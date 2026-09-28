import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, type DetalheDia as Detalhe } from '../lib/api';
import { dataCompleta, hhmmss, minutosHumanos, plural } from '../lib/format';

type Props = { dia: string; aoAtualizar: () => void };

/**
 * O que aconteceu num dia. As sessões não guardam matéria, então "o que foi
 * estudado" vem das questões respondidas e das provas resolvidas no dia.
 */
export function DetalheDia({ dia, aoAtualizar }: Props) {
  const [dados, setDados] = useState<Detalhe | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  function carregar() {
    setCarregando(true);
    api
      .atividadeDia(dia)
      .then((d) => {
        setDados(d);
        setErro('');
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }

  useEffect(carregar, [dia]);

  async function remover(id: number) {
    if (!confirm('Remover esta sessão do histórico?')) return;
    await api.removerSessao(id);
    carregar();
    aoAtualizar();
  }

  if (carregando && !dados) return <p className="suave">Carregando…</p>;
  if (erro) return <p className="vermelho">{erro}</p>;
  if (!dados) return null;

  const vazio =
    dados.sessoes.length === 0 && dados.materias.length === 0 && dados.provas.length === 0;

  return (
    <div className="detalhe">
      <div className="detalhe-cabecalho">
        <h3>{dataCompleta(dia)}</h3>
        {dados.minutos > 0 && (
          <span className="detalhe-total">
            {minutosHumanos(dados.minutos)} · {plural(dados.sessoes.length, 'sessão', 'sessões')}
            {dados.interrompidas > 0 && ` · ${dados.interrompidas} interrompida${dados.interrompidas === 1 ? '' : 's'}`}
          </span>
        )}
      </div>

      {vazio && <p className="suave">Nenhum registro neste dia.</p>}

      <div className="detalhe-colunas">
        {/* ---------------- sessões ---------------- */}
        {dados.sessoes.length > 0 && (
          <section>
            <span className="rotulo">Sessões</span>
            <ul className="lista">
              {dados.sessoes.map((s) => (
                <li key={s.id}>
                  <span className="lista-hora">{s.inicio.slice(11, 16)}</span>
                  <span>{minutosHumanos(s.minutos)}</span>
                  {!s.completa && <span className="vermelho">interrompida</span>}
                  <button
                    className="botao botao-nu botao-perigo lista-acao"
                    onClick={() => remover(s.id)}
                    aria-label="Remover sessão"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ---------------- o que foi estudado ---------------- */}
        {dados.materias.length > 0 && (
          <section>
            <span className="rotulo">Questões respondidas</span>
            <ul className="lista">
              {dados.materias.map((m) => {
                const validas = m.respondidas - m.anuladas;
                const pct = validas > 0 ? Math.round((m.certas / validas) * 100) : null;
                return (
                  <li key={m.materia}>
                    <span className="lista-nome">{m.materia}</span>
                    <span className="suave">{m.respondidas}</span>
                    {pct !== null && (
                      <span className={pct >= 70 ? 'positivo' : 'vermelho'}>{pct}%</span>
                    )}
                    {m.anuladas > 0 && <span className="fraco">{m.anuladas} anulada(s)</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* ---------------- provas ---------------- */}
        {dados.provas.length > 0 && (
          <section>
            <span className="rotulo">Provas resolvidas</span>
            <ul className="lista">
              {dados.provas.map((p, i) => (
                <li key={`${p.id}-${i}`}>
                  <span className="lista-nome">{p.nome}</span>
                  <span>
                    {p.acertos}/{p.total}
                  </span>
                  <span className="suave">{hhmmss(p.tempo_seg)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
