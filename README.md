# Estudos

App local de tracking de estudos: pomodoro, estatísticas, banco de questões no
estilo QConcursos, provas e importação de provas em PDF.

Roda em Docker com Postgres. Os dados ficam em um volume no seu Mac.

---

## Subir

```bash
docker compose up -d --build
```

Abra **http://localhost:5182**.

O `docker compose` sobe dois containers: o Postgres e o app (API + frontend já
compilado, servidos pelo mesmo Fastify). Na primeira execução as migrations
rodam sozinhas e as questões de `seed-questoes.js` são carregadas.

```bash
docker compose logs -f app
```

```bash
docker compose down
```

Para apagar **também os dados**:

```bash
docker compose down -v
```

### Portas

| O quê      | Endereço          | Variável   |
| ---------- | ----------------- | ---------- |
| App        | http://localhost:5182 | `APP_PORT` |
| Postgres   | localhost:5434    | `DB_PORT`  |

Escolhi 5434 porque você já tem outro projeto ocupando 5432 e 5433. Para mudar
qualquer coisa, copie `.env.example` para `.env` e edite.

> **Fuso horário**: as datas são gravadas no horário local do container. O
> `TZ` padrão é `America/Sao_Paulo`. Se o seu for outro, ajuste no `.env` —
> senão estudar à noite pode cair no dia seguinte nas estatísticas.

---

## Dados de demonstração

Para ver o app cheio, sem ter que usar por semanas:

```bash
docker compose exec app npm run seed:demo -- --limpar
```

Fora do Docker, é o mesmo comando sem o prefixo:

```bash
npm run seed:demo -- --limpar
```

Gera 110 sessões espalhadas pelos últimos 35 dias (com dias de folga, para a
sequência não ser uma linha reta), respostas com cerca de 65% de acerto,
5 anotações, 3 provas já resolvidas, uma **questão anulada** e uma **cadastrada
à mão** — assim você vê a tag *Anulada* e o botão *Excluir*, que só aparece nas
suas próprias questões.

Os números saem de uma semente fixa, então rodar de novo devolve o mesmo banco.

- `--limpar` apaga o histórico antes de gerar (mantém as matérias e as questões
  do seed). **Sem** a flag, os dados são somados aos que já existem.
- Para voltar a um banco limpo de verdade: `docker compose down -v`.

---

## Desenvolvimento

Com o banco já rodando em Docker, você pode rodar app e front direto no Mac,
com hot reload:

```bash
docker compose up -d db
```

```bash
npm install && npm run dev
```

O app de desenvolvimento fica em **http://localhost:5182** (Vite) e a API em
`127.0.0.1:5183`. Use `localhost`, não `127.0.0.1`, para abrir o front — o Vite
escuta em IPv6.

```bash
npm test
```

---

## Pomodoro

A tela é só o contador: **Iniciar**, **Pausar** e **Encerrar**, mais os
quadrados de ciclo. Nada bloqueia o início.

- O timer usa o **timestamp de término**, então o tempo continua correto mesmo
  com a aba em segundo plano. O tempo restante aparece no título da aba.
- Ao terminar um foco: toca um som, mostra uma notificação do sistema e grava a
  sessão. Se **pausa automática** estiver ligada, a pausa começa sozinha.
- **Encerrar** grava a sessão parcial como *interrompido* a partir de 1 minuto;
  abaixo disso nada é registrado.

Foco, pausa, ciclos por bloco, som e notificações são ajustáveis em **Config**.

---

## Atividade

A aba **Sessões** mostra um heatmap no estilo GitHub: 53 semanas, uma coluna
por semana, um quadrado por dia. A intensidade vai de 0 a 4 conforme o tempo
estudado (menos de 30min, menos de 1h, menos de 2h, 2h ou mais).

- **Passar o mouse** mostra a data, o tempo e quantas sessões teve o dia.
- **Clicar** abre o detalhe daquele dia: cada sessão com horário e duração
  (marcando as interrompidas), as questões respondidas agrupadas por matéria
  com o percentual de acerto, e as provas resolvidas com a nota e o tempo.
  Dá para remover uma sessão por ali.

As sessões não guardam matéria — o pomodoro é só o contador. Então "o que foi
estudado" no dia vem das questões e das provas, que têm matéria. Se quiser
rotular a própria sessão, é preciso voltar um campo em `sessoes`.

---

## Importar provas em PDF

Coloque os arquivos em `uploads/` (a pasta é montada dentro do container) e:

```bash
docker compose exec app npm run import -- --prova uploads/prova.pdf --gabarito uploads/gabarito.pdf --cargo 200 --tipo A
```

Rodando fora do Docker, é o mesmo comando sem o prefixo:

```bash
npm run import -- --prova uploads/prova.pdf --gabarito uploads/gabarito.pdf --cargo 200 --tipo A
```

| Opção        | Obrigatória | Descrição                                           |
| ------------ | ----------- | --------------------------------------------------- |
| `--prova`    | sim         | PDF do caderno de questões                          |
| `--gabarito` | sim         | PDF do gabarito oficial                             |
| `--cargo`    | sim         | Número do cargo na tabela do gabarito               |
| `--tipo`     | sim         | Tipo da prova (A, B, C…)                            |
| `--nome`     | não         | Nome gravado nas questões (padrão: nome do arquivo) |
| `--banca`    | não         | Banca organizadora                                  |
| `--orgao`    | não         | Órgão                                               |
| `--ano`      | não         | Ano da prova                                        |
| `--materia`  | não         | Matéria usada quando a seção não for detectada      |
| `--id`       | não         | Prefixo dos ids gerados                             |
| `--sim`      | não         | Grava sem pedir confirmação                         |

O importador:

- extrai o texto com `pdf-parse`;
- remove cabeçalhos e rodapés (`PROCESSO SELETIVO`, `PÁGINA 3/15`, `Área livre`,
  `Rascunho`…) e junta palavras quebradas por hífen no fim da linha;
- divide o caderno por `QUESTÃO N`;
- associa os blocos `Texto para responder às questões X a Y` às questões da faixa;
- detecta as seções de disciplina (`LEGISLAÇÃO ADMINISTRATIVA / Questões de 9 a 16`),
  tanto na mesma linha quanto na linha anterior;
- lê a tabela do cargo e do tipo informados no gabarito, tratando `#` como
  **questão anulada**;
- mostra uma **prévia** e pede confirmação antes de gravar;
- **não duplica**: o id é `<prefixo>-q<número>`, único por prova e número.

Se o cargo/tipo não existir no PDF, o erro lista as combinações encontradas.

---

## Testes

```bash
npm test
```

Os testes do parser rodam contra fixtures em `server/test/fixtures/` que
reproduzem o texto de um caderno real (cabeçalhos, rodapés, hifenização, seções
e texto associado).

`server/test/uploads.test.ts` roda o parser contra **os PDFs reais que estiverem
em `uploads/`** e verifica numeração sem buracos, ausência de resíduo de
cabeçalho, seções que não se sobrepõem e ao menos 90% das questões com
alternativas reconhecidas. Com a pasta vazia esses testes são pulados.

---

## Backup

Em **Config → Backup**:

- **Exportar backup** baixa um JSON com todas as tabelas.
- **Importar backup** pergunta se você quer **substituir** tudo ou **mesclar**
  com o que já existe (mesclar ignora registros repetidos).

---

## Estrutura

```
estudos/
├── docker-compose.yml      Postgres + app
├── Dockerfile              build do app (front compilado + API)
├── seed-questoes.js        questões carregadas na primeira execução
├── uploads/                PDFs de provas e gabaritos (montado no container)
├── server/
│   ├── src/
│   │   ├── index.ts        Fastify: API + front estático
│   │   ├── db.ts           pool do Postgres, migrations e configuração
│   │   ├── migrations.ts   schema versionado
│   │   ├── routes/         materias, sessoes, questoes, provas, config, backup
│   │   └── import/         parser de PDF, gabarito e CLI
│   └── test/               testes do parser + fixtures
└── web/
    └── src/
        ├── styles/tokens.css   tokens do design system
        ├── components/         modais e cartão de questão
        └── pages/              pomodoro, sessões, questões, provas, config
```

### Modelo de dados

```
materias(id, nome)
sessoes(id, inicio, minutos, completa)
questoes(id, materia_id, assunto, ano, banca, orgao, prova, texto_assoc,
         enunciado, alternativas_json, gabarito, anulada, custom, criada_em)
respostas(id, questao_id, alternativa, correta, ts, origem)
anotacoes(questao_id, texto, atualizado_em)
provas(id, nome, criada_em) + prova_questoes(prova_id, questao_id, ordem)
resultados(id, prova_id, acertos, total, tempo_seg, ts)
config(chave, valor)
```

`sessoes` não guarda matéria — o pomodoro é só o contador. As estatísticas por
matéria são de questões (respondidas e % de acerto).

Datas são `TEXT` em ISO local (`2026-09-24T14:32:00`), de propósito: com
`timestamptz` o container em UTC agruparia o dia errado.

---

## Notas de uso

- **Questões anuladas** ficam com a tag *Anulada*, não entram no cálculo de
  acerto e são excluídas do sorteio de provas aleatórias.
- Só é possível **excluir questões cadastradas por você** — as importadas e as
  do seed são protegidas.
- Cada resposta dada dentro de uma prova entra no histórico da questão com
  origem *prova*.
