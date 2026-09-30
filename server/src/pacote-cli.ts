#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, dirBancoApp, dirBancoProjeto, encerrarBanco, migrar, q } from './db.js';
import type { QuestaoSeed } from './seed.js';
import { agoraLocal } from './util.js';
import { assinar, gerarParDeChaves, type Licenca, type Miolo, FORMATO, VERSAO } from './pacote.js';

const here = dirname(fileURLToPath(import.meta.url));

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const chave = a.slice(2);
    const proximo = argv[i + 1];
    if (proximo && !proximo.startsWith('--')) {
      args[chave] = proximo;
      i++;
    } else {
      args[chave] = true;
    }
  }
  return args;
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const CHAVE_PRIVADA_PADRAO = resolve(homedir(), '.estudos', 'chave-privada.pem');

const USO = `
Monta pacotes de questões assinados para venda.

Primeiro, uma vez só — gere o par de chaves:

  npm run pacote:chaves

  A pública é gravada em server/src/chave-publica.ts (vai compilada no app).
  A privada vai para ~/.estudos/chave-privada.pem e NUNCA entra no git.

Depois, para cada venda:

  npm run pacote -- --titulo "Banco INSS 2026" --para "Fulano" --email f@x.com \\
                    --banca Cebraspe --saida ./pacotes

Seleção das questões. Questões que você cadastrou à mão (custom) nunca
entram — só as importadas de prova. Sem nenhum filtro o comando recusa:
vender o banco inteiro por engano é caro.
  --banca <texto>     filtra por banca (parcial, sem diferenciar maiúsculas)
  --orgao <texto>     filtra por órgão
  --prova <texto>     filtra pelo nome da prova
  --ano <número>      filtra por ano
  --tudo              todas as questões não-custom do banco

Licença:
  --titulo <texto>    nome comercial do banco          (obrigatório)
  --para <nome>       nome do comprador                (obrigatório, ou --lote)
  --email <e-mail>    e-mail do comprador              (obrigatório, ou --lote)
  --lote <arquivo>    CSV "nome,email" por linha: emite um arquivo por comprador

Saída:
  --saida <caminho>   pasta (ou arquivo, quando é um comprador só)
  --privada <arquivo> chave privada (padrão: ~/.estudos/chave-privada.pem)
  --banco app|projeto de qual banco ler as questões    (padrão: app)
`;

/* ------------------------------ chaves ------------------------------ */

function gerarChaves(args: Args) {
  const destino = (args.privada as string) || CHAVE_PRIVADA_PADRAO;

  if (existsSync(destino) && !args.sim) {
    console.error(
      `\nJá existe uma chave privada em ${destino}.\n\n` +
        'Gerar outra INVALIDA todos os pacotes já vendidos: o app dos seus\n' +
        'compradores recusaria os arquivos antigos. Se é isso mesmo que você\n' +
        'quer, repita com --sim.\n',
    );
    process.exitCode = 1;
    return;
  }

  const { publica, privada } = gerarParDeChaves();

  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, privada, { mode: 0o600 });

  const arquivoPublica = resolve(here, 'chave-publica.ts');
  const atual = readFileSync(arquivoPublica, 'utf8');
  const novo = atual.replace(
    /export const CHAVE_PUBLICA = [\s\S]*?;\n$/,
    'export const CHAVE_PUBLICA =\n  process.env.ESTUDOS_CHAVE_PUBLICA ??\n' +
      `  ${JSON.stringify(publica)};\n`,
  );

  if (novo === atual) {
    console.error(
      `Não consegui reescrever ${arquivoPublica}. Cole a chave à mão:\n\n${publica}`,
    );
    process.exitCode = 1;
    return;
  }
  writeFileSync(arquivoPublica, novo);

  console.log(`
Par de chaves gerado.

  privada  ${destino}   (modo 600 — faça backup, e fora do git)
  pública  ${arquivoPublica}   (commite: é ela que vai no app)

Perder a privada = não conseguir emitir pacotes novos.
Trocar a privada = invalidar os pacotes já vendidos.
`);
}

/* ------------------------------ pacote ------------------------------ */

type Comprador = { para: string; email: string };

function compradores(args: Args): Comprador[] {
  if (args.lote) {
    const linhas = readFileSync(args.lote as string, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));

    const lista = linhas.map((linha, i) => {
      // Só o primeiro vírgula separa: nome pode conter vírgula, e-mail não.
      const corte = linha.indexOf(',');
      if (corte < 0) throw new Error(`Linha ${i + 1} do lote sem vírgula: ${linha}`);
      const para = linha.slice(0, corte).trim();
      const email = linha.slice(corte + 1).trim();
      if (!para || !email) throw new Error(`Linha ${i + 1} do lote incompleta: ${linha}`);
      return { para, email };
    });

    // Cabeçalho de planilha é o erro mais comum aqui.
    if (lista[0] && /^nome$/i.test(lista[0].para)) lista.shift();
    return lista;
  }

  const para = (args.para as string)?.trim();
  const email = (args.email as string)?.trim();
  if (!para || !email) throw new Error('Informe --para e --email, ou --lote com o CSV.');
  return [{ para, email }];
}

