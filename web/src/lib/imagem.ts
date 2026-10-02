import type { ArquivoEnviado } from './api';

/**
 * Prepara um print para a leitura por visão.
 *
 * O redimensionamento é feito aqui, no navegador, por dois motivos: a API
 * reduz qualquer imagem para 1568px no lado maior de qualquer jeito, então
 * mandar 1920px só gasta banda; e um lote de 20 prints crus passaria do limite
 * de corpo do Fastify.
 *
 * A qualidade fica alta de propósito. O que decide o gabarito nesses slides é
 * uma alternativa em vermelho, e o que decide o enunciado é um traço fino de
 * caneta — compressão agressiva apaga exatamente isso.
 */

const LADO_MAXIMO = 1568;
const QUALIDADE = 0.92;

export type PrintPreparado = ArquivoEnviado & {
  /** Miniatura para a tela, já pronta. Não vai para o servidor. */
  previa: string;
};

function desenhar(fonte: ImageBitmap): HTMLCanvasElement {
  const escala = Math.min(1, LADO_MAXIMO / Math.max(fonte.width, fonte.height));
  const tela = document.createElement('canvas');
  tela.width = Math.round(fonte.width * escala);
  tela.height = Math.round(fonte.height * escala);

  const ctx = tela.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem neste navegador.');

  // Os slides são brancos; sem isso, um PNG com transparência viraria fundo preto.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, tela.width, tela.height);
  ctx.drawImage(fonte, 0, 0, tela.width, tela.height);

  return tela;
}

export async function prepararPrint(arquivo: File): Promise<PrintPreparado> {
  const bitmap = await createImageBitmap(arquivo);
  try {
    const tela = desenhar(bitmap);
    const dataUrl = tela.toDataURL('image/jpeg', QUALIDADE);

    return {
      nome: arquivo.name,
      mime: 'image/jpeg',
      base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      previa: dataUrl,
    };
  } finally {
    bitmap.close();
  }
}

export function ehImagem(arquivo: File): boolean {
  return /^image\/(png|jpe?g|webp|gif)$/.test(arquivo.type);
}
