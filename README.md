# Estudos

App local de tracking de estudos: pomodoro, estatísticas, banco de questões no
estilo QConcursos, provas e importação de provas em PDF.

Roda em Docker com Postgres. Os dados ficam em um volume no seu Mac.
O acesso pelo navegador é protegido por senha; o app desktop entra direto.

---

## Subir

```bash
docker compose up -d --build
```

Abra **http://localhost:5182**. Na primeira vez a tela pede para **criar o
acesso** — escolha usuário e senha. Veja [Login](#login).

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

### Na web, de qualquer dispositivo

O `docker compose` acima roda na sua máquina, então só vale nela. Para abrir o
app no celular e no notebook **vendo os mesmos dados**, o banco precisa sair do
seu computador: é o que [DEPLOY.md](DEPLOY.md) descreve, incluindo como levar
os dados que você já tem e o que muda na importação de prints.

---

## Login

Uma conta só. É uma **tranca no app**, não um sistema multiusuário: quem entra
vê todos os dados, e nenhuma tabela tem dono.

No primeiro acesso a tela pede usuário e senha (mínimo de 8 caracteres). O
cadastro se fecha sozinho depois disso — a rota `/api/primeiro-acesso` passa a
responder 409, então ninguém se cadastra por cima.

Toda a API fica protegida, menos o healthcheck e as próprias rotas de entrada.
A sessão dura 30 dias, num cookie `HttpOnly` + `SameSite=Lax`. Para trocar a
senha, vá em **Config → Acesso**; isso derruba as outras sessões e mantém a sua.

### Onde vale

| Modo | Login | Por quê |
| ---- | ----- | ------- |
| `docker compose` | **exigido** | é o modo servido pela rede |
| App desktop (Electron) | dispensado | já está atrás do login do macOS, e o banco é um arquivo na sua pasta de usuário |
| `npm run dev` | dispensado | banco embutido, igual ao desktop |

O padrão é ligar o login quando existe `DATABASE_URL` — que é exatamente o caso
do compose. Para forçar o contrário:

```bash
ESTUDOS_LOGIN=1 npm run dev
```

`ESTUDOS_LOGIN=0` desliga mesmo no Docker.

> **Atrás de HTTPS**: ponha `COOKIE_SEGURO=1` no `.env` para marcar o cookie
> como `Secure`. Em HTTP puro **não** ligue — o navegador descarta o cookie e o
> login entra em laço.

### Esqueci a senha

Não há recuperação por e-mail. Apague a conta e a tela de primeiro acesso volta:

```bash
docker compose exec db psql -U estudos -d estudos -c "DELETE FROM usuarios"
```

Os dados de estudo não são tocados — só a credencial. As sessões abertas caem
junto, por `ON DELETE CASCADE`.

### Como a senha é guardada

`scrypt` do `node:crypto`, com salt novo a cada hash e o custo gravado junto
(`scrypt$16384$8$1$<salt>$<hash>`). Não usei bcrypt nem argon2 porque os dois
exigem compilação nativa, o que quebraria a imagem Alpine e o empacotamento do
Electron.

O backup em JSON **não** inclui a conta nem as sessões: restaurar um backup não
mexe na sua senha.

Depois de 8 tentativas erradas a origem fica 15 minutos bloqueada.

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

## Notas e TODO do dia

A aba **Notas** é o caderno de bordo: no fim da sessão você escreve o que
estudou e o que a próxima sessão precisa pegar. No dia seguinte, abrir a aba já
responde "por onde eu continuo".

A tela tem três partes, nessa ordem:

- **Para hoje** — tudo que está em aberto, do mais antigo para o mais novo.
  A tarefa fica presa ao dia em que foi escrita, mas **não some na virada do
  dia**: só sai da lista quando é marcada. O que ficou de trás vem com o selo
  do dia em vermelho.
- **Anotação do dia** — o texto livre, salvo sozinho enquanto você escreve, e o
  campo de tarefas logo abaixo. **Enter** adiciona, **Shift+Enter** quebra a
  linha, e colar uma lista inteira cria **uma tarefa por linha** — os `-`, `*`,
  `1.` e `[ ]` do começo da linha são descartados. O seletor de data ao lado do
  título permite escrever a nota de outro dia (o de ontem, se esqueceu; o de
  amanhã, se quer deixar o plano pronto).
- **Dias anteriores** — o histórico, com o texto e as tarefas de cada dia.

Marcar uma tarefa não a tira da lista na hora: ela fica riscada até o próximo
carregamento, para que um clique errado não obrigue a caçá-la no histórico.

É uma nota por dia — o dia é a própria chave. Nota com texto vazio e sem
tarefas é apagada, para não encher o histórico de dias em branco só porque a
aba foi aberta.

---

## Importar prints de videoaula

Os prints do VLC de uma videoaula viram questões pelo **primeiro campo do
cadastro**: em *Questões › Cadastrar questão*, você arrasta os arquivos, o OCR
lê, e o formulário abaixo já vem preenchido para conferir antes de salvar.

Quando o lote dá mais de uma questão, o modal vira passo-a-passo ("questão 3 de
9") e salvar leva para a próxima. Fechar no meio não perde nada: na próxima vez
o cadastro oferece continuar de onde parou.

A leitura é OCR local (Tesseract em português) dentro de um container, que roda
com `--network none`. Não usa API paga e nenhum print sai da máquina. A imagem é
construída sozinha na primeira leitura; o Docker precisa estar aberto.

Também dá para ler uma pasta inteira pela linha de comando:

```bash
npm run import:prints -- --dir assets/portugues/aula-01
```

O lote lido pela linha de comando aparece no cadastro como leitura pendente.

| Opção     | Obrigatória | Descrição                                        |
| --------- | ----------- | ------------------------------------------------ |
| `--dir`   | sim         | Pasta com os prints (.png, .jpg, .webp)          |
| `--nome`  | não         | Nome do lote (padrão: nome da pasta)             |
| `--banco` | não         | `app` (padrão) ou `projeto`                      |

O lote entra como rascunho nos dois casos: a revisão é sempre na tela.

PDF de prova continua em `npm run import` (seção abaixo), e não no cadastro: ele
precisa do PDF do gabarito junto, mais cargo e tipo, que não cabem num campo de
arrastar arquivo.

### O que a leitura faz

O mesmo slide costuma aparecer duas ou três vezes na aula — limpo, anotado pelo
professor, e com o gabarito revelado. Os frames são agrupados **pelo conteúdo do
enunciado**, nunca pela hora do arquivo: nos prints reais, dois snapshots a três
segundos de distância eram slides diferentes, enquanto o gabarito de uma questão
veio quase dois minutos depois do frame limpo dela.

O gabarito sai da cor, não do texto. Nesses slides há **dois vermelhos** com
significados opostos, e confundi-los envenenaria o banco:

- **caneta à mão livre**, quase sempre no enunciado, marcando os termos que a
  questão cita. O glifo continua preto. Vira `__sublinhado__` no enunciado.
- **a alternativa inteira repintada de vermelho**, na fonte do slide. Aí são os
  próprios glifos que mudam de cor, e isso é o gabarito.

São duas medidas diferentes — cor dos pixels do texto contra cor dos pixels logo
abaixo dele — e por isso não dependem de nenhum modelo.

Os grifos entram no enunciado como `__sublinhado__` e `==marca-texto==`, e o app
os renderiza. Sem eles, uma questão de banca do tipo *"os termos sublinhados
acima constituem, respectivamente:"* ficaria sem resposta possível.

### O que ela não faz bem

- **Matéria** não é deduzida. Escolha a matéria do lote na hora de importar.
- **Cabeçalho** (banca, ano, órgão, cargo) sai de heurística sobre formatos
  variados. Erra às vezes; os campos são editáveis na revisão.
- **Slide dentro do vídeo** costuma vir cortado no próprio print, e aí falta
  alternativa. A questão é marcada como cortada.
- **Questão sem gabarito não entra no banco** por padrão. Sem gabarito, toda
  resposta contaria como erro e a revisão espaçada repetiria para sempre uma
  questão impossível de acertar.

---

## Revisão espaçada

Não há estado guardado: nível, vencimento e prioridade são calculados a partir
da tabela `respostas`. Vale retroativamente para tudo que você já respondeu, e
não existe um segundo lugar onde a verdade possa divergir do histórico.

O nível é o número de acertos seguidos no fim do histórico, e o intervalo até a
questão voltar vem dele:

| Nível     | 0        | 1     | 2      | 3      | 4       | 5       |
| --------- | -------- | ----- | ------ | ------ | ------- | ------- |
| Intervalo | volta já | 1 dia | 3 dias | 7 dias | 14 dias | 30 dias |

Errar zera o nível, e nível zero vence no mesmo dia — é isso que faz a questão
errada voltar na próxima sessão, e continuar voltando até você acertar algumas
vezes seguidas.

Na aba **Provas**, dois botões montam caderno a partir disso:

- **Caderno da sessão de hoje** — o que venceu, com as erradas no topo da fila.
- **Caderno das que mais errei** — ignora vencimento e junta só o que você errou
  dentro da janela (7 dias por padrão), da que mais errou para a que menos
  errou. É o de fim de semana.

Questões anuladas e sem gabarito ficam fora das duas: não há como acertar nem
errar, então não há o que espaçar.

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

`server/test/pacote.test.ts` cobre o formato de venda: a serialização
determinística (sem ela, a mesma licença geraria bytes diferentes e toda
assinatura falharia), e as recusas que importam — licença trocada, questão
inserida, chave errada, arquivo que é backup e não pacote.

`server/test/auth.test.ts` cobre o login: hash e conferência de senha, recusa de
hash malformado, quando o login liga sozinho, a trava de força bruta e — num
PGlite temporário, que também exercita a migration — o cadastro da conta única,
a validade e o vencimento das sessões e a troca de senha.

---

## Pacotes de questões

Um pacote é um arquivo `.estudos` com um banco de questões pronto, **assinado** e
**nominal**. É o formato de venda: o comprador baixa o app, importa o arquivo em
**Config → Pacotes de questões** e as questões entram no banco dele.

Duas defesas, e vale ser claro sobre o alcance de cada uma:

- **Licença nominal.** O arquivo carrega nome e e-mail de quem comprou, e o app
  mostra isso no topo, em qualquer aba. Não impede cópia — nada impede — mas faz
  repassar o arquivo custar o próprio nome.
- **Assinatura Ed25519.** Cobre a licença *e* as questões. Sem ela bastaria abrir
  o JSON e apagar o nome. O app recusa qualquer arquivo alterado ou assinado com
  outra chave.

O que isso **não** é: controle de acesso. Depois de importadas, as questões ficam
no banco do comprador para sempre. Quem tiver o arquivo e a paciência de mexer no
código do app consegue usá-lo. A proposta é encarecer o compartilhamento casual,
não torná-lo impossível.

### Gerar o par de chaves (uma vez)

```bash
npm run pacote:chaves
```

Grava a **pública** em `server/src/chave-publica.ts` (commite: é ela que vai
compilada no app) e a **privada** em `~/.estudos/chave-privada.pem`, modo 600.

A privada nunca entra no git — `*.pem` está no `.gitignore`. Faça backup dela
em outro lugar:

- **perder a privada** = não conseguir emitir pacotes novos;
- **trocar a privada** = invalidar todos os pacotes já vendidos.

Enquanto a pública estiver vazia, o app recusa qualquer pacote.

### Emitir

```bash
npm run pacote -- --titulo "Banco INSS 2026" --banca Cebraspe --para "Fulano" --email fulano@exemplo.com
```

Para várias vendas de uma vez, um CSV `nome,email` por linha (com ou sem
cabeçalho):

```bash
npm run pacote -- --titulo "Banco INSS 2026" --banca Cebraspe --lote clientes.csv --saida ./pacotes
```

Cada comprador recebe um arquivo próprio, com licença de `id` distinto — dois
arquivos do mesmo banco nunca são idênticos.

| Opção       | Descrição                                                    |
| ----------- | ------------------------------------------------------------ |
| `--titulo`  | Nome comercial do banco (obrigatório)                        |
| `--para`    | Nome do comprador (obrigatório, ou `--lote`)                  |
| `--email`   | E-mail do comprador (obrigatório, ou `--lote`)                |
| `--lote`    | CSV `nome,email`: emite um arquivo por linha                  |
| `--banca`   | Filtra por banca (parcial, sem diferenciar maiúsculas)        |
| `--orgao`   | Filtra por órgão                                              |
| `--prova`   | Filtra pelo nome da prova                                     |
| `--ano`     | Filtra por ano                                                |
| `--tudo`    | Todas as questões — sem filtro nenhum o comando recusa        |
| `--saida`   | Pasta de destino (padrão: `./pacotes`)                        |
| `--privada` | Chave privada (padrão: `~/.estudos/chave-privada.pem`)        |
| `--banco`   | De qual banco ler: `app` (padrão) ou `projeto`                |

Questões cadastradas à mão (`custom`) **nunca** entram num pacote: só as
importadas de prova.

### Importar (o lado do comprador)

**Config → Pacotes de questões → Importar pacote**. As questões são sempre
**somadas** às que já existem; nada é apagado.

Isso é de propósito, e é o motivo de o pacote não usar o Importar backup: o
backup tem modo *substituir*, que dá `TRUNCATE` em tudo — o histórico de estudo
de quem acabou de pagar iria junto. A rota do pacote toca só `materias` e
`questoes`.

Reimportar o mesmo arquivo não duplica nada e avisa que já tinha entrado. As
questões chegam como `custom = false`, então o comprador não as apaga sem
querer.

---

## Backup

Em **Config → Backup**:

- **Exportar backup** baixa um JSON com todas as tabelas de estudo.
- **Importar backup** pergunta se você quer **substituir** tudo ou **mesclar**
  com o que já existe (mesclar ignora registros repetidos).

A conta e as sessões de login ficam de fora nos dois sentidos: o JSON não leva
sua senha, e restaurar um backup não a altera.

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
│   │   ├── auth.ts         senha (scrypt), sessões e trava de força bruta
│   │   ├── pacote.ts       formato .estudos: licença e assinatura Ed25519
│   │   ├── chave-publica.ts  chave que confere os pacotes (gerada)
│   │   ├── pacote-cli.ts   gera as chaves e emite os pacotes de venda
│   │   ├── revisao.ts      repetição espaçada calculada do histórico
│   │   ├── notas.ts        notas do dia e o TODO que sai delas
│   │   ├── routes/         materias, sessoes, questoes, provas, config,
│   │   │                   backup, pacote, importacao, notas, auth
│   │   └── import/         parser de PDF, gabarito e CLI
│   │       └── prints/     leitura dos prints: container, fusão e lote
│   ├── ocr/                imagem do OCR (Tesseract + análise de cor)
│   └── test/               parser, login, pacote, prints, revisão e notas
│                           + fixtures
└── web/
    └── src/
        ├── styles/tokens.css   tokens do design system
        ├── components/         modais (cadastro com importador de print),
        │                       cartão de questão, grifos e visualizador
        └── pages/              login, pomodoro, notas, sessões, questões,
                                provas, config
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

notas(dia, texto, criada_em, atualizado_em)
nota_tarefas(id, dia, texto, feita, ordem, criada_em, feita_em)

usuarios(id, login, senha_hash, criado_em)
sessoes_login(token, usuario_id, criada_em, expira_em)

licencas(id, banco, para, email, emitido_em, importado_em, questoes)
```

`usuarios` tem no máximo uma linha. O hash não fica em `config` porque
`garantirConfig()` apaga toda chave fora do padrão — ele morreria no boot.
`licencas` é tabela pelo mesmo motivo.

`licencas` é só carimbo: as questões do pacote já estão em `questoes`, e apagar
a linha não as remove.

`notas` é chaveada pelo dia: não existe "duas notas do mesmo dia", e gravar
vira um upsert. A tarefa guarda o dia em que foi escrita, mas quem decide se
ela ainda é trabalho pendente é `feita`, não a data — é isso que faz o que
sobrou de ontem aparecer na sessão de hoje.

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
