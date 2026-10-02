import { statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Onde procurar um caminho que o usuário digitou.
 *
 * `npm run ... --workspace server` troca o diretório para `server/` antes de
 * rodar o script, então `--dir assets` chegaria aqui apontando para
 * `server/assets`, que não existe. O caminho é procurado na ordem em que faz
 * sentido para quem digitou: onde ele estava (`INIT_CWD`, que o npm preserva),
 * o diretório atual, e por último a raiz do projeto.
 */

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function candidatos(caminho: string): string[] {
  if (isAbsolute(caminho)) return [caminho];

  const bases = [process.env.INIT_CWD, process.cwd(), RAIZ].filter(
    (b): b is string => !!b,
  );
  return [...new Set(bases.map((base) => resolve(base, caminho)))];
}

/** Primeiro candidato que existe e é do tipo pedido, ou null. */
export function acharCaminho(caminho: string, tipo: 'arquivo' | 'pasta'): string | null {
  for (const candidato of candidatos(caminho)) {
    const info = statSync(candidato, { throwIfNoEntry: false });
    if (!info) continue;
    if (tipo === 'pasta' ? info.isDirectory() : info.isFile()) return candidato;
  }
  return null;
}

/** Mensagem de erro que diz onde foi procurado — senão o "não encontrado" engana. */
export function naoEncontrado(caminho: string, tipo: 'arquivo' | 'pasta'): string {
  const onde = candidatos(caminho)
    .map((c) => `  ${c}`)
    .join('\n');
  return `${tipo === 'pasta' ? 'Pasta' : 'Arquivo'} não encontrada: ${caminho}\nProcurei em:\n${onde}`;
}
