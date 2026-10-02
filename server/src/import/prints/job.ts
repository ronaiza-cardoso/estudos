import { exec, q as consulta, um } from '../../db.js';
import { agoraLocal } from '../../util.js';
import { lerPrints, type Imagem } from './extrair.js';
import { chaveDoEnunciado, fundir } from './juntar.js';
import type { Frame, Item, ItemRevisado } from './tipos.js';

/**
 * Roda um lote de prints. A leitura acontece no container, que devolve um
 * frame por vez; a fusão no banco é serializada, porque dois frames do mesmo
 * slide chegando juntos dariam leitura-e-escrita concorrente na mesma linha.
 *
 * A fusão é incremental de propósito. Cada print lido já atualiza a linha no
 * banco, então a tela mostra a questão aparecer e, depois, o gabarito
 * preencher sozinho quando o frame com a resposta for lido.
 */

export type Progresso = {
  id: number;
  nome: string;
  criada_em: string;
  estado: 'processando' | 'concluida' | 'erro';
  total: number;
  processados: number;
  erro: string | null;
};

/* -------------------------- gravação serializada -------------------------- */

let fila: Promise<unknown> = Promise.resolve();

function emFila<T>(fn: () => Promise<T>): Promise<T> {
  const proxima = fila.then(fn, fn);
  fila = proxima.catch(() => undefined);
  return proxima;
}

type LinhaItem = {
  id: number;
  chave: string;
  ordem: number;
  arquivos: string;
  dados_json: string;
  estado: string;
  questao_id: string | null;
};

function paraItem(linha: LinhaItem): Item {
  return { ...(JSON.parse(linha.dados_json) as Frame), arquivos: JSON.parse(linha.arquivos) };
}

async function registrar(importacaoId: number, arquivo: string, frame: Frame): Promise<void> {
  const chave = chaveDoEnunciado(frame.enunciado);

  const existente = await um<LinhaItem>(
    'SELECT * FROM importacao_itens WHERE importacao_id = $1 AND chave = $2',
    [importacaoId, chave],
  );

  const item: Item = existente
    ? fundir(paraItem(existente), frame, arquivo)
    : { ...frame, arquivos: [arquivo] };

  const { arquivos, ...dados } = item;

  if (existente) {
    await exec('UPDATE importacao_itens SET arquivos = $1, dados_json = $2 WHERE id = $3', [
      JSON.stringify(arquivos),
      JSON.stringify(dados),
      existente.id,
    ]);
    return;
  }

  const proxima = await um<{ n: number }>(
    'SELECT COALESCE(MAX(ordem), 0) + 1 AS n FROM importacao_itens WHERE importacao_id = $1',
    [importacaoId],
  );

  await exec(
    `INSERT INTO importacao_itens (importacao_id, chave, ordem, arquivos, dados_json)
     VALUES ($1, $2, $3, $4, $5)`,
    [importacaoId, chave, Number(proxima?.n ?? 1), JSON.stringify(arquivos), JSON.stringify(dados)],
  );
}

/* ------------------------------- o trabalho ------------------------------- */

export async function criarImportacao(nome: string, total: number): Promise<number> {
  const linha = await um<{ id: number }>(
    'INSERT INTO importacoes (nome, criada_em, total) VALUES ($1, $2, $3) RETURNING id',
    [nome, agoraLocal(), total],
  );
  return linha!.id;
}

/**
 * Lê os prints e vai gravando. Não lança: a falha de um print vira observação
 * no lote, e a falha do lote inteiro vira estado "erro" na linha — quem chamou
 * já respondeu ao navegador faz tempo.
 */
export async function rodarImportacao(importacaoId: number, imagens: Imagem[]): Promise<void> {
  const problemas: string[] = [];

  try {
    const falhas = await lerPrints(imagens, async (nome, frame) => {
      if (frame.tipo === 'questao') {
        await emFila(() => registrar(importacaoId, nome, frame));
      }
      await exec('UPDATE importacoes SET processados = processados + 1 WHERE id = $1', [
        importacaoId,
      ]);
    });

    problemas.push(...falhas);

    // Print ilegível conta como processado: sem isso a barra de progresso
    // parava antes do fim quando algum arquivo não era questão.
    const lidos = await um<{ n: number }>(
      'SELECT processados AS n FROM importacoes WHERE id = $1',
      [importacaoId],
    );
    if (Number(lidos?.n ?? 0) < imagens.length) {
      await exec('UPDATE importacoes SET processados = $1 WHERE id = $2', [
        imagens.length,
        importacaoId,
      ]);
    }

    // Se nenhum print passou, o problema é o ambiente e não os arquivos.
    const tudoFalhou = problemas.length >= imagens.length && imagens.length > 0;

    await exec('UPDATE importacoes SET estado = $1, erro = $2 WHERE id = $3', [
      tudoFalhou ? 'erro' : 'concluida',
      problemas.length > 0 ? problemas.slice(0, 5).join(' | ') : null,
      importacaoId,
    ]);
  } catch (erro) {
    await exec('UPDATE importacoes SET estado = $1, erro = $2 WHERE id = $3', [
      'erro',
      (erro as Error).message,
      importacaoId,
    ]);
  }
}

/* ------------------------------- consultas ------------------------------- */

export async function lerImportacao(id: number): Promise<Progresso | undefined> {
  return um<Progresso>(
    'SELECT id, nome, criada_em, estado, total, processados, erro FROM importacoes WHERE id = $1',
    [id],
  );
}

export async function listarImportacoes(): Promise<(Progresso & { itens: number })[]> {
  return consulta(
    `SELECT i.id, i.nome, i.criada_em, i.estado, i.total, i.processados, i.erro,
            (SELECT COUNT(*)::int FROM importacao_itens t WHERE t.importacao_id = i.id) AS itens
       FROM importacoes i
      ORDER BY i.criada_em DESC, i.id DESC
      LIMIT 30`,
  );
}

export async function lerItens(importacaoId: number): Promise<ItemRevisado[]> {
  const linhas = await consulta<LinhaItem>(
    'SELECT * FROM importacao_itens WHERE importacao_id = $1 ORDER BY ordem',
    [importacaoId],
  );

  return linhas.map((l) => ({
    ...paraItem(l),
    id: l.id,
    estado: l.estado as ItemRevisado['estado'],
    questao_id: l.questao_id,
  }));
}

/**
 * Um lote que ficou "processando" só pode ser de um servidor que morreu no
 * meio: o trabalho vive no processo, não numa fila persistente.
 */
export async function fecharImportacoesOrfas(): Promise<number> {
  return exec(
    `UPDATE importacoes SET estado = 'erro', erro = COALESCE(erro, $1)
      WHERE estado = 'processando'`,
    ['A importação foi interrompida quando o app fechou.'],
  );
}
