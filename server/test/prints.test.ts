/**
 * Agrupamento dos prints. Os casos vêm dos arquivos reais em `assets/`: o
 * mesmo slide capturado limpo, anotado e com o gabarito revelado.
 */
import { describe, expect, it } from 'vitest';
import { agrupar, chaveDoEnunciado, fundir } from '../src/import/prints/juntar.js';
import { FRAME_VAZIO, type Frame } from '../src/import/prints/tipos.js';

function frame(parcial: Partial<Frame>): Frame {
  return { ...FRAME_VAZIO, tipo: 'questao', ...parcial };
}

const ENUNCIADO =
  'Foi um dos primeiros a perceber o gênio do escritor e o estimulou sem trégua a acreditar em si mesmo';

const GRIFADO =
  'Foi um dos primeiros a perceber __o__ gênio do escritor e __o__ estimulou sem trégua __a__ acreditar em si mesmo';

const ALTERNATIVAS = {
  A: 'artigo – preposição – pronome',
  B: 'preposição – pronome – artigo',
  C: 'artigo – pronome – preposição',
  D: 'preposição – artigo – pronome',
  E: 'pronome – artigo – preposição',
};

describe('chaveDoEnunciado', () => {
  it('ignora os grifos, a acentuação e a caixa', () => {
    expect(chaveDoEnunciado(GRIFADO)).toBe(chaveDoEnunciado(ENUNCIADO));
  });

  it('separa enunciados diferentes', () => {
    expect(chaveDoEnunciado(ENUNCIADO)).not.toBe(
      chaveDoEnunciado('O treinamento com armas será realizado nos estandes de tiro da Cactos'),
    );
  });
});

describe('agrupar', () => {
  it('junta o print limpo, o anotado e o do gabarito numa questão só', () => {
    const itens = agrupar([
      {
        arquivo: 'limpo.png',
        frame: frame({ enunciado: ENUNCIADO, alternativas: ALTERNATIVAS, banca: 'FCC', ano: 2019 }),
      },
      {
        arquivo: 'anotado.png',
        frame: frame({ enunciado: GRIFADO, alternativas: ALTERNATIVAS }),
      },
      {
        arquivo: 'gabarito.png',
        frame: frame({
          enunciado: ENUNCIADO,
          alternativas: ALTERNATIVAS,
          gabarito: 'E',
          gabarito_evidencia: 'alternativa E em vermelho',
        }),
      },
    ]);

    expect(itens).toHaveLength(1);
    expect(itens[0].arquivos).toEqual(['limpo.png', 'anotado.png', 'gabarito.png']);
    // O gabarito veio do terceiro print, os grifos do segundo, a banca do primeiro.
    expect(itens[0].gabarito).toBe('E');
    expect(itens[0].enunciado).toBe(GRIFADO);
    expect(itens[0].banca).toBe('FCC');
    expect(itens[0].ano).toBe(2019);
  });

  it('descarta slide de abertura e tela em branco', () => {
    const itens = agrupar([
      { arquivo: 'anotaai.png', frame: { ...FRAME_VAZIO, motivo_ignorar: 'slide em branco' } },
      { arquivo: 'questao.png', frame: frame({ enunciado: ENUNCIADO, alternativas: ALTERNATIVAS }) },
    ]);

    expect(itens).toHaveLength(1);
    expect(itens[0].arquivos).toEqual(['questao.png']);
  });

  it('não junta prints de slides diferentes capturados no mesmo minuto', () => {
    const itens = agrupar([
      { arquivo: 'a.png', frame: frame({ enunciado: ENUNCIADO, alternativas: ALTERNATIVAS }) },
      {
        arquivo: 'b.png',
        frame: frame({
          enunciado: 'No período acima; há:',
          alternativas: { A: '1 artigo e 3 preposições', B: '4 artigos e 3 preposições' },
        }),
      },
    ]);

    expect(itens).toHaveLength(2);
  });
});

describe('fundir', () => {
  const completo = frame({ enunciado: ENUNCIADO, alternativas: ALTERNATIVAS });

  it('o frame com mais alternativas manda no texto', () => {
    const cortado = frame({
      enunciado: 'Aliás, o melhor para a democracia seria separar os fundos partidários',
      alternativas: { A: 'todas', B: 'apenas II e III', C: 'nenhuma' },
      cortada: true,
    });

    const item = fundir(
      { ...cortado, arquivos: ['cortado.png'] },
      { ...completo, enunciado: cortado.enunciado },
      'inteiro.png',
    );

    expect(Object.keys(item.alternativas)).toHaveLength(5);
    // Um frame inteiro basta para a questão deixar de estar cortada.
    expect(item.cortada).toBe(false);
  });

  it('mantém o gabarito já encontrado quando o outro frame não tem', () => {
    const comGabarito = { ...completo, gabarito: 'E', arquivos: ['gab.png'] };
    const item = fundir(comGabarito, completo, 'limpo.png');
    expect(item.gabarito).toBe('E');
  });

  it('aceita o gabarito que chega depois', () => {
    const item = fundir({ ...completo, arquivos: ['limpo.png'] }, { ...completo, gabarito: 'E' }, 'gab.png');
    expect(item.gabarito).toBe('E');
  });

  it('não repete o mesmo arquivo', () => {
    const item = fundir({ ...completo, arquivos: ['a.png'] }, completo, 'a.png');
    expect(item.arquivos).toEqual(['a.png']);
  });
});
