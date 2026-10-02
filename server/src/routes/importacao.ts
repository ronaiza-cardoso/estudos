import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { exec, materiaId, um } from '../db.js';
import { agoraLocal } from '../util.js';
import { garantirImagem, type Imagem } from '../import/prints/extrair.js';
import { abrirPrint, apagarPrints, guardarPrints } from '../import/prints/arquivos.js';
import {
  criarImportacao,
  lerImportacao,
  lerItens,
  listarImportacoes,
  rodarImportacao,
} from '../import/prints/job.js';
import type { Frame } from '../import/prints/tipos.js';

/** Teto por lote. 40 prints de 1568px cabem folgados no bodyLimit do Fastify. */
const MAXIMO_POR_LOTE = 40;

type CorpoNovo = {
  nome?: string;
  arquivos?: { nome?: string; mime?: string; base64?: string }[];
};

type CorpoItem = {
  gabarito?: string | null;
  materia?: string | null;
  assunto?: string | null;
  banca?: string | null;
  orgao?: string | null;
  prova?: string | null;
  ano?: number | string | null;
  enunciado?: string;
  alternativas?: Record<string, string>;
  estado?: 'rascunho' | 'descartada';
};

/**
 * O id sai do enunciado, não do relógio. Reimportar o mesmo print — ou a mesma
 * questão capturada em dias diferentes, o que acontece — cai no mesmo id e o
 * ON CONFLICT segura a duplicata.
 */
