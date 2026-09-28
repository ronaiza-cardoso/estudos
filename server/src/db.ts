import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrations } from './migrations.js';

/**
 * O app fala Postgres em dois modos:
 *
 *  - **embutido** (padrão): PGlite, que é o Postgres compilado para WASM e roda
 *    dentro do próprio processo. Não precisa instalar nada, e é o que permite
 *    empacotar o app para desktop.
 *  - **servidor**: Postgres de verdade, usado quando `DATABASE_URL` está
 *    definida — é o caso do docker compose.
 *
 * O SQL é o mesmo nos dois: só o driver muda.
 *
 * Datas são guardadas como TEXT em ISO local ("2026-09-24T14:32:00"). É
 * proposital: em UTC, agrupar por dia devolveria o dia errado para quem estuda
 * à noite. Com TEXT local, `substr(inicio, 1, 10)` já é o dia certo.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const URL_BANCO = process.env.DATABASE_URL ?? null;

/** Onde o PGlite guarda os dados quando não há Postgres externo. */
export const DIR_DADOS =
  process.env.ESTUDOS_DATA_DIR ?? resolve(here, '../../data/pglite');

export const CONFIG_PADRAO: Record<string, string> = {
  foco_min: '25',
  pausa_min: '5',
  ciclos_ate_pausa_longa: '4',
  pausa_auto: '1',
  som_ativo: '1',
  notificacoes: '1',
};

type Resultado<T> = { rows: T[]; rowCount: number };

/** O mínimo que as rotas precisam — vale para o pool e para uma transação. */
export interface Cliente {
  query<T = any>(sql: string, params?: unknown[]): Promise<Resultado<T>>;
  /** Roda um script com vários comandos (usado pelas migrations). */
  exec(sql: string): Promise<void>;
}

interface Driver extends Cliente {
  tx<T>(fn: (c: Cliente) => Promise<T>): Promise<T>;
  pronto(): Promise<void>;
  encerrar(): Promise<void>;
  descricao: string;
}

/* ------------------------------ PGlite ------------------------------ */

async function driverEmbutido(dir: string): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  mkdirSync(dir, { recursive: true });

  const db = new PGlite(dir);
  await db.waitReady;

  const adaptar = (alvo: any): Cliente => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await alvo.query(sql, params as any[]);
      return { rows: (r.rows ?? []) as T[], rowCount: r.affectedRows ?? 0 };
    },
    async exec(sql: string) {
      await alvo.exec(sql);
    },
  });

  const base = adaptar(db);

  return {
    ...base,
    tx: (fn) => db.transaction(async (t: any) => fn(adaptar(t))) as any,
    pronto: async () => undefined,
    encerrar: () => db.close(),
    descricao: `PGlite embutido em ${dir}`,
  };
}

/* ------------------------------ Postgres ------------------------------ */

async function driverServidor(url: string): Promise<Driver> {
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, max: 10 });

  const adaptar = (alvo: any): Cliente => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await alvo.query(sql, params as any[]);
      return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
    },
    async exec(sql: string) {
      // Sem parâmetros, o driver aceita vários comandos de uma vez.
      await alvo.query(sql);
    },
  });

  return {
    ...adaptar(pool),
    async tx<T>(fn: (c: Cliente) => Promise<T>) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const r = await fn(adaptar(cliente));
        await cliente.query('COMMIT');
        return r;
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      } finally {
        cliente.release();
      }
    },
    /** O container do banco sobe junto, então vale a pena esperar. */
    async pronto() {
      for (let i = 1; i <= 30; i++) {
        try {
          await pool.query('SELECT 1');
          return;
        } catch (erro) {
          if (i === 30) throw erro;
          console.log(`Aguardando o banco… (${i}/30)`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    },
    encerrar: () => pool.end(),
    descricao: `Postgres em ${url.replace(/:\/\/[^@]*@/, '://***@')}`,
  };
}

/* ------------------------------ acesso ------------------------------ */

let driver: Driver | null = null;

export async function abrirBanco(): Promise<Driver> {
  if (driver) return driver;
  driver = URL_BANCO ? await driverServidor(URL_BANCO) : await driverEmbutido(DIR_DADOS);
  await driver.pronto();
  console.log(driver.descricao);
  return driver;
}

function exigirDriver(): Driver {
  if (!driver) throw new Error('Banco não foi aberto. Chame abrirBanco() antes.');
  return driver;
}

/** Consulta que devolve várias linhas. */
export async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await exigirDriver().query<T>(sql, params)).rows;
}

/** Consulta que devolve no máximo uma linha. */
export async function um<T = any>(
  sql: string,
  params: unknown[] = [],
): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

/** Comando sem retorno; devolve quantas linhas foram afetadas. */
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  return (await exigirDriver().query(sql, params)).rowCount;
}

/** Roda várias operações em uma transação, com rollback em caso de erro. */
export async function tx<T>(fn: (c: Cliente) => Promise<T>): Promise<T> {
  return exigirDriver().tx(fn);
}

export async function encerrarBanco(): Promise<void> {
  if (!driver) return;
  await driver.encerrar();
  driver = null;
}

export async function migrar(): Promise<void> {
  const d = exigirDriver();

  await d.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const aplicadas = new Set((await q<{ id: number }>('SELECT id FROM _migrations')).map((r) => r.id));

  for (const m of migrations) {
    if (aplicadas.has(m.id)) continue;
    await d.tx(async (c) => {
      await c.exec(m.sql);
      await c.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [m.id, m.name]);
    });
    console.log(`migration aplicada: ${m.id} ${m.name}`);
  }
}

/** Garante que as chaves de configuração padrão existam. */
export async function garantirConfig(): Promise<void> {
  for (const [chave, valor] of Object.entries(CONFIG_PADRAO)) {
    await exec(
      'INSERT INTO config (chave, valor) VALUES ($1, $2) ON CONFLICT (chave) DO NOTHING',
      [chave, valor],
    );
  }
  // Limpa chaves de versões anteriores (o foco do Mac foi removido).
  await exec('DELETE FROM config WHERE chave <> ALL($1::text[])', [Object.keys(CONFIG_PADRAO)]);
}

export async function lerConfig(): Promise<Record<string, string>> {
  const linhas = await q<{ chave: string; valor: string }>('SELECT chave, valor FROM config');
  return Object.fromEntries(linhas.map((l) => [l.chave, l.valor]));
}

/** Retorna o id da matéria, criando-a se ainda não existir. */
export async function materiaId(nome: string): Promise<number> {
  const limpo = nome.trim() || 'Sem matéria';

  const existente = await um<{ id: number }>(
    'SELECT id FROM materias WHERE lower(nome) = lower($1)',
    [limpo],
  );
  if (existente) return existente.id;

  const criada = await um<{ id: number }>(
    `INSERT INTO materias (nome) VALUES ($1)
     ON CONFLICT (nome) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id`,
    [limpo],
  );
  return criada!.id;
}
