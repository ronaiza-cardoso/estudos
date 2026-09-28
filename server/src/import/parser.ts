/**
 * Parser do texto extraído dos PDFs de prova.
 *
 * O fluxo é sempre o mesmo:
 *   limparTexto -> extrairSecoes -> extrairTextosAssoc -> dividirQuestoes
 * `parseProva` encadeia tudo e devolve as questões já associadas à sua
 * disciplina e ao seu texto-base.
 */

export type Secao = { nome: string; de: number; ate: number };
export type TextoAssoc = { de: number; ate: number; texto: string };

export type QuestaoParseada = {
  numero: number;
  materia: string | null;
  enunciado: string;
  alternativas: Record<string, string>;
  texto_assoc: string | null;
};

/** Linhas de cabeçalho/rodapé que não fazem parte do conteúdo da prova. */
const RUIDO: RegExp[] = [
  /^processo\s+seletivo/i,
  /^concurso\s+p[úu]blico/i,
  /^p[áa]gina\s*\d+\s*[\/de]+\s*\d+/i,
  /^\d+\s*\/\s*\d+$/,
  /^[-–—]\s*\d+\s*[-–—]$/,
  /^[áa]rea\s+livre\.?$/i,
  /^rascunho\.?$/i,
  /^espa[çc]o\s+(livre|para\s+rascunho)/i,
  /^caderno\s+de\s+(prova|quest)/i,
  /^tipo\s*:?\s*[A-E]$/i,
  /^cargo\s*:?\s*\d+/i,
  /^n[ãa]o\s+escreva\s+aqui/i,
  /^\f$/,
];

const RE_QUESTAO = /^\s*QUEST[ÃA]O\s+0*(\d+)\b[\s.:\-–—]*(.*)$/i;
const RE_SECAO = /QUEST[ÕO]ES\s+de\s+0*(\d+)\s+a\s+0*(\d+)/i;
const RE_TEXTO_ASSOC = /TEXTOS?\s+para\s+responder\s+[àa]s?\s+quest/i;
const RE_FAIXA = /quest[õo]es?\s+0*(\d+)\s+a\s+0*(\d+)/i;
/** Marcadores de alternativa: "(A) ", "A) ", "A - ". */
const RE_ALT = /^\s*[(\[]?([A-Ea-e])\s*[)\].\-–—]\s+(.*)$/;

/**
 * Remove cabeçalhos, rodapés e marcações de página, junta palavras
 * hifenizadas quebradas em duas linhas e normaliza espaços em branco.
 */
export function limparTexto(bruto: string): string {
  const linhas = bruto
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => !RUIDO.some((re) => re.test(l.trim())));

  return linhas
    .join('\n')
    // palavra quebrada por hífen no fim da linha
    .replace(/([a-zà-öø-ÿ])-\n([a-zà-öø-ÿ])/g, '$1$2')
    // no máximo uma linha em branco seguida
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ehVazia(l: string) {
  return l.trim() === '';
}

/**
 * Detecta as seções de disciplina. Aceita as duas formas usuais:
 *   "LEGISLAÇÃO ADMINISTRATIVA / Questões de 9 a 16"
 *   "LEGISLAÇÃO ADMINISTRATIVA" seguida de "Questões de 9 a 16"
 */
export function extrairSecoes(texto: string): Secao[] {
  const linhas = texto.split('\n');
  const secoes: Secao[] = [];

  linhas.forEach((linha, i) => {
    const m = linha.match(RE_SECAO);
    if (!m) return;

    const de = Number(m[1]);
    const ate = Number(m[2]);

    // nome antes do separador na mesma linha...
    let nome = linha.slice(0, m.index).replace(/[\/|–—-]\s*$/, '').trim();

    // ...ou na linha anterior não vazia.
    if (!nome) {
      for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
        if (ehVazia(linhas[j])) continue;
        if (RE_QUESTAO.test(linhas[j])) break;
        nome = linhas[j].trim();
        break;
      }
    }

    nome = nome.replace(/[:.\s]+$/, '').trim();
    if (nome) secoes.push({ nome: normalizarNome(nome), de, ate });
  });

  return secoes;
}

/** "LEGISLAÇÃO ADMINISTRATIVA" -> "Legislação Administrativa" */
function normalizarNome(nome: string): string {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);
  if (nome !== nome.toUpperCase()) return nome;
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) =>
      i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(' ');
}

/**
 * Extrai os blocos "Texto para responder às questões X a Y" e devolve
 * o texto já sem esses blocos, para que o split por questão não os capture.
 */
