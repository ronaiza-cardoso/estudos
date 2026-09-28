#!/usr/bin/env node
/**
 * Popula o banco com dados de demonstração para você ver o app cheio:
 * sessões dos últimos 35 dias, respostas com acertos e erros, anotações,
 * provas já resolvidas, uma questão anulada e uma cadastrada à mão.
 *
 *   npm run seed:demo            adiciona aos dados atuais
 *   npm run seed:demo -- --limpar  apaga o histórico antes de popular
 *
 * Os números são gerados a partir de uma semente fixa, então rodar de novo
 * com --limpar devolve exatamente o mesmo banco.
 */
import { abrirBanco, encerrarBanco, exec, materiaId, migrar, q, um } from './db.js';
import { popularSeed } from './seed.js';
import { agoraLocal } from './util.js';

/** PRNG com semente fixa — mantém a demonstração reproduzível. */
function prng(semente: number) {
  let a = semente;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = prng(20260928);
const entre = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
const sorteio = (p: number) => rnd() < p;
const um_de = <T,>(lista: T[]): T => lista[Math.floor(rnd() * lista.length)];

/** Data/hora local de N dias atrás, na hora e minuto pedidos. */
function diasAtras(dias: number, hora: number, minuto: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora, minuto, 0, 0);
  return agoraLocal(d);
}

const DIAS = 35;

async function limparHistorico() {
  await exec(`TRUNCATE sessoes, respostas, anotacoes, provas, prova_questoes,
              resultados RESTART IDENTITY CASCADE`);
  await exec('DELETE FROM questoes WHERE custom');
  console.log('Histórico anterior apagado.');
}

/** Duas questões extras: uma anulada e uma cadastrada à mão. */
async function questoesExtras() {
  const extras = [
    {
      id: 'demo-anulada-001',
      materia: 'Direito Constitucional',
      assunto: 'Controle de Constitucionalidade',
      ano: 2023,
      banca: 'CEBRASPE',
      orgao: 'TRF 5ª Região',
      prova: 'Analista Judiciário',
      enunciado:
        'Acerca do controle difuso de constitucionalidade, assinale a alternativa correta. '
        + '(Questão anulada pela banca por ausência de alternativa correta.)',
      alternativas: {
        A: 'Só pode ser exercido pelo Supremo Tribunal Federal.',
        B: 'Produz sempre efeitos erga omnes e vinculantes.',
        C: 'Não admite participação de amicus curiae em nenhuma hipótese.',
        D: 'Exige quórum de dois terços em qualquer instância.',
        E: 'É privativo dos tribunais superiores.',
      },
      gabarito: null,
      anulada: true,
    },
    {
      id: 'demo-custom-001',
      materia: 'Raciocínio Lógico',
      assunto: 'Proposições Equivalentes',
      ano: 2024,
      banca: 'FGV',
      orgao: 'TRT 1ª Região',
      prova: 'Técnico Judiciário',
      enunciado:
        'A proposição "Se chove, então a rua fica molhada" é logicamente equivalente a:',
      alternativas: {
        A: 'Se a rua fica molhada, então chove.',
        B: 'Se a rua não fica molhada, então não chove.',
        C: 'Chove e a rua não fica molhada.',
        D: 'Não chove e a rua fica molhada.',
        E: 'Chove ou a rua fica molhada.',
      },
      gabarito: 'B',
      anulada: false,
    },
  ];

  for (const e of extras) {
    await exec(
      `INSERT INTO questoes
         (id, materia_id, assunto, ano, banca, orgao, prova, texto_assoc,
          enunciado, alternativas_json, gabarito, anulada, custom, criada_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,TRUE,$12)
       ON CONFLICT (id) DO NOTHING`,
      [
        e.id,
        await materiaId(e.materia),
        e.assunto,
        e.ano,
        e.banca,
        e.orgao,
        e.prova,
        e.enunciado,
        JSON.stringify(e.alternativas),
        e.gabarito,
        e.anulada,
        diasAtras(12, 10, 0),
      ],
    );
  }
  console.log(`Questões extras: ${extras.length} (1 anulada, 1 cadastrada à mão).`);
}

