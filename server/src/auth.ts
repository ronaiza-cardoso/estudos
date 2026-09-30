import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { exec, q, um } from './db.js';
import { agoraLocal } from './util.js';

/**
 * Login de conta única — uma tranca no app, não um sistema multiusuário.
 * Nenhuma tabela de dados ganhou `usuario_id`: quem entra vê tudo.
 *
 * Duas escolhas que valem explicação:
 *
 *  - **scrypt do `node:crypto`**, e não bcrypt/argon2. Os dois exigem
 *    compilação nativa, o que quebraria tanto a imagem Alpine quanto o
 *    empacotamento do Electron. O scrypt é da biblioteca padrão e é um KDF
 *    legítimo para senha.
 *  - **sessão no banco**, e não token assinado. Assim "Sair" invalida de
 *    verdade e não é preciso guardar um segredo de assinatura em disco — o
 *    token aleatório *é* o segredo, e só o cookie o carrega.
 */

/** `promisify` perde a sobrecarga com opções, então o wrapper é na mão. */
function scrypt(
  senha: string,
  salt: Buffer,
  tamanho: number,
  opcoes: ScryptOptions,
): Promise<Buffer> {
  return new Promise((ok, falha) => {
    scryptCb(senha, salt, tamanho, opcoes, (erro, chave) =>
      erro ? falha(erro) : ok(chave),
    );
  });
}

/** Custo do scrypt. Gravado junto do hash, para poder subir depois sem quebrar os hashes antigos. */
const CUSTO = { N: 16384, r: 8, p: 1 } as const;
const TAM_CHAVE = 64;

export const COOKIE_SESSAO = 'estudos_sessao';

/** Sessão longa: é um app de uso diário, relogar toda hora só atrapalha. */
export const DIAS_SESSAO = 30;

/** Mínimo de caracteres da senha. Curto demais não protege nada. */
export const MIN_SENHA = 8;

export type Usuario = { id: number; login: string };

/**
 * O login vale no Docker/web e é transparente no app desktop: lá o banco é um
 * arquivo na pasta do usuário, já atrás do login do sistema operacional, e o
 * Electron apaga `DATABASE_URL` justamente para usar o banco embutido.
 *
 * `ESTUDOS_LOGIN=1` liga à força (útil em `npm run dev`), `0` desliga.
 */
export function loginAtivo(): boolean {
  const v = process.env.ESTUDOS_LOGIN?.trim().toLowerCase();
  if (v === '0' || v === 'false') return false;
  if (v === '1' || v === 'true') return true;
  return Boolean(process.env.DATABASE_URL);
}

/* ------------------------------ senha ------------------------------ */

/** `scrypt$N$r$p$salt$hash`, tudo em hex. */
async function derivar(senha: string, salt: Buffer): Promise<Buffer> {
  return scrypt(senha.normalize('NFKC'), salt, TAM_CHAVE, {
    N: CUSTO.N,
    r: CUSTO.r,
    p: CUSTO.p,
    // O Node recusa N alto sem folga de memória para a operação.
    maxmem: 256 * 1024 * 1024,
  });
}

