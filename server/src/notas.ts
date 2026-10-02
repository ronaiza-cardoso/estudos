/**
 * Notas e tarefas do dia.
 *
 * A nota é a anotação escrita no fim do dia de estudo — uma por dia, com o dia
 * como chave. As tarefas são o TODO: ficam presas ao dia em que foram escritas,
 * mas continuam em aberto até serem marcadas. É por isso que o que sobrou de
 * ontem aparece na sessão de hoje, e não desaparece junto com a virada do dia.
 */
import { exec, q, tx, um } from './db.js';
import { agoraLocal } from './util.js';

export type Tarefa = {
  id: number;
  dia: string;
  texto: string;
  feita: boolean;
  ordem: number;
  criada_em: string;
  feita_em: string | null;
};

export type Nota = {
  dia: string;
  texto: string;
  criada_em: string;
  atualizado_em: string;
  tarefas: Tarefa[];
};

const COLUNAS_TAREFA = 'id, dia, texto, feita, ordem, criada_em, feita_em';

export const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Quebra o texto digitado em uma tarefa por linha e descarta o marcador que
 * veio junto. Serve para colar uma lista inteira de uma vez — de um caderno,
 * do WhatsApp, de onde for — sem ter de limpar os "-" e os "1." na mão.
 */
export function linhasDeTarefas(texto: string): string[] {
  return texto
    .split('\n')
    .map((linha) =>
      linha
        .replace(/^\s*(?:[-*•–]\s*)?(?:\[[ xX]?\]\s*)?(?:\d+[.)]\s*)?/, '')
        .trim(),
    )
    .filter(Boolean);
}

async function tarefasDe(dia: string): Promise<Tarefa[]> {
  return q<Tarefa>(
    `SELECT ${COLUNAS_TAREFA} FROM nota_tarefas WHERE dia = $1 ORDER BY ordem, id`,
    [dia],
  );
}

export async function lerNota(dia: string): Promise<Nota | null> {
  const nota = await um<Omit<Nota, 'tarefas'>>(
    'SELECT dia, texto, criada_em, atualizado_em FROM notas WHERE dia = $1',
    [dia],
  );
  if (!nota) return null;
  return { ...nota, tarefas: await tarefasDe(dia) };
}

/** Histórico, do dia mais recente para o mais antigo. */
export async function listarNotas(limite: number): Promise<Nota[]> {
  const notas = await q<Omit<Nota, 'tarefas'>>(
    'SELECT dia, texto, criada_em, atualizado_em FROM notas ORDER BY dia DESC LIMIT $1',
    [limite],
  );
  if (notas.length === 0) return [];

  // Uma consulta só para as tarefas de todos os dias da página.
  const tarefas = await q<Tarefa>(
    `SELECT ${COLUNAS_TAREFA} FROM nota_tarefas
      WHERE dia = ANY($1::text[]) ORDER BY ordem, id`,
    [notas.map((n) => n.dia)],
  );

  const porDia = new Map<string, Tarefa[]>();
  for (const t of tarefas) {
    const lista = porDia.get(t.dia) ?? [];
    lista.push(t);
    porDia.set(t.dia, lista);
  }

  return notas.map((n) => ({ ...n, tarefas: porDia.get(n.dia) ?? [] }));
}

/**
 * Tudo que está em aberto, do mais antigo para o mais novo: é o painel "para
 * hoje". Não filtra por data de propósito — tarefa de três dias atrás que nunca
 * foi marcada continua sendo trabalho pendente.
 */
export async function tarefasAbertas(): Promise<Tarefa[]> {
  return q<Tarefa>(
    `SELECT ${COLUNAS_TAREFA} FROM nota_tarefas
      WHERE NOT feita ORDER BY dia, ordem, id`,
  );
}

/** Cria a linha do dia se ainda não existir. Usada antes de pendurar tarefas. */
async function garantirNota(dia: string): Promise<void> {
  await exec(
    `INSERT INTO notas (dia, texto, criada_em, atualizado_em) VALUES ($1, '', $2, $2)
     ON CONFLICT (dia) DO NOTHING`,
    [dia, agoraLocal()],
  );
}