function idDaQuestao(enunciado: string): string {
  const normal = enunciado
    .replace(/__|==/g, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `print-${createHash('sha256').update(normal).digest('hex').slice(0, 12)}`;
}

export function rotasImportacao(app: FastifyInstance) {
  /* ------------------------------ ambiente ------------------------------ */

  /**
   * A tela pergunta isto antes de deixar escolher arquivos: construir a imagem
   * na primeira vez leva um minuto, e é melhor descobrir que o Docker está
   * fechado agora do que depois de arrastar vinte prints.
   */
  app.get('/api/importacoes/ambiente', async () => {
    try {
      const imagem = await garantirImagem();
      return { pronto: true, imagem, erro: null };
    } catch (e) {
      return { pronto: false, imagem: null, erro: (e as Error).message };
    }
  });

  /* ------------------------------ importações ------------------------------ */

  app.get('/api/importacoes', async () => listarImportacoes());

  /**
   * O lote mais recente que ainda tem rascunho para revisar.
   *
   * Sem a aba de importação, é o que permite fechar o cadastro no meio de um
   * lote de vinte prints e voltar depois sem reler nada.
   */
  app.get('/api/importacoes/pendente', async () => {
    const lote = await um<{ id: number }>(
      `SELECT i.id FROM importacoes i
        WHERE i.estado = 'concluida'
          AND EXISTS (SELECT 1 FROM importacao_itens t
                       WHERE t.importacao_id = i.id AND t.estado = 'rascunho')
        ORDER BY i.criada_em DESC, i.id DESC LIMIT 1`,
    );
    if (!lote) return { lote: null };

    const importacao = await lerImportacao(lote.id);
    const itens = (await lerItens(lote.id)).filter((i) => i.estado === 'rascunho');
    return { lote: { ...importacao, itens } };
  });

  app.post<{ Body: CorpoNovo }>('/api/importacoes', async (req, reply) => {
    const arquivos = req.body?.arquivos ?? [];
    if (arquivos.length === 0)
      return reply.code(400).send({ erro: 'Escolha ao menos um print.' });
    if (arquivos.length > MAXIMO_POR_LOTE)
      return reply
        .code(400)
        .send({ erro: `São no máximo ${MAXIMO_POR_LOTE} prints por lote.` });

    const imagens: Imagem[] = [];
    for (const [i, a] of arquivos.entries()) {
      if (!a?.base64?.trim())
        return reply.code(400).send({ erro: `O arquivo ${i + 1} chegou vazio.` });
      imagens.push({
        nome: a.nome?.trim() || `print-${i + 1}`,
        mime: a.mime?.trim() || 'image/png',
        base64: a.base64,
      });
    }

    const nome =
      (req.body?.nome ?? '').trim() ||
      `Prints de ${new Date().toLocaleDateString('pt-BR')}`;

    const id = await criarImportacao(nome, imagens.length);

    // Gravados antes da leitura: o nome em disco é o mesmo que vai para o item,
    // e é por ele que a revisão pede o print de volta.
    const nomes = guardarPrints(id, imagens);
    const guardadas = imagens.map((imagem, i) => ({ ...imagem, nome: nomes[i] }));

    // A leitura leva minutos; o navegador acompanha pelo progresso, não aqui.
    void rodarImportacao(id, guardadas);

    return reply.code(201).send({ id, nome, total: imagens.length });
  });

  app.get<{ Params: { id: string } }>('/api/importacoes/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const importacao = await lerImportacao(id);
    if (!importacao) return reply.code(404).send({ erro: 'Importação não encontrada.' });
    return { ...importacao, itens: await lerItens(id) };
  });

  /** O print original, para conferir o que o OCR leu. */
  app.get<{ Params: { id: string; arquivo: string } }>(
    '/api/importacoes/:id/prints/:arquivo',
    async (req, reply) => {
      const print = abrirPrint(Number(req.params.id), req.params.arquivo);
      if (!print) return reply.code(404).send({ erro: 'Print não encontrado.' });

      // Imutável: o arquivo nunca muda depois de gravado.
      return reply
        .type(print.tipo)
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(print.stream());
    },
  );

  app.delete<{ Params: { id: string } }>('/api/importacoes/:id', async (req) => {
    const id = Number(req.params.id);
    await exec('DELETE FROM importacoes WHERE id = $1', [id]);
    apagarPrints(id);
    return { ok: true };
  });

  /* --------------------------- revisão do rascunho --------------------------- */

  app.put<{ Params: { id: string; item: string }; Body: CorpoItem }>(
    '/api/importacoes/:id/itens/:item',
    async (req, reply) => {
      const linha = await um<{ dados_json: string; estado: string }>(
        'SELECT dados_json, estado FROM importacao_itens WHERE id = $1 AND importacao_id = $2',
        [Number(req.params.item), Number(req.params.id)],
      );
      if (!linha) return reply.code(404).send({ erro: 'Item não encontrado.' });

      const dados = JSON.parse(linha.dados_json) as Frame;
      const b = req.body ?? {};

      if (b.alternativas) {
        const limpas: Record<string, string> = {};
        for (const [letra, texto] of Object.entries(b.alternativas)) {
          const chave = letra.trim().toUpperCase().slice(0, 1);
          if (/^[A-Z]$/.test(chave) && texto.trim()) limpas[chave] = texto.trim();
        }
        if (Object.keys(limpas).length >= 2) dados.alternativas = limpas;
      }

      if (b.enunciado?.trim()) dados.enunciado = b.enunciado.trim();
      if (b.gabarito !== undefined) {
        const letra = (b.gabarito ?? '').toUpperCase().slice(0, 1);
        dados.gabarito = dados.alternativas[letra] ? letra : null;
        // Gabarito conferido por você não precisa mais da evidência do modelo.
        dados.gabarito_evidencia = dados.gabarito ? 'Confirmado na revisão.' : null;
      }
      for (const campo of ['materia', 'assunto', 'banca', 'orgao', 'prova'] as const) {
        if (b[campo] !== undefined) dados[campo] = b[campo]?.trim() || null;
      }
      if (b.ano !== undefined) {
        const ano = Number(b.ano);
        dados.ano = Number.isInteger(ano) && ano > 1900 && ano < 2200 ? ano : null;
      }

      // Tirar ou renomear alternativa pode deixar o gabarito apontando para o
      // vazio, e aí toda resposta viraria erro.
      if (dados.gabarito && !dados.alternativas[dados.gabarito]) {
        dados.gabarito = null;
        dados.gabarito_evidencia = null;
      }

      const estado = b.estado === 'descartada' || b.estado === 'rascunho' ? b.estado : linha.estado;

      await exec('UPDATE importacao_itens SET dados_json = $1, estado = $2 WHERE id = $3', [
        JSON.stringify(dados),
        estado,
        Number(req.params.item),
      ]);

      return { ok: true };
    },
  );

  /* ------------------------------- confirmar ------------------------------- */

  app.post<{
    Params: { id: string };
    Body: { materia_padrao?: string; permitir_sem_gabarito?: boolean; itens?: number[] };
  }>('/api/importacoes/:id/confirmar', async (req, reply) => {
    const importacaoId = Number(req.params.id);
    const todos = await lerItens(importacaoId);
    if (todos.length === 0)
      return reply.code(400).send({ erro: 'Esta importação não tem questões.' });

    // Sem `itens`, vai o lote inteiro. Com, só os pedidos — é como o cadastro
    // salva uma questão de cada vez, sem fechar o lote junto.
    const escolhidos = req.body?.itens;
    const itens =
      Array.isArray(escolhidos) && escolhidos.length > 0
        ? todos.filter((i) => escolhidos.includes(i.id))
        : todos;

    const padrao = (req.body?.materia_padrao ?? '').trim();
    const permitirSemGabarito = req.body?.permitir_sem_gabarito === true;

    let inseridas = 0;
    let repetidas = 0;
    let semGabarito = 0;
    const ids: string[] = [];

    for (const item of itens) {
      if (item.estado === 'descartada') continue;

      // Sem gabarito, `responder` conta toda resposta como erro e a revisão
      // espaçada passa a repetir uma questão que você nunca vai "acertar".
      if (!item.gabarito && !permitirSemGabarito) {
        semGabarito++;
        continue;
      }

      const id = item.questao_id ?? idDaQuestao(item.enunciado);
      const nova = await exec(
        `INSERT INTO questoes
           (id, materia_id, assunto, ano, banca, orgao, prova, texto_assoc,
            enunciado, alternativas_json, gabarito, anulada, custom, criada_em)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE, TRUE, $12)
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          await materiaId(item.materia || padrao || 'Sem matéria'),
          item.assunto,
          item.ano,
          item.banca,
          item.orgao,
          item.prova,
          item.texto_assoc,
          item.enunciado,
          JSON.stringify(item.alternativas),
          item.gabarito,
          agoraLocal(),
        ],
      );

      if (nova > 0) inseridas++;
      else repetidas++;

      ids.push(id);
      await exec(
        "UPDATE importacao_itens SET estado = 'importada', questao_id = $1 WHERE id = $2",
        [id, item.id],
      );
    }

    return { inseridas, repetidas, sem_gabarito: semGabarito, questao_ids: ids };
  });
}