export async function gerarHash(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derivar(senha, salt);
  return `scrypt$${CUSTO.N}$${CUSTO.r}$${CUSTO.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  const partes = armazenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;

  const [, n, r, p, saltHex, hashHex] = partes;
  const salt = Buffer.from(saltHex, 'hex');
  const esperado = Buffer.from(hashHex, 'hex');
  if (salt.length === 0 || esperado.length === 0) return false;

  const obtido = await scrypt(senha.normalize('NFKC'), salt, esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 256 * 1024 * 1024,
  });

  // Mesmo tamanho por construção, mas timingSafeEqual lança se diferir.
  if (obtido.length !== esperado.length) return false;
  return timingSafeEqual(obtido, esperado);
}

/** Recusa senhas curtas. Devolve a mensagem de erro, ou null se estiver boa. */
export function criticarSenha(senha: unknown): string | null {
  if (typeof senha !== 'string' || senha.length === 0) return 'Informe a senha.';
  if (senha.length < MIN_SENHA) return `A senha precisa ter pelo menos ${MIN_SENHA} caracteres.`;
  if (senha.length > 200) return 'Senha longa demais.';
  return null;
}

/* ------------------------------ conta ------------------------------ */

/** Já existe alguém cadastrado? É o que decide entre tela de login e de primeiro acesso. */
export async function contaConfigurada(): Promise<boolean> {
  const r = await um<{ n: string }>('SELECT count(*) AS n FROM usuarios');
  return Number(r?.n ?? 0) > 0;
}

/**
 * Cria a conta única. Falha se já houver uma — é o que impede alguém de
 * chamar /api/primeiro-acesso depois e se cadastrar por cima.
 */
export async function criarConta(login: string, senha: string): Promise<Usuario> {
  const nome = login.trim();
  if (await contaConfigurada()) throw new Error('A conta já foi criada.');

  const criado = await um<Usuario>(
    `INSERT INTO usuarios (login, senha_hash, criado_em) VALUES ($1, $2, $3)
     RETURNING id, login`,
    [nome, await gerarHash(senha), agoraLocal()],
  );
  return criado!;
}

export async function buscarPorLogin(login: string) {
  return um<{ id: number; login: string; senha_hash: string }>(
    'SELECT id, login, senha_hash FROM usuarios WHERE lower(login) = lower($1)',
    [login.trim()],
  );
}

export async function trocarSenha(usuarioId: number, senhaNova: string): Promise<void> {
  await exec('UPDATE usuarios SET senha_hash = $1 WHERE id = $2', [
    await gerarHash(senhaNova),
    usuarioId,
  ]);
}

/* ------------------------------ sessão ------------------------------ */

function vencimento(): string {
  const d = new Date();
  d.setDate(d.getDate() + DIAS_SESSAO);
  return agoraLocal(d);
}

export async function criarSessao(usuarioId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await exec(
    'INSERT INTO sessoes_login (token, usuario_id, criada_em, expira_em) VALUES ($1, $2, $3, $4)',
    [token, usuarioId, agoraLocal(), vencimento()],
  );
  return token;
}

/** Devolve o usuário da sessão, ou null se o token for inválido ou vencido. */
export async function usuarioDaSessao(token: string | undefined): Promise<Usuario | null> {
  if (!token) return null;
  const linha = await um<Usuario>(
    `SELECT u.id, u.login
       FROM sessoes_login s
       JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token = $1 AND s.expira_em > $2`,
    [token, agoraLocal()],
  );
  return linha ?? null;
}

export async function encerrarSessao(token: string | undefined): Promise<void> {
  if (!token) return;
  await exec('DELETE FROM sessoes_login WHERE token = $1', [token]);
}

/** Usado ao trocar a senha: derruba todos os outros acessos. */
export async function encerrarSessoesDoUsuario(usuarioId: number, exceto?: string): Promise<void> {
  if (exceto) {
    await exec('DELETE FROM sessoes_login WHERE usuario_id = $1 AND token <> $2', [
      usuarioId,
      exceto,
    ]);
  } else {
    await exec('DELETE FROM sessoes_login WHERE usuario_id = $1', [usuarioId]);
  }
}

/** Faxina de boot: sessões vencidas não servem para nada. */
export async function limparSessoesVencidas(): Promise<number> {
  return exec('DELETE FROM sessoes_login WHERE expira_em <= $1', [agoraLocal()]);
}

/* --------------------------- força bruta --------------------------- */

/**
 * Trava simples por origem, em memória. Não é rate limit distribuído: é um
 * app de uma instância, e o objetivo é só tornar inviável testar senhas em
 * sequência.
 */
const JANELA_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 8;
const tentativas = new Map<string, { n: number; ate: number }>();

export function bloqueioRestante(chave: string): number {
  const reg = tentativas.get(chave);
  if (!reg) return 0;
  if (Date.now() > reg.ate) {
    tentativas.delete(chave);
    return 0;
  }
  if (reg.n < MAX_TENTATIVAS) return 0;
  return Math.ceil((reg.ate - Date.now()) / 1000);
}

export function registrarFalha(chave: string): void {
  const agora = Date.now();
  const reg = tentativas.get(chave);
  if (!reg || agora > reg.ate) tentativas.set(chave, { n: 1, ate: agora + JANELA_MS });
  else reg.n += 1;
}

export function limparFalhas(chave: string): void {
  tentativas.delete(chave);
}

/** Só para os testes: zera o estado em memória. */
export function zerarTravas(): void {
  tentativas.clear();
}

/** Sessões ativas, para a tela de configurações. */
export async function contarSessoes(usuarioId: number): Promise<number> {
  const r = await q<{ n: string }>(
    'SELECT count(*) AS n FROM sessoes_login WHERE usuario_id = $1 AND expira_em > $2',
    [usuarioId, agoraLocal()],
  );
  return Number(r[0]?.n ?? 0);
}
