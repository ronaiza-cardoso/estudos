import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';
import { dirBancoApp, dirBancoProjeto, URL_BANCO } from '../../db.js';

/**
 * Os prints ficam em disco depois da leitura.
 *
 * Não é luxo: o OCR erra, e para consertar o enunciado na revisão você precisa
 * ver o slide original lado a lado. Guardar em arquivo, e não no banco, evita
 * inchar o PGlite com alguns megabytes por lote.
 */

const EXTENSOES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

const TIPOS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

/**
 * Onde o lote mora. No modo servidor usamos `uploads/`, que o compose já monta;
 * no desktop, ao lado do banco embutido, para o backup da pasta levar os dois.
 */
function raiz(): string {
  if (process.env.ESTUDOS_PRINTS_DIR) return process.env.ESTUDOS_PRINTS_DIR;
  if (URL_BANCO) return resolve(process.cwd(), 'uploads/prints');

  const banco = process.env.ESTUDOS_DATA_DIR ?? dirBancoProjeto();
  const base = banco === dirBancoProjeto() ? dirBancoProjeto() : (banco ?? dirBancoApp());
  return resolve(base, '../prints');
}

export function pastaDoLote(importacaoId: number): string {
  return resolve(raiz(), String(importacaoId));
}

/**
 * O nome vem do navegador, então nunca é usado cru. Barra, `..` e tudo que não
 * for letra, número, ponto, hífen ou sublinhado some antes de virar caminho.
 */
export function nomeSeguro(nome: string, indice: number): string {
  const limpo = basename(nome).replace(/[^\w.-]+/g, '_').slice(-120);
  const ext = extname(limpo).toLowerCase();
  if (!EXTENSOES.has(ext)) return `${indice + 1}-${limpo.replace(/\.+$/, '')}.png`;
  return limpo.startsWith('.') ? `${indice + 1}${limpo}` : limpo;
}

export function tipoDoArquivo(nome: string): string {
  return TIPOS[extname(nome).toLowerCase()] ?? 'application/octet-stream';
}

/** Grava o lote e devolve o nome final de cada print, na mesma ordem. */
export function guardarPrints(
  importacaoId: number,
  imagens: { nome: string; base64: string }[],
): string[] {
  const pasta = pastaDoLote(importacaoId);
  mkdirSync(pasta, { recursive: true });

  const usados = new Set<string>();

  return imagens.map((imagem, i) => {
    let nome = nomeSeguro(imagem.nome, i);
    // Dois arquivos com o mesmo nome em pastas diferentes do seu computador
    // chegam juntos aqui; o segundo não pode apagar o primeiro.
    while (usados.has(nome)) nome = `${i + 1}-${nome}`;
    usados.add(nome);

    writeFileSync(resolve(pasta, nome), Buffer.from(imagem.base64, 'base64'));
    return nome;
  });
}

export function apagarPrints(importacaoId: number): void {
  rmSync(pastaDoLote(importacaoId), { recursive: true, force: true });
}

/** Caminho de um print, ou null se o nome escapar da pasta do lote. */
export function abrirPrint(importacaoId: number, nome: string) {
  const pasta = pastaDoLote(importacaoId);
  const caminho = resolve(pasta, basename(nome));

  if (!caminho.startsWith(pasta) || !existsSync(caminho)) return null;
  return { caminho, tipo: tipoDoArquivo(caminho), stream: () => createReadStream(caminho) };
}
