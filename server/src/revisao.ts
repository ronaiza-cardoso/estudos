import { q as consulta } from './db.js';
import { diaLocal } from './util.js';

/**
 * Repetição espaçada em cima do histórico que já existe.
 *
 * Nível, vencimento e prioridade são calculados a partir da tabela `respostas`,
 * sem estado paralelo. Isso vale a conta de recalcular — o cálculo passa a
 * valer retroativamente para tudo que você já respondeu, e não há um segundo
 * lugar onde a verdade possa divergir do histórico.
 *
 * A única coisa guardada é o agendamento manual ("responder amanhã"), que é
 * justamente o que a conta não teria como adivinhar.
 *
 * O nível é o número de acertos seguidos no fim do histórico. Errar zera, e
 * nível zero vence no mesmo dia: é isso que faz a questão errada voltar na
 * próxima sessão, e continuar voltando até você acertar algumas vezes.
 */

/** Dias até a questão vencer, por nível. Leitner clássico. */
export const INTERVALOS = [0, 1, 3, 7, 14, 30] as const;

export const NIVEL_MAXIMO = INTERVALOS.length - 1;

export type Resposta = { correta: boolean; ts: string };

export type Estado = {
  questao_id: string;
  materia_id: number | null;
  tentativas: number;
  erros: number;
  /** Acertos consecutivos no fim do histórico (0 = errou na última). */
  nivel: number;
  ultima_ts: string | null;
  dias_desde_ultima: number | null;
  /** Dias além do vencimento. Negativo = ainda descansando. */
  atraso: number;
  vencida: boolean;
  /** Erros dentro da janela pedida — é o que monta o caderno de erros. */
  erros_no_periodo: number;
  /** Data marcada à mão com "responder amanhã", se houver. */
  agendada_para: string | null;
  peso: number;
};

/**
 * Quanto um agendamento vencido pesa.
 *
 * Fica acima de tudo que a conta automática produz: você marcou essa questão
 * para hoje de propósito, e o propósito ganha da estatística.
 */
const PESO_AGENDADA = 200;

