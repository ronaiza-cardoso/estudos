/** Cliente HTTP mínimo. O Vite faz proxy de /api e /focus para o Fastify. */

export class ErroApi extends Error {}

/** 401: a sessão caiu (ou nunca existiu). O App volta para a tela de login. */
export class ErroAutenticacao extends ErroApi {}

/**
 * Rotas em que um 401 é resposta esperada, e não sessão perdida: errar a senha
 * na tela de login não pode disparar o "sua sessão expirou".
 */
const ROTAS_LOGIN = ['/api/login', '/api/senha', '/api/primeiro-acesso'];

let aoPerderSessao: (() => void) | null = null;

/** O App registra aqui o que fazer quando qualquer chamada devolver 401. */
export function observarSessao(fn: (() => void) | null) {
  aoPerderSessao = fn;
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, {
      ...init,
      // O cookie de sessão é HttpOnly e mora na mesma origem da API.
      credentials: 'same-origin',
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ErroApi('Servidor fora do ar. Rode `npm run dev`.');
  }

  const texto = await resposta.text();
  const corpo = texto ? JSON.parse(texto) : null;

  if (!resposta.ok) {
    const mensagem = corpo?.erro ?? `Falha na requisição (${resposta.status}).`;
    if (resposta.status === 401 && !ROTAS_LOGIN.includes(url.split('?')[0])) {
      aoPerderSessao?.();
      throw new ErroAutenticacao(mensagem);
    }
    throw new ErroApi(mensagem);
  }
  return corpo as T;
}

const get = <T,>(url: string) => pedir<T>(url);
const post = <T,>(url: string, corpo?: unknown) =>
  pedir<T>(url, { method: 'POST', body: JSON.stringify(corpo ?? {}) });
const put = <T,>(url: string, corpo: unknown) =>
  pedir<T>(url, { method: 'PUT', body: JSON.stringify(corpo) });
const remover = <T,>(url: string) => pedir<T>(url, { method: 'DELETE' });

/* ------------------------------ tipos ------------------------------ */

export type Materia = { id: number; nome: string; questoes: number };

/** A sessão não guarda matéria: o pomodoro é só o contador. */
export type Sessao = {
  id: number;
  inicio: string;
  minutos: number;
  completa: boolean;
};

export type Resposta = {
  questao_id?: string;
  alternativa: string;
  correta: number;
  ts: string;
  origem: string;
};

export type Questao = {
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
  alternativas: Record<string, string>;
  gabarito: string | null;
  anulada: boolean;
  custom: boolean;
  anotacao: string;
  /** Data marcada com "responder amanhã" (AAAA-MM-DD), se houver. */
  agendada_para: string | null;
  estatisticas: {
    tentativas: number;
    acertos: number;
    /** Acertos seguidos no fim do histórico. Zero = errou na última. */
    nivel: number;
    intervalo_dias: number;
    percentual: number | null;
    ultima: Resposta | null;
    historico: Resposta[];
  };
};

export type Estatisticas = {
  hoje: number;
  semana: number;
  media_semana: number;
  total: number;
  total_sessoes: number;
  dias_seguidos: number;
  questoes_respondidas: number;
  questoes_certas: number;
  percentual_acerto: number;
  por_materia: {
    id: number;
    nome: string;
    questoes: number;
    respondidas: number;
    certas: number;
    acerto: number | null;
  }[];
};

export type Resultado = {
  id?: number;
  acertos: number;
  total: number;
  tempo_seg: number;
  ts: string;
};

export type ProvaResumo = {
  id: number;
  nome: string;
  criada_em: string;
  questoes: number;
  materias: string[];
  ultimo_resultado: Resultado | null;
  melhor_aproveitamento: number | null;
};

export type ProvaCompleta = {
  id: number;
  nome: string;
  criada_em: string;
  questoes: Questao[];
  resultados: Resultado[];
};

export type DiaAtividade = { dia: string; minutos: number; sessoes: number };

export type DetalheDia = {
  dia: string;
  minutos: number;
  total_sessoes: number;
  interrompidas: number;
  sessoes: Sessao[];
  materias: { materia: string; respondidas: number; certas: number; anuladas: number }[];
  provas: {
    id: number;
    nome: string;
    acertos: number;
    total: number;
    tempo_seg: number;
    ts: string;
  }[];
};

export type Config = Record<string, string>;

/* ---------------------- importação de prints ---------------------- */

/** Rascunho de questão lido de um ou mais prints do mesmo slide. */
export type ItemImportado = {
  id: number;
  estado: 'rascunho' | 'importada' | 'descartada';
  questao_id: string | null;
  arquivos: string[];
  banca: string | null;
  ano: number | null;
  orgao: string | null;
  prova: string | null;
  materia: string | null;
  assunto: string | null;
  texto_assoc: string | null;
  enunciado: string;
  alternativas: Record<string, string>;
  gabarito: string | null;
  gabarito_evidencia: string | null;
  cortada: boolean;
  observacao: string | null;
};

