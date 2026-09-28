import type { FastifyInstance } from 'fastify';
import { q, um } from '../db.js';

/**
 * Dados do heatmap: um registro por dia com estudo, e o detalhe de um dia.
 *
 * As sessões não guardam matéria (o pomodoro é só o contador), então "o que
 * foi estudado" no dia vem das questões respondidas e das provas resolvidas,
 * que têm matéria.
 */
export function rotasAtividade(app: FastifyInstance) {
  /** Minutos e nº de sessões por dia — o grid é montado no front. */
  app.get('/api/atividade', async () =>
    q<{ dia: string; minutos: number; sessoes: number }>(
      `SELECT substr(inicio, 1, 10) AS dia,
              SUM(minutos)::int     AS minutos,
              COUNT(*)::int         AS sessoes
         FROM sessoes
        GROUP BY 1
        ORDER BY 1`,
    ),
  );

  app.get<{ Params: { data: string } }>('/api/atividade/:data', async (req, reply) => {
    const dia = req.params.data;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia))
      return reply.code(400).send({ erro: 'Data inválida. Use AAAA-MM-DD.' });

    const sessoes = await q(
      `SELECT id, inicio, minutos, completa
         FROM sessoes WHERE substr(inicio, 1, 10) = $1
        ORDER BY inicio`,
      [dia],
    );

    const resumo = (await um<{ minutos: number; total_sessoes: number; interrompidas: number }>(
      `SELECT COALESCE(SUM(minutos), 0)::int            AS minutos,
              COUNT(*)::int                             AS total_sessoes,
              COUNT(*) FILTER (WHERE NOT completa)::int AS interrompidas
         FROM sessoes WHERE substr(inicio, 1, 10) = $1`,
      [dia],
    ))!;

    // Questões respondidas no dia, agrupadas por matéria. Anuladas ficam de
    // fora da conta de acerto, como no resto do app.
    const materias = await q(
      `SELECT COALESCE(m.nome, 'Sem matéria')                            AS materia,
              COUNT(*)::int                                              AS respondidas,
              COUNT(*) FILTER (WHERE r.correta AND NOT qq.anulada)::int   AS certas,
              COUNT(*) FILTER (WHERE qq.anulada)::int                     AS anuladas
         FROM respostas r
         JOIN questoes qq ON qq.id = r.questao_id
         LEFT JOIN materias m ON m.id = qq.materia_id
        WHERE substr(r.ts, 1, 10) = $1
        GROUP BY 1
        ORDER BY respondidas DESC, 1`,
      [dia],
    );

    const provas = await q(
      `SELECT p.id, p.nome, res.acertos, res.total, res.tempo_seg, res.ts
         FROM resultados res
         JOIN provas p ON p.id = res.prova_id
        WHERE substr(res.ts, 1, 10) = $1
        ORDER BY res.ts`,
      [dia],
    );

    return { dia, ...resumo, sessoes, materias, provas };
  });
}