/** Diferença em dias de calendário entre dois "YYYY-MM-DD". */
export function diasEntre(de: string, ate: string): number {
  const ms = Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function calcularEstado(
  questao: { id: string; materia_id: number | null; agendada_para?: string | null },
  historico: Resposta[],
  hoje: string,
  corteDoPeriodo: string,
): Estado {
  const agendada = questao.agendada_para ?? null;
  // Marcada para depois: some da fila de hoje, mesmo que a conta diga que
  // venceu. É o sentido de "deixar para amanhã".
  const segurada = agendada !== null && agendada > hoje;
  const chamada = agendada !== null && agendada <= hoje;
  // O histórico chega em ordem crescente de tempo; o nível olha do fim para trás.
  const tentativas = historico.length;
  const erros = historico.filter((r) => !r.correta).length;

  let nivel = 0;
  for (let i = historico.length - 1; i >= 0 && historico[i].correta; i--) {
    nivel = Math.min(nivel + 1, NIVEL_MAXIMO);
  }

  const ultima = historico[historico.length - 1] ?? null;
  const ultimaTs = ultima?.ts ?? null;
  const diasDesde = ultimaTs ? diasEntre(ultimaTs.slice(0, 10), hoje) : null;

  const erros_no_periodo = historico.filter(
    (r) => !r.correta && r.ts.slice(0, 10) >= corteDoPeriodo,
  ).length;

  // Nunca respondida: entra na fila, mas atrás de quem você já errou.
  if (tentativas === 0) {
    return {
      questao_id: questao.id,
      materia_id: questao.materia_id,
      tentativas: 0,
      erros: 0,
      nivel: 0,
      ultima_ts: null,
      dias_desde_ultima: null,
      atraso: 0,
      vencida: !segurada,
      erros_no_periodo: 0,
      agendada_para: agendada,
      peso: (chamada ? PESO_AGENDADA : 0) + 40,
    };
  }

  const atraso = (diasDesde ?? 0) - INTERVALOS[nivel];
  const taxaErro = erros / tentativas;

  const peso =
    (chamada ? PESO_AGENDADA : 0) + // você marcou para hoje: vem antes de tudo
    (nivel === 0 ? 100 : 0) + // errou na última: prioridade máxima
    Math.min(Math.max(atraso, 0), 60) * 2 + // quanto mais atrasada, mais urgente
    taxaErro * 30; // histórico ruim pesa mesmo depois de acertar

  return {
    questao_id: questao.id,
    materia_id: questao.materia_id,
    tentativas,
    erros,
    nivel,
    ultima_ts: ultimaTs,
    dias_desde_ultima: diasDesde,
    atraso,
    vencida: segurada ? false : chamada || atraso >= 0,
    erros_no_periodo,
    agendada_para: agendada,
    peso,
  };
}

/**
 * Estado de todas as questões respondíveis. Anuladas e sem gabarito ficam de
 * fora: não há como acertar nem errar, então não há o que espaçar.
 */
export async function estados(opcoes: {
  materiaId?: number | null;
  diasDoPeriodo?: number;
  hoje?: string;
}): Promise<Estado[]> {
  const hoje = opcoes.hoje ?? diaLocal();
  const dias = opcoes.diasDoPeriodo ?? 7;

  const corte = new Date(`${hoje}T00:00:00Z`);
  corte.setUTCDate(corte.getUTCDate() - (dias - 1));
  const corteDoPeriodo = corte.toISOString().slice(0, 10);

  const questoes = await consulta<{
    id: string;
    materia_id: number | null;
    agendada_para: string | null;
  }>(
    `SELECT q.id, q.materia_id, a.data AS agendada_para
       FROM questoes q
       LEFT JOIN agendamentos a ON a.questao_id = q.id
      WHERE NOT q.anulada AND q.gabarito IS NOT NULL
        AND ($1::int IS NULL OR q.materia_id = $1)`,
    [opcoes.materiaId ?? null],
  );

  const respostas = await consulta<{ questao_id: string; correta: boolean; ts: string }>(
    'SELECT questao_id, correta, ts FROM respostas ORDER BY ts, id',
  );

  const porQuestao = new Map<string, Resposta[]>();
  for (const r of respostas) {
    const lista = porQuestao.get(r.questao_id);
    if (lista) lista.push(r);
    else porQuestao.set(r.questao_id, [r]);
  }

  return questoes.map((q) =>
    calcularEstado(q, porQuestao.get(q.id) ?? [], hoje, corteDoPeriodo),
  );
}

/**
 * Tira da fila o que você mandou para outro dia.
 *
 * Precisa ser um filtro, e não só peso baixo: o caderno completa a quantidade
 * pedida com questões ainda não vencidas, e sem isto a questão adiada entraria
 * hoje de qualquer jeito — que é exatamente o que "responder amanhã" promete
 * não fazer.
 */
export function semAdiadas(lista: Estado[]): Estado[] {
  return lista.filter((e) => e.agendada_para === null || e.vencida);
}

/** Fila da revisão do dia: vencidas primeiro, mais pesadas antes. */
export function ordenarParaRevisao(lista: Estado[]): Estado[] {
  return [...lista].sort(
    (a, b) => Number(b.vencida) - Number(a.vencida) || b.peso - a.peso || b.erros - a.erros,
  );
}

/**
 * Fila do caderno de erros: só o que você errou dentro da janela, do que mais
 * errou para o que menos errou.
 */
export function ordenarPorErros(lista: Estado[]): Estado[] {
  return lista
    .filter((e) => e.erros_no_periodo > 0)
    .sort(
      (a, b) =>
        b.erros_no_periodo - a.erros_no_periodo ||
        b.erros / b.tentativas - a.erros / a.tentativas ||
        b.peso - a.peso,
    );
}

/** Resumo mostrado na tela, antes de gerar caderno nenhum. */
export function resumir(lista: Estado[]) {
  const vencidas = lista.filter((e) => e.vencida);
  return {
    total: lista.length,
    vencidas: vencidas.length,
    agendadas_hoje: lista.filter((e) => e.agendada_para !== null && e.vencida).length,
    agendadas_depois: lista.filter((e) => e.agendada_para !== null && !e.vencida).length,
    nunca_respondidas: lista.filter((e) => e.tentativas === 0).length,
    errei_na_ultima: lista.filter((e) => e.tentativas > 0 && e.nivel === 0).length,
    com_erro_no_periodo: lista.filter((e) => e.erros_no_periodo > 0).length,
    por_nivel: INTERVALOS.map((intervalo, nivel) => ({
      nivel,
      intervalo_dias: intervalo,
      questoes: lista.filter((e) => e.tentativas > 0 && e.nivel === nivel).length,
    })),
  };
}