/**
 * Sessões dos últimos 35 dias. Dias de semana rendem mais; fins de semana
 * variam; alguns dias ficam vazios de propósito, para a sequência não ser
 * uma linha reta. Hoje sempre tem estudo, para a sequência começar em 1.
 */
async function sessoes() {
  let total = 0;
  let minutos = 0;

  for (let dia = DIAS - 1; dia >= 0; dia--) {
    const data = new Date();
    data.setDate(data.getDate() - dia);
    const fimDeSemana = data.getDay() === 0 || data.getDay() === 6;

    // Pula alguns dias — mas nunca hoje nem ontem, para a sequência aparecer.
    const folga = dia > 1 && sorteio(fimDeSemana ? 0.45 : 0.18);
    if (folga) continue;

    const quantidade = dia === 0 ? entre(2, 4) : fimDeSemana ? entre(1, 3) : entre(2, 6);
    let hora = fimDeSemana ? entre(9, 11) : entre(7, 9);

    for (let i = 0; i < quantidade; i++) {
      // Uma em cada oito sessões é interrompida no meio.
      const interrompida = sorteio(0.12);
      const min = interrompida ? entre(3, 18) : 25;

      await exec(
        'INSERT INTO sessoes (inicio, minutos, completa) VALUES ($1, $2, $3)',
        [diasAtras(dia, hora, entre(0, 55)), min, !interrompida],
      );

      total++;
      minutos += min;
      hora += 1;
      if (hora > 22) break;
    }
  }

  console.log(`Sessões: ${total} (${Math.floor(minutos / 60)}h ${minutos % 60}min).`);
}

/** Respostas espalhadas no tempo, com acerto girando em torno de 65%. */
async function respostas() {
  const questoes = await q<{ id: string; gabarito: string | null; anulada: boolean }>(
    'SELECT id, gabarito, anulada FROM questoes ORDER BY id',
  );
  const letras = ['A', 'B', 'C', 'D', 'E'];
  let total = 0;
  let certas = 0;

  for (const questao of questoes) {
    // Deixa algumas sem resposta, para o filtro "não respondidas" ter conteúdo.
    if (sorteio(0.25)) continue;

    const tentativas = entre(1, 3);
    for (let t = 0; t < tentativas; t++) {
      // A chance de acerto sobe a cada refação — é o efeito de estudar.
      const acerta = sorteio(0.55 + t * 0.15);
      const erradas = letras.filter((l) => l !== questao.gabarito);
      const alternativa =
        acerta && questao.gabarito ? questao.gabarito : um_de(erradas);
      const correta = questao.gabarito !== null && alternativa === questao.gabarito;

      await exec(
        `INSERT INTO respostas (questao_id, alternativa, correta, ts, origem)
         VALUES ($1, $2, $3, $4, 'banco')`,
        [questao.id, alternativa, correta, diasAtras(entre(0, 20), entre(8, 22), entre(0, 59))],
      );

      total++;
      if (correta && !questao.anulada) certas++;
    }
  }

  console.log(`Respostas: ${total} (${certas} certas fora as anuladas).`);
}

async function anotacoes() {
  const textos: [string, string][] = [
    ['seed-dir-adm-001', 'LIMPE — Legalidade, Impessoalidade, Moralidade, Publicidade e Eficiência.\nA eficiência entrou com a EC 19/98.'],
    ['seed-dir-adm-002', 'Revogação: conveniência e oportunidade, efeito ex nunc.\nAnulação: ilegalidade, efeito ex tunc. Cai sempre.'],
    ['seed-port-002', 'Errei de novo. "Existir" concorda com o sujeito; "haver" no sentido de existir é impessoal.'],
    ['seed-rlm-001', 'Negação de "se P então Q" = P e não-Q. Não é a contrapositiva!'],
    ['seed-leg-001', 'Estágio probatório: 36 meses. Não confundir com a estabilidade (3 anos) do art. 41 da CF.'],
  ];

  for (const [questaoId, texto] of textos) {
    await exec(
      `INSERT INTO anotacoes (questao_id, texto, atualizado_em) VALUES ($1, $2, $3)
       ON CONFLICT (questao_id) DO UPDATE
         SET texto = EXCLUDED.texto, atualizado_em = EXCLUDED.atualizado_em`,
      [questaoId, texto, diasAtras(entre(1, 15), entre(9, 21), entre(0, 59))],
    );
  }

  console.log(`Anotações: ${textos.length}.`);
}