/**
 * Grava o texto do dia. Texto vazio apaga a nota — assim abrir a aba e sair sem
 * escrever nada não deixa um dia em branco no histórico. Com tarefas presas a
 * ela, a linha fica: apagá-la levaria o TODO embora.
 */
export async function salvarNota(dia: string, texto: string): Promise<Nota | null> {
  const limpo = texto.trim();

  if (!limpo) {
    const presas = await um<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM nota_tarefas WHERE dia = $1',
      [dia],
    );
    if ((presas?.n ?? 0) === 0) {
      await exec('DELETE FROM notas WHERE dia = $1', [dia]);
      return null;
    }
  }

  const agora = agoraLocal();
  await exec(
    `INSERT INTO notas (dia, texto, criada_em, atualizado_em) VALUES ($1, $2, $3, $3)
     ON CONFLICT (dia) DO UPDATE
        SET texto = EXCLUDED.texto, atualizado_em = EXCLUDED.atualizado_em`,
    [dia, limpo, agora],
  );
  return lerNota(dia);
}

/** Cria uma tarefa por linha do texto, no fim da lista do dia. */
export async function criarTarefas(dia: string, texto: string): Promise<Tarefa[]> {
  const itens = linhasDeTarefas(texto);
  if (itens.length === 0) return [];

  await garantirNota(dia);
  const agora = agoraLocal();

  return tx(async (c) => {
    const { rows } = await c.query<{ proxima: number }>(
      'SELECT COALESCE(MAX(ordem), 0) + 1 AS proxima FROM nota_tarefas WHERE dia = $1',
      [dia],
    );
    let ordem = Number(rows[0].proxima);

    const criadas: Tarefa[] = [];
    for (const item of itens) {
      const r = await c.query<Tarefa>(
        `INSERT INTO nota_tarefas (dia, texto, ordem, criada_em)
         VALUES ($1, $2, $3, $4) RETURNING ${COLUNAS_TAREFA}`,
        [dia, item, ordem++, agora],
      );
      criadas.push(r.rows[0]);
    }
    return criadas;
  });
}

/**
 * Altera o texto e/ou o estado de uma tarefa. Campo ausente fica como estava —
 * marcar como feita não pode exigir reenviar o texto.
 */
export async function atualizarTarefa(
  id: number,
  mudancas: { texto?: string; feita?: boolean },
): Promise<Tarefa | null | 'texto-vazio'> {
  const atual = await um<Tarefa>(
    `SELECT ${COLUNAS_TAREFA} FROM nota_tarefas WHERE id = $1`,
    [id],
  );
  if (!atual) return null;

  const texto = mudancas.texto === undefined ? atual.texto : mudancas.texto.trim();
  if (!texto) return 'texto-vazio';
  const feita = mudancas.feita === undefined ? atual.feita : mudancas.feita;

  const atualizada = await um<Tarefa>(
    `UPDATE nota_tarefas
        SET texto = $2,
            feita = $3::boolean,
            -- Desmarcar limpa o carimbo; remarcar depois carimba de novo.
            feita_em = CASE WHEN $3::boolean THEN COALESCE(feita_em, $4) END
      WHERE id = $1
     RETURNING ${COLUNAS_TAREFA}`,
    [id, texto, feita, agoraLocal()],
  );
  return atualizada ?? null;
}

export async function removerTarefa(id: number): Promise<boolean> {
  const tarefa = await um<{ dia: string }>('SELECT dia FROM nota_tarefas WHERE id = $1', [id]);
  if (!tarefa) return false;

  await exec('DELETE FROM nota_tarefas WHERE id = $1', [id]);
  // A linha do dia pode ter nascido só para pendurar esta tarefa. Sem texto e
  // sem tarefas, ela não tem o que mostrar no histórico.
  await exec(
    `DELETE FROM notas n
      WHERE n.dia = $1 AND n.texto = ''
        AND NOT EXISTS (SELECT 1 FROM nota_tarefas t WHERE t.dia = n.dia)`,
    [tarefa.dia],
  );
  return true;
}

/** Apaga a nota do dia; as tarefas vão junto, por cascade. */
export async function removerNota(dia: string): Promise<boolean> {
  return (await exec('DELETE FROM notas WHERE dia = $1', [dia])) > 0;
}