export type ImportacaoResumo = {
  id: number;
  nome: string;
  criada_em: string;
  estado: 'processando' | 'concluida' | 'erro';
  total: number;
  processados: number;
  erro: string | null;
  itens: number;
};

export type Importacao = Omit<ImportacaoResumo, 'itens'> & { itens: ItemImportado[] };

export type ArquivoEnviado = { nome: string; mime: string; base64: string };

/* ------------------------- revisão espaçada ------------------------- */

export type ResumoRevisao = {
  total: number;
  vencidas: number;
  agendadas_hoje: number;
  agendadas_depois: number;
  nunca_respondidas: number;
  errei_na_ultima: number;
  com_erro_no_periodo: number;
  por_nivel: { nivel: number; intervalo_dias: number; questoes: number }[];
};

/** Carimbo de um pacote de questões comprado. */
export type Licenca = {
  id: string;
  banco: string;
  para: string;
  email: string;
  emitido_em: string;
  importado_em: string;
  questoes: number;
};

/* --------------------------- notas e tarefas --------------------------- */

/** Item do TODO. Fica preso ao dia em que foi escrito, mas vive até ser feito. */
export type Tarefa = {
  id: number;
  dia: string;
  texto: string;
  feita: boolean;
  ordem: number;
  criada_em: string;
  feita_em: string | null;
};

/** A anotação de um dia de estudo, com o TODO escrito nele. */
export type Nota = {
  dia: string;
  texto: string;
  criada_em: string;
  atualizado_em: string;
  tarefas: Tarefa[];
  /** Verdadeiro quando salvar com texto vazio apagou a nota. */
  removida?: boolean;
};

export type EstadoLogin = {
  /** Falso no app desktop: lá o login é transparente. */
  login_ativo: boolean;
  /** Já existe conta? Falso só no primeiro acesso. */
  configurado: boolean;
  autenticado: boolean;
  usuario: { id: number; login: string } | null;
  /** Quantas sessões ativas — mostrado na tela de config. */
  sessoes?: number;
};

/* ------------------------------ rotas ------------------------------ */