export function extrairTextosAssoc(texto: string): {
  textos: TextoAssoc[];
  restante: string;
} {
  const linhas = texto.split('\n');
  const textos: TextoAssoc[] = [];
  const consumidas = new Set<number>();

  for (let i = 0; i < linhas.length; i++) {
    if (!RE_TEXTO_ASSOC.test(linhas[i])) continue;

    // A faixa pode estar na mesma linha ou continuar na seguinte.
    const cabecalho = [linhas[i], linhas[i + 1] ?? ''].join(' ');
    const faixa = cabecalho.match(RE_FAIXA);
    if (!faixa) continue;

    const de = Number(faixa[1]);
    const ate = Number(faixa[2]);

    consumidas.add(i);
    let j = i + 1;
    if (!RE_FAIXA.test(linhas[i])) consumidas.add(j++); // faixa na linha seguinte

    const corpo: string[] = [];
    for (; j < linhas.length; j++) {
      if (RE_QUESTAO.test(linhas[j])) break;
      if (RE_TEXTO_ASSOC.test(linhas[j])) break;
      if (RE_SECAO.test(linhas[j])) break;
      consumidas.add(j);
      corpo.push(linhas[j]);
    }

    const conteudo = corpo.join('\n').trim();
    if (conteudo) textos.push({ de, ate, texto: conteudo });
    i = j - 1;
  }

  const restante = linhas.filter((_, i) => !consumidas.has(i)).join('\n');
  return { textos, restante };
}

/** Quebra o texto em blocos, um por "QUESTÃO N". */
export function dividirQuestoes(texto: string): { numero: number; bloco: string }[] {
  const linhas = texto.split('\n');
  const blocos: { numero: number; bloco: string }[] = [];
  let atual: { numero: number; linhas: string[] } | null = null;

  for (const linha of linhas) {
    const m = linha.match(RE_QUESTAO);
    if (m) {
      if (atual) blocos.push({ numero: atual.numero, bloco: atual.linhas.join('\n') });
      atual = { numero: Number(m[1]), linhas: m[2].trim() ? [m[2].trim()] : [] };
      continue;
    }
    if (atual) atual.linhas.push(linha);
  }
  if (atual) blocos.push({ numero: atual.numero, bloco: atual.linhas.join('\n') });

  return blocos;
}

/**
 * Separa enunciado e alternativas dentro de um bloco de questão.
 * As alternativas precisam aparecer em ordem (A, B, C...) — um "(A)" solto
 * no meio do enunciado não inicia a lista se a sequência não continuar.
 */
export function parseAlternativas(bloco: string): {
  enunciado: string;
  alternativas: Record<string, string>;
} {
  const linhas = bloco.split('\n');
  const LETRAS = ['A', 'B', 'C', 'D', 'E'];

  // Índices das linhas que iniciam cada alternativa, em sequência.
  const marcas: { letra: string; i: number; resto: string }[] = [];
  let esperada = 0;

  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(RE_ALT);
    if (!m) continue;
    const letra = m[1].toUpperCase();
    if (letra !== LETRAS[esperada]) continue;
    marcas.push({ letra, i, resto: m[2] });
    esperada++;
    if (esperada >= LETRAS.length) break;
  }

  if (marcas.length < 2) {
    return { enunciado: juntarParagrafo(linhas), alternativas: {} };
  }

  const enunciado = juntarParagrafo(linhas.slice(0, marcas[0].i));
  const alternativas: Record<string, string> = {};

  marcas.forEach((marca, k) => {
    const fim = k + 1 < marcas.length ? marcas[k + 1].i : linhas.length;
    const corpo = [marca.resto, ...linhas.slice(marca.i + 1, fim)];
    alternativas[marca.letra] = juntarParagrafo(corpo);
  });

  return { enunciado, alternativas };
}

/** Junta linhas em parágrafos, preservando quebras duplas. */
function juntarParagrafo(linhas: string[]): string {
  return linhas
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function materiaDe(secoes: Secao[], numero: number): string | null {
  const s = secoes.find((x) => numero >= x.de && numero <= x.ate);
  return s ? s.nome : null;
}

function textoDe(textos: TextoAssoc[], numero: number): string | null {
  const t = textos.find((x) => numero >= x.de && numero <= x.ate);
  return t ? t.texto : null;
}

/** Pipeline completo: texto bruto do PDF -> questões estruturadas. */
export function parseProva(bruto: string): {
  questoes: QuestaoParseada[];
  secoes: Secao[];
  textos: TextoAssoc[];
} {
  const limpo = limparTexto(bruto);
  const secoes = extrairSecoes(limpo);
  const { textos, restante } = extrairTextosAssoc(limpo);

  const questoes = dividirQuestoes(restante)
    .map(({ numero, bloco }) => {
      const { enunciado, alternativas } = parseAlternativas(bloco);
      return {
        numero,
        materia: materiaDe(secoes, numero),
        enunciado,
        alternativas,
        texto_assoc: textoDe(textos, numero),
      };
    })
    .filter((q) => q.enunciado.length > 0);

  return { questoes, secoes, textos };
}
