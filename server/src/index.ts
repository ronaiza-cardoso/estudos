import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { abrirBanco, encerrarBanco, garantirConfig, migrar } from './db.js';
import { popularSeed } from './seed.js';
import { rotasMaterias } from './routes/materias.js';
import { rotasSessoes } from './routes/sessoes.js';
import { rotasAtividade } from './routes/atividade.js';
import { rotasQuestoes } from './routes/questoes.js';
import { rotasProvas } from './routes/provas.js';
import { rotasConfig } from './routes/config.js';
import { rotasBackup } from './routes/backup.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT ?? 5183);
// No Docker precisa escutar em 0.0.0.0; localmente, só no loopback.
const HOST = process.env.HOST ?? '127.0.0.1';

await abrirBanco();
await migrar();
await garantirConfig();

const inseridas = await popularSeed();
if (inseridas > 0) console.log(`seed-questoes.js: ${inseridas} questões carregadas.`);

const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });

await app.register(cors, { origin: true });

app.get('/api/saude', async () => ({ ok: true }));

rotasMaterias(app);
rotasSessoes(app);
rotasAtividade(app);
rotasQuestoes(app);
rotasProvas(app);
rotasConfig(app);
rotasBackup(app);

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
