import type { FastifyInstance } from 'fastify';
import { exec, materiaId, q as consulta, um } from '../db.js';
import { agoraLocal, diaLocal } from '../util.js';
import { INTERVALOS, NIVEL_MAXIMO } from '../revisao.js';

type LinhaQuestao = {
  id: string;
  materia_id: number | null;
  materia: string | null;
  assunto: string | null;
  ano: number | null;
  banca: string | null;
  orgao: string | null;
  prova: string | null;
  texto_assoc: string | null;
  enunciado: string;
  alternativas_json: string;
  gabarito: string | null;
  anulada: boolean;
  custom: boolean;
  anotacao: string | null;
  agendada_para: string | null;
};

/** Corpo aceito no cadastro manual de questão. */
type CorpoQuestao = {
  id?: string;
  materia?: string;
  materia_id?: number | string;
  assunto?: string;
  ano?: number | string;
  banca?: string;
  orgao?: string;
  prova?: string;
  texto_assoc?: string;
  enunciado?: string;
  alternativas?: Record<string, unknown>;
  gabarito?: string | null;
  anulada?: boolean;
};

const SELECT_BASE = `
  SELECT q.id, q.materia_id, m.nome AS materia, q.assunto, q.ano, q.banca, q.orgao,
         q.prova, q.texto_assoc, q.enunciado, q.alternativas_json, q.gabarito,
         q.anulada, q.custom, a.texto AS anotacao, g.data AS agendada_para
    FROM questoes q
    LEFT JOIN materias     m ON m.id = q.materia_id
    LEFT JOIN anotacoes    a ON a.questao_id = q.id
    LEFT JOIN agendamentos g ON g.questao_id = q.id
`;

const ULTIMA_CORRETA = `
  (SELECT r.correta FROM respostas r
    WHERE r.questao_id = q.id ORDER BY r.ts DESC, r.id DESC LIMIT 1)
`;

function montarFiltros(f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = () => `$${params.length}`;

  if (f.materia_id) {
    params.push(Number(f.materia_id));
    where.push(`q.materia_id = ${p()}`);
  }

  if (f.busca?.trim()) {
    params.push(`%${f.busca.trim()}%`);
    const termo = p();
    where.push(
      `(q.enunciado ILIKE ${termo} OR q.assunto ILIKE ${termo} OR q.texto_assoc ILIKE ${termo})`,
    );
  }

  switch (f.situacao) {
    case 'nao_respondidas':
      where.push('NOT EXISTS (SELECT 1 FROM respostas r WHERE r.questao_id = q.id)');
      break;
    case 'errei_ultima':
      where.push(`${ULTIMA_CORRETA} = FALSE`);
      break;
    case 'agendadas':
      where.push('EXISTS (SELECT 1 FROM agendamentos g WHERE g.questao_id = q.id)');
      break;
    case 'com_anotacoes':
      where.push("a.texto IS NOT NULL AND btrim(a.texto) <> ''");
      break;
    case 'selecionadas': {
      const ids = (f.ids ?? '').split(',').filter(Boolean);
      if (ids.length === 0) {
        where.push('FALSE');
      } else {
        params.push(ids);
        where.push(`q.id = ANY(${p()}::text[])`);
      }
      break;
    }
  }

  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', params };
}

async function hidratar(linhas: LinhaQuestao[]) {
  if (linhas.length === 0) return [];

  const ids = linhas.map((l) => l.id);
  const respostas = await consulta<{
    questao_id: string;
    alternativa: string;
    correta: boolean;
    ts: string;
    origem: string;
  }>(
    `SELECT questao_id, alternativa, correta, ts, origem
       FROM respostas WHERE questao_id = ANY($1::text[])
      ORDER BY ts DESC, id DESC`,
    [ids],
  );

  const porQuestao = new Map<string, typeof respostas>();
  for (const r of respostas) {
    if (!porQuestao.has(r.questao_id)) porQuestao.set(r.questao_id, []);
    porQuestao.get(r.questao_id)!.push(r);
  }

  return linhas.map((l) => {
    const historico = (porQuestao.get(l.id) ?? []).map((r) => ({
      ...r,
      correta: r.correta ? 1 : 0,
    }));
    const acertos = historico.filter((r) => r.correta === 1).length;

    // Nível da repetição espaçada: acertos seguidos a partir da última
    // resposta. O histórico já vem do mais novo para o mais antigo.
    let nivel = 0;
    for (const r of historico) {
      if (r.correta !== 1 || nivel >= NIVEL_MAXIMO) break;
      nivel++;
    }

    return {
      id: l.id,
      materia_id: l.materia_id,
      materia: l.materia,
      assunto: l.assunto,
      ano: l.ano,
      banca: l.banca,
      orgao: l.orgao,
      prova: l.prova,
      texto_assoc: l.texto_assoc,
      enunciado: l.enunciado,
      alternativas: JSON.parse(l.alternativas_json) as Record<string, string>,
      gabarito: l.gabarito,
      anulada: l.anulada,
      custom: l.custom,
      anotacao: l.anotacao ?? '',
      agendada_para: l.agendada_para,
      estatisticas: {
        tentativas: historico.length,
        acertos,
        nivel,
        intervalo_dias: INTERVALOS[nivel],
        percentual:
          historico.length > 0 ? Math.round((acertos / historico.length) * 100) : null,
        ultima: historico[0] ?? null,
        historico: historico.slice(0, 20),
      },
    };
  });
}

