import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exec, materiaId, um } from './db.js';
import { agoraLocal } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
export const SEED_PATH =
  process.env.ESTUDOS_SEED ?? resolve(here, '../../seed-questoes.js');

export type QuestaoSeed = {
  id: string;
  materia: string;
  assunto?: string | null;
  ano?: number | null;
  banca?: string | null;
  orgao?: string | null;
  prova?: string | null;
  texto_assoc?: string | null;
  enunciado: string;
  alternativas: Record<string, string>;
  gabarito?: string | null;
  anulada?: boolean;
};

/**
 * Carrega seed-questoes.js na primeira execução (banco sem questões).
 * Nunca duplica: a inserção é ignorada quando o id já existe.
 */
export async function popularSeed(caminho = SEED_PATH): Promise<number> {
  const jaTem = await um<{ n: string }>('SELECT COUNT(*) AS n FROM questoes');
  if (Number(jaTem?.n ?? 0) > 0) return 0;
  if (!existsSync(caminho)) return 0;

  const mod = await import(pathToFileURL(caminho).href);
  const questoes: QuestaoSeed[] = mod.default ?? mod.questoes ?? [];
  if (!Array.isArray(questoes) || questoes.length === 0) return 0;

  return inserirQuestoes(questoes);
}

export async function inserirQuestoes(questoes: QuestaoSeed[]): Promise<number> {
  let inseridas = 0;

  for (const q of questoes) {
    const n = await exec(
      `INSERT INTO questoes
         (id, materia_id, assunto, ano, banca, orgao, prova, texto_assoc,
          enunciado, alternativas_json, gabarito, anulada, custom, criada_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE, $13)
       ON CONFLICT (id) DO NOTHING`,
      [
        q.id,
        await materiaId(q.materia || 'Sem matéria'),
        q.assunto ?? null,
        q.ano ?? null,
        q.banca ?? null,
        q.orgao ?? null,
        q.prova ?? null,
        q.texto_assoc ?? null,
        q.enunciado,
        JSON.stringify(q.alternativas ?? {}),
        q.gabarito ?? null,
        q.anulada === true,
        agoraLocal(),
      ],
    );
    inseridas += n;
  }

  return inseridas;
}
