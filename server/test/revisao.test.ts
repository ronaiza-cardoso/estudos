/**
 * Repetição espaçada. Tudo aqui é função pura sobre o histórico de respostas,
 * então o teste não precisa de banco.
 */
import { describe, expect, it } from 'vitest';
import {
  INTERVALOS,
  NIVEL_MAXIMO,
  calcularEstado,
  diasEntre,
  ordenarParaRevisao,
  ordenarPorErros,
  semAdiadas,
  type Resposta,
} from '../src/revisao.js';

const HOJE = '2026-09-30';
const CORTE = '2026-09-24';
const QUESTAO = { id: 'q1', materia_id: 1 };

/** Histórico em ordem crescente de tempo, um dia por resposta. */
function historico(...linhas: [dia: string, correta: boolean][]): Resposta[] {
  return linhas.map(([dia, correta]) => ({ correta, ts: `${dia}T10:00:00` }));
}

describe('calcularEstado', () => {
  it('questão nunca respondida entra na fila, mas atrás de quem já errou', () => {
    const nova = calcularEstado(QUESTAO, [], HOJE, CORTE);
    const errada = calcularEstado(QUESTAO, historico(['2026-09-30', false]), HOJE, CORTE);

    expect(nova.vencida).toBe(true);
    expect(nova.peso).toBeLessThan(errada.peso);
  });

  it('errar zera o nível, mesmo depois de uma sequência de acertos', () => {
    const estado = calcularEstado(
      QUESTAO,
      historico(
        ['2026-09-01', true],
        ['2026-09-10', true],
        ['2026-09-20', true],
        ['2026-09-29', false],
      ),
      HOJE,
      CORTE,
    );

    expect(estado.nivel).toBe(0);
    expect(estado.tentativas).toBe(4);
    expect(estado.erros).toBe(1);
  });

  it('nível zero vence no mesmo dia — é o que faz o erro voltar na próxima sessão', () => {
    const estado = calcularEstado(QUESTAO, historico(['2026-09-30', false]), HOJE, CORTE);

    expect(INTERVALOS[0]).toBe(0);
    expect(estado.dias_desde_ultima).toBe(0);
    expect(estado.vencida).toBe(true);
  });

  it('cada acerto seguido empurra o próximo encontro para mais longe', () => {
    const doisAcertos = calcularEstado(
      QUESTAO,
      historico(['2026-09-28', true], ['2026-09-29', true]),
      HOJE,
      CORTE,
    );

    expect(doisAcertos.nivel).toBe(2);
    // Nível 2 espera 3 dias; só passou 1.
    expect(doisAcertos.vencida).toBe(false);
    expect(doisAcertos.atraso).toBe(1 - INTERVALOS[2]);
  });

  it('o nível não passa do teto da tabela de intervalos', () => {
    const muitos = historico(
      ...(Array.from({ length: 10 }, (_, i) => [`2026-09-${10 + i}`, true]) as [string, boolean][]),
    );
    expect(calcularEstado(QUESTAO, muitos, HOJE, CORTE).nivel).toBe(NIVEL_MAXIMO);
  });

  it('conta só os erros dentro da janela pedida', () => {
    const estado = calcularEstado(
      QUESTAO,
      historico(['2026-08-01', false], ['2026-09-26', false], ['2026-09-28', false]),
      HOJE,
      CORTE,
    );

    expect(estado.erros).toBe(3);
    expect(estado.erros_no_periodo).toBe(2);
  });

  it('histórico ruim continua pesando depois de voltar a acertar', () => {
    const limpa = calcularEstado(
      QUESTAO,
      historico(['2026-09-20', true], ['2026-09-21', true]),
      HOJE,
      CORTE,
    );
    const sofrida = calcularEstado(
      QUESTAO,
      historico(
        ['2026-09-10', false],
        ['2026-09-12', false],
        ['2026-09-20', true],
        ['2026-09-21', true],
      ),
      HOJE,
      CORTE,
    );

    expect(sofrida.nivel).toBe(limpa.nivel);
    expect(sofrida.peso).toBeGreaterThan(limpa.peso);
  });
});

