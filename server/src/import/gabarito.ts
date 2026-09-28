/**
 * Parser do PDF de gabarito.
 *
 * O documento costuma trazer uma tabela por cargo e por tipo de prova.
 * Percorremos as linhas mantendo o cargo/tipo "corrente" e só coletamos os
 * pares número->letra quando ambos batem com o que foi pedido.
 * "#" marca questão anulada.
 */

export type Gabarito = Record<number, string>; // letra A–E ou '#'

const RE_CARGO = /cargo\s*:?\s*n?[º°]?\s*(\d{1,4})\b/i;
const RE_TIPO = /(?:tipo|prova\s+tipo|tipo\s+de\s+prova)\s*:?\s*([A-E])\b/i;
const RE_PAR = /\b(\d{1,3})\s*[-–—:.)]?\s+?([A-E#*])(?![\wÀ-ÿ])/g;
const RE_LIXO = [
  /^p[áa]gina\s*\d+/i,
  /^\d+\s*\/\s*\d+$/,
  /^[-–—]\s*\d+\s*[-–—]$/,
];

function linhasUteis(bruto: string): string[] {
  return bruto
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !RE_LIXO.some((re) => re.test(l)));
}

/**
 * Lê a tabela do cargo e do tipo informados.
 * Lança erro quando a combinação não existe no documento.
 */
export function parseGabarito(bruto: string, cargo: string, tipo: string): Gabarito {
  const alvoCargo = String(cargo).replace(/\D/g, '');
  const alvoTipo = String(tipo).trim().toUpperCase();

  const gabarito: Gabarito = {};
  let cargoAtual: string | null = null;
  let tipoAtual: string | null = null;

  for (const linha of linhasUteis(bruto)) {
    const mCargo = linha.match(RE_CARGO);
    if (mCargo) {
      cargoAtual = mCargo[1].replace(/^0+/, '') || mCargo[1];
      // Um novo cargo normalmente reinicia a contagem de tipo.
      if (!RE_TIPO.test(linha)) tipoAtual = null;
    }

    const mTipo = linha.match(RE_TIPO);
    if (mTipo) tipoAtual = mTipo[1].toUpperCase();

    const casa =
      cargoAtual === alvoCargo.replace(/^0+/, '') && tipoAtual === alvoTipo;
    if (!casa) continue;

    RE_PAR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_PAR.exec(linha)) !== null) {
      const numero = Number(m[1]);
      const letra = m[2] === '*' ? '#' : m[2].toUpperCase();
      if (numero > 0 && numero < 500) gabarito[numero] = letra;
    }
  }

  if (Object.keys(gabarito).length === 0) {
    const disponiveis = listarCargosTipos(bruto);
    const dica = disponiveis.length
      ? ` Combinações encontradas no PDF: ${disponiveis.join(', ')}.`
      : '';
    throw new Error(
      `Nenhum gabarito encontrado para cargo ${cargo} tipo ${tipo}.${dica}`,
    );
  }

  return gabarito;
}

/** Combinações cargo/tipo presentes no documento — usado nas mensagens de erro. */
export function listarCargosTipos(bruto: string): string[] {
  const achados = new Set<string>();
  let cargoAtual: string | null = null;

  for (const linha of linhasUteis(bruto)) {
    const mCargo = linha.match(RE_CARGO);
    if (mCargo) cargoAtual = mCargo[1];
    const mTipo = linha.match(RE_TIPO);
    if (mTipo && cargoAtual) achados.add(`${cargoAtual}/${mTipo[1].toUpperCase()}`);
  }

  return [...achados];
}

export function ehAnulada(valor: string | undefined): boolean {
  return valor === '#';
}
