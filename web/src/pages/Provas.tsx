import { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, Dices, Flag, Play, Target, Trash2 } from 'lucide-react';
import {
  api,
  type Materia,
  type ProvaCompleta,
  type ProvaResumo,
  type ResumoRevisao,
} from '../lib/api';
import { dataCompleta, hhmmss, minutosHumanos } from '../lib/format';
import { QuestaoCard } from '../components/QuestaoCard';
import { Modal } from '../components/Modal';
import { Campo, Aviso } from '../components/Campo';

type Props = { materias: Materia[]; aoAtualizar: () => void };

export function Provas({ materias, aoAtualizar }: Props) {
  const [provas, setProvas] = useState<ProvaResumo[]>([]);
  const [resolvendo, setResolvendo] = useState<ProvaCompleta | null>(null);
  const [modalAleatoria, setModalAleatoria] = useState(false);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  function recarregar() {
    setCarregando(true);
    api
      .provas()
      .then(setProvas)
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }

  useEffect(recarregar, []);

  async function resolver(id: number) {
    try {
      setResolvendo(await api.prova(id));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir(id: number) {
    if (!confirm('Excluir esta prova? O histórico de respostas das questões é mantido.')) return;
    await api.removerProva(id);
    recarregar();
  }

  if (resolvendo) {
    return (
      <ResolverProva
        prova={resolvendo}
        aoSair={() => {
          setResolvendo(null);
          recarregar();
          aoAtualizar();
        }}
      />
    );
  }

  return (
    <>
      <div className="secao-titulo">
        <h2>Provas</h2>
        <button className="botao botao-primario" onClick={() => setModalAleatoria(true)}>
          <Dices size={15} /> Gerar aleatória
        </button>
      </div>

      {erro && <div className="aviso aviso-erro">{erro}</div>}

      <PainelRevisao materias={materias} aoCriar={recarregar} />

      <section className="painel">
        <div className="painel-cabecalho">
          <span className="rotulo">Minhas provas</span>
          <span className="rotulo">{provas.length}</span>
        </div>

        {carregando ? (
          <div className="vazio">Carregando…</div>
        ) : provas.length === 0 ? (
          <div className="vazio">
            Nenhuma prova ainda. Selecione questões no banco ou gere uma aleatória.
          </div>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Prova</th>
                <th className="num">Questões</th>
                <th>Matérias</th>
                <th className="num">Última nota</th>
                <th className="num">Melhor</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {provas.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.nome}</div>
                    <span className="rotulo">{dataCompleta(p.criada_em)}</span>
                  </td>
                  <td className="num">{p.questoes}</td>
                  <td>
                    <div className="linha" style={{ gap: 'var(--esp-1)' }}>
                      {p.materias.slice(0, 3).map((m) => (
                        <span className="tag" key={m}>
                          {m}
                        </span>
                      ))}
                      {p.materias.length > 3 && (
                        <span className="tag">+{p.materias.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="num">
                    {p.ultimo_resultado ? (
                      <>
                        {p.ultimo_resultado.acertos}/{p.ultimo_resultado.total}
                        <div className="rotulo">{hhmmss(p.ultimo_resultado.tempo_seg)}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">
                    {p.melhor_aproveitamento === null ? (
                      '—'
                    ) : (
                      <b className={p.melhor_aproveitamento >= 70 ? 'positivo' : 'vermelho'}>
                        {p.melhor_aproveitamento}%
                      </b>
                    )}
                  </td>
                  <td className="num">
                    <div className="linha" style={{ justifyContent: 'flex-end', gap: 'var(--esp-1)' }}>
                      <button className="botao botao-p" onClick={() => resolver(p.id)}>
                        <Play size={12} /> Resolver
                      </button>
                      <button
                        className="botao botao-p botao-perigo"
                        onClick={() => excluir(p.id)}
                        aria-label="Excluir prova"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {modalAleatoria && (
        <ModalAleatoria
          materias={materias}
          aoFechar={() => setModalAleatoria(false)}
          aoCriar={recarregar}
        />
      )}
    </>
  );
}

/* ====================================================================== */

function ModalAleatoria({
  materias,
  aoFechar,
  aoCriar,
}: {
  materias: Materia[];
  aoFechar: () => void;
  aoCriar: () => void;
}) {
  const [materiaId, setMateriaId] = useState('');
  const [quantidade, setQuantidade] = useState('10');
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function gerar() {
    setSalvando(true);
    setErro('');
    try {
      await api.provaAleatoria({
        nome: nome.trim() || undefined,
        materia_id: materiaId ? Number(materiaId) : null,
        quantidade: Number(quantidade) || 10,
      });
      aoCriar();
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="Gerar prova aleatória"
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" onClick={gerar} disabled={salvando}>
            {salvando ? 'Gerando…' : 'Gerar prova'}
          </button>
        </>
      }
    >
      <div className="coluna">
        <Campo rotulo="Matéria">
          <select value={materiaId} onChange={(e) => setMateriaId(e.target.value)}>
            <option value="">Todas as matérias</option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} ({m.questoes})
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Quantidade de questões">
          <input
            inputMode="numeric"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, '').slice(0, 3))}
          />
        </Campo>

        <Campo rotulo="Nome (opcional)">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Gerado automaticamente se vazio"
          />
        </Campo>

        <span className="rotulo">Questões anuladas ficam de fora do sorteio.</span>
        {erro && <Aviso erro>{erro}</Aviso>}
      </div>
    </Modal>
  );
}

/* ====================================================================== */

type Resultado = { acertos: number; total: number; tempo: number };

function ResolverProva({ prova, aoSair }: { prova: ProvaCompleta; aoSair: () => void }) {
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const inicio = useRef(Date.now());

  // Cronômetro baseado no instante de início, imune a aba em segundo plano.
  useEffect(() => {
    if (resultado) return;
    const id = window.setInterval(
      () => setSegundos(Math.floor((Date.now() - inicio.current) / 1000)),
      500,
    );
    return () => window.clearInterval(id);
  }, [resultado]);

  const respondidas = Object.keys(respostas).length;

  async function finalizar() {
    if (
      respondidas < prova.questoes.length &&
      !confirm(
        `Faltam ${prova.questoes.length - respondidas} questão(ões) sem resposta. Finalizar mesmo assim?`,
      )
    )
      return;

    setSalvando(true);
    setErro('');
    const tempo = Math.floor((Date.now() - inicio.current) / 1000);

    try {
      // Cada resposta entra no histórico da questão com origem "prova".
      for (const [questaoId, alternativa] of Object.entries(respostas)) {
        await api.responder(questaoId, alternativa, 'prova');
      }

      // Anuladas não entram no cálculo.
      const validas = prova.questoes.filter((q) => !q.anulada);
      const acertos = validas.filter((q) => respostas[q.id] === q.gabarito).length;

      await api.salvarResultado(prova.id, { acertos, total: validas.length, tempo_seg: tempo });
      setResultado({ acertos, total: validas.length, tempo });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const percentual =
    resultado && resultado.total > 0
      ? Math.round((resultado.acertos / resultado.total) * 100)
      : 0;

  return (
    <>
      <div className="prova-topo">
        <div className="coluna" style={{ gap: 0 }}>
          <span className="rotulo" style={{ color: 'inherit', opacity: 0.7 }}>
            {resultado ? 'Prova finalizada' : 'Resolvendo'}
          </span>
          <strong>{prova.nome}</strong>
        </div>

        <div className="coluna" style={{ gap: 0 }}>
          <span className="rotulo" style={{ color: 'inherit', opacity: 0.7 }}>
            Tempo
          </span>
          <span className="prova-cronometro">
            {hhmmss(resultado ? resultado.tempo : segundos)}
          </span>
        </div>

        <div className="coluna" style={{ gap: 0 }}>
          <span className="rotulo" style={{ color: 'inherit', opacity: 0.7 }}>
            Respondidas
          </span>
          <span className="prova-cronometro">
            {respondidas}/{prova.questoes.length}
          </span>
        </div>

        {resultado ? (
          <button className="botao" onClick={aoSair}>
            Voltar às provas
          </button>
        ) : (
          <button className="botao" onClick={finalizar} disabled={salvando}>
            <Flag size={15} /> {salvando ? 'Salvando…' : 'Finalizar'}
          </button>
        )}
      </div>

      {erro && <div className="aviso aviso-erro">{erro}</div>}

      {resultado && (
        <div className="resultado">
          <div className="metrica">
            <span className="rotulo">Acertos</span>
            <span className="metrica-valor">
              {resultado.acertos}
              <span className="fraco">/{resultado.total}</span>
            </span>
          </div>
          <div className="metrica">
            <span className="rotulo">Aproveitamento</span>
            <span className={`metrica-valor ${percentual >= 70 ? 'positivo' : 'vermelho'}`}>
              {percentual}%
            </span>
          </div>
          <div className="metrica">
            <span className="rotulo">Tempo</span>
            <span className="metrica-valor">{hhmmss(resultado.tempo)}</span>
            <span className="rotulo">
              média de {minutosHumanos(Math.round(resultado.tempo / 60 / Math.max(1, resultado.total)))} por questão
            </span>
          </div>
        </div>
      )}

      <div className="coluna" style={{ gap: 'var(--esp-4)' }}>
        {prova.questoes.map((q, i) => (
          <QuestaoCard
            key={q.id}
            questao={q}
            numero={i + 1}
            modo={resultado ? 'revisao' : 'prova'}
            marcada={respostas[q.id] ?? null}
            aoMarcar={(alternativa) =>
              setRespostas((r) => ({ ...r, [q.id]: alternativa }))
            }
          />
        ))}
      </div>
    </>
  );
}


/* ====================================================================== */

/**
 * Repetição espaçada.
 *
 * Duas filas, com propósitos diferentes. A da sessão devolve o que venceu hoje
 * — e o que você errou na última vez vence no mesmo dia, então erro volta
 * rápido e continua voltando até você acertar algumas vezes seguidas. A de fim
 * de semana ignora vencimento e junta só o que você errou na janela, do que
 * mais errou para o que menos errou.
 */
function PainelRevisao({
  materias,
  aoCriar,
}: {
  materias: Materia[];
  aoCriar: () => void;
}) {
  const [resumo, setResumo] = useState<ResumoRevisao | null>(null);
  const [materiaId, setMateriaId] = useState('');
  const [quantidade, setQuantidade] = useState('20');
  const [dias, setDias] = useState('7');
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState<'revisao' | 'erros' | null>(null);

  const carregar = useCallback(() => {
    api
      .revisao({ materia_id: materiaId ? Number(materiaId) : null, dias: Number(dias) || 7 })
      .then(setResumo)
      .catch(() => setResumo(null));
  }, [materiaId, dias]);

  useEffect(carregar, [carregar]);

  async function gerar(tipo: 'revisao' | 'erros') {
    setGerando(tipo);
    setErro('');
    try {
      const comum = {
        materia_id: materiaId ? Number(materiaId) : null,
        quantidade: Number(quantidade) || 20,
      };
      if (tipo === 'revisao') await api.provaRevisao(comum);
      else await api.provaErros({ ...comum, dias: Number(dias) || 7 });
      aoCriar();
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGerando(null);
    }
  }

  const nivelMaximo = (resumo?.por_nivel.length ?? 1) - 1;

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <span className="rotulo">Revisão espaçada</span>
        {resumo && (
          <span className="rotulo">
            {resumo.total} questões respondíveis
          </span>
        )}
      </div>

      <div className="painel-corpo coluna">
        {resumo && (
          <div className="linha" style={{ gap: 'var(--esp-5)' }}>
            <Metrica rotulo="Vencidas hoje" valor={resumo.vencidas} />
            <Metrica rotulo="Errei na última" valor={resumo.errei_na_ultima} acento />
            <Metrica rotulo="Marquei para hoje" valor={resumo.agendadas_hoje} />
            <Metrica rotulo="Guardadas p/ depois" valor={resumo.agendadas_depois} />
            <Metrica rotulo="Nunca respondidas" valor={resumo.nunca_respondidas} />
            <Metrica
              rotulo={`Erradas em ${dias} dias`}
              valor={resumo.com_erro_no_periodo}
              acento
            />
          </div>
        )}

        <div className="filtros filtros-compactos">
          <Campo rotulo="Matéria">
            <select value={materiaId} onChange={(e) => setMateriaId(e.target.value)}>
              <option value="">Todas as matérias</option>
              {materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Questões no caderno">
            <input
              inputMode="numeric"
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </Campo>
          <Campo rotulo="Janela de erros (dias)">
            <input
              inputMode="numeric"
              value={dias}
              onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
          </Campo>
        </div>

        <div className="linha">
          <button
            className="botao botao-primario"
            onClick={() => gerar('revisao')}
            disabled={gerando !== null || resumo?.total === 0}
          >
            <Brain size={15} />
            {gerando === 'revisao' ? 'Montando…' : 'Caderno da sessão de hoje'}
          </button>
          <button
            className="botao"
            onClick={() => gerar('erros')}
            disabled={gerando !== null || resumo?.com_erro_no_periodo === 0}
          >
            <Target size={15} />
            {gerando === 'erros' ? 'Montando…' : 'Caderno das que mais errei'}
          </button>
        </div>

        {resumo && resumo.total > 0 && (
          <div className="niveis">
            {resumo.por_nivel.map((n) => (
              <div className="nivel" key={n.nivel}>
                <span className="rotulo">
                  {n.nivel === 0 ? 'errei' : `nível ${n.nivel}`}
                </span>
                <span className={`numero ${n.nivel === 0 ? 'vermelho' : ''}`}>{n.questoes}</span>
                <span className="rotulo">
                  {n.intervalo_dias === 0
                    ? 'volta já'
                    : `${n.intervalo_dias}d${n.nivel === nivelMaximo ? '+' : ''}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <span className="dica">
          Errar zera o nível e a questão volta na próxima sessão. Cada acerto seguido empurra
          o próximo encontro para mais longe. O que você marcou com "responder amanhã" fica
          fora da fila até o dia, e nesse dia vem na frente de tudo.
        </span>

        {erro && <Aviso erro>{erro}</Aviso>}
      </div>
    </section>
  );
}

function Metrica({
  rotulo,
  valor,
  acento,
}: {
  rotulo: string;
  valor: number;
  acento?: boolean;
}) {
  return (
    <div className="coluna" style={{ gap: 0 }}>
      <span className="rotulo">{rotulo}</span>
      <span
        className={`numero ${acento && valor > 0 ? 'vermelho' : ''}`}
        style={{ fontSize: 'var(--texto-g)' }}
      >
        {valor}
      </span>
    </div>
  );
}
