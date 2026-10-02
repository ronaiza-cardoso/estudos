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
  {
    id: 2,
    name: 'login',
    sql: `
      -- Uma conta só: o login é uma tranca no app, não um sistema
      -- multiusuário. Ainda assim é uma tabela, e não uma chave em "config",
      -- porque garantirConfig() apaga toda chave fora de CONFIG_PADRAO — o
      -- hash da senha morreria no primeiro boot.
      CREATE TABLE usuarios (
        id         SERIAL PRIMARY KEY,
        login      TEXT NOT NULL,
        senha_hash TEXT NOT NULL,
        criado_em  TEXT NOT NULL
      );
      -- Mesma convenção das matérias: unicidade sem diferenciar maiúsculas.
      CREATE UNIQUE INDEX idx_usuarios_login_lower ON usuarios (lower(login));

      -- O token guardado no cookie. Sessão no banco em vez de token assinado:
      -- assim "Sair" invalida de verdade, sem precisar de segredo em disco.
      CREATE TABLE sessoes_login (
        token      TEXT PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        criada_em  TEXT NOT NULL,
        expira_em  TEXT NOT NULL
      );
      CREATE INDEX idx_sessoes_login_expira ON sessoes_login (expira_em);
    `,
  },
  {
    id: 3,
    name: 'licencas',
    sql: `
      -- Carimbo dos pacotes de questões comprados. Fica em tabela, e não em
      -- "config", pelo mesmo motivo do hash da senha: garantirConfig() apaga
      -- toda chave fora de CONFIG_PADRAO.
      --
      -- Não é controle de acesso: as questões já entraram no banco e continuam
      -- lá. É o carimbo que o app exibe — quem compartilhar o arquivo
      -- compartilha o próprio nome junto.
      CREATE TABLE licencas (
        id           TEXT PRIMARY KEY,
        banco        TEXT NOT NULL,
        para         TEXT NOT NULL,
        email        TEXT NOT NULL,
        emitido_em   TEXT NOT NULL,
        importado_em TEXT NOT NULL,
        questoes     INTEGER NOT NULL
      );
    `,
  },
  {
    id: 4,
    name: 'importacao-de-prints',
    sql: `
      -- Um lote de prints lido pelo OCR. Vira questão só depois da revisão.
      CREATE TABLE importacoes (
        id          SERIAL PRIMARY KEY,
        nome        TEXT    NOT NULL,
        criada_em   TEXT    NOT NULL,
        estado      TEXT    NOT NULL DEFAULT 'processando',
        total       INTEGER NOT NULL DEFAULT 0,
        processados INTEGER NOT NULL DEFAULT 0,
        erro        TEXT
      );

      -- Rascunho de questão. Vários frames do mesmo slide caem no mesmo item:
      -- "chave" é o começo do enunciado normalizado, e é por ela que o frame
      -- limpo, o frame anotado e o frame com o gabarito se reencontram.
      CREATE TABLE importacao_itens (
        id            SERIAL  PRIMARY KEY,
        importacao_id INTEGER NOT NULL REFERENCES importacoes(id) ON DELETE CASCADE,
        chave         TEXT    NOT NULL,
        ordem         INTEGER NOT NULL,
        arquivos      TEXT    NOT NULL,
        dados_json    TEXT    NOT NULL,
        estado        TEXT    NOT NULL DEFAULT 'rascunho',
        questao_id    TEXT
      );
      CREATE UNIQUE INDEX idx_itens_chave ON importacao_itens (importacao_id, chave);
      CREATE INDEX idx_itens_ordem ON importacao_itens (importacao_id, ordem);
    `,
  },
  {
    id: 5,
    name: 'sem-chave-de-api',
    sql: `
      -- A leitura dos prints passou a ser OCR local, num container. Não há
      -- mais chave de API para guardar.
      DROP TABLE IF EXISTS segredos;
    `,
  },
  {
    id: 6,
    name: 'notas-e-tarefas',
    sql: `
      -- Uma nota por dia: o que foi estudado, escrito no fim do dia. O dia é a
      -- própria chave — não existe "duas notas do mesmo dia", e gravar vira um
      -- upsert simples.
      CREATE TABLE notas (
        dia           TEXT PRIMARY KEY,
        texto         TEXT NOT NULL DEFAULT '',
        criada_em     TEXT NOT NULL,
        atualizado_em TEXT NOT NULL
      );

      -- O TODO. A tarefa fica presa ao dia em que foi escrita, mas continua em
      -- aberto até ser marcada: é isso que faz o que sobrou de ontem aparecer
      -- na sessão de hoje.
      CREATE TABLE nota_tarefas (
        id        SERIAL  PRIMARY KEY,
        dia       TEXT    NOT NULL REFERENCES notas(dia) ON DELETE CASCADE,
        texto     TEXT    NOT NULL,
        feita     BOOLEAN NOT NULL DEFAULT FALSE,
        ordem     INTEGER NOT NULL DEFAULT 0,
        criada_em TEXT    NOT NULL,
        feita_em  TEXT
      );
      CREATE INDEX idx_nota_tarefas_dia     ON nota_tarefas (dia, ordem);
      CREATE INDEX idx_nota_tarefas_abertas ON nota_tarefas (feita, dia);
    `,
  },
  {
    id: 7,
    name: 'agendamentos',
    sql: `
      -- "Responder amanhã": uma data marcada à mão, que vence a conta da
      -- repetição espaçada nos dois sentidos — segura a questão até o dia, e
      -- joga ela para a frente da fila quando o dia chega.
      --
      -- Uma linha por questão: adiar de novo é remarcar, não empilhar.
      CREATE TABLE agendamentos (
        questao_id TEXT PRIMARY KEY REFERENCES questoes(id) ON DELETE CASCADE,
        data       TEXT NOT NULL,
        criado_em  TEXT NOT NULL
      );
      CREATE INDEX idx_agendamentos_data ON agendamentos (data);
    `,
  },
];
