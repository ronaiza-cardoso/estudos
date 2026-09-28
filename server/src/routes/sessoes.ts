import type { FastifyInstance } from 'fastify';
import { exec, q, um } from '../db.js';
import { agoraLocal, diaLocal, diasSeguidos, ultimosDias } from '../util.js';

type NovaSessao = { minutos: number; completa?: boolean; inicio?: string };

export function rotasSessoes(app: FastifyInstance) {
  app.get<{ Querystring: { limite?: string } }>('/api/sessoes', async (req) => {
    const limite = Math.min(Number(req.query.limite ?? 100) || 100, 1000);
    return q(
      `SELECT id, inicio, minutos, completa
         FROM sessoes ORDER BY inicio DESC, id DESC LIMIT $1`,
      [limite],
    );
  });

  app.post<{ Body: NovaSessao }>('/api/sessoes', async (req, reply) => {
    const minutos = Number(req.body?.minutos);
    if (!minutos || minutos < 1)
      return reply.code(400).send({ erro: 'A sessão precisa ter ao menos 1 minuto.' });

    const criada = await um<{ id: number }>(
      'INSERT INTO sessoes (inicio, minutos, completa) VALUES ($1, $2, $3) RETURNING id',
      [req.body.inicio ?? agoraLocal(), Math.round(minutos), req.body.completa !== false],
    );
    return reply.code(201).send({ id: criada!.id });
  });

  app.delete<{ Params: { id: string } }>('/api/sessoes/:id', async (req) => {
    await exec('DELETE FROM sessoes WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  });

  app.get('/api/estatisticas', async () => {
    const hoje = diaLocal();
    const dias7 = ultimosDias(7);

    const porDia = await q<{ dia: string; minutos: number }>(
      `SELECT substr(inicio, 1, 10) AS dia, SUM(minutos)::int AS minutos
         FROM sessoes GROUP BY 1`,
    );

    const mapaDia = new Map(porDia.map((d) => [d.dia, d.minutos]));
    const soma = (dias: string[]) => dias.reduce((a, d) => a + (mapaDia.get(d) ?? 0), 0);

    const total = (await um<{ minutos: number; sessoes: number }>(
      'SELECT COALESCE(SUM(minutos), 0)::int AS minutos, COUNT(*)::int AS sessoes FROM sessoes',
    ))!;

    // Percentual de acerto ignora questões anuladas.
    const acertos = (await um<{ respondidas: number; certas: number }>(
      `SELECT COUNT(*)::int AS respondidas,
              COUNT(*) FILTER (WHERE r.correta)::int AS certas
         FROM respostas r
         JOIN questoes q ON q.id = r.questao_id
        WHERE NOT q.anulada`,
    ))!;

    // Sem matéria nas sessões, a tabela por matéria é só de questões.
    const porMateria = await q<{
      id: number;
      nome: string;
      respondidas: number;
      certas: number;
    }>(
      `SELECT m.id, m.nome,
              COUNT(r.id)::int                        AS respondidas,
              COUNT(r.id) FILTER (WHERE r.correta)::int AS certas
         FROM materias m
         LEFT JOIN questoes  q ON q.materia_id = m.id AND NOT q.anulada
         LEFT JOIN respostas r ON r.questao_id = q.id
        GROUP BY m.id, m.nome
        ORDER BY respondidas DESC, lower(m.nome)`,
    );

    const questoesPorMateria = await q<{ id: number; total: number }>(
      `SELECT materia_id AS id, COUNT(*)::int AS total
         FROM questoes WHERE materia_id IS NOT NULL GROUP BY materia_id`,
    );
    const mapaQuestoes = new Map(questoesPorMateria.map((x) => [x.id, x.total]));

    return {
      hoje: mapaDia.get(hoje) ?? 0,
      semana: soma(dias7),
      media_semana: Math.round(soma(dias7) / 7),
      total: total.minutos,
      total_sessoes: total.sessoes,
      dias_seguidos: diasSeguidos(porDia.filter((d) => d.minutos > 0).map((d) => d.dia)),
      questoes_respondidas: acertos.respondidas,
      questoes_certas: acertos.certas,
      percentual_acerto:
        acertos.respondidas > 0
          ? Math.round((acertos.certas / acertos.respondidas) * 100)
          : 0,
      por_materia: porMateria.map((m) => ({
        id: m.id,
        nome: m.nome,
        questoes: mapaQuestoes.get(m.id) ?? 0,
        respondidas: m.respondidas,
        certas: m.certas,
        acerto:
          m.respondidas > 0 ? Math.round((m.certas / m.respondidas) * 100) : null,
      })),
    };
  });
}