export const api = {
  sessao: () => get<EstadoLogin>('/api/sessao'),
  login: (login: string, senha: string) =>
    post<{ ok: true; usuario: { id: number; login: string } }>('/api/login', { login, senha }),
  primeiroAcesso: (login: string, senha: string) =>
    post<{ ok: true; usuario: { id: number; login: string } }>('/api/primeiro-acesso', {
      login,
      senha,
    }),
  logout: () => post<{ ok: true }>('/api/logout'),
  trocarSenha: (senha_atual: string, senha_nova: string) =>
    put<{ ok: true }>('/api/senha', { senha_atual, senha_nova }),

  materias: () => get<Materia[]>('/api/materias'),
  criarMateria: (nome: string) => post<{ id: number; nome: string }>('/api/materias', { nome }),
  removerMateria: (id: number) => remover<{ ok: true }>(`/api/materias/${id}`),

  sessoes: (limite = 100) => get<Sessao[]>(`/api/sessoes?limite=${limite}`),
  criarSessao: (dados: { minutos: number; completa?: boolean }) =>
    post<{ id: number }>('/api/sessoes', dados),
  removerSessao: (id: number) => remover<{ ok: true }>(`/api/sessoes/${id}`),

  estatisticas: () => get<Estatisticas>('/api/estatisticas'),

  atividade: () => get<DiaAtividade[]>('/api/atividade'),
  atividadeDia: (dia: string) => get<DetalheDia>(`/api/atividade/${dia}`),

  questoes: (filtros: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtros)) {
      if (v !== undefined && v !== '') p.set(k, String(v));
    }
    return get<{ total: number; questoes: Questao[] }>(`/api/questoes?${p}`);
  },
  contagemQuestoes: () =>
    get<{ total: number; por_materia: { id: number | null; materia: string | null; total: number }[] }>(
      '/api/questoes/contagem',
    ),
  criarQuestao: (dados: unknown) => post<{ id: string }>('/api/questoes', dados),
  removerQuestao: (id: string) => remover<{ ok: true }>(`/api/questoes/${id}`),
  responder: (id: string, alternativa: string, origem: 'banco' | 'prova' = 'banco') =>
    post<{ correta: boolean; gabarito: string | null; anulada: boolean }>(
      `/api/questoes/${id}/responder`,
      { alternativa, origem },
    ),
  /** Sem `data`, cai em amanhã. `data: null` desmarca. */
  agendar: (ids: string[], data?: string | null) =>
    put<{ agendadas: number; removidas: number; data: string | null }>(
      '/api/questoes/agendar',
      { ids, ...(data === undefined ? {} : { data }) },
    ),
  salvarAnotacao: (id: string, texto: string) =>
    put<{ ok: true }>(`/api/questoes/${id}/anotacao`, { texto }),

  provas: () => get<ProvaResumo[]>('/api/provas'),
  prova: (id: number) => get<ProvaCompleta>(`/api/provas/${id}`),
  criarProva: (nome: string, questao_ids: string[]) =>
    post<{ id: number }>('/api/provas', { nome, questao_ids }),
  provaAleatoria: (dados: { nome?: string; materia_id?: number | null; quantidade: number }) =>
    post<{ id: number; nome: string; questoes: number }>('/api/provas/aleatoria', dados),
  removerProva: (id: number) => remover<{ ok: true }>(`/api/provas/${id}`),
  salvarResultado: (id: number, dados: { acertos: number; total: number; tempo_seg: number }) =>
    post<{ id: number }>(`/api/provas/${id}/resultado`, dados),

  config: () => get<Config>('/api/config'),
  salvarConfig: (dados: Record<string, string | number | boolean>) =>
    put<Config>('/api/config', dados),

  backup: () => get<{ versao: number; exportado_em: string; dados: Record<string, unknown[]> }>(
    '/api/backup',
  ),
  restaurarBackup: (conteudo: unknown, modo: 'mesclar' | 'substituir') =>
    post<{ ok: true; resumo: Record<string, number> }>('/api/backup/restaurar', {
      ...(conteudo as object),
      modo,
    }),

  revisao: (filtros: { materia_id?: number | null; dias?: number } = {}) => {
    const p = new URLSearchParams();
    if (filtros.materia_id) p.set('materia_id', String(filtros.materia_id));
    if (filtros.dias) p.set('dias', String(filtros.dias));
    return get<ResumoRevisao>(`/api/revisao?${p}`);
  },
  provaRevisao: (dados: { nome?: string; materia_id?: number | null; quantidade: number }) =>
    post<{ id: number; nome: string; questoes: number; vencidas: number }>(
      '/api/provas/revisao',
      dados,
    ),
  provaErros: (dados: {
    nome?: string;
    materia_id?: number | null;
    quantidade: number;
    dias: number;
  }) =>
    post<{ id: number; nome: string; questoes: number; erros: number }>(
      '/api/provas/erros',
      dados,
    ),

  ambienteImportacao: () =>
    get<{ pronto: boolean; imagem: string | null; erro: string | null }>(
      '/api/importacoes/ambiente',
    ),

  importacoes: () => get<ImportacaoResumo[]>('/api/importacoes'),
  /** Imagem servida direto pela tag <img>, sem passar pelo cliente HTTP. */
  urlPrint: (importacaoId: number, arquivo: string) =>
    `/api/importacoes/${importacaoId}/prints/${encodeURIComponent(arquivo)}`,
  importacao: (id: number) => get<Importacao>(`/api/importacoes/${id}`),
  criarImportacao: (nome: string, arquivos: ArquivoEnviado[]) =>
    post<{ id: number; nome: string; total: number }>('/api/importacoes', { nome, arquivos }),
  salvarItem: (importacaoId: number, itemId: number, dados: Partial<ItemImportado>) =>
    put<{ ok: true }>(`/api/importacoes/${importacaoId}/itens/${itemId}`, dados),
  importacaoPendente: () => get<{ lote: Importacao | null }>('/api/importacoes/pendente'),
  confirmarImportacao: (
    id: number,
    dados: { materia_padrao?: string; itens?: number[] } = {},
  ) =>
    post<{
      inseridas: number;
      repetidas: number;
      sem_gabarito: number;
      questao_ids: string[];
    }>(`/api/importacoes/${id}/confirmar`, dados),
  removerImportacao: (id: number) => remover<{ ok: true }>(`/api/importacoes/${id}`),

  notas: (limite = 60) => get<Nota[]>(`/api/notas?limite=${limite}`),
  tarefasPendentes: () => get<{ hoje: string; tarefas: Tarefa[] }>('/api/notas/pendentes'),
  salvarNota: (dia: string, texto: string) => put<Nota>(`/api/notas/${dia}`, { texto }),
  removerNota: (dia: string) => remover<{ ok: true }>(`/api/notas/${dia}`),
  criarTarefas: (dia: string, texto: string) =>
    post<Tarefa[]>(`/api/notas/${dia}/tarefas`, { texto }),
  salvarTarefa: (id: number, dados: { texto?: string; feita?: boolean }) =>
    put<Tarefa>(`/api/tarefas/${id}`, dados),
  removerTarefa: (id: number) => remover<{ ok: true }>(`/api/tarefas/${id}`),

  licencas: () => get<Licenca[]>('/api/licencas'),
  importarPacote: (conteudo: unknown) =>
    post<{
      ok: true;
      licenca: Licenca;
      total: number;
      inseridas: number;
      repetido: boolean;
    }>('/api/pacote/importar', conteudo),
};
