import type { FastifyInstance } from 'fastify';
import { q as consulta, tx } from '../db.js';

/** Ordem de inserção: pais antes de filhos. */
const TABELAS = [
  'materias',
  'sessoes',
  'questoes',
  'respostas',
  'anotacoes',
  'agendamentos',
  'provas',
  'prova_questoes',
  'resultados',
  'config',
  'notas',
  'nota_tarefas',
] as const;

/** Tabelas com id serial, cuja sequência precisa ser realinhada após restaurar. */
const COM_SEQUENCIA = [
  'materias',
  'sessoes',
  'respostas',
  'provas',
  'resultados',
  'nota_tarefas',
] as const;

export function rotasBackup(app: FastifyInstance) {
  app.get('/api/backup', async (_req, reply) => {
    const dados: Record<string, unknown[]> = {};
    for (const t of TABELAS) dados[t] = await consulta(`SELECT * FROM ${t}`);

    const nome = `estudos-backup-${new Date().toISOString().slice(0, 10)}.json`;
    reply.header('Content-Disposition', `attachment; filename="${nome}"`);
    return { versao: 2, exportado_em: new Date().toISOString(), dados };
  });

  /**
   * Restaura um backup. `modo: "substituir"` apaga tudo antes de gravar;
   * `modo: "mesclar"` (padrão) mantém o que já existe e ignora duplicatas.
   */
  app.post<{ Body: { versao?: number; dados?: Record<string, any[]>; modo?: string } }>(
    '/api/backup/restaurar',
    async (req, reply) => {
      const dados = req.body?.dados;
      if (!dados || typeof dados !== 'object')
        return reply.code(400).send({ erro: 'Arquivo de backup inválido.' });

      const substituir = req.body?.modo === 'substituir';
      const resumo: Record<string, number> = {};

      try {
        await tx(async (c) => {
          if (substituir) {
            // TRUNCATE ... CASCADE resolve a ordem das dependências sozinho.
            await c.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
          }

          for (const tabela of TABELAS) {
            const linhas = dados[tabela];
            if (!Array.isArray(linhas) || linhas.length === 0) continue;

            const colunas = Object.keys(linhas[0]);
            const marcadores = colunas.map((_, i) => `$${i + 1}`).join(', ');
            const sql =
              `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES (${marcadores}) ` +
              'ON CONFLICT DO NOTHING';

            let n = 0;
            for (const linha of linhas) {
              const r = await c.query(
                sql,
                colunas.map((col) => linha[col] ?? null),
              );
              n += r.rowCount ?? 0;
            }
            resumo[tabela] = n;
          }

          // Ids vieram do backup, então as sequências precisam pular para frente.
          for (const tabela of COM_SEQUENCIA) {
            await c.query(
              `SELECT setval(pg_get_serial_sequence('${tabela}', 'id'),
                             COALESCE((SELECT MAX(id) FROM ${tabela}), 1))`,
            );
          }
        });
      } catch (erro) {
        return reply
          .code(400)
          .send({ erro: `Falha ao restaurar: ${(erro as Error).message}` });
      }

      return { ok: true, modo: substituir ? 'substituir' : 'mesclar', resumo };
    },
  );
}