/** Provas já resolvidas, com resultados e respostas de origem "prova". */
async function provas() {
  const disponiveis = await q<{ id: string; gabarito: string | null }>(
    'SELECT id, gabarito FROM questoes WHERE NOT anulada AND gabarito IS NOT NULL ORDER BY id',
  );

  const definicoes = [
    { nome: 'Simulado — Direito Administrativo e Constitucional', dias: 18, qtd: 4, tentativas: 2 },
    { nome: 'Aleatória — todas as matérias (6)', dias: 9, qtd: 6, tentativas: 1 },
    { nome: 'Revisão da semana', dias: 2, qtd: 5, tentativas: 1 },
  ];

  for (const def of definicoes) {
    const escolhidas = [...disponiveis].sort(() => rnd() - 0.5).slice(0, def.qtd);

    const prova = await um<{ id: number }>(
      'INSERT INTO provas (nome, criada_em) VALUES ($1, $2) RETURNING id',
      [def.nome, diasAtras(def.dias, 19, 30)],
    );

    for (const [i, questao] of escolhidas.entries()) {
      await exec(
        'INSERT INTO prova_questoes (prova_id, questao_id, ordem) VALUES ($1, $2, $3)',
        [prova!.id, questao.id, i + 1],
      );
    }

    // Cada tentativa gera respostas e um resultado; a segunda costuma ir melhor.
    for (let t = 0; t < def.tentativas; t++) {
      const quandoDia = Math.max(0, def.dias - t * 3);
      let acertos = 0;

      for (const questao of escolhidas) {
        const acerta = sorteio(0.5 + t * 0.2);
        const erradas = ['A', 'B', 'C', 'D', 'E'].filter((l) => l !== questao.gabarito);
        const alternativa = acerta ? questao.gabarito! : um_de(erradas);
        const correta = alternativa === questao.gabarito;
        if (correta) acertos++;

        await exec(
          `INSERT INTO respostas (questao_id, alternativa, correta, ts, origem)
           VALUES ($1, $2, $3, $4, 'prova')`,
          [questao.id, alternativa, correta, diasAtras(quandoDia, 20, entre(0, 45))],
        );
      }

      await exec(
        `INSERT INTO resultados (prova_id, acertos, total, tempo_seg, ts)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          prova!.id,
          acertos,
          escolhidas.length,
          escolhidas.length * entre(70, 150),
          diasAtras(quandoDia, 20, 50),
        ],
      );
    }
  }

  console.log(`Provas: ${definicoes.length}, todas já resolvidas.`);
}

async function main() {
  const limpar = process.argv.includes('--limpar');

  await abrirBanco();
  await migrar();

  const carregadas = await popularSeed();
  if (carregadas > 0) console.log(`seed-questoes.js: ${carregadas} questões carregadas.`);

  if (limpar) await limparHistorico();

  console.log('\nGerando dados de demonstração…\n');

  await questoesExtras();
  await sessoes();
  await respostas();
  await anotacoes();
  await provas();

  const resumo = (await um<any>(`
    SELECT (SELECT COUNT(*) FROM questoes)   AS questoes,
           (SELECT COUNT(*) FROM sessoes)    AS sessoes,
           (SELECT COUNT(*) FROM respostas)  AS respostas,
           (SELECT COUNT(*) FROM anotacoes)  AS anotacoes,
           (SELECT COUNT(*) FROM provas)     AS provas,
           (SELECT COUNT(*) FROM resultados) AS resultados
  `))!;

  console.log('\n─────────── BANCO DE DEMONSTRAÇÃO ───────────');
  for (const [chave, valor] of Object.entries(resumo)) {
    console.log(`  ${chave.padEnd(12)} ${valor}`);
  }
  console.log('─────────────────────────────────────────────');
  console.log('\nAbra http://localhost:5182 e veja as abas Sessões, Questões e Provas.');
  console.log('Para zerar e gerar de novo: npm run seed:demo -- --limpar\n');

  await encerrarBanco();
}

main().catch(async (erro) => {
  console.error(`\nErro: ${erro instanceof Error ? erro.message : erro}`);
  await encerrarBanco();
  process.exitCode = 1;
});
