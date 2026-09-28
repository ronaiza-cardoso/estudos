/**
 * Roda o parser contra os PDFs reais em uploads/.
 * Sem PDFs na pasta os testes são pulados, então o repositório continua
 * verde em uma máquina limpa — basta soltar os arquivos lá para ativá-los.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProva } from '../src/import/parser.js';
import { listarCargosTipos } from '../src/import/gabarito.js';
import { textoDoPdf } from '../src/import/pdf.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const UPLOADS = resolve(aqui, '../../uploads');

const pdfs = existsSync(UPLOADS)
  ? readdirSync(UPLOADS).filter((f) => f.toLowerCase().endsWith('.pdf'))
  : [];

const ehGabarito = (nome: string) => /gabarito|resposta/i.test(nome);
const provas = pdfs.filter((f) => !ehGabarito(f));
const gabaritos = pdfs.filter(ehGabarito);

describe.skipIf(provas.length === 0)('PDFs de prova em uploads/', () => {
  it.each(provas)('%s produz questões bem formadas', async (arquivo) => {
    const { questoes, secoes } = parseProva(await textoDoPdf(resolve(UPLOADS, arquivo)));

    expect(questoes.length).toBeGreaterThan(0);

    // Numeração sem buracos nem repetições.
    const numeros = questoes.map((q) => q.numero);
    expect(new Set(numeros).size).toBe(numeros.length);
    expect([...numeros].sort((a, b) => a - b)).toEqual(numeros);

    // Nenhum resíduo de cabeçalho ou marcador de questão no enunciado.
    for (const q of questoes) {
      expect(q.enunciado.length).toBeGreaterThan(10);
      expect(q.enunciado).not.toMatch(/QUEST[ÃA]O\s+\d+/i);
      expect(q.enunciado).not.toMatch(/P[ÁA]GINA\s*\d+/i);
    }

    // A grande maioria das questões precisa ter alternativas reconhecidas.
    const comAlternativas = questoes.filter(
      (q) => Object.keys(q.alternativas).length >= 4,
    );
    expect(comAlternativas.length / questoes.length).toBeGreaterThan(0.9);

    // As seções detectadas não podem se sobrepor.
    const ordenadas = [...secoes].sort((a, b) => a.de - b.de);
    for (let i = 1; i < ordenadas.length; i++) {
      expect(ordenadas[i].de).toBeGreaterThan(ordenadas[i - 1].ate);
    }
  });
});

describe.skipIf(gabaritos.length === 0)('PDFs de gabarito em uploads/', () => {
  it.each(gabaritos)('%s expõe ao menos uma combinação cargo/tipo', async (arquivo) => {
    const texto = await textoDoPdf(resolve(UPLOADS, arquivo));
    expect(listarCargosTipos(texto).length).toBeGreaterThan(0);
  });
});