async function buscarQuestoes(args: Args): Promise<QuestaoSeed[]> {
  const onde: string[] = ['q.custom = FALSE'];
  const params: unknown[] = [];

  const filtro = (coluna: string, valor: unknown) => {
    params.push(`%${String(valor)}%`);
    onde.push(`${coluna} ILIKE $${params.length}`);
  };

  if (args.banca) filtro('q.banca', args.banca);
  if (args.orgao) filtro('q.orgao', args.orgao);
  if (args.prova) filtro('q.prova', args.prova);
  if (args.ano) {
    params.push(Number(args.ano));
    onde.push(`q.ano = $${params.length}`);
  }

  if (params.length === 0 && !args.tudo)
    throw new Error(
      'Nenhum filtro. Use --banca/--orgao/--prova/--ano, ou --tudo para o banco inteiro.',
    );

  const linhas = await q<any>(
    `SELECT q.id, m.nome AS materia, q.assunto, q.ano, q.banca, q.orgao, q.prova,
            q.texto_assoc, q.enunciado, q.alternativas_json, q.gabarito, q.anulada
       FROM questoes q
       LEFT JOIN materias m ON m.id = q.materia_id
      WHERE ${onde.join(' AND ')}
      ORDER BY q.id`,
    params,
  );

  return linhas.map((l) => ({
    id: l.id,
    materia: l.materia ?? 'Sem matéria',
    assunto: l.assunto,
    ano: l.ano,
    banca: l.banca,
    orgao: l.orgao,
    prova: l.prova,
    texto_assoc: l.texto_assoc,
    enunciado: l.enunciado,
    alternativas: JSON.parse(l.alternativas_json),
    gabarito: l.gabarito,
    anulada: l.anulada === true,
  }));
}

async function montarPacotes(args: Args) {
  const titulo = (args.titulo as string)?.trim();
  if (!titulo) throw new Error('Informe --titulo, o nome comercial do banco.');

  const arquivoChave = (args.privada as string) || CHAVE_PRIVADA_PADRAO;
  if (!existsSync(arquivoChave))
    throw new Error(`Chave privada não encontrada em ${arquivoChave}. Rode: npm run pacote:chaves`);
  const chavePrivada = readFileSync(arquivoChave, 'utf8');

  const lista = compradores(args);

  process.env.ESTUDOS_DATA_DIR ??=
    args.banco === 'projeto' ? dirBancoProjeto() : dirBancoApp();
  await abrirBanco();
  await migrar();

  const questoes = await buscarQuestoes(args);
  if (questoes.length === 0) throw new Error('Nenhuma questão bateu com o filtro.');

  const anuladas = questoes.filter((q) => q.anulada).length;
  const materias = new Set(questoes.map((q) => q.materia));
  console.log(
    `\n${titulo}\n` +
      `  ${questoes.length} questões · ${materias.size} matérias` +
      (anuladas > 0 ? ` · ${anuladas} ${anuladas === 1 ? 'anulada' : 'anuladas'}` : '') +
      `\n  ${lista.length} ${lista.length === 1 ? 'comprador' : 'compradores'}\n`,
  );

  const saida = (args.saida as string) || './pacotes';
  const pastaSaida = lista.length > 1 || !saida.endsWith('.estudos') ? saida : dirname(saida);
  mkdirSync(pastaSaida, { recursive: true });

  for (const { para, email } of lista) {
    const licenca: Licenca = {
      id: randomUUID(),
      banco: titulo,
      para,
      email,
      emitido_em: agoraLocal(),
    };

    const miolo: Miolo = { formato: FORMATO, versao: VERSAO, licenca, questoes };
    const pacote = assinar(miolo, chavePrivada);

    const arquivo =
      lista.length === 1 && saida.endsWith('.estudos')
        ? saida
        : resolve(pastaSaida, `${slug(titulo)}-${slug(para)}.estudos`);

    writeFileSync(arquivo, JSON.stringify(pacote));
    console.log(`  ${para} <${email}>  →  ${arquivo}`);
  }

  console.log('');
}

/* ------------------------------ main ------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(USO);
    return;
  }

  if (args.chaves) {
    gerarChaves(args);
    return;
  }

  try {
    await montarPacotes(args);
  } finally {
    await encerrarBanco();
  }
}

main().catch((erro) => {
  console.error(`\n${(erro as Error).message}\n`);
  process.exit(1);
});
