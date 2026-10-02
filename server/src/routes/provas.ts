import type { FastifyInstance } from 'fastify';
import { exec, q as consulta, tx, um } from '../db.js';
import { agoraLocal, diaLocal } from '../util.js';
import {
  estados,
  ordenarParaRevisao,
  ordenarPorErros,
  resumir,
  semAdiadas,
  type Estado,
} from '../revisao.js';
import { hidratar } from './questoes.js';

async function criarProvaCom(nome: string, ids: string[]): Promise<number> {
  return tx(async (c) => {
    const r = await c.query<{ id: number }>(
      'INSERT INTO provas (nome, criada_em) VALUES ($1, $2) RETURNING id',
      [nome, agoraLocal()],
    );
    const provaId = r.rows[0].id;
    for (const [i, questaoId] of ids.entries()) {
      await c.query(
        `INSERT INTO prova_questoes (prova_id, questao_id, ordem) VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [provaId, questaoId, i + 1],
      );
    }
    return provaId;
  });
}

/** Data curta para nomear caderno gerado, no formato que você lê: 30/09. */
function hojeCurto(): string {
  const [ano, mes, dia] = diaLocal().split('-');
  return `${dia}/${mes}/${ano.slice(2)}`;
}

export function rotasProvas(app: FastifyInstance) {
  app.get('/api/provas', async () =>
    consulta(
      `SELECT p.id, p.nome, p.criada_em,
              (SELECT COUNT(*)::int FROM prova_questoes pq WHERE pq.prova_id = p.id) AS questoes,
              COALESCE((
                SELECT array_agg(DISTINCT m.nome ORDER BY m.nome)
                  FROM prova_questoes pq
                  JOIN questoes q ON q.id = pq.questao_id
                  JOIN materias m ON m.id = q.materia_id
                 WHERE pq.prova_id = p.id
              ), '{}') AS materias,
              (SELECT to_jsonb(r) FROM (
                 SELECT acertos, total, tempo_seg, ts FROM resultados
                  WHERE prova_id = p.id ORDER BY ts DESC, id DESC LIMIT 1
               ) r) AS ultimo_resultado,
              (SELECT round(MAX(acertos::numeric / NULLIF(total, 0)) * 100)::int
                 FROM resultados WHERE prova_id = p.id) AS melhor_aproveitamento
         FROM provas p
        ORDER BY p.criada_em DESC, p.id DESC`,
    ),
  );

  app.get<{ Params: { id: string } }>('/api/provas/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const prova = await um('SELECT id, nome, criada_em FROM provas WHERE id = $1', [id]);
    if (!prova) return reply.code(404).send({ erro: 'Prova não encontrada.' });

    const linhas = await consulta<any>(
      `SELECT q.id, q.materia_id, m.nome AS materia, q.assunto, q.ano, q.banca, q.orgao,
              q.prova, q.texto_assoc, q.enunciado, q.alternativas_json, q.gabarito,
              q.anulada, q.custom, a.texto AS anotacao
         FROM prova_questoes pq
         JOIN questoes q ON q.id = pq.questao_id
         LEFT JOIN materias  m ON m.id = q.materia_id
         LEFT JOIN anotacoes a ON a.questao_id = q.id
        WHERE pq.prova_id = $1
        ORDER BY pq.ordem`,
      [id],
    );

    const resultados = await consulta(
      'SELECT id, acertos, total, tempo_seg, ts FROM resultados WHERE prova_id = $1 ORDER BY ts DESC',
      [id],
    );

    return { ...prova, questoes: await hidratar(linhas), resultados };
  });

  app.post<{ Body: { nome?: string; questao_ids?: string[] } }>(
    '/api/provas',
    async (req, reply) => {
      const nome = (req.body?.nome ?? '').trim();
      const ids = req.body?.questao_ids ?? [];
      if (!nome) return reply.code(400).send({ erro: 'Dê um nome à prova.' });
      if (ids.length === 0)
        return reply.code(400).send({ erro: 'Selecione ao menos uma questão.' });

      const provaId = await tx(async (c) => {
        const r = await c.query<{ id: number }>(
          'INSERT INTO provas (nome, criada_em) VALUES ($1, $2) RETURNING id',
          [nome, agoraLocal()],
        );
        const novaId = r.rows[0].id;
        for (const [i, qid] of ids.entries()) {
          await c.query(
            `INSERT INTO prova_questoes (prova_id, questao_id, ordem) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [novaId, qid, i + 1],
          );
        }
        return novaId;
      });

      return reply.code(201).send({ id: provaId, nome });
    },
  );

  /** Sorteia questões de uma matéria (ou de todas), sempre ignorando as anuladas. */
  app.post<{ Body: { nome?: string; materia_id?: number | null; quantidade?: number } }>(
    '/api/provas/aleatoria',
    async (req, reply) => {
      const quantidade = Math.max(1, Math.min(Number(req.body?.quantidade ?? 10), 200));
      const materiaId = req.body?.materia_id ? Number(req.body.materia_id) : null;

      const sorteadas = await consulta<{ id: string }>(
        `SELECT id FROM questoes
          WHERE NOT anulada AND gabarito IS NOT NULL
            AND ($1::int IS NULL OR materia_id = $1)
          ORDER BY random() LIMIT $2`,
        [materiaId, quantidade],
      );

      if (sorteadas.length === 0)
        return reply
          .code(400)
          .send({ erro: 'Não há questões disponíveis para esse filtro.' });

      const materia = materiaId
        ? await um<{ nome: string }>('SELECT nome FROM materias WHERE id = $1', [materiaId])
        : undefined;

      const nome =
        (req.body?.nome ?? '').trim() ||
        `Aleatória — ${materia?.nome ?? 'todas as matérias'} (${sorteadas.length})`;

      const provaId = await tx(async (c) => {
        const r = await c.query<{ id: number }>(
          'INSERT INTO provas (nome, criada_em) VALUES ($1, $2) RETURNING id',
          [nome, agoraLocal()],
        );
        const novaId = r.rows[0].id;
        for (const [i, s] of sorteadas.entries()) {
          await c.query(
            'INSERT INTO prova_questoes (prova_id, questao_id, ordem) VALUES ($1, $2, $3)',
            [novaId, s.id, i + 1],
          );
        }
        return novaId;
      });

      return reply.code(201).send({ id: provaId, nome, questoes: sorteadas.length });
    },
  );

  /* ------------------------------- revisão ------------------------------- */

  /** Quanto está vencido hoje, sem gerar caderno nenhum. */
  app.get<{ Querystring: { materia_id?: string; dias?: string } }>(
    '/api/revisao',
    async (req) => {
      const lista = await estados({
        materiaId: req.query.materia_id ? Number(req.query.materia_id) : null,
        diasDoPeriodo: Number(req.query.dias) || 7,
      });
      return resumir(lista);
    },
  );

  /**
   * Caderno da sessão: o que a repetição espaçada diz que está vencido, com as
   * que você errou na última vez no topo da fila.
   */
  app.post<{
    Body: { nome?: string; materia_id?: number | null; quantidade?: number };
  }>('/api/provas/revisao', async (req, reply) => {
    const quantidade = Math.max(1, Math.min(Number(req.body?.quantidade ?? 20), 200));
    const materia = req.body?.materia_id ? Number(req.body.materia_id) : null;

    const lista = await estados({ materiaId: materia });
    const fila = ordenarParaRevisao(semAdiadas(lista)).slice(0, quantidade);

    if (fila.length === 0)
      return reply.code(400).send({
        erro: 'Nada para revisar ainda. Importe questões ou responda algumas primeiro.',
      });

    const nome = (req.body?.nome ?? '').trim() || `Revisão — ${hojeCurto()}`;
    const provaId = await criarProvaCom(
      nome,
      fila.map((e) => e.questao_id),
    );

    return reply.code(201).send({
      id: provaId,
      nome,
      questoes: fila.length,
      vencidas: fila.filter((e: Estado) => e.vencida).length,
    });
  });

  /**
   * Caderno de erros — o de fim de semana. Só entra o que você errou dentro da
   * janela, do que mais errou para o que menos errou.
   */
  app.post<{
    Body: { nome?: string; materia_id?: number | null; quantidade?: number; dias?: number };
  }>('/api/provas/erros', async (req, reply) => {
    const quantidade = Math.max(1, Math.min(Number(req.body?.quantidade ?? 20), 200));
    const dias = Math.max(1, Math.min(Number(req.body?.dias ?? 7), 365));
    const materia = req.body?.materia_id ? Number(req.body.materia_id) : null;

    const lista = await estados({ materiaId: materia, diasDoPeriodo: dias });
    const fila = ordenarPorErros(semAdiadas(lista)).slice(0, quantidade);

    if (fila.length === 0)
      return reply
        .code(400)
        .send({ erro: `Você não errou nenhuma questão nos últimos ${dias} dias.` });

    const nome =
      (req.body?.nome ?? '').trim() ||
      `Caderno de erros — ${dias === 7 ? 'semana' : `${dias} dias`} até ${hojeCurto()}`;

    const provaId = await criarProvaCom(
      nome,
      fila.map((e) => e.questao_id),
    );

    return reply.code(201).send({
      id: provaId,
      nome,
      questoes: fila.length,
      erros: fila.reduce((s: number, e: Estado) => s + e.erros_no_periodo, 0),
    });
  });

  app.delete<{ Params: { id: string } }>('/api/provas/:id', async (req) => {
    await exec('DELETE FROM provas WHERE id = $1', [Number(req.params.id)]);
    return { ok: true };
  });

  app.post<{
    Params: { id: string };
    Body: { acertos: number; total: number; tempo_seg: number };
  }>('/api/provas/:id/resultado', async (req, reply) => {
    const { acertos, total, tempo_seg } = req.body ?? ({} as any);
    if (total == null) return reply.code(400).send({ erro: 'Resultado incompleto.' });

    const criado = await um<{ id: number }>(
      `INSERT INTO resultados (prova_id, acertos, total, tempo_seg, ts)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        Number(req.params.id),
        acertos ?? 0,
        total,
        Math.round(tempo_seg ?? 0),
        agoraLocal(),
      ],
    );

    return reply.code(201).send({ id: criado!.id });
  });
}
