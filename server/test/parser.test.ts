import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dividirQuestoes,
  extrairSecoes,
  extrairTextosAssoc,
  limparTexto,
  parseAlternativas,
  parseProva,
} from '../src/import/parser.js';
import { listarCargosTipos, parseGabarito } from '../src/import/gabarito.js';

const aqui = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) => readFileSync(resolve(aqui, 'fixtures', n), 'utf8');

const PROVA = fixture('prova-exemplo.txt');
const GABARITO = fixture('gabarito-exemplo.txt');

describe('limparTexto', () => {
  it('remove cabeçalhos, rodapés e marcações de página', () => {
    const limpo = limparTexto(PROVA);
    expect(limpo).not.toMatch(/PROCESSO SELETIVO/);
    expect(limpo).not.toMatch(/PÁGINA \d+\/\d+/);
    expect(limpo).not.toMatch(/Área livre/);
    expect(limpo).not.toMatch(/Rascunho/);
  });

  it('junta palavras quebradas por hífen no fim da linha', () => {
    const limpo = limparTexto(PROVA);
    expect(limpo).toContain('imediatas');
    expect(limpo).toContain('constância');
    expect(limpo).not.toContain('ime-');
  });

  it('não deixa mais de uma linha em branco seguida', () => {
    expect(limparTexto(PROVA)).not.toMatch(/\n{3,}/);
  });
});

describe('extrairSecoes', () => {
  const secoes = extrairSecoes(limparTexto(PROVA));

  it('detecta a disciplina na linha anterior à faixa', () => {
    expect(secoes).toContainEqual({ nome: 'Língua Portuguesa', de: 1, ate: 3 });
  });

  it('detecta a disciplina na mesma linha, separada por barra', () => {
    expect(secoes).toContainEqual({
      nome: 'Legislação Administrativa',
      de: 4,
      ate: 5,
    });
  });
});

describe('extrairTextosAssoc', () => {
  const { textos, restante } = extrairTextosAssoc(limparTexto(PROVA));

  it('captura o bloco com a faixa de questões correta', () => {
    expect(textos).toHaveLength(1);
    expect(textos[0].de).toBe(1);
    expect(textos[0].ate).toBe(2);
    expect(textos[0].texto).toContain('A pressa é inimiga da precisão');
  });

  it('não invade a primeira questão', () => {
    expect(textos[0].texto).not.toContain('QUESTÃO 1');
    expect(textos[0].texto).not.toContain('oposição construída');
  });

  it('remove o bloco do texto restante', () => {
    expect(restante).not.toContain('A pressa é inimiga da precisão');
    expect(restante).toContain('QUESTÃO 1');
  });
});

describe('dividirQuestoes', () => {
  it('quebra em um bloco por questão, na ordem', () => {
    const { restante } = extrairTextosAssoc(limparTexto(PROVA));
    const blocos = dividirQuestoes(restante);
    expect(blocos.map((b) => b.numero)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('parseAlternativas', () => {
  it('separa enunciado das cinco alternativas', () => {
    const { enunciado, alternativas } = parseAlternativas(
      [
        'Qual é a capital do Brasil?',
        '(A) São Paulo',
        '(B) Rio de Janeiro',
        '(C) Brasília',
        '(D) Salvador',
        '(E) Belo Horizonte',
      ].join('\n'),
    );
    expect(enunciado).toBe('Qual é a capital do Brasil?');
    expect(Object.keys(alternativas)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(alternativas.C).toBe('Brasília');
  });

  it('junta alternativas que ocupam mais de uma linha', () => {
    const { alternativas } = parseAlternativas(
      ['Enunciado.', '(A) primeira parte', 'continuação da A', '(B) segunda'].join('\n'),
    );
    expect(alternativas.A).toBe('primeira parte continuação da A');
  });

  it('ignora "(A)" solto no enunciado quando a sequência não continua', () => {
    const { enunciado, alternativas } = parseAlternativas(
      ['(A) é apenas uma citação no meio do texto.', 'Texto segue sem mais marcas.'].join(
        '\n',
      ),
    );
    expect(alternativas).toEqual({});
    expect(enunciado).toContain('citação');
  });

  it('aceita o formato "A - texto"', () => {
    const { alternativas } = parseAlternativas(
      ['Enunciado.', 'A - um', 'B - dois', 'C - três'].join('\n'),
    );
    expect(alternativas).toEqual({ A: 'um', B: 'dois', C: 'três' });
  });
});

describe('parseProva', () => {
  const { questoes } = parseProva(PROVA);

  it('lê todas as questões', () => {
    expect(questoes).toHaveLength(5);
  });

  it('associa cada questão à sua disciplina', () => {
    expect(questoes.find((q) => q.numero === 2)?.materia).toBe('Língua Portuguesa');
    expect(questoes.find((q) => q.numero === 4)?.materia).toBe(
      'Legislação Administrativa',
    );
  });

  it('associa o texto-base apenas às questões da faixa', () => {
    expect(questoes.find((q) => q.numero === 1)?.texto_assoc).toContain('A pressa');
    expect(questoes.find((q) => q.numero === 2)?.texto_assoc).toContain('A pressa');
    expect(questoes.find((q) => q.numero === 3)?.texto_assoc).toBeNull();
  });

  it('mantém o enunciado sem o cabeçalho "QUESTÃO N"', () => {
    const q3 = questoes.find((q) => q.numero === 3)!;
    expect(q3.enunciado).not.toMatch(/QUESTÃO/i);
    expect(q3.enunciado).toContain('concordância verbal');
  });

  it('lê cinco alternativas em todas as questões', () => {
    for (const q of questoes) expect(Object.keys(q.alternativas)).toHaveLength(5);
  });
});

describe('parseGabarito', () => {
  it('lê a tabela do cargo e do tipo pedidos', () => {
    expect(parseGabarito(GABARITO, '200', 'A')).toEqual({
      1: 'B',
      2: 'B',
      3: 'C',
      4: '#',
      5: 'B',
    });
  });

  it('não mistura tabelas de cargos diferentes', () => {
    expect(parseGabarito(GABARITO, '100', 'A')[1]).toBe('C');
    expect(parseGabarito(GABARITO, '200', 'A')[1]).toBe('B');
  });

  it('distingue os tipos dentro do mesmo cargo', () => {
    expect(parseGabarito(GABARITO, '200', 'B')[1]).toBe('E');
  });

  it('marca questão anulada com "#"', () => {
    expect(parseGabarito(GABARITO, '200', 'A')[4]).toBe('#');
  });

  it('erra com mensagem útil quando a combinação não existe', () => {
    expect(() => parseGabarito(GABARITO, '999', 'A')).toThrow(/999/);
    expect(() => parseGabarito(GABARITO, '999', 'A')).toThrow(/200\/A/);
  });

  it('lista as combinações disponíveis', () => {
    expect(listarCargosTipos(GABARITO).sort()).toEqual(['100/A', '200/A', '200/B']);
  });
});
