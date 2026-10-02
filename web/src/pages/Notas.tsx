import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, type Nota, type Tarefa } from '../lib/api';
import { dataCompleta, diaLocal, diaMes, plural } from '../lib/format';

/**
 * As notas do dia e o TODO que sai delas.
 *
 * A tela tem três partes, nesta ordem de propósito: o que está em aberto
 * (é o que se abre o app para ver), a anotação do dia escolhido (é onde se
 * escreve no fim da sessão) e o histórico dos dias anteriores.
 */
export function Notas() {
  const hoje = diaLocal();

  const [notas, setNotas] = useState<Nota[]>([]);
  const [pendentes, setPendentes] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [dia, setDia] = useState(hoje);
  const [texto, setTexto] = useState('');
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [novaTarefa, setNovaTarefa] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [lista, abertas] = await Promise.all([api.notas(), api.tarefasPendentes()]);
      setNotas(lista);
      setPendentes(abertas.tarefas);
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const notaDoDia = notas.find((n) => n.dia === dia) ?? null;

  /*
   * O rascunho espelha o que está no servidor para o dia escolhido. Enquanto
   * houver edição não salva, recarregar a lista não pode passar por cima do que
   * está sendo digitado — por isso `sujo` fica fora das dependências: o efeito
   * só precisa reagir à troca de dia e à chegada de dados novos.
   */
  useEffect(() => {
    if (sujo) return;
    setTexto(notaDoDia?.texto ?? '');
  }, [dia, notas]); // eslint-disable-line react-hooks/exhaustive-deps

  const salvar = useCallback(async (): Promise<boolean> => {
    setSalvando(true);
    try {
      await api.salvarNota(dia, texto);
      setSujo(false);
      await carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setSalvando(false);
    }
  }, [carregar, dia, texto]);

  // Salvamento automático: escrever no fim do dia não devia exigir um botão.
  useEffect(() => {
    if (!sujo) return;
    const timer = setTimeout(() => void salvar(), 1000);
    return () => clearTimeout(timer);
  }, [salvar, sujo, texto]);

  async function trocarDia(novo: string) {
    if (!novo || novo === dia) return;
    // Trocar de dia com rascunho pendente gravaria o texto no dia errado.
    if (sujo && !(await salvar())) return;
    setDia(novo);
  }

  /** Reflete a mudança nas duas listas: o painel de pendentes e o histórico. */
  function aplicar(id: number, mudanca: Partial<Tarefa>) {
    setPendentes((atual) => atual.map((t) => (t.id === id ? { ...t, ...mudanca } : t)));
    setNotas((atual) =>
      atual.map((n) => ({
        ...n,
        tarefas: n.tarefas.map((t) => (t.id === id ? { ...t, ...mudanca } : t)),
      })),
    );
  }

  async function alternar(tarefa: Tarefa) {
    const feita = !tarefa.feita;
    // Otimista, e sem tirar a linha da lista: desmarcar um clique errado não
    // pode obrigar a caçar a tarefa no histórico. Ela sai no próximo carregamento.
    aplicar(tarefa.id, { feita });
    try {
      await api.salvarTarefa(tarefa.id, { feita });
    } catch (e) {
      aplicar(tarefa.id, { feita: tarefa.feita });
      setErro((e as Error).message);
    }
  }

  async function adicionarTarefas() {
    if (!novaTarefa.trim()) return;
    try {
      await api.criarTarefas(dia, novaTarefa);
      setNovaTarefa('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function removerTarefa(id: number) {
    try {
      await api.removerTarefa(id);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function removerNota(alvo: string) {
    if (!confirm(`Apagar a nota de ${dataCompleta(alvo)} e as tarefas dela?`)) return;
    try {
      await api.removerNota(alvo);
      if (alvo === dia) {
        setSujo(false);
        setTexto('');
      }
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (carregando) return <p className="suave">Carregando…</p>;

  const abertas = pendentes.filter((t) => !t.feita);
  const atrasadas = abertas.filter((t) => t.dia < hoje).length;
  const historico = notas.filter((n) => n.dia !== dia);
  const tarefasDoDia = notaDoDia?.tarefas ?? [];

  return (
    <>
      {erro && <div className="aviso aviso-erro">{erro}</div>}

      {/* ---------------- o que fazer agora ---------------- */}
      <section className="secao">
        <div className="secao-titulo">
          <h2>Para hoje</h2>
          {abertas.length > 0 && (
            <span className="rotulo">
              {plural(abertas.length, 'tarefa em aberto', 'tarefas em aberto')}
              {atrasadas > 0 && ` · ${atrasadas} de dias anteriores`}
            </span>
          )}
        </div>

        {pendentes.length === 0 ? (
          <p className="suave">
            Nada em aberto. No fim da sessão, anote abaixo o que a próxima precisa pegar.
          </p>
        ) : (
          <ul className="tarefas">
            {pendentes.map((t) => (
              <ItemTarefa
                key={t.id}
                tarefa={t}
                selo={rotuloDia(t.dia, hoje)}
                atrasada={t.dia < hoje}
                aoAlternar={() => alternar(t)}
                aoRemover={() => removerTarefa(t.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- a nota do dia ---------------- */}
      <section className="secao">
        <div className="secao-titulo">
          <h2>Anotação do dia</h2>
          <div className="linha">
            <span className="nota-estado">
              {salvando ? 'Salvando…' : sujo ? 'Não salvo' : notaDoDia ? 'Salvo' : ''}
            </span>
            <input
              className="entrada nota-data"
              type="date"
              value={dia}
              max="2100-12-31"
              onChange={(e) => void trocarDia(e.target.value)}
            />
          </div>
        </div>

        <textarea
          className="entrada nota-editor"
          value={texto}
          placeholder={
            dia === hoje
              ? 'O que estudei hoje, o que ficou travado, onde parei…'
              : 'O que foi estudado nesse dia…'
          }
          onChange={(e) => {
            setTexto(e.target.value);
            setSujo(true);
          }}
          onBlur={() => {
            if (sujo) void salvar();
          }}
        />

        <div className="nota-tarefas">
          <span className="rotulo">Para a próxima sessão</span>

          {tarefasDoDia.length > 0 && (
            <ul className="tarefas">
              {tarefasDoDia.map((t) => (
                <ItemTarefa
                  key={t.id}
                  tarefa={t}
                  aoAlternar={() => alternar(t)}
                  aoRemover={() => removerTarefa(t.id)}
                />
              ))}
            </ul>
          )}

          <div className="nota-nova">
            <textarea
              className="entrada"
              rows={2}
              value={novaTarefa}
              placeholder="Revisar crase · 20 questões de Direito Administrativo…"
              onChange={(e) => setNovaTarefa(e.target.value)}
              onKeyDown={(e) => {
                // Enter adiciona; Shift+Enter quebra a linha. Colar uma lista
                // inteira e dar Enter cria uma tarefa por linha.
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void adicionarTarefas();
                }
              }}
            />
            <button className="botao" onClick={() => void adicionarTarefas()} disabled={!novaTarefa.trim()}>
              <Plus size={15} /> Adicionar
            </button>
          </div>
          <span className="dica">Uma tarefa por linha. Enter adiciona, Shift+Enter quebra a linha.</span>
        </div>
      </section>

      {/* ---------------- dias anteriores ---------------- */}
      <section className="secao">
        <h2>Dias anteriores</h2>
        {historico.length === 0 ? (
          <p className="suave">Nenhuma outra nota ainda.</p>
        ) : (
          <div className="nota-historico">
            {historico.map((n) => (
              <article className="nota-dia" key={n.dia}>
                <div className="secao-titulo">
                  <h3>{dataCompleta(n.dia)}</h3>
                  <div className="linha">
                    <button className="botao botao-p" onClick={() => void trocarDia(n.dia)}>
                      Editar
                    </button>
                    <button
                      className="botao botao-nu botao-perigo"
                      onClick={() => void removerNota(n.dia)}
                      aria-label={`Apagar a nota de ${dataCompleta(n.dia)}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {n.texto && <p className="nota-texto">{n.texto}</p>}

                {n.tarefas.length > 0 && (
                  <ul className="tarefas">
                    {n.tarefas.map((t) => (
                      <ItemTarefa
                        key={t.id}
                        tarefa={t}
                        aoAlternar={() => alternar(t)}
                        aoRemover={() => removerTarefa(t.id)}
                      />
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ItemTarefa({
  tarefa,
  selo,
  atrasada,
  aoAlternar,
  aoRemover,
}: {
  tarefa: Tarefa;
  selo?: string;
  atrasada?: boolean;
  aoAlternar: () => void;
  aoRemover: () => void;
}) {
  return (
    <li className={`tarefa ${tarefa.feita ? 'tarefa-feita' : ''}`}>
      <input
        type="checkbox"
        checked={tarefa.feita}
        onChange={aoAlternar}
        aria-label={tarefa.feita ? 'Reabrir tarefa' : 'Marcar como feita'}
      />
      <span className="tarefa-texto">{tarefa.texto}</span>
      {selo && <span className={`tag ${atrasada ? 'tag-acento' : ''}`}>{selo}</span>}
      <button
        className="botao botao-nu botao-perigo"
        onClick={aoRemover}
        aria-label="Remover tarefa"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}

/** "hoje", "ontem" ou "28/09" — o selo que a tarefa carrega no painel. */
function rotuloDia(dia: string, hoje: string): string {
  if (dia === hoje) return 'hoje';
  const ontem = new Date(`${hoje}T12:00:00`);
  ontem.setDate(ontem.getDate() - 1);
  if (dia === diaLocal(ontem)) return 'ontem';
  return diaMes(dia);
}
