import type { FastifyInstance } from 'fastify';
import { CONFIG_PADRAO, exec, lerConfig } from '../db.js';

export function rotasConfig(app: FastifyInstance) {
  app.get('/api/config', async () => lerConfig());

  app.put<{ Body: Record<string, string | number | boolean> }>(
    '/api/config',
    async (req) => {
      // Só aceitamos chaves conhecidas — evita lixo na tabela de configuração.
      const entradas = Object.entries(req.body ?? {}).filter(
        ([chave]) => chave in CONFIG_PADRAO,
      );

      for (const [chave, valor] of entradas) {
        await exec(
          `INSERT INTO config (chave, valor) VALUES ($1, $2)
           ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`,
          [chave, String(valor)],
        );
      }

      return lerConfig();
    },
  );
}
