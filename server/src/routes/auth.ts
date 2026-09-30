import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import {
  COOKIE_SESSAO,
  DIAS_SESSAO,
  bloqueioRestante,
  buscarPorLogin,
  conferirSenha,
  contaConfigurada,
  contarSessoes,
  criarConta,
  criarSessao,
  criticarSenha,
  encerrarSessao,
  encerrarSessoesDoUsuario,
  limparFalhas,
  loginAtivo,
  registrarFalha,
  trocarSenha,
  usuarioDaSessao,
  type Usuario,
} from '../auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Preenchido pelo guarda. Null quando o login está desligado. */
    usuario: Usuario | null;
  }
}

/**
 * Rotas que respondem sem sessão. As três primeiras são o que a tela de login
 * precisa para existir; /api/saude é o healthcheck do compose, e o logout fica
 * aberto para que uma sessão já vencida ainda consiga limpar o cookie.
 */
const ABERTAS = new Set([
  '/api/saude',
  '/api/sessao',
  '/api/login',
  '/api/logout',
  '/api/primeiro-acesso',
]);

function opcoesCookie() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    // Só com HTTPS na frente. Ligado em HTTP puro, o navegador descarta o
    // cookie e o login entra em laço — por isso o padrão é desligado.
    secure: process.env.COOKIE_SEGURO === '1',
    maxAge: DIAS_SESSAO * 24 * 60 * 60,
  };
}

/** Chave da trava de força bruta. */
const origem = (req: FastifyRequest) => req.ip || 'desconhecida';

/**
 * Guarda + rotas de autenticação. Precisa ser chamado **antes** de registrar
 * as rotas do app, para que o hook valha para todas elas.
 */
export async function registrarAutenticacao(app: FastifyInstance) {
  await app.register(cookie);

  app.decorateRequest('usuario', null);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!loginAtivo()) return;

    const caminho = req.url.split('?')[0];

    // O front é servido estaticamente: a página precisa carregar para poder
    // mostrar a tela de login. O que ela busca é a API, e essa é protegida.
    if (!caminho.startsWith('/api/')) return;
    if (req.method === 'OPTIONS') return; // preflight do CORS
    if (ABERTAS.has(caminho)) return;

    const usuario = await usuarioDaSessao(req.cookies[COOKIE_SESSAO]);
    if (!usuario) {
      // O cookie pode estar velho; limpar evita reenviar lixo a cada request.
      reply.clearCookie(COOKIE_SESSAO, { path: '/' });
      return reply.code(401).send({ erro: 'Faça login para continuar.' });
    }
    req.usuario = usuario;
  });

  /** Estado para o front decidir qual tela mostrar. */
  app.get('/api/sessao', async (req) => {
    if (!loginAtivo()) {
      return { login_ativo: false, configurado: true, autenticado: true, usuario: null };
    }
    const usuario = await usuarioDaSessao(req.cookies[COOKIE_SESSAO]);
    return {
      login_ativo: true,
      configurado: await contaConfigurada(),
      autenticado: Boolean(usuario),
      usuario,
      sessoes: usuario ? await contarSessoes(usuario.id) : 0,
    };
  });

  /** Cadastro da conta única. Só funciona enquanto não existe nenhuma. */
  app.post<{ Body: { login?: string; senha?: string } }>(
    '/api/primeiro-acesso',
    async (req, reply) => {
      if (!loginAtivo()) return reply.code(400).send({ erro: 'O login está desativado.' });
      if (await contaConfigurada())
        return reply.code(409).send({ erro: 'A conta já foi criada. Use a tela de login.' });

      const login = (req.body?.login ?? '').trim();
      if (login.length < 3)
        return reply.code(400).send({ erro: 'O usuário precisa ter pelo menos 3 caracteres.' });

      const problema = criticarSenha(req.body?.senha);
      if (problema) return reply.code(400).send({ erro: problema });

      const usuario = await criarConta(login, req.body!.senha!);
      const token = await criarSessao(usuario.id);
      reply.setCookie(COOKIE_SESSAO, token, opcoesCookie());
      return { ok: true, usuario };
    },
  );

  app.post<{ Body: { login?: string; senha?: string } }>('/api/login', async (req, reply) => {
    if (!loginAtivo()) return reply.code(400).send({ erro: 'O login está desativado.' });

    const chave = origem(req);
    const espera = bloqueioRestante(chave);
    if (espera > 0) {
      reply.header('Retry-After', String(espera));
      return reply
        .code(429)
        .send({ erro: `Tentativas demais. Espere ${Math.ceil(espera / 60)} min.` });
    }

    const login = (req.body?.login ?? '').trim();
    const senha = req.body?.senha ?? '';

    const usuario = login ? await buscarPorLogin(login) : undefined;
    // Mesma resposta para usuário inexistente e senha errada: não entregamos
    // qual dos dois falhou.
    const ok = usuario ? await conferirSenha(senha, usuario.senha_hash) : false;

    if (!ok || !usuario) {
      registrarFalha(chave);
      return reply.code(401).send({ erro: 'Usuário ou senha inválidos.' });
    }

    limparFalhas(chave);
    const token = await criarSessao(usuario.id);
    reply.setCookie(COOKIE_SESSAO, token, opcoesCookie());
    return { ok: true, usuario: { id: usuario.id, login: usuario.login } };
  });

  app.post('/api/logout', async (req, reply) => {
    await encerrarSessao(req.cookies[COOKIE_SESSAO]);
    reply.clearCookie(COOKIE_SESSAO, { path: '/' });
    return { ok: true };
  });

  /** Troca de senha. Derruba as outras sessões e mantém a atual. */
  app.put<{ Body: { senha_atual?: string; senha_nova?: string } }>(
    '/api/senha',
    async (req, reply) => {
      if (!loginAtivo()) return reply.code(400).send({ erro: 'O login está desativado.' });
      const atual = req.usuario;
      if (!atual) return reply.code(401).send({ erro: 'Não autenticado.' });

      const registro = await buscarPorLogin(atual.login);
      if (!registro) return reply.code(401).send({ erro: 'Não autenticado.' });

      if (!(await conferirSenha(req.body?.senha_atual ?? '', registro.senha_hash))) {
        registrarFalha(origem(req));
        return reply.code(401).send({ erro: 'Senha atual incorreta.' });
      }

      const problema = criticarSenha(req.body?.senha_nova);
      if (problema) return reply.code(400).send({ erro: problema });

      await trocarSenha(atual.id, req.body!.senha_nova!);
      await encerrarSessoesDoUsuario(atual.id, req.cookies[COOKIE_SESSAO]);
      return { ok: true };
    },
  );
}
