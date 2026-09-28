/**
 * Parse do texto colado no cadastro manual.
 * Segue as mesmas regras do importador de PDF: cabeçalho "QUESTÃO N" e
 * alternativas "(A) … (E)" — aceitando também "A)" e "A - ".
 */

const RE_QUESTAO = /^\s*QUEST[ÃA]O\s+0*(\d+)\b[\s.:\-–—]*(.*)$/i;
const RE_ALT = /^\s*[(\[]?([A-Ea-e])\s*[)\].\-–—]\s+(.*)$/;
const LETRAS = ['A', 'B', 'C', 'D', 'E'];

export type Colagem = {
  numero: number | null;
  enunciado: string;
  alternativas: Record<string, string>;
};

export function parseColagem(bruto: string): Colagem {
  const linhas = bruto
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trimEnd());

  let numero: number | null = null;

  // Cabeçalho "QUESTÃO N" — o resto da linha volta para o enunciado.
  const iCabecalho = linhas.findIndex((l) => RE_QUESTAO.test(l));
  if (iCabecalho >= 0) {
    const m = linhas[iCabecalho].match(RE_QUESTAO)!;
    numero = Number(m[1]);
    linhas[iCabecalho] = m[2] ?? '';
  }

  // Marcas de alternativa, exigindo a sequência A, B, C…
  const marcas: { letra: string; i: number; resto: string }[] = [];
  let esperada = 0;

  for (let i = iCabecalho + 1; i < linhas.length; i++) {
    const m = linhas[i].match(RE_ALT);
    if (!m) continue;
    const letra = m[1].toUpperCase();
    if (letra !== LETRAS[esperada]) continue;
    marcas.push({ letra, i, resto: m[2] });
    if (++esperada >= LETRAS.length) break;
  }

  const fimEnunciado = marcas.length ? marcas[0].i : linhas.length;
  const enunciado = juntar(linhas.slice(Math.max(0, iCabecalho), fimEnunciado));

  const alternativas: Record<string, string> = {};
  marcas.forEach((marca, k) => {
    const fim = k + 1 < marcas.length ? marcas[k + 1].i : linhas.length;
    alternativas[marca.letra] = juntar([marca.resto, ...linhas.slice(marca.i + 1, fim)]);
  });

  return { numero, enunciado, alternativas };
}

function juntar(linhas: string[]): string {
  return linhas
    .join('\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
