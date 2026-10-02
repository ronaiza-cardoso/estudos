/**
 * O que a visão devolve para cada print, e o que sobra depois de juntar os
 * frames do mesmo slide.
 *
 * Os prints são snapshots de videoaula: o mesmo slide costuma aparecer duas ou
 * três vezes — limpo, anotado pelo professor, e com o gabarito revelado. Por
 * isso "frame" e "questão" são coisas diferentes aqui.
 */

/** Uma leitura de um único print. */
export type Frame = {
  /** "ignorar" cobre slide de abertura, #ANOTAAÍ, professor sem slide etc. */
  tipo: 'questao' | 'ignorar';
  motivo_ignorar: string | null;

  banca: string | null;
  ano: number | null;
  orgao: string | null;
  prova: string | null;
  /** Sugestão do modelo; a matéria de verdade vem da pasta ou da revisão. */
  materia: string | null;
  assunto: string | null;

  texto_assoc: string | null;
  /** Com `__sublinhado__` e `==grifado==` embutidos. */
  enunciado: string;
  alternativas: Record<string, string>;

  /**
   * Só preenchido quando a alternativa correta aparece **na cor do slide**
   * (vermelho, negrito). Traço de caneta à mão livre do professor não conta:
   * aquilo marca os termos do enunciado, não a resposta.
   */
  gabarito: string | null;
  /** Como o gabarito foi identificado — vai para a revisão. */
  gabarito_evidencia: string | null;

  /** Slide cortado pelo enquadramento do vídeo (alternativa faltando). */
  cortada: boolean;
  observacao: string | null;
};

/** Um slide, depois de juntar todos os frames que são dele. */
export type Item = Frame & {
  /** Nomes dos prints que entraram neste item. */
  arquivos: string[];
};

/** Item já revisado, pronto para virar linha em `questoes`. */
export type ItemRevisado = Item & {
  id: number;
  estado: 'rascunho' | 'importada' | 'descartada';
  questao_id: string | null;
};

export const FRAME_VAZIO: Frame = {
  tipo: 'ignorar',
  motivo_ignorar: null,
  banca: null,
  ano: null,
  orgao: null,
  prova: null,
  materia: null,
  assunto: null,
  texto_assoc: null,
  enunciado: '',
  alternativas: {},
  gabarito: null,
  gabarito_evidencia: null,
  cortada: false,
  observacao: null,
};
