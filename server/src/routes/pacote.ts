import type { FastifyInstance } from 'fastify';
import { exec, q as consulta } from '../db.js';
import { inserirQuestoes } from '../seed.js';
import { agoraLocal } from '../util.js';
import { conferir } from '../pacote.js';

type LinhaLicenca = {
  id: string;
  banco: string;
  para: string;
  email: string;
  emitido_em: string;
  importado_em: string;
  questoes: number;
};

export function rotasPacote(app: FastifyInstance) {
  /** Licenças já importadas, da mais recente para a mais antiga. */
  app.get('/api/licencas', async () =>
    consulta<LinhaLicenca>('SELECT * FROM licencas ORDER BY importado_em DESC'),
  );

  /**
   * Importa um pacote comprado.
   *
   * Deliberadamente **não** é o /api/backup/restaurar: aquele aceita qualquer
   * tabela e tem o modo "substituir", que faria um TRUNCATE do histórico de
   * estudo de quem acabou de pagar. Aqui só entram matérias e questões, sempre
   * somando ao que já existe.
   */
  app.post<{ Body: unknown }>('/api/pacote/importar', async (req, reply) => {
    const conferencia = conferir(req.body);
    if (!conferencia.ok) return reply.code(400).send({ erro: conferencia.erro });

    const { licenca, questoes } = conferencia.pacote;

    const jaImportado = await consulta<{ id: string }>(
      'SELECT id FROM licencas WHERE id = $1',
      [licenca.id],
    );

    // inserirQuestoes ignora id repetido, então reimportar não duplica nada —
    // mas devolve 0, o que pareceria erro. Por isso o aviso explícito.
    const inseridas = await inserirQuestoes(questoes);

    await exec(
      `INSERT INTO licencas (id, banco, para, email, emitido_em, importado_em, questoes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        licenca.id,
        licenca.banco,
        licenca.para,
        licenca.email,
        licenca.emitido_em,
        agoraLocal(),
        questoes.length,
      ],
    );

    return {
      ok: true,
      licenca,
      total: questoes.length,
      inseridas,
      repetido: jaImportado.length > 0,
    };
  });
}