describe('agendamento manual', () => {
  it('questão marcada para depois some da fila de hoje', () => {
    const estado = calcularEstado(
      { ...QUESTAO, agendada_para: '2026-10-05' },
      historico(['2026-09-01', false]),
      HOJE,
      CORTE,
    );

    // Pela conta ela está vencidíssima; o agendamento manual vence a conta.
    expect(estado.atraso).toBeGreaterThan(0);
    expect(estado.vencida).toBe(false);
  });

  it('no dia marcado ela vem na frente de tudo', () => {
    const agendada = calcularEstado(
      { ...QUESTAO, agendada_para: HOJE },
      historico(['2026-09-29', true]),
      HOJE,
      CORTE,
    );
    const errada = calcularEstado(
      { id: 'q2', materia_id: 1 },
      historico(['2026-09-29', false]),
      HOJE,
      CORTE,
    );

    expect(agendada.vencida).toBe(true);
    expect(agendada.peso).toBeGreaterThan(errada.peso);
    expect(ordenarParaRevisao([errada, agendada])[0].questao_id).toBe(QUESTAO.id);
  });

  it('data passada também conta como chamada', () => {
    const estado = calcularEstado(
      { ...QUESTAO, agendada_para: '2026-09-28' },
      [],
      HOJE,
      CORTE,
    );
    expect(estado.vencida).toBe(true);
    expect(estado.agendada_para).toBe('2026-09-28');
  });

  it('segura também a questão que nunca foi respondida', () => {
    const estado = calcularEstado({ ...QUESTAO, agendada_para: '2026-10-05' }, [], HOJE, CORTE);
    expect(estado.tentativas).toBe(0);
    expect(estado.vencida).toBe(false);
  });
});

describe('semAdiadas', () => {
  it('tira da fila o que foi marcado para outro dia, e mantém o resto', () => {
    const adiada = calcularEstado(
      { id: 'adiada', materia_id: 1, agendada_para: '2026-10-05' },
      historico(['2026-09-01', false]),
      HOJE,
      CORTE,
    );
    const chamada = calcularEstado(
      { id: 'chamada', materia_id: 1, agendada_para: HOJE },
      [],
      HOJE,
      CORTE,
    );
    // Não vencida e sem agendamento: o caderno pode usá-la para completar a
    // quantidade pedida, então ela não pode sumir aqui.
    const descansando = calcularEstado(
      { id: 'descansando', materia_id: 1 },
      historico(['2026-09-29', true], ['2026-09-30', true]),
      HOJE,
      CORTE,
    );

    const sobraram = semAdiadas([adiada, chamada, descansando]).map((e) => e.questao_id);
    expect(sobraram).toEqual(['chamada', 'descansando']);
  });
});

describe('ordenarParaRevisao', () => {
  it('põe o que foi errado na última vez na frente do que está só vencido', () => {
    const errada = calcularEstado(
      { id: 'errada', materia_id: 1 },
      historico(['2026-09-29', false]),
      HOJE,
      CORTE,
    );
    const antiga = calcularEstado(
      { id: 'antiga', materia_id: 1 },
      historico(['2026-07-01', true]),
      HOJE,
      CORTE,
    );
    const descansando = calcularEstado(
      { id: 'descansando', materia_id: 1 },
      historico(['2026-09-29', true], ['2026-09-30', true]),
      HOJE,
      CORTE,
    );

    const fila = ordenarParaRevisao([descansando, antiga, errada]);

    expect(fila.map((e) => e.questao_id)).toEqual(['errada', 'antiga', 'descansando']);
    expect(fila[2].vencida).toBe(false);
  });
});

describe('ordenarPorErros', () => {
  it('deixa de fora quem não errou na janela e ordena pelo número de erros', () => {
    const muitos = calcularEstado(
      { id: 'muitos', materia_id: 1 },
      historico(['2026-09-25', false], ['2026-09-26', false], ['2026-09-27', false]),
      HOJE,
      CORTE,
    );
    const um = calcularEstado(
      { id: 'um', materia_id: 1 },
      historico(['2026-09-26', false]),
      HOJE,
      CORTE,
    );
    const foraDaJanela = calcularEstado(
      { id: 'antiga', materia_id: 1 },
      historico(['2026-08-01', false]),
      HOJE,
      CORTE,
    );

    const fila = ordenarPorErros([um, foraDaJanela, muitos]);

    expect(fila.map((e) => e.questao_id)).toEqual(['muitos', 'um']);
  });
});

describe('diasEntre', () => {
  it('conta dias de calendário, inclusive atravessando o mês', () => {
    expect(diasEntre('2026-09-30', '2026-09-30')).toBe(0);
    expect(diasEntre('2026-09-28', '2026-10-01')).toBe(3);
  });
});
