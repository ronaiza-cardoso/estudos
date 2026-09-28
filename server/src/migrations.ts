export type Migration = { id: number; name: string; sql: string };

export const migrations: Migration[] = [
  {
    id: 1,
    name: 'schema-inicial',
    sql: `
      CREATE TABLE materias (
        id   SERIAL PRIMARY KEY,
        nome TEXT NOT NULL UNIQUE
      );
      -- unicidade sem diferenciar maiúsculas/minúsculas
      CREATE UNIQUE INDEX idx_materias_nome_lower ON materias (lower(nome));

      -- A sessão não guarda matéria: o pomodoro é só o contador.
      CREATE TABLE sessoes (
        id       SERIAL PRIMARY KEY,
        inicio   TEXT    NOT NULL,
        minutos  INTEGER NOT NULL,
        completa BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE INDEX idx_sessoes_inicio ON sessoes (inicio);

      CREATE TABLE questoes (
        id                TEXT PRIMARY KEY,
        materia_id        INTEGER REFERENCES materias(id) ON DELETE SET NULL,
        assunto           TEXT,
        ano               INTEGER,
        banca             TEXT,
        orgao             TEXT,
        prova             TEXT,
        texto_assoc       TEXT,
        enunciado         TEXT NOT NULL,
        alternativas_json TEXT NOT NULL,
        gabarito          TEXT,
        anulada           BOOLEAN NOT NULL DEFAULT FALSE,
        custom            BOOLEAN NOT NULL DEFAULT FALSE,
        criada_em         TEXT NOT NULL
      );
      CREATE INDEX idx_questoes_materia ON questoes (materia_id);

      CREATE TABLE respostas (
        id          SERIAL PRIMARY KEY,
        questao_id  TEXT NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
        alternativa TEXT NOT NULL,
        correta     BOOLEAN NOT NULL,
        ts          TEXT NOT NULL,
        origem      TEXT NOT NULL DEFAULT 'banco'
      );
      CREATE INDEX idx_respostas_questao ON respostas (questao_id);
      CREATE INDEX idx_respostas_ts      ON respostas (ts);

      CREATE TABLE anotacoes (
        questao_id    TEXT PRIMARY KEY REFERENCES questoes(id) ON DELETE CASCADE,
        texto         TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      CREATE TABLE provas (
        id        SERIAL PRIMARY KEY,
        nome      TEXT NOT NULL,
        criada_em TEXT NOT NULL
      );

      CREATE TABLE prova_questoes (
        prova_id   INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
        questao_id TEXT    NOT NULL REFERENCES questoes(id) ON DELETE CASCADE,
        ordem      INTEGER NOT NULL,
        PRIMARY KEY (prova_id, questao_id)
      );

      CREATE TABLE resultados (
        id        SERIAL PRIMARY KEY,
        prova_id  INTEGER NOT NULL REFERENCES provas(id) ON DELETE CASCADE,
        acertos   INTEGER NOT NULL,
        total     INTEGER NOT NULL,
        tempo_seg INTEGER NOT NULL,
        ts        TEXT NOT NULL
      );
      CREATE INDEX idx_resultados_prova ON resultados (prova_id);

      CREATE TABLE config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      );
    `,
  },
];
