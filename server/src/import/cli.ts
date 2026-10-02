#!/usr/bin/env node
import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { acharCaminho, naoEncontrado } from './caminho.js';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { abrirBanco, dirBancoApp, dirBancoProjeto, encerrarBanco, migrar } from '../db.js';
import { inserirQuestoes, type QuestaoSeed } from '../seed.js';
import { parseProva } from './parser.js';
import { parseGabarito } from './gabarito.js';
import { textoDoPdf } from './pdf.js';

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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const USO = `
Uso:
  npm run import -- --prova <arquivo.pdf> --gabarito <arquivo.pdf> --cargo 200 --tipo A

Opções:
  --prova      PDF do caderno de questões          (obrigatório)
  --gabarito   PDF do gabarito oficial             (obrigatório)
  --cargo      Número do cargo no gabarito         (obrigatório)
  --tipo       Tipo da prova (A, B, C...)          (obrigatório)
  --nome       Nome da prova gravado nas questões  (padrão: nome do arquivo)
  --banca      Banca organizadora
  --orgao      Órgão
  --ano        Ano da prova
  --materia    Matéria usada quando a seção não for detectada
  --id         Prefixo dos ids gerados             (padrão: slug do nome)
  --banco      Onde gravar: "app" (padrão) ou "projeto"
  --sim        Grava sem pedir confirmação

O padrão grava no banco do app desktop. Feche o app antes de importar: o
banco embutido aceita um processo por vez.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(USO);
    return;
  }

  let provaPdf = args.prova as string;
  let gabaritoPdf = args.gabarito as string;
  const cargo = args.cargo as string;
  const tipo = args.tipo as string;

  const faltando = [
    !provaPdf && '--prova',
    !gabaritoPdf && '--gabarito',
    !cargo && '--cargo',
    !tipo && '--tipo',
  ].filter(Boolean);

  if (faltando.length) {
    console.error(`Faltam argumentos: ${faltando.join(', ')}`);
    console.log(USO);
    process.exitCode = 1;
    return;
  }

  // Resolvido aqui, e não onde foi digitado: `--workspace server` roda o
  // script de dentro de `server/`, então um caminho relativo apontaria para lá.
  for (const [rotulo, arquivo] of [
    ['--prova', provaPdf],
    ['--gabarito', gabaritoPdf],
  ] as const) {
    const achado = acharCaminho(arquivo, 'arquivo');
    if (!achado) {
      console.error(naoEncontrado(arquivo, 'arquivo'));
      process.exitCode = 1;
      return;
    }
    if (rotulo === '--prova') provaPdf = achado;
    else gabaritoPdf = achado;
  }

  // Sem isto, o import cairia no banco de desenvolvimento e as questões
  // simplesmente não apareceriam no app.
  if (!process.env.DATABASE_URL && !process.env.ESTUDOS_DATA_DIR) {
    const destino = (args.banco as string) ?? 'app';
    if (destino !== 'app' && destino !== 'projeto') {
      console.error('--banco aceita apenas "app" ou "projeto".');
      process.exitCode = 1;
      return;
    }
    process.env.ESTUDOS_DATA_DIR =
      destino === 'app' ? dirBancoApp() : dirBancoProjeto();
  }

  const nomeProva =
    (args.nome as string) ?? basename(provaPdf).replace(/\.pdf$/i, '');
  const prefixo = (args.id as string) ?? slug(nomeProva);

  console.log(`Lendo ${provaPdf}...`);
  const textoProva = await textoDoPdf(provaPdf);
  console.log(`Lendo ${gabaritoPdf}...`);
  const textoGabarito = await textoDoPdf(gabaritoPdf);

  const { questoes, secoes } = parseProva(textoProva);
  const gabarito = parseGabarito(textoGabarito, cargo, tipo);

  if (questoes.length === 0) {
    console.error('Nenhuma questão reconhecida no PDF da prova.');
    process.exitCode = 1;
    return;
  }

  const materiaPadrao = (args.materia as string) ?? 'Sem matéria';

  const registros: QuestaoSeed[] = questoes.map((q) => {
    const resposta = gabarito[q.numero];
    const anulada = resposta === '#';
    return {
      id: `${prefixo}-q${String(q.numero).padStart(3, '0')}`,
      materia: q.materia ?? materiaPadrao,
      assunto: null,
      ano: args.ano ? Number(args.ano) : null,
      banca: (args.banca as string) ?? null,
      orgao: (args.orgao as string) ?? null,
      prova: nomeProva,
      texto_assoc: q.texto_assoc,
      enunciado: q.enunciado,
      alternativas: q.alternativas,
      gabarito: anulada ? null : (resposta ?? null),
      anulada,
    };
  });

  // ---------- prévia ----------
  const semGabarito = registros.filter((r) => !r.gabarito && !r.anulada);
  const anuladas = registros.filter((r) => r.anulada);
  const semAlternativas = registros.filter(
    (r) => Object.keys(r.alternativas).length < 2,
  );

  console.log('\n─────────────── PRÉVIA ───────────────');
  console.log(`Prova .............. ${nomeProva}`);
  console.log(`Cargo / tipo ....... ${cargo} / ${tipo}`);
  console.log(`Questões lidas ..... ${registros.length}`);
  console.log(`Anuladas (#) ....... ${anuladas.length}`);
  console.log(`Sem gabarito ....... ${semGabarito.length}`);
  console.log(`Sem alternativas ... ${semAlternativas.length}`);

  console.log(`\nSeções detectadas (${secoes.length}):`);
  for (const s of secoes) console.log(`  · ${s.nome} — questões ${s.de} a ${s.ate}`);

  console.log('\nPrimeiras questões:');
  for (const r of registros.slice(0, 3)) {
    const letras = Object.keys(r.alternativas).join('');
    console.log(`\n  [${r.id}] ${r.materia} — gabarito ${r.gabarito ?? (r.anulada ? 'ANULADA' : '?')}`);
    console.log(`  ${r.enunciado.slice(0, 160).replace(/\n/g, ' ')}${r.enunciado.length > 160 ? '…' : ''}`);
    console.log(`  alternativas: ${letras || '(nenhuma)'}`);
  }

  if (semAlternativas.length) {
    console.log(
      `\nAtenção — sem alternativas reconhecidas: ${semAlternativas
        .map((r) => r.id)
        .join(', ')}`,
    );
  }
  console.log('──────────────────────────────────────\n');

  // ---------- confirmação ----------
  if (!args.sim) {
    const rl = createInterface({ input: stdin, output: stdout });
    const resposta = (await rl.question('Gravar no banco? [s/N] ')).trim().toLowerCase();
    rl.close();
    if (resposta !== 's' && resposta !== 'sim') {
      console.log('Cancelado. Nada foi gravado.');
      return;
    }
  }

  try {
    await abrirBanco();
    await migrar();
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    if (/lock|LOCK|in use|resource busy/i.test(msg)) {
      console.error(
        '\nO banco está em uso. Feche o app Estudos e rode de novo — ' +
          'o banco embutido aceita um processo por vez.',
      );
      process.exitCode = 1;
      return;
    }
    throw erro;
  }

  const inseridas = await inserirQuestoes(registros);
  await encerrarBanco();

  const ignoradas = registros.length - inseridas;
  console.log(`Gravadas: ${inseridas} questão(ões).`);
  if (ignoradas > 0) {
    console.log(`Ignoradas por já existirem: ${ignoradas}.`);
  }
}

main().catch((erro) => {
  console.error(`\nErro: ${erro instanceof Error ? erro.message : erro}`);
  process.exitCode = 1;
});
