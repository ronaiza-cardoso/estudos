import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRAME_VAZIO, type Frame } from './tipos.js';

/**
 * Leitura dos prints, feita por um container com Tesseract em português.
 *
 * Por que container e não uma biblioteca de Node: o Tesseract e os dados de
 * português são dependências de sistema, e ninguém deveria precisar instalar
 * nada na máquina para usar um app de estudos. A imagem se constrói sozinha na
 * primeira vez.
 *
 * Por que OCR e não uma API de visão: sai de graça, roda offline, e os slides
 * são o caso fácil do OCR — texto grande, preto, sobre fundo branco. O gabarito,
 * que parecia exigir um modelo, é a alternativa escrita em vermelho: medir cor
 * de pixel resolve, e resolve igual toda vez.
 *
 * O container roda com `--network none`. Nenhum print sai desta máquina.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const PASTA_OCR = resolve(AQUI, '../../../ocr');

export type Imagem = { nome: string; mime: string; base64: string };

/** Chamado assim que cada print termina — é o que alimenta o progresso na tela. */
export type AoLer = (nome: string, frame: Frame) => Promise<void>;

type Saida = { nome: string; frame?: Frame; erro?: string };

/**
 * A tag sai do conteúdo da imagem. Mexer no Python ou nas dependências muda a
 * tag, e a próxima leitura reconstrói sozinha — sem "por que minha mudança não
 * surtiu efeito".
 */
function tagDaImagem(): string {
  const partes = ['Dockerfile', 'requirements.txt', 'ocr_prints.py'].map((f) =>
    readFileSync(resolve(PASTA_OCR, f)),
  );
  const hash = createHash('sha256');
  for (const p of partes) hash.update(p);
  return `estudos-ocr:${hash.digest('hex').slice(0, 12)}`;
}

function rodar(
  comando: string,
  args: string[],
  opcoes: { entrada?: string; aoSair?: (linha: string) => void } = {},
): Promise<{ codigo: number; saida: string; erro: string }> {
  return new Promise((ok, falha) => {
    const processo = spawn(comando, args, { stdio: ['pipe', 'pipe', 'pipe'] });

    let saida = '';
    let erro = '';
    let pendente = '';

    processo.stdout.on('data', (pedaco: Buffer) => {
      const texto = pedaco.toString();
      saida += texto;
      if (!opcoes.aoSair) return;

      pendente += texto;
      const linhas = pendente.split('\n');
      pendente = linhas.pop() ?? '';
      for (const linha of linhas) if (linha.trim()) opcoes.aoSair(linha);
    });

    processo.stderr.on('data', (pedaco: Buffer) => {
      erro += pedaco.toString();
    });

    processo.on('error', (e) =>
      falha(
        (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error(
              `"${comando}" não foi encontrado. Instale o Docker Desktop e deixe-o aberto.`,
            )
          : e,
      ),
    );

    processo.on('close', (codigo) => {
      if (pendente.trim()) opcoes.aoSair?.(pendente);
      ok({ codigo: codigo ?? 0, saida, erro });
    });

    if (opcoes.entrada !== undefined) processo.stdin.end(opcoes.entrada);
    else processo.stdin.end();
  });
}

let tagPronta: string | null = null;

/** Constrói a imagem na primeira leitura. Depois disso é só uma consulta local. */
export async function garantirImagem(): Promise<string> {
  const tag = tagDaImagem();
  if (tagPronta === tag) return tag;

  const existe = await rodar('docker', ['image', 'inspect', tag]);
  if (existe.codigo === 0) {
    tagPronta = tag;
    return tag;
  }

  console.log(`Construindo a imagem de leitura de prints (${tag})…`);
  const construcao = await rodar('docker', ['build', '-t', tag, PASTA_OCR]);

  if (construcao.codigo !== 0) {
    const motivo = construcao.erro.trim().split('\n').slice(-4).join(' ');
    throw new Error(
      `Não consegui construir a imagem de leitura. O Docker está aberto? ${motivo}`,
    );
  }

  tagPronta = tag;
  return tag;
}

/** Usado pelo teste e por quem quiser forçar a reconstrução. */
export function esquecerImagem(): void {
  tagPronta = null;
}

/** O Python só entende o que o Pillow abre; o resto nem vale a viagem. */
const MIMES_OK = /^image\/(png|jpe?g|webp|gif|bmp|tiff?)$/;

/**
 * Lê o lote inteiro num container só e entrega cada print conforme fica
 * pronto. Devolve a lista de problemas — um print ilegível não derruba o lote.
 */
export async function lerPrints(imagens: Imagem[], aoLer: AoLer): Promise<string[]> {
  if (imagens.length === 0) return [];

  const tag = await garantirImagem();
  const problemas: string[] = [];
  const pendentes: Promise<void>[] = [];

  const entrada = imagens
    .filter((i) => {
      if (MIMES_OK.test(i.mime)) return true;
      problemas.push(`${i.nome}: formato não suportado (${i.mime})`);
      return false;
    })
    .map((i) => JSON.stringify({ nome: i.nome, base64: i.base64 }))
    .join('\n');

  if (!entrada) return problemas;

  const { codigo, erro } = await rodar(
    'docker',
    ['run', '--rm', '-i', '--network', 'none', tag],
    {
      entrada,
      aoSair: (linha) => {
        let saida: Saida;
        try {
          saida = JSON.parse(linha) as Saida;
        } catch {
          return; // ruído do container não é resultado
        }

        if (saida.erro || !saida.frame) {
          problemas.push(`${saida.nome}: ${saida.erro ?? 'leitura vazia'}`);
          return;
        }

        // Guardamos a promessa: o container fecha antes de o banco terminar.
        pendentes.push(aoLer(saida.nome, { ...FRAME_VAZIO, ...saida.frame }));
      },
    },
  );

  await Promise.allSettled(pendentes);

  if (codigo !== 0 && problemas.length === 0) {
    problemas.push(erro.trim().split('\n').slice(-2).join(' ') || 'A leitura falhou.');
  }

  return problemas;
}
