import type { FastifyInstance } from 'fastify';
import { exec, q, um } from '../db.js';

export function rotasMaterias(app: FastifyInstance) {
  app.get('/api/materias', async () =>
    q(
      `SELECT m.id, m.nome,
              (SELECT COUNT(*) FROM questoes qq WHERE qq.materia_id = m.id)::int AS questoes
         FROM materias m
        ORDER BY lower(m.nome)`,
    ),
  );

  app.post<{ Body: { nome?: string } }>('/api/materias', async (req, reply) => {
    const nome = (req.body?.nome ?? '').trim();
    if (!nome) return reply.code(400).send({ erro: 'Informe o nome da matéria.' });

    const existente = await um('SELECT id FROM materias WHERE lower(nome) = lower($1)', [
      nome,
    ]);
    if (existente) return reply.code(409).send({ erro: 'Essa matéria já existe.' });

    const criada = await um<{ id: number }>(
      'INSERT INTO materias (nome) VALUES ($1) RETURNING id',
      [nome],
    );
    return reply.code(201).send({ id: criada!.id, nome });
  });

  app.delete<{ Params: { id: string } }>('/api/materias/:id', async (req) => {
    await exec('DELETE FROM materias WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  });
}
