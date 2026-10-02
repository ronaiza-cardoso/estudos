import type { FastifyInstance } from 'fastify';
import {
  FORMATO_DIA,
  atualizarTarefa,
  criarTarefas,
  listarNotas,
  removerNota,
  removerTarefa,
  salvarNota,
  tarefasAbertas,
} from '../notas.js';
import { diaLocal } from '../util.js';

const ERRO_DIA = 'Dia inválido. Use o formato AAAA-MM-DD.';

export function rotasNotas(app: FastifyInstance) {
  /**
   * O painel "para hoje". Vem antes de `/api/notas/:dia` na leitura do router
   * porque segmento fixo ganha de parâmetro, mas a ordem aqui também deixa isso
   * explícito para quem lê.
   */
  app.get('/api/notas/pendentes', async () => ({
    hoje: diaLocal(),
    tarefas: await tarefasAbertas(),
  }));

  app.get<{ Querystring: { limite?: string } }>('/api/notas', async (req) => {
    const limite = Math.min(Number(req.query.limite ?? 60) || 60, 400);
    return listarNotas(limite);
  });

  app.put<{ Params: { dia: string }; Body: { texto?: string } }>(
    '/api/notas/:dia',
    async (req, reply) => {
      const { dia } = req.params;
      if (!FORMATO_DIA.test(dia)) return reply.code(400).send({ erro: ERRO_DIA });

      const nota = await salvarNota(dia, req.body?.texto ?? '');
      // Texto vazio e nenhuma tarefa: a nota deixou de existir.
      return nota ?? { dia, texto: '', tarefas: [], removida: true };
    },
  );

  app.delete<{ Params: { dia: string } }>('/api/notas/:dia', async (req, reply) => {
    const { dia } = req.params;
    if (!FORMATO_DIA.test(dia)) return reply.code(400).send({ erro: ERRO_DIA });
    await removerNota(dia);
    return { ok: true };
  });

  app.post<{ Params: { dia: string }; Body: { texto?: string } }>(
    '/api/notas/:dia/tarefas',
    async (req, reply) => {
      const { dia } = req.params;
      if (!FORMATO_DIA.test(dia)) return reply.code(400).send({ erro: ERRO_DIA });

      const criadas = await criarTarefas(dia, req.body?.texto ?? '');
      if (criadas.length === 0)
        return reply.code(400).send({ erro: 'Escreva o que precisa ser feito.' });
      return reply.code(201).send(criadas);
    },
  );

  app.put<{ Params: { id: string }; Body: { texto?: string; feita?: boolean } }>(
    '/api/tarefas/:id',
    async (req, reply) => {
      const resultado = await atualizarTarefa(Number(req.params.id), {
        texto: req.body?.texto,
        feita: req.body?.feita === undefined ? undefined : !!req.body.feita,
      });
      if (resultado === null)
        return reply.code(404).send({ erro: 'Tarefa não encontrada.' });
      if (resultado === 'texto-vazio')
        return reply.code(400).send({ erro: 'Escreva o que precisa ser feito.' });
      return resultado;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/tarefas/:id', async (req) => {
    await removerTarefa(Number(req.params.id));
    return { ok: true };
  });
}
