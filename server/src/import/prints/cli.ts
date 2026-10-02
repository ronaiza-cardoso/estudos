#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { abrirBanco, dirBancoApp, dirBancoProjeto, encerrarBanco, migrar } from '../../db.js';
import { acharCaminho, naoEncontrado } from '../caminho.js';
import { criarImportacao, lerImportacao, lerItens, rodarImportacao } from './job.js';
import { garantirImagem, type Imagem } from './extrair.js';

/**
 * Mesma leitura da aba "Importar", pela linha de comando — útil para uma pasta
 * inteira de prints sem passar pelo navegador. A revisão continua sendo na
 * tela: aqui o lote só é lido e fica guardado como rascunho.
 */

const USO = `
Uso:
  npm run import:prints -- --dir assets/portugues/aula-01

Opções:
  --dir     Pasta com os prints (.png, .jpg, .webp)     (obrigatório)
  --nome    Nome do lote                                (padrão: nome da pasta)
  --banco   Onde gravar: "app" (padrão) ou "projeto"

Com DATABASE_URL definida, o lote vai para aquele banco e --banco é ignorado:
é assim que se lê prints no seu computador gravando no banco da nuvem.

O lote entra como rascunho. Abra a aba Importar no app para conferir gabarito
e matéria antes de mandar para o banco de questões.

A leitura roda num container. O Docker precisa estar aberto; na primeira vez
a imagem é construída sozinha (uns dois minutos).
`;

const EXTENSOES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

const MIMES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const proximo = argv[i + 1];
    if (proximo && !proximo.startsWith('--')) {
      args[argv[i].slice(2)] = proximo;
      i++;
    } else {
      args[argv[i].slice(2)] = true;
    }
  }
  return args;
}

async function principal() {
  const args = parseArgs(process.argv.slice(2));
  const pedido = typeof args.dir === 'string' ? args.dir : null;

  if (!pedido) {
    console.log(USO);
    process.exit(1);
  }

  const dir = acharCaminho(pedido, 'pasta');
  if (!dir) {
    console.error(naoEncontrado(pedido, 'pasta'));
    process.exit(1);
  }

  const arquivos = readdirSync(dir)
    .filter((f) => EXTENSOES.has(extname(f).toLowerCase()))
    .sort();

  if (arquivos.length === 0) {
    console.error(`Nenhuma imagem em ${dir}.`);
    process.exit(1);
  }

  // Com DATABASE_URL o destino já está decidido: é o banco do servidor, e
  // `--banco` não tem o que escolher. Sem ela, o padrão é o banco do app —
  // o de desenvolvimento só com `--banco projeto`.
  if (!process.env.DATABASE_URL) {
    process.env.ESTUDOS_DATA_DIR =
      args.banco === 'projeto' ? dirBancoProjeto() : dirBancoApp();
  }

  await abrirBanco();
  await migrar();

  // Antes de ler os arquivos do disco: se o Docker estiver fechado, é melhor
  // dizer isso agora do que depois de um lote inteiro falhar em silêncio.
  try {
    await garantirImagem();
  } catch (erro) {
    console.error((erro as Error).message);
    await encerrarBanco();
    process.exit(1);
  }

  const imagens: Imagem[] = arquivos.map((f) => ({
    nome: f,
    mime: MIMES[extname(f).toLowerCase()] ?? 'image/png',
    base64: readFileSync(resolve(dir, f)).toString('base64'),
  }));

  const nome = typeof args.nome === 'string' ? args.nome : basename(dir);
  const id = await criarImportacao(nome, imagens.length);

  console.log(`Lendo ${imagens.length} print(s) de ${dir}…`);
  await rodarImportacao(id, imagens);

  const lote = await lerImportacao(id);
  const itens = await lerItens(id);
  const comGabarito = itens.filter((i) => i.gabarito).length;
  const cortadas = itens.filter((i) => i.cortada).length;

  console.log(`\nLote #${id} — "${nome}"`);
  console.log(`  ${itens.length} questão(ões) a partir de ${imagens.length} print(s)`);
  console.log(`  ${comGabarito} com gabarito, ${itens.length - comGabarito} a conferir`);
  if (cortadas > 0) console.log(`  ${cortadas} com slide cortado`);

  if (lote?.erro) console.log(`\nProblemas na leitura:\n  ${lote.erro}`);

  if (lote?.estado === 'erro') {
    console.error('\nNenhum print pôde ser lido. O lote ficou marcado como falho.');
    await encerrarBanco();
    process.exit(1);
  }

  console.log('\nAbra a aba Importar no app para revisar e mandar para o banco.');

  await encerrarBanco();
}

principal().catch(async (erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  await encerrarBanco();
  process.exit(1);
});
