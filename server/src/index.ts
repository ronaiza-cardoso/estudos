import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { URL_BANCO, abrirBanco, encerrarBanco, garantirConfig, migrar } from './db.js';
import { limparSessoesVencidas, loginAtivo } from './auth.js';
import { popularSeed } from './seed.js';
import { rotasMaterias } from './routes/materias.js';
import { rotasSessoes } from './routes/sessoes.js';
import { rotasAtividade } from './routes/atividade.js';
import { rotasQuestoes } from './routes/questoes.js';
import { rotasProvas } from './routes/provas.js';
import { rotasConfig } from './routes/config.js';
import { rotasBackup } from './routes/backup.js';
import { rotasPacote } from './routes/pacote.js';
import { rotasImportacao } from './routes/importacao.js';
import { rotasNotas } from './routes/notas.js';
import { fecharImportacoesOrfas } from './import/prints/job.js';
import { registrarAutenticacao } from './routes/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
// O host da nuvem decide a porta e a injeta em PORT.
const PORTA = Number(process.env.PORT ?? 5183);

/**
 * Em modo servidor (Docker, nuvem) o processo precisa escutar em todas as
 * interfaces, senão o proxy do host não alcança o app. Localmente fica no
 * loopback: o app não aparece na rede sem você pedir.
 */
const HOST = process.env.HOST ?? (URL_BANCO ? '0.0.0.0' : '127.0.0.1');

/**
 * Atrás do proxy do host, `req.ip` seria o endereço do próprio proxy — e a
 * trava de força bruta do login viraria um balde único para o mundo inteiro.
 * É também daqui que sai `req.protocol === 'https'`, que decide o cookie
 * Secure. `ESTUDOS_PROXY=0` desliga para quem expõe o Node direto.
 *
 * Confiar só no **primeiro salto** (o proxy que abriu a conexão), e não em
 * `true`: com `true` valeria o endereço mais à esquerda do X-Forwarded-For,
 * que qualquer cliente pode escrever — e a trava do login cairia só mandando
 * um cabeçalho diferente a cada tentativa. Assim vale o último endereço do
 * cabeçalho, o único que o proxy escreveu.
 */
const ATRAS_DE_PROXY = process.env.ESTUDOS_PROXY === '0' ? false : Boolean(URL_BANCO);

/** Equivale a `trustProxy: 1`, que a tipagem desta versão do Fastify recusa. */
const soPrimeiroSalto = (_endereco: string, salto: number) => salto === 0;

await abrirBanco();
await migrar();
await garantirConfig();

const orfas = await fecharImportacoesOrfas();
if (orfas > 0) console.log(`${orfas} importação(ões) interrompida(s) foram encerradas.`);

const inseridas = await popularSeed();
if (inseridas > 0) console.log(`seed-questoes.js: ${inseridas} questões carregadas.`);

if (loginAtivo()) {
  const vencidas = await limparSessoesVencidas();
  console.log(`Login ativo${vencidas > 0 ? ` (${vencidas} sessões vencidas removidas)` : ''}.`);
} else {
  console.log('Login desativado (banco embutido). Use ESTUDOS_LOGIN=1 para exigir senha.');
}

if (URL_BANCO && !process.env.TZ) {
  console.warn(
    'Atenção: TZ não está definida. As datas seriam gravadas em UTC e o que ' +
      'você estuda à noite cairia no dia seguinte. Defina TZ=America/Sao_Paulo.',
  );
}

const app = Fastify({
  logger: false,
  bodyLimit: 32 * 1024 * 1024,
  // Um salto: confia no proxy que está na frente, e não na cadeia inteira de
  // X-Forwarded-For — que o cliente consegue forjar. O Fastify aceita o número
  // em tempo de execução, mas a tipagem desta versão só declara
  // boolean/string/lista, daí o cast.
  trustProxy: ATRAS_DE_PROXY ? soPrimeiroSalto : false,
});

// Sem `credentials: true` de propósito: o cookie de sessão é SameSite=Lax e
// nunca deve viajar para outra origem. Nos três modos o front é servido da
// mesma origem da API (no dev, via proxy do Vite).
await app.register(cors, { origin: true });

app.get('/api/saude', async () => ({ ok: true }));

// Antes das rotas do app: o hook precisa valer para todas elas.
await registrarAutenticacao(app);

rotasMaterias(app);
rotasSessoes(app);
rotasAtividade(app);
rotasQuestoes(app);
rotasProvas(app);
rotasConfig(app);
rotasBackup(app);
rotasPacote(app);
rotasImportacao(app);
rotasNotas(app);

// Em produção (Docker) o próprio Fastify serve o front já compilado.
// Em desenvolvimento quem serve é o Vite, então a pasta não existe.
const estaticos = process.env.ESTUDOS_WEB_DIR ?? resolve(here, '../../web/dist');
if (existsSync(estaticos)) {
  await app.register(fastifyStatic, { root: estaticos });
  // Navegação de página única cai no index.html. Só GET/HEAD: um POST para
  // uma rota inexistente tem de responder 404, não a página inicial.
  app.setNotFoundHandler((req, reply) => {
    const navegacao = req.method === 'GET' || req.method === 'HEAD';
    if (navegacao && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
    return reply.code(404).send({ erro: 'Rota não encontrada.' });
  });
  console.log(`Servindo o front de ${estaticos}`);
}

app.setErrorHandler((erro: FastifyError, _req, reply) => {
  console.error(erro);
  reply.code(erro.statusCode ?? 500).send({ erro: erro.message });
});

await app.listen({ port: PORTA, host: HOST });
console.log(`Estudos em http://localhost:${PORTA}`);

for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    await encerrarBanco();
    process.exit(0);
  });
}