export function rotasQuestoes(app: FastifyInstance) {
  app.get<{ Querystring: Record<string, string | undefined> }>(
    '/api/questoes',
    async (req) => {
      const { sql, params } = montarFiltros(req.query);
      const limite = Math.min(Number(req.query.limite ?? 25) || 25, 200);
      const offset = Number(req.query.offset ?? 0) || 0;

      const total = Number(
        (
          await um<{ n: string }>(
            `SELECT COUNT(*) AS n FROM questoes q
               LEFT JOIN anotacoes a ON a.questao_id = q.id${sql}`,
            params,
          )
        )?.n ?? 0,
      );

      const linhas = await consulta<LinhaQuestao>(
        // Mais nova primeiro: quem acabou de cadastrar quer conferir o que
        // entrou, não rolar até o fim do banco.
        `${SELECT_BASE}${sql} ORDER BY q.criada_em DESC, q.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limite, offset],
      );

      return { total, questoes: await hidratar(linhas) };
    },
  );

  /** Contagem por matéria, usada nos filtros. */
  app.get('/api/questoes/contagem', async () => {
    const por_materia = await consulta(
      `SELECT q.materia_id AS id, m.nome AS materia, COUNT(*)::int AS total
         FROM questoes q LEFT JOIN materias m ON m.id = q.materia_id
        GROUP BY q.materia_id, m.nome ORDER BY lower(m.nome)`,
    );
    const total = Number(
      (await um<{ n: string }>('SELECT COUNT(*) AS n FROM questoes'))?.n ?? 0,
    );
    return { total, por_materia };
  });

  /**
   * "Responder amanhã" — adia um punhado de questões para uma data.
   *
   * Vale mais que a conta da repetição espaçada nos dois sentidos: até o dia
   * marcado a questão some da fila, e no dia ela vem na frente de tudo.
   */
  app.put<{ Body: { ids?: string[]; data?: string | null; dias?: number } }>(
    '/api/questoes/agendar',
    async (req, reply) => {
      const ids = (req.body?.ids ?? []).filter((id) => typeof id === 'string' && id.trim());
      if (ids.length === 0)
        return reply.code(400).send({ erro: 'Escolha ao menos uma questão.' });

      // `data: null` desmarca. Sem data, amanhã — é o caso de longe mais comum.
      if (req.body?.data === null) {
        const removidas = await exec('DELETE FROM agendamentos WHERE questao_id = ANY($1::text[])', [
          ids,
        ]);
        return { agendadas: 0, removidas, data: null };
      }

      let data = (req.body?.data ?? '').trim();
      if (!data) {
        const dias = Number.isFinite(Number(req.body?.dias)) ? Number(req.body?.dias) : 1;
        const alvo = new Date(`${diaLocal()}T00:00:00Z`);
        alvo.setUTCDate(alvo.getUTCDate() + Math.max(0, Math.min(dias, 365)));
        data = alvo.toISOString().slice(0, 10);
      }

      if (!/^\d{4}-\d{2}-\d{2}$/.test(data))
        return reply.code(400).send({ erro: 'Data inválida.' });

      let agendadas = 0;
      for (const id of ids) {
        agendadas += await exec(
          `INSERT INTO agendamentos (questao_id, data, criado_em) VALUES ($1, $2, $3)
           ON CONFLICT (questao_id) DO UPDATE
             SET data = EXCLUDED.data, criado_em = EXCLUDED.criado_em`,
          [id, data, agoraLocal()],
        );
      }

      return { agendadas, removidas: 0, data };
    },
  );

  app.post<{ Body: CorpoQuestao }>('/api/questoes', async (req, reply) => {
    const b: CorpoQuestao = req.body ?? {};
    if (!b.enunciado?.trim())
      return reply.code(400).send({ erro: 'O enunciado é obrigatório.' });
    if (!b.materia?.trim() && !b.materia_id)
      return reply.code(400).send({ erro: 'Escolha uma matéria.' });

    const alternativas: Record<string, string> = {};
    for (const [letra, texto] of Object.entries(b.alternativas ?? {})) {
      if (typeof texto === 'string' && texto.trim()) alternativas[letra] = texto.trim();
    }
    if (Object.keys(alternativas).length < 2)
      return reply.code(400).send({ erro: 'Preencha ao menos duas alternativas.' });

    const id =
      b.id?.trim() || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await exec(
      `INSERT INTO questoes
         (id, materia_id, assunto, ano, banca, orgao, prova, texto_assoc,
          enunciado, alternativas_json, gabarito, anulada, custom, criada_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, $13)`,
      [
        id,
        b.materia_id ? Number(b.materia_id) : await materiaId(b.materia ?? ''),
        b.assunto?.trim() || null,
        b.ano ? Number(b.ano) : null,
        b.banca?.trim() || null,
        b.orgao?.trim() || null,
        b.prova?.trim() || null,
        b.texto_assoc?.trim() || null,
        b.enunciado.trim(),
        JSON.stringify(alternativas),
        b.anulada ? null : (b.gabarito ?? null),
        b.anulada === true,
        agoraLocal(),
      ],
    );

    return reply.code(201).send({ id });
  });

  app.delete<{ Params: { id: string } }>('/api/questoes/:id', async (req, reply) => {
    const questao = await um<{ custom: boolean }>(
      'SELECT custom FROM questoes WHERE id = $1',
      [req.params.id],
    );
    if (!questao) return reply.code(404).send({ erro: 'Questão não encontrada.' });
    if (!questao.custom)
      return reply
        .code(403)
        .send({ erro: 'Só é possível excluir questões cadastradas por você.' });

    await exec('DELETE FROM questoes WHERE id = $1', [req.params.id]);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { alternativa: string; origem?: string } }>(
    '/api/questoes/:id/responder',
    async (req, reply) => {
      const questao = await um<{ gabarito: string | null; anulada: boolean }>(
        'SELECT gabarito, anulada FROM questoes WHERE id = $1',
        [req.params.id],
      );
      if (!questao) return reply.code(404).send({ erro: 'Questão não encontrada.' });

      const alternativa = (req.body?.alternativa ?? '').toUpperCase();
      if (!alternativa) return reply.code(400).send({ erro: 'Escolha uma alternativa.' });

      const correta = questao.gabarito !== null && alternativa === questao.gabarito;

      // Respondida é agendamento cumprido: deixá-lo de pé traria a questão de
      // volta na frente da fila amanhã sem motivo.
      await exec('DELETE FROM agendamentos WHERE questao_id = $1', [req.params.id]);

      await exec(
        'INSERT INTO respostas (questao_id, alternativa, correta, ts, origem) VALUES ($1, $2, $3, $4, $5)',
        [
          req.params.id,
          alternativa,
          correta,
          agoraLocal(),
          req.body?.origem === 'prova' ? 'prova' : 'banco',
        ],
      );

      return { correta, gabarito: questao.gabarito, anulada: questao.anulada };
    },
  );

  app.put<{ Params: { id: string }; Body: { texto?: string } }>(
    '/api/questoes/:id/anotacao',
    async (req) => {
      const texto = req.body?.texto ?? '';
      if (texto.trim() === '') {
        await exec('DELETE FROM anotacoes WHERE questao_id = $1', [req.params.id]);
        return { ok: true, texto: '' };
      }
      await exec(
        `INSERT INTO anotacoes (questao_id, texto, atualizado_em) VALUES ($1, $2, $3)
         ON CONFLICT (questao_id) DO UPDATE
           SET texto = EXCLUDED.texto, atualizado_em = EXCLUDED.atualizado_em`,
        [req.params.id, texto, agoraLocal()],
      );
      return { ok: true, texto };
    },
  );
}

export { hidratar };
