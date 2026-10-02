/**
 * O caminho do lote dentro do banco: ler os prints, fundir os frames do mesmo
 * slide numa linha só e virar questão.
 *
 * A leitura no container é trocada por um dublê — o que está sendo testado aqui
 * é a fusão incremental, que recebe os frames em paralelo e escreve na mesma
 * linha. Esse é o pedaço que os testes puros de `juntar.ts` não alcançam.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

delete process.env.DATABASE_URL;

const dir = mkdtempSync(resolve(tmpdir(), 'estudos-import-'));
process.env.ESTUDOS_DATA_DIR = dir;

const { FRAME_VAZIO } = await import('../src/import/prints/tipos.js');
type Frame = import('../src/import/prints/tipos.js').Frame;

const ENUNCIADO = 'O treinamento com armas será realizado nos estandes de tiro da Cactos.';
const ALTERNATIVAS = {
  A: '1 artigo e 3 preposições',
  B: '4 artigos e 3 preposições',
  C: '3 artigos e 4 preposições',
  D: '3 artigos e 4 preposições',
  E: '4 artigos e 5 preposições',
};

/** O que o dublê devolve para cada nome de arquivo. */
const LEITURAS: Record<string, Partial<Frame>> = {
  'limpo.png': { tipo: 'questao', enunciado: ENUNCIADO, alternativas: ALTERNATIVAS, ano: 2019 },
  'gabarito.png': {
    tipo: 'questao',
    enunciado: ENUNCIADO,
    alternativas: ALTERNATIVAS,
    gabarito: 'E',
    gabarito_evidencia: 'alternativa E em vermelho',
  },
  'anotaai.png': { tipo: 'ignorar', motivo_ignorar: 'slide em branco' },
  'outra.png': {
    tipo: 'questao',
    enunciado: 'Aliás, o melhor para a democracia seria separar os fundos partidários.',
    alternativas: { A: 'todas', B: 'apenas II e III', C: 'nenhuma' },
    cortada: true,
  },
  'estoura.png': {},
};

vi.mock('../src/import/prints/extrair.js', () => ({
  garantirImagem: async () => 'estudos-ocr:duble',
  esquecerImagem: () => undefined,
  // Entrega todos os frames de uma vez, como o container faz quando lê o lote
  // em paralelo. É assim que a fila de gravação do job fica sob pressão.
  lerPrints: async (
    imagens: { nome: string }[],
    aoLer: (nome: string, frame: Frame) => Promise<void>,
  ) => {
    const problemas: string[] = [];
    await Promise.all(
      imagens.map((imagem) => {
        if (imagem.nome === 'estoura.png') {
          problemas.push(`${imagem.nome}: falhou de propósito`);
          return Promise.resolve();
        }
        return aoLer(imagem.nome, { ...FRAME_VAZIO, ...LEITURAS[imagem.nome] } as Frame);
      }),
    );
    return problemas;
  },
}));

const db = await import('../src/db.js');
const job = await import('../src/import/prints/job.js');

beforeAll(async () => {
  await db.abrirBanco();
  await db.migrar();
});

afterAll(async () => {
  await db.encerrarBanco();
  rmSync(dir, { recursive: true, force: true });
});

const imagem = (nome: string) => ({ nome, mime: 'image/png', base64: 'x' });

describe('rodarImportacao', () => {
  it('funde os frames do mesmo slide e ignora o que não é questão', async () => {
    const id = await job.criarImportacao('aula 1', 4);
    await job.rodarImportacao(id, [
      imagem('limpo.png'),
      imagem('anotaai.png'),
      imagem('gabarito.png'),
      imagem('outra.png'),
    ]);

    const lote = await job.lerImportacao(id);
    expect(lote?.estado).toBe('concluida');
    expect(lote?.processados).toBe(4);

    const itens = await job.lerItens(id);
    expect(itens).toHaveLength(2);

    const guarda = itens.find((i) => i.enunciado === ENUNCIADO)!;
    expect([...guarda.arquivos].sort()).toEqual(['gabarito.png', 'limpo.png']);
    // O gabarito chegou num frame, o ano no outro; a linha final tem os dois.
    expect(guarda.gabarito).toBe('E');
    expect(guarda.ano).toBe(2019);
  });

  it('um print que falha não derruba o lote', async () => {
    const id = await job.criarImportacao('aula 2', 2);
    await job.rodarImportacao(id, [imagem('estoura.png'), imagem('limpo.png')]);

    const lote = await job.lerImportacao(id);
    expect(lote?.estado).toBe('concluida');
    expect(lote?.erro).toContain('estoura.png');
    expect(await job.lerItens(id)).toHaveLength(1);
  });

  it('lote em que tudo falhou é marcado como erro', async () => {
    const id = await job.criarImportacao('aula 3', 1);
    await job.rodarImportacao(id, [imagem('estoura.png')]);
    expect((await job.lerImportacao(id))?.estado).toBe('erro');
  });

  it('o mesmo slide repetido muitas vezes continua virando um item só', async () => {
    // Oito frames chegando juntos e disputando a mesma linha: é o caso que o
    // índice único de (importacao_id, chave) e a fila de gravação protegem.
    const id = await job.criarImportacao('aula 4', 8);
    await job.rodarImportacao(
      id,
      Array.from({ length: 8 }, (_, i) =>
        imagem(i % 2 === 0 ? 'limpo.png' : 'gabarito.png'),
      ),
    );

    const itens = await job.lerItens(id);
    expect(itens).toHaveLength(1);
    expect(itens[0].gabarito).toBe('E');
  });

  it('encerra lotes deixados no meio por um servidor que caiu', async () => {
    const id = await job.criarImportacao('aula 5', 3);
    expect((await job.lerImportacao(id))?.estado).toBe('processando');

    await job.fecharImportacoesOrfas();

    const lote = await job.lerImportacao(id);
    expect(lote?.estado).toBe('erro');
    expect(lote?.erro).toMatch(/interrompida/i);
  });
});
