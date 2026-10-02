import { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  NotebookPen,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { api, type Questao } from '../lib/api';
import { dataHora, diaMes } from '../lib/format';
import { TextoMarcado } from './TextoMarcado';

type Modo = 'banco' | 'prova' | 'revisao';
type Gaveta = 'gabarito' | 'anotacoes' | 'estatisticas' | null;

type Props = {
  questao: Questao;
  numero: number;
  modo?: Modo;
  selecionada?: boolean;
  aoSelecionar?: (id: string, marcada: boolean) => void;
  aoAtualizar?: () => void;
  /** Modos "prova" e "revisao": a alternativa marcada vem de fora. */
  marcada?: string | null;
  aoMarcar?: (alternativa: string) => void;
};

export function QuestaoCard({
  questao,
  numero,
  modo = 'banco',
  selecionada = false,
  aoSelecionar,
  aoAtualizar,
  marcada,
  aoMarcar,
}: Props) {
  const [escolha, setEscolha] = useState<string | null>(null);
  const [revelado, setRevelado] = useState(modo === 'revisao');
  const [gaveta, setGaveta] = useState<Gaveta>(modo === 'revisao' ? 'anotacoes' : null);
  const [textoAssocAberto, setTextoAssocAberto] = useState(false);
  const [erro, setErro] = useState('');

  const escolhida = modo === 'banco' ? escolha : (marcada ?? null);
  const mostraGabarito = modo === 'revisao' || (modo === 'banco' && revelado);

  useEffect(() => {
    if (modo === 'revisao') setRevelado(true);
  }, [modo]);

  async function responder() {
    if (!escolha) return;
    try {
      await api.responder(questao.id, escolha, 'banco');
      setRevelado(true);
      setGaveta('gabarito');
      aoAtualizar?.();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  function refazer() {
    setEscolha(null);
    setRevelado(false);
    setGaveta(null);
    setErro('');
  }

  /**
   * Tira a questão da fila de hoje e a traz na frente amanhã. Clicar de novo
   * desmarca — é o mesmo botão nos dois sentidos.
   */
  async function adiar() {
    try {
      await api.agendar([questao.id], questao.agendada_para ? null : undefined);
      aoAtualizar?.();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir() {
    if (!confirm('Excluir esta questão definitivamente?')) return;
    try {
      await api.removerQuestao(questao.id);
      aoAtualizar?.();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const letras = Object.keys(questao.alternativas).sort();

  return (
    <article className="questao">
      {/* ---------------- faixa de cabeçalho ---------------- */}
      <header className="questao-faixa">
        <span className="questao-numero">{numero}</span>
        <span className="questao-id">{questao.id}</span>
        <span className="questao-trilha">
          {questao.materia ?? 'Sem matéria'}
          {questao.assunto ? ` › ${questao.assunto}` : ''}
        </span>
        {questao.anulada && <span className="tag tag-acento">Anulada</span>}
        {questao.agendada_para && (
          <span className="tag" title={`Volta na revisão de ${questao.agendada_para}`}>
            <CalendarClock size={11} /> {diaMes(questao.agendada_para)}
          </span>
        )}

        {modo === 'banco' && aoSelecionar && (
          <label className="questao-selecionar">
            <input
              type="checkbox"
              checked={selecionada}
              onChange={(ev) => aoSelecionar(questao.id, ev.target.checked)}
            />
            Adicionar à prova
          </label>
        )}
      </header>

      {/* ---------------- meta ---------------- */}
      <div className="questao-meta">
        <span>
          Ano: <b>{questao.ano ?? '—'}</b>
        </span>
        <span>
          Banca: <b>{questao.banca ?? '—'}</b>
        </span>
        <span>
          Órgão: <b>{questao.orgao ?? '—'}</b>
        </span>
        <span>
          Prova: <b>{questao.prova ?? '—'}</b>
        </span>
      </div>

      {/* ---------------- texto associado ---------------- */}
      {questao.texto_assoc && (
        <div className="questao-texto-assoc">
          <button
            className="questao-texto-assoc-botao"
            onClick={() => setTextoAssocAberto((v) => !v)}
            aria-expanded={textoAssocAberto}
          >
            {textoAssocAberto ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Texto associado
          </button>
          {textoAssocAberto && (
            <div className="questao-texto-assoc-corpo">
              <TextoMarcado texto={questao.texto_assoc} />
            </div>
          )}
        </div>
      )}

      {/* ---------------- enunciado ---------------- */}
      <div className="questao-enunciado">
        <TextoMarcado texto={questao.enunciado} />
      </div>

      {/* ---------------- alternativas ---------------- */}
      <div className="alternativas">
        {letras.map((letra) => {
          const certa = mostraGabarito && questao.gabarito === letra;
          const errada = mostraGabarito && escolhida === letra && questao.gabarito !== letra;

          return (
            <button
              key={letra}
              className={[
                'alternativa',
                escolhida === letra ? 'alternativa-marcada' : '',
                certa ? 'alternativa-certa' : '',
                errada ? 'alternativa-errada' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={modo === 'revisao' || (modo === 'banco' && revelado)}
              onClick={() => {
                if (modo === 'banco') setEscolha(letra);
                else aoMarcar?.(letra);
              }}
            >
              <span className="alternativa-letra">{letra}</span>
              <span>
                <TextoMarcado texto={questao.alternativas[letra]} />
              </span>
            </button>
          );
        })}
      </div>

      {/* ---------------- ações ---------------- */}
      {modo === 'banco' && (
        <div className="questao-acoes">
          {!revelado ? (
            <button className="botao botao-primario" onClick={responder} disabled={!escolha}>
              <Eye size={15} /> Responder
            </button>
          ) : (
            <button className="botao" onClick={refazer}>
              <RotateCcw size={15} /> Refazer
            </button>
          )}

          {revelado && questao.anulada && (
            <span className="tag tag-acento">Anulada — fora do cálculo de acerto</span>
          )}
          {revelado && !questao.anulada && (
            <span className={`tag ${escolha === questao.gabarito ? 'tag-positivo' : 'tag-acento'}`}>
              {escolha === questao.gabarito ? 'Você acertou' : `Errou — gabarito ${questao.gabarito}`}
            </span>
          )}
          {erro && <span className="rotulo rotulo-acento">{erro}</span>}
        </div>
      )}

      {/* ---------------- rodapé ---------------- */}
      {modo !== 'prova' && (
        <>
          <footer className="questao-rodape">
            <ItemRodape
              icone={<Check size={13} />}
              ativo={gaveta === 'gabarito'}
              aoClicar={() => setGaveta(gaveta === 'gabarito' ? null : 'gabarito')}
            >
              Gabarito
            </ItemRodape>
            <ItemRodape
              icone={<NotebookPen size={13} />}
              ativo={gaveta === 'anotacoes'}
              aoClicar={() => setGaveta(gaveta === 'anotacoes' ? null : 'anotacoes')}
            >
              Anotações{questao.anotacao ? ' •' : ''}
            </ItemRodape>
            <ItemRodape
              icone={<BarChart3 size={13} />}
              ativo={gaveta === 'estatisticas'}
              aoClicar={() => setGaveta(gaveta === 'estatisticas' ? null : 'estatisticas')}
            >
              Estatísticas
            </ItemRodape>

            {modo === 'banco' && !questao.anulada && (
              <button
                className="questao-rodape-item"
                onClick={adiar}
                title={
                  questao.agendada_para
                    ? 'Tirar a marcação e voltar para a fila normal'
                    : 'Segurar esta questão até amanhã e trazê-la na frente da fila'
                }
              >
                <CalendarClock size={13} />
                {questao.agendada_para ? 'Não deixar para depois' : 'Responder amanhã'}
              </button>
            )}

            {questao.custom && modo === 'banco' && (
              <button
                className="questao-rodape-item questao-rodape-perigo"
                onClick={excluir}
              >
                <Trash2 size={13} /> Excluir
              </button>
            )}
          </footer>

          {gaveta === 'gabarito' && (
            <div className="questao-gaveta">
              {questao.anulada ? (
                <span className="vermelho" style={{ fontWeight: 600 }}>
                  Questão anulada — não entra no cálculo de acerto.
                </span>
              ) : (
                <span style={{ fontWeight: 600 }}>
                  Gabarito oficial:{' '}
                  <span className="vermelho">{questao.gabarito ?? 'não informado'}</span>
                </span>
              )}
            </div>
          )}

          {gaveta === 'anotacoes' && (
            <div className="questao-gaveta">
              <Anotacoes questao={questao} somenteLeitura={modo === 'revisao'} />
            </div>
          )}

          {gaveta === 'estatisticas' && (
            <div className="questao-gaveta">
              <EstatisticasQuestao questao={questao} />
            </div>
          )}
        </>
      )}
    </article>
  );
}

function ItemRodape({
  children,
  icone,
  ativo,
  aoClicar,
}: {
  children: React.ReactNode;
  icone: React.ReactNode;
  ativo: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      className={`questao-rodape-item ${ativo ? 'questao-rodape-item-ativo' : ''}`}
      onClick={aoClicar}
    >
      {icone} {children}
    </button>
  );
}

/** Textarea com autosave por questão (debounce). */
function Anotacoes({ questao, somenteLeitura }: { questao: Questao; somenteLeitura: boolean }) {
  const [texto, setTexto] = useState(questao.anotacao ?? '');
  const [situacao, setSituacao] = useState<'' | 'salvando' | 'salvo' | 'erro'>('');
  const timer = useRef<number>();
  const primeiro = useRef(true);

  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false;
      return;
    }
    if (somenteLeitura) return;

    window.clearTimeout(timer.current);
    setSituacao('salvando');
    timer.current = window.setTimeout(async () => {
      try {
        await api.salvarAnotacao(questao.id, texto);
        setSituacao('salvo');
      } catch {
        setSituacao('erro');
      }
    }, 600);

    return () => window.clearTimeout(timer.current);
  }, [texto, questao.id, somenteLeitura]);

  if (somenteLeitura) {
    return texto.trim() ? (
      <>
        <span className="rotulo">Minhas anotações</span>
        <p style={{ whiteSpace: 'pre-wrap', marginTop: 'var(--esp-2)' }}>{texto}</p>
      </>
    ) : (
      <span className="rotulo">Sem anotações nesta questão.</span>
    );
  }

  return (
    <div className="coluna" style={{ gap: 'var(--esp-2)' }}>
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <span className="rotulo">Minhas anotações</span>
        <span className="rotulo">
          {situacao === 'salvando' && 'salvando…'}
          {situacao === 'salvo' && 'salvo'}
          {situacao === 'erro' && <span className="vermelho">falha ao salvar</span>}
        </span>
      </div>
      <textarea
        className="entrada"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Fundamento legal, pegadinha, o que revisar…"
      />
    </div>
  );
}

function EstatisticasQuestao({ questao }: { questao: Questao }) {
  const { tentativas, acertos, percentual, historico, nivel, intervalo_dias } =
    questao.estatisticas;

  if (tentativas === 0) {
    return <span className="rotulo">Você ainda não respondeu esta questão.</span>;
  }

  return (
    <>
      <div className="linha" style={{ gap: 'var(--esp-5)' }}>
        <Par rotulo="Tentativas" valor={String(tentativas)} />
        <Par rotulo="Acertos" valor={String(acertos)} />
        <Par
          rotulo="Aproveitamento"
          valor={questao.anulada ? '—' : `${percentual}%`}
          acento={!questao.anulada && (percentual ?? 0) < 70}
        />
        <Par
          rotulo="Nível da revisão"
          valor={String(nivel)}
          acento={nivel === 0}
        />
      </div>

      <span className="rotulo">
        {nivel === 0
          ? 'Errou na última — volta na próxima revisão.'
          : `Volta para revisão ${intervalo_dias} dia(s) depois da última resposta.`}
      </span>

      <div className="historico-lista">
        {historico.map((r, i) => (
          <div className="historico-linha" key={i}>
            <span className="rotulo" style={{ minWidth: 92 }}>
              {dataHora(r.ts)}
            </span>
            <span className="alternativa-letra" style={{ width: 20, height: 20, fontSize: 11 }}>
              {r.alternativa}
            </span>
            <span className={r.correta ? 'positivo' : 'vermelho'} style={{ fontWeight: 600 }}>
              {r.correta ? 'certa' : 'errada'}
            </span>
            <span className="tag" style={{ marginLeft: 'auto' }}>
              {r.origem === 'prova' ? 'Prova' : 'Banco'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Par({ rotulo, valor, acento }: { rotulo: string; valor: string; acento?: boolean }) {
  return (
    <div className="coluna" style={{ gap: 0 }}>
      <span className="rotulo">{rotulo}</span>
      <span className={`numero ${acento ? 'vermelho' : ''}`} style={{ fontSize: 'var(--texto-g)' }}>
        {valor}
      </span>
    </div>
  );
}
