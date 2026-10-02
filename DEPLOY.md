# Colocar na web

O objetivo aqui é **usar o app de qualquer dispositivo, com os mesmos dados**,
sem pagar nada. A ideia é simples: o banco sai do seu computador e vai para um
Postgres na nuvem; o app passa a ser um site atrás de HTTPS, protegido pela
senha que você já usa.

Nada da arquitetura muda. O app já fala Postgres de verdade quando existe
`DATABASE_URL`, já serve o frontend pelo próprio Fastify (uma origem só) e já
tem `Dockerfile`. O que este documento descreve é a configuração.

---

## O que o host precisa oferecer

| Requisito | Por quê |
| --------- | ------- |
| Rodar um `Dockerfile` ou Node 22 | O app é um processo Node de longa duração, não função serverless: a importação de prints roda em background e perderia o progresso. |
| HTTPS | Sem ele o cookie de sessão viaja em claro. Praticamente todo host dá de graça. |
| Postgres com dados persistentes | É o que faz os dispositivos verem a mesma coisa. |
| ~512 MB de RAM | Suficiente. O app não guarda imagem em memória. |

Não precisa de disco persistente. Veja [Prints e OCR](#prints-e-ocr).

---

## Variáveis de ambiente

Só as duas primeiras são obrigatórias.

| Variável | Valor | Para quê |
| -------- | ----- | -------- |
| `DATABASE_URL` | `postgres://usuario:senha@host:5432/banco?sslmode=require` | Liga o modo servidor. A presença dela já ativa o login e faz o app escutar em `0.0.0.0`. |
| `TZ` | `America/Sao_Paulo` | As datas são gravadas no horário local. Sem isto o container fica em UTC e **o que você estuda à noite cai no dia seguinte** nas estatísticas. O app avisa no log se faltar. |
| `PORT` | injetada pelo host | A maioria dos hosts define sozinha. O padrão é 5183. |
| `ESTUDOS_LOGIN` | `1` | Já é o padrão quando há `DATABASE_URL`. Use `0` só se souber o que está fazendo: sem login, quem tiver a URL tem seus dados. |
| `ESTUDOS_PROXY` | `0` | Só se o Node estiver exposto **direto**, sem proxy na frente. Em host de nuvem, deixe de fora. |
| `COOKIE_SEGURO` | `1` | Normalmente desnecessário: o cookie já vira `Secure` sozinho quando a requisição chega por HTTPS. Serve para forçar. |

O cookie e o IP do cliente dependem de o app confiar no proxy do host — é o
que `ESTUDOS_PROXY` controla, e o padrão em modo servidor já está certo. Sem
isso, o `X-Forwarded-For` seria ignorado e a trava de força bruta do login
viraria um balde único para todos os visitantes.

---

## Subir

O `Dockerfile` da raiz já faz tudo: instala, compila o frontend e inicia a
API, que serve os dois. Em host que lê `Dockerfile`, aponte para o repositório
e defina as variáveis acima — não há passo extra.

Em host que roda Node direto:

```bash
npm ci && npm run build --workspace web
npm run start --workspace server
```

As migrations rodam sozinhas no boot, então o banco pode estar vazio.

Confira a subida em `https://seu-endereco/api/saude`, que responde
`{"ok":true}` sem exigir login. Depois abra a raiz: na primeira vez a tela pede
para **criar o acesso**, e o cadastro se fecha sozinho em seguida.

---

## Levar os dados que você já tem

As rotas de backup fazem a mudança inteira — não é preciso mexer em SQL:

1. No app local, **Config → Backup → Exportar backup**. Sai um JSON com todas
   as tabelas de estudo.
2. No app na web, depois de criar o acesso, **Config → Backup → Importar
   backup**, modo **substituir**.

A conta e as sessões de login ficam fora do JSON nos dois sentidos: sua senha
não viaja, e restaurar não a troca. Os megabytes da pasta `data/` são o PGlite
inteiro, com índices e o próprio Postgres em WASM; o JSON das tabelas é uma
fração disso.

---

## Prints e OCR

**A importação de prints continua no seu computador.** A leitura roda num
container com Tesseract (`server/ocr`), e nenhum host grátis deixa um container
abrir outro container. Isso não atrapalha o uso, porque a questão pronta é
texto puro — a tabela `questoes` não guarda imagem, e o print só é necessário
enquanto você revisa o lote.

O fluxo passa a ser: ler e revisar no Mac, **gravando direto no banco da
nuvem**. Com `DATABASE_URL` definida, os CLIs ignoram o banco local e escrevem
lá:

```bash
DATABASE_URL='postgres://...' npm run import:prints -- --dir assets/portugues/aula-01
```

A revisão é na tela, então rode o app local contra o mesmo banco:

```bash
DATABASE_URL='postgres://...' TZ=America/Sao_Paulo npm run dev
```

Revise na aba **Importar** e mande para o banco de questões. As questões
aparecem em todos os dispositivos na hora. A importação de provas em PDF
(`npm run import`) funciona igual.

Se um dia a importação pela web virar necessidade, o caminho é guardar os
prints fora do disco do container (um bucket, ou `bytea` no Postgres) e trocar
o OCR local por um serviço de visão. É trabalho de verdade, e não é preciso
agora.

---

## Antes de considerar pronto

- [ ] `https://seu-endereco/api/saude` responde `{"ok":true}`.
- [ ] O log do boot **não** traz o aviso de `TZ`.
- [ ] Uma sessão de pomodoro iniciada à noite aparece no dia certo no heatmap.
- [ ] Abrir a URL numa janela anônima cai na tela de login, não nos dados.
- [ ] Sua senha tem pelo menos 8 caracteres e não é reaproveitada de outro
      lugar: é uma conta só, e quem entra vê tudo.
- [ ] `Config → Backup → Exportar` de vez em quando. Plano grátis não tem
      garantia de nada, e o backup é um arquivo no seu computador.

---

## Sobre o plano grátis

Duas armadilhas que valem saber de antemão, porque não aparecem na página de
preço:

- **Postgres grátis com prazo de validade.** Alguns hosts oferecem banco grátis
  que expira em 30 dias e depois exige upgrade para continuar acessível. Para
  os seus dados, prefira um Postgres cujo plano grátis não tenha prazo.
- **Hibernação.** Serviço web grátis costuma dormir depois de ~15 min sem
  tráfego, e a primeira visita seguinte leva de 30 s a 1 min. É incômodo, não
  perda de dado — o banco fica em outro lugar e não dorme. Um ping periódico
  de um cron externo evita, desde que caiba na cota de horas do mês.

Quem quer sempre ligado precisa de uma VM (há opções permanentemente grátis,
normalmente exigindo cartão no cadastro). Aí o `docker-compose.yml` do
repositório roda inteiro, Postgres incluso — e você passa a cuidar de sistema
operacional, HTTPS e backup.
