import { describe, expect, it } from 'vitest';
import {
  FORMATO,
  VERSAO,
  assinar,
  canonico,
  conferir,
  gerarParDeChaves,
  type Miolo,
} from '../src/pacote.js';

const { publica, privada } = gerarParDeChaves();
const outro = gerarParDeChaves();

const questao = {
  id: 'inss-2024-q1',
  materia: 'Direito Previdenciário',
  enunciado: 'Sobre o RGPS, assinale a alternativa correta.',
  alternativas: { A: 'Primeira', B: 'Segunda' },
  gabarito: 'B',
};

function miolo(): Miolo {
  return {
    formato: FORMATO,
    versao: VERSAO,
    licenca: {
      id: '11111111-2222-3333-4444-555555555555',
      banco: 'Banco INSS 2026',
      para: 'Fulano de Tal',
      email: 'fulano@exemplo.com',
      emitido_em: '2026-09-30T10:00:00',
    },
    questoes: [questao],
  };
}

/** O arquivo chega por JSON.parse, não como o objeto que assinamos. */
const comoArquivo = (p: unknown) => JSON.parse(JSON.stringify(p));

describe('canonico', () => {
  it('ordena as chaves, em qualquer profundidade', () => {
    expect(canonico({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('dá o mesmo texto para objetos montados em ordens diferentes', () => {
    expect(canonico({ a: 1, b: [{ y: 1, x: 2 }] })).toBe(canonico({ b: [{ x: 2, y: 1 }], a: 1 }));
  });

  it('preserva a ordem dos arrays, que é significativa', () => {
    expect(canonico([2, 1])).not.toBe(canonico([1, 2]));
  });

  it('ignora undefined, que JSON.parse nunca devolve', () => {
    expect(canonico({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('conferir', () => {
  it('aceita um pacote recém-assinado', () => {
    const r = conferir(comoArquivo(assinar(miolo(), privada)), publica);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pacote.licenca.para).toBe('Fulano de Tal');
  });

  it('aceita mesmo que o JSON venha com as chaves em outra ordem', () => {
    const p = assinar(miolo(), privada) as any;
    const embaralhado = {
      assinatura: p.assinatura,
      questoes: p.questoes,
      versao: p.versao,
      licenca: { email: p.licenca.email, para: p.licenca.para, ...p.licenca },
      formato: p.formato,
    };
    expect(conferir(comoArquivo(embaralhado), publica).ok).toBe(true);
  });

  it('recusa quando a licença é trocada — o ponto da assinatura', () => {
    const p = assinar(miolo(), privada);
    const adulterado = comoArquivo(p);
    adulterado.licenca.para = 'Outra Pessoa';

    const r = conferir(adulterado, publica);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/alterado/i);
  });

  it('recusa quando as questões são trocadas', () => {
    const adulterado = comoArquivo(assinar(miolo(), privada));
    adulterado.questoes.push({ ...questao, id: 'clandestina' });
    expect(conferir(adulterado, publica).ok).toBe(false);
  });

  it('recusa pacote assinado com outra chave', () => {
    const p = comoArquivo(assinar(miolo(), outro.privada));
    expect(conferir(p, publica).ok).toBe(false);
  });

  it('recusa sem assinatura', () => {
    const p = comoArquivo(assinar(miolo(), privada));
    delete p.assinatura;
    const r = conferir(p, publica);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/sem assinatura/i);
  });

  it('recusa arquivo que não é pacote — um backup, por exemplo', () => {
    const r = conferir({ versao: 2, dados: { questoes: [] } }, publica);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/não é um pacote/i);
  });

  it('recusa pacote de versão futura, pedindo atualização', () => {
    const p = comoArquivo(assinar({ ...miolo(), versao: VERSAO + 1 }, privada));
    const r = conferir(p, publica);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/atualize o app/i);
  });

  it('recusa pacote vazio', () => {
    const p = comoArquivo(assinar({ ...miolo(), questoes: [] }, privada));
    const r = conferir(p, publica);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/sem questões/i);
  });

  it('recusa tudo quando o app foi compilado sem chave pública', () => {
    const r = conferir(comoArquivo(assinar(miolo(), privada)), '');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/sem chave pública/i);
  });

  it('não estoura com lixo no lugar da assinatura', () => {
    const p = comoArquivo(assinar(miolo(), privada));
    p.assinatura = 'nem base64 nem nada';
    expect(() => conferir(p, publica)).not.toThrow();
    expect(conferir(p, publica).ok).toBe(false);
  });

  it('cada emissão tem id próprio: duas cópias do mesmo banco são distinguíveis', () => {
    const a = assinar({ ...miolo(), licenca: { ...miolo().licenca, id: 'a' } }, privada);
    const b = assinar({ ...miolo(), licenca: { ...miolo().licenca, id: 'b' } }, privada);
    expect(a.assinatura).not.toBe(b.assinatura);
  });
});
