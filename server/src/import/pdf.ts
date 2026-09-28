import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/**
 * pdf-parse é CommonJS e o index.js roda um bloco de debug quando importado
 * fora de um require tradicional — por isso apontamos direto para lib/.
 */
export async function textoDoPdf(caminho: string): Promise<string> {
  const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
    b: Buffer,
  ) => Promise<{ text: string; numpages: number }>;
  const buffer = await readFile(caminho);
  const { text } = await pdfParse(buffer);
  return text;
}
