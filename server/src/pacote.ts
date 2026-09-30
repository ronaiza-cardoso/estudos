import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { QuestaoSeed } from './seed.js';
import { CHAVE_PUBLICA } from './chave-publica.js';

/**
 * Pacote de questões vendido: um arquivo `.estudos` assinado.
 *
 * Duas coisas moram aqui, e as duas existem por causa de pirataria:
 *
 *  - **licença**: o nome e o e-mail de quem comprou, que o app mostra na tela.
 *    Não impede cópia — nada impede — mas faz o arquivo custar caro de
 *    compartilhar, porque ele vai carimbado com quem vazou.
 *  - **assinatura**: Ed25519 sobre todo o resto do arquivo. Sem ela alguém
 *    apagaria a licença num editor de texto e o carimbo deixaria de existir.
 *    A chave privada nunca sai da máquina de quem vende.
 *
 * Ed25519 do `node:crypto` pelo mesmo motivo do scrypt em auth.ts: não exige
 * compilação nativa, então sobrevive ao Alpine e ao empacotamento do Electron.
 */

export const FORMATO = 'estudos-pacote';
export const VERSAO = 1;

export type Licenca = {
  /** Identifica esta cópia. Duas vendas do mesmo banco têm ids diferentes. */
  id: string;
  /** Nome comercial do banco: "Banco INSS 2026". */
  banco: string;
  para: string;
  email: string;
  emitido_em: string;
};

/** O que é assinado: tudo menos a própria assinatura. */
export type Miolo = {
  formato: typeof FORMATO;
  versao: number;
  licenca: Licenca;
  questoes: QuestaoSeed[];
};

export type Pacote = Miolo & { assinatura: string };

/**
 * JSON determinístico: chaves em ordem alfabética, em qualquer profundidade.
 *
 * `JSON.stringify` preserva a ordem de inserção das chaves, que depende de como
 * o objeto foi montado. Quem assina e quem confere montam o objeto por caminhos
 * diferentes — um vem do banco, o outro de `JSON.parse` — então sem ordenar a
 * mesma licença geraria bytes diferentes e toda assinatura falharia.
 */
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;

  const pares = Object.entries(valor as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonico(v)}`);

  return `{${pares.join(',')}}`;
}

export function gerarParDeChaves(): { publica: string; privada: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publica: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privada: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

export function assinar(miolo: Miolo, chavePrivadaPem: string): Pacote {
  const assinatura = sign(null, Buffer.from(canonico(miolo), 'utf8'), chavePrivadaPem);
  return { ...miolo, assinatura: assinatura.toString('base64') };
}

export type Conferencia =
  | { ok: true; pacote: Pacote }
  | { ok: false; erro: string };

/**
 * Confere um arquivo recebido. Recusa cedo e com mensagem específica: o
 * comprador precisa saber a diferença entre "arquivo errado" e "arquivo
 * adulterado", e a segunda é a única que acusa fraude.
 */
export function conferir(bruto: unknown, chavePublicaPem = CHAVE_PUBLICA): Conferencia {
  if (!chavePublicaPem)
    return { ok: false, erro: 'Este app foi compilado sem chave pública; nenhum pacote pode ser conferido.' };

  if (!bruto || typeof bruto !== 'object')
    return { ok: false, erro: 'Arquivo ilegível.' };

  const p = bruto as Partial<Pacote>;

  if (p.formato !== FORMATO)
    return { ok: false, erro: 'Isto não é um pacote de questões do Estudos.' };

  if (typeof p.versao !== 'number' || p.versao > VERSAO)
    return {
      ok: false,
      erro: `Pacote na versão ${p.versao}; este app entende até a ${VERSAO}. Atualize o app.`,
    };

  const lic = p.licenca;
  if (
    !lic ||
    typeof lic.id !== 'string' ||
    typeof lic.banco !== 'string' ||
    typeof lic.para !== 'string' ||
    typeof lic.email !== 'string' ||
    typeof lic.emitido_em !== 'string'
  )
    return { ok: false, erro: 'Pacote sem licença válida.' };

  if (!Array.isArray(p.questoes) || p.questoes.length === 0)
    return { ok: false, erro: 'Pacote sem questões.' };

  if (typeof p.assinatura !== 'string')
    return { ok: false, erro: 'Pacote sem assinatura.' };

  const miolo: Miolo = {
    formato: FORMATO,
    versao: p.versao,
    licenca: lic,
    questoes: p.questoes,
  };

  let confere = false;
  try {
    confere = verify(
      null,
      Buffer.from(canonico(miolo), 'utf8'),
      createPublicKey(chavePublicaPem),
      Buffer.from(p.assinatura, 'base64'),
    );
  } catch {
    // Chave pública quebrada ou assinatura que nem é base64 válido.
    confere = false;
  }

  if (!confere)
    return {
      ok: false,
      erro: 'Assinatura inválida: o arquivo foi alterado depois de emitido, ou não veio de nós.',
    };

  return { ok: true, pacote: { ...miolo, assinatura: p.assinatura } };
}
