/**
 * Notas do dia e o TODO que sai delas. A quebra do texto colado em uma tarefa
 * por linha é pura; o resto é SQL, então sobe um PGlite de verdade num
 * diretório temporário — o que também exercita a migration.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// `db.ts` lê DATABASE_URL na carga do módulo: sem isto, quem tiver a variável
// exportada no shell rodaria os testes contra o Postgres do compose.
delete process.env.DATABASE_URL;

const dir = mkdtempSync(resolve(tmpdir(), 'estudos-notas-'));
process.env.ESTUDOS_DATA_DIR = dir;

const db = await import('../src/db.js');
const notas = await import('../src/notas.js');

const ONTEM = '2026-10-01';
const HOJE = '2026-10-02';

beforeAll(async () => {
  await db.abrirBanco();
  await db.migrar();
});

afterAll(async () => {
  await db.encerrarBanco();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.exec('DELETE FROM notas');
});

describe('linhasDeTarefas', () => {
  it('cria uma tarefa por linha e descarta o marcador', () => {
    expect(
      notas.linhasDeTarefas('- revisar crase\n* 20 questões\n1. ler a lei\n[ ] simulado'),
    ).toEqual(['revisar crase', '20 questões', 'ler a lei', 'simulado']);
  });

  it('ignora linhas em branco e sobras de espaço', () => {
    expect(notas.linhasDeTarefas('  um  \n\n\n   \n  dois')).toEqual(['um', 'dois']);
  });

  it('não come o texto de uma linha sem marcador', () => {
    expect(notas.linhasDeTarefas('Lei 8.112, art. 1 a 20')).toEqual(['Lei 8.112, art. 1 a 20']);
  });
});

describe('salvarNota', () => {
  it('grava e regrava o texto do mesmo dia sem duplicar a linha', async () => {
    await notas.salvarNota(HOJE, 'parei na aula 12');
    const nota = await notas.salvarNota(HOJE, 'parei na aula 13');

    expect(nota?.texto).toBe('parei na aula 13');
    expect((await notas.listarNotas(10)).length).toBe(1);
  });

  it('texto vazio apaga a nota, para não deixar dia em branco no histórico', async () => {
    await notas.salvarNota(HOJE, 'algo');
    expect(await notas.salvarNota(HOJE, '   ')).toBeNull();
    expect(await notas.lerNota(HOJE)).toBeNull();
  });

  it('mas mantém a nota quando ela ainda tem tarefas penduradas', async () => {
    await notas.criarTarefas(HOJE, 'revisar crase');
    expect(await notas.salvarNota(HOJE, '')).not.toBeNull();
    expect((await notas.lerNota(HOJE))?.tarefas).toHaveLength(1);
  });
});

describe('tarefas', () => {
  it('entram na ordem em que foram escritas, mesmo em chamadas separadas', async () => {
    await notas.criarTarefas(HOJE, 'primeira\nsegunda');
    await notas.criarTarefas(HOJE, 'terceira');

    const nota = await notas.lerNota(HOJE);
    expect(nota?.tarefas.map((t) => t.texto)).toEqual(['primeira', 'segunda', 'terceira']);
    expect(nota?.tarefas.map((t) => t.ordem)).toEqual([1, 2, 3]);
  });

  it('criar tarefa abre a nota do dia, mesmo sem texto escrito', async () => {
    await notas.criarTarefas(HOJE, 'revisar crase');
    expect((await notas.lerNota(HOJE))?.texto).toBe('');
  });

  it('o que não foi marcado continua em aberto no dia seguinte', async () => {
    const [velha] = await notas.criarTarefas(ONTEM, 'terminar a lei 8.112');
    await notas.criarTarefas(HOJE, 'questões de português');
    await notas.criarTarefas(ONTEM, 'já resolvida');

    const resolvida = (await notas.lerNota(ONTEM))!.tarefas.find(
      (t) => t.texto === 'já resolvida',
    )!;
    await notas.atualizarTarefa(resolvida.id, { feita: true });

    const abertas = await notas.tarefasAbertas();
    // Da mais antiga para a mais nova: o atraso aparece primeiro.
    expect(abertas.map((t) => t.texto)).toEqual([
      'terminar a lei 8.112',
      'questões de português',
    ]);
    expect(abertas[0].id).toBe(velha.id);
  });

  it('marcar carimba a hora; desmarcar limpa o carimbo', async () => {
    const [tarefa] = await notas.criarTarefas(HOJE, 'simulado');
    expect(tarefa.feita_em).toBeNull();

    const feita = await notas.atualizarTarefa(tarefa.id, { feita: true });
    expect(feita).toMatchObject({ feita: true });
    expect((feita as typeof tarefa).feita_em).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const reaberta = await notas.atualizarTarefa(tarefa.id, { feita: false });
    expect(reaberta).toMatchObject({ feita: false, feita_em: null });
  });

  it('remarcar não reescreve o carimbo original', async () => {
    const [tarefa] = await notas.criarTarefas(HOJE, 'simulado');
    const primeira = (await notas.atualizarTarefa(tarefa.id, { feita: true })) as typeof tarefa;
    const segunda = (await notas.atualizarTarefa(tarefa.id, { texto: 'simulado 2' })) as typeof tarefa;

    expect(segunda.texto).toBe('simulado 2');
    expect(segunda.feita_em).toBe(primeira.feita_em);
  });

  it('mudar só o estado preserva o texto, e vice-versa', async () => {
    const [tarefa] = await notas.criarTarefas(HOJE, 'ler o edital');

    expect(await notas.atualizarTarefa(tarefa.id, { feita: true })).toMatchObject({
      texto: 'ler o edital',
    });
    expect(await notas.atualizarTarefa(tarefa.id, { texto: 'ler o edital todo' })).toMatchObject({
      feita: true,
    });
  });

  it('recusa texto vazio em vez de apagar a tarefa por acidente', async () => {
    const [tarefa] = await notas.criarTarefas(HOJE, 'ler o edital');
    expect(await notas.atualizarTarefa(tarefa.id, { texto: '  ' })).toBe('texto-vazio');
    expect((await notas.lerNota(HOJE))?.tarefas).toHaveLength(1);
  });

  it('avisa quando a tarefa não existe', async () => {
    expect(await notas.atualizarTarefa(99999, { feita: true })).toBeNull();
    expect(await notas.removerTarefa(99999)).toBe(false);
  });

  it('remover a última tarefa de um dia sem texto apaga o dia junto', async () => {
    const [tarefa] = await notas.criarTarefas(HOJE, 'revisar crase');
    expect(await notas.removerTarefa(tarefa.id)).toBe(true);
    expect(await notas.lerNota(HOJE)).toBeNull();
  });

  it('mas não apaga o dia que tem texto escrito', async () => {
    await notas.salvarNota(HOJE, 'parei na aula 12');
    const [tarefa] = await notas.criarTarefas(HOJE, 'revisar crase');
    await notas.removerTarefa(tarefa.id);

    expect((await notas.lerNota(HOJE))?.texto).toBe('parei na aula 12');
  });

  it('texto em branco não cria tarefa nenhuma', async () => {
    expect(await notas.criarTarefas(HOJE, '  \n \n')).toEqual([]);
    expect(await notas.lerNota(HOJE)).toBeNull();
  });
});

describe('listarNotas', () => {
  it('vem do dia mais recente para o mais antigo, com as tarefas de cada um', async () => {
    await notas.salvarNota(ONTEM, 'ontem');
    await notas.criarTarefas(ONTEM, 'tarefa de ontem');
    await notas.salvarNota(HOJE, 'hoje');

    const lista = await notas.listarNotas(10);
    expect(lista.map((n) => n.dia)).toEqual([HOJE, ONTEM]);
    expect(lista[0].tarefas).toEqual([]);
    expect(lista[1].tarefas.map((t) => t.texto)).toEqual(['tarefa de ontem']);
  });

  it('respeita o limite', async () => {
    for (const dia of ['2026-09-28', '2026-09-29', '2026-09-30']) {
      await notas.salvarNota(dia, dia);
    }
    expect((await notas.listarNotas(2)).map((n) => n.dia)).toEqual([
      '2026-09-30',
      '2026-09-29',
    ]);
  });
});

describe('removerNota', () => {
  it('leva as tarefas do dia junto', async () => {
    await notas.salvarNota(HOJE, 'nota');
    await notas.criarTarefas(HOJE, 'uma\noutra');

    expect(await notas.removerNota(HOJE)).toBe(true);
    expect(await notas.tarefasAbertas()).toEqual([]);
    expect(await notas.lerNota(HOJE)).toBeNull();
  });
});
