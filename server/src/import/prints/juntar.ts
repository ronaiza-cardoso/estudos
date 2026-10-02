import type { Frame, Item } from './tipos.js';

/**
 * Junta os frames que são do mesmo slide.
 *
 * O agrupamento é pelo CONTEÚDO do enunciado, nunca pelo horário do arquivo.
 * Nos prints reais isso não é preciosismo: dois snapshots a 3 segundos um do
 * outro eram slides completamente diferentes (um deles em branco), enquanto o
 * frame com o gabarito de uma questão veio quase dois minutos depois do frame
 * limpo dela. Agrupar por proximidade de tempo juntaria o que não é par e
 * separaria o que é.
 */

/** Quanto do enunciado entra na chave. Curto o bastante para tolerar ruído de leitura. */
const TAMANHO_CHAVE = 80;

export function chaveDoEnunciado(enunciado: string): string {
  return enunciado
    .replace(/__|==/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, TAMANHO_CHAVE);
}

function marcas(s: string): number {
  return (s.match(/__|==/g) ?? []).length;
}

/**
 * Qual frame manda no texto. Mais alternativas ganha (um slide cortado tem
 * menos), depois o não cortado, depois o que preservou mais grifo.
 */
function melhor(a: Frame, b: Frame): Frame {
  const nA = Object.keys(a.alternativas).length;
  const nB = Object.keys(b.alternativas).length;
  if (nA !== nB) return nA > nB ? a : b;
  if (a.cortada !== b.cortada) return a.cortada ? b : a;

  const mA = marcas(a.enunciado);
  const mB = marcas(b.enunciado);
  if (mA !== mB) return mA > mB ? a : b;

  return a.enunciado.length >= b.enunciado.length ? a : b;
}

function primeiro<T>(...valores: (T | null | undefined)[]): T | null {
  for (const v of valores) if (v !== null && v !== undefined && v !== '') return v;
  return null;
}

function juntarNotas(a: string | null, b: string | null): string | null {
  const partes = [a, b].filter((p): p is string => !!p?.trim());
  return [...new Set(partes)].join(' · ') || null;
}

/**
 * Funde um frame novo no item que já existia. Cada campo tem sua regra, e a do
 * gabarito é a que importa: ele vem do frame que tiver, seja qual for a ordem
 * de chegada — o print com a resposta revelada costuma ser o segundo, mas nada
 * garante que ele seja lido depois.
 */
export function fundir(item: Item, frame: Frame, arquivo: string): Item {
  const base = melhor(item, frame);
  const outro = base === item ? frame : item;

  return {
    tipo: 'questao',
    motivo_ignorar: null,

    banca: primeiro(base.banca, outro.banca),
    ano: primeiro(base.ano, outro.ano),
    orgao: primeiro(base.orgao, outro.orgao),
    prova: primeiro(base.prova, outro.prova),
    materia: primeiro(base.materia, outro.materia),
    assunto: primeiro(base.assunto, outro.assunto),

    // Entre dois textos iguais, fica o que manteve os grifos.
    texto_assoc:
      marcas(frame.texto_assoc ?? '') > marcas(item.texto_assoc ?? '')
        ? (frame.texto_assoc ?? item.texto_assoc)
        : (item.texto_assoc ?? frame.texto_assoc),
    enunciado: base.enunciado,
    alternativas: { ...outro.alternativas, ...base.alternativas },

    gabarito: primeiro(item.gabarito, frame.gabarito),
    gabarito_evidencia: primeiro(
      item.gabarito ? item.gabarito_evidencia : null,
      frame.gabarito ? frame.gabarito_evidencia : null,
    ),

    // Basta um frame ter pego o slide inteiro para a questão não estar cortada.
    cortada: item.cortada && frame.cortada,
    observacao: juntarNotas(item.observacao, frame.observacao),

    arquivos: [...new Set([...item.arquivos, arquivo])],
  };
}

/** Versão em lote, usada pelo CLI e pelos testes. */
export function agrupar(frames: { arquivo: string; frame: Frame }[]): Item[] {
  const porChave = new Map<string, Item>();

  for (const { arquivo, frame } of frames) {
    if (frame.tipo !== 'questao') continue;

    const chave = chaveDoEnunciado(frame.enunciado);
    const existente = porChave.get(chave);

    porChave.set(
      chave,
      existente ? fundir(existente, frame, arquivo) : { ...frame, arquivos: [arquivo] },
    );
  }

  return [...porChave.values()];
}
