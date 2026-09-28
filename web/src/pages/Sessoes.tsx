import { useEffect, useState } from 'react';
import { api, type DiaAtividade, type Estatisticas } from '../lib/api';
import { minutosHumanos, plural } from '../lib/format';
import { Heatmap } from '../components/Heatmap';
import { DetalheDia } from '../components/DetalheDia';
import { diaLocal } from '../lib/format';

type Props = { estatisticas: Estatisticas | null; aoAtualizar: () => void };

export function Sessoes({ estatisticas, aoAtualizar }: Props) {
  const [atividade, setAtividade] = useState<DiaAtividade[]>([]);
  const [selecionado, setSelecionado] = useState<string>(() => diaLocal());
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    api.atividade().then(setAtividade).catch(() => undefined);
  }, [versao]);

  if (!estatisticas) return <p className="suave">Carregando…</p>;
  const e = estatisticas;

  function recarregar() {
    setVersao((v) => v + 1);
    aoAtualizar();
  }

  return (
    <>
      {/* ---------------- métricas ---------------- */}
      <div className="metricas">
        <Metrica rotulo="Hoje" valor={minutosHumanos(e.hoje)} />
        <Metrica
          rotulo="Últimos 7 dias"
          valor={minutosHumanos(e.semana)}
          nota={`média de ${minutosHumanos(e.media_semana)}/dia`}
        />
        <Metrica
          rotulo="Total"
          valor={minutosHumanos(e.total)}
          nota={plural(e.total_sessoes, 'sessão', 'sessões')}
        />
        <Metrica
          rotulo="Dias seguidos"
          valor={String(e.dias_seguidos)}
          nota={e.dias_seguidos === 1 ? 'dia' : 'dias'}
          acento={e.dias_seguidos > 0}
        />
        <Metrica
          rotulo="Acerto em questões"
          valor={e.questoes_respondidas > 0 ? `${e.percentual_acerto}%` : '—'}
          nota={`${e.questoes_certas}/${e.questoes_respondidas} respondidas`}
        />
      </div>

      {/* ---------------- heatmap ---------------- */}
      <section className="secao">
        <h2>Atividade</h2>
        <Heatmap
          atividade={atividade}
          selecionado={selecionado}
          aoSelecionar={setSelecionado}
        />
      </section>

      {/* ---------------- detalhe do dia ---------------- */}
      <section className="secao">
        <DetalheDia dia={selecionado} aoAtualizar={recarregar} />
      </section>

      {/* ---------------- questões por matéria ---------------- */}
      <section className="secao">
        <h2>Questões por matéria</h2>
        {e.por_materia.length === 0 ? (
          <p className="suave">Nenhuma matéria cadastrada ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Matéria</th>
                <th className="num">No banco</th>
                <th className="num">Respondidas</th>
                <th className="num">Acertos</th>
                <th className="num">Acerto</th>
              </tr>
            </thead>
            <tbody>
              {e.por_materia.map((m) => (
                <tr key={m.id}>
                  <td>{m.nome}</td>
                  <td className="num">{m.questoes}</td>
                  <td className="num">{m.respondidas || '—'}</td>
                  <td className="num">{m.respondidas ? m.certas : '—'}</td>
                  <td className="num">
                    {m.acerto === null ? (
                      '—'
                    ) : (
                      <b className={m.acerto >= 70 ? 'positivo' : 'vermelho'}>{m.acerto}%</b>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Metrica({
  rotulo,
  valor,
  nota,
  acento,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  acento?: boolean;
}) {
  return (
    <div className="metrica">
      <span className="rotulo">{rotulo}</span>
      <span className={`metrica-valor ${acento ? 'vermelho' : ''}`}>{valor}</span>
      {nota && <span className="rotulo">{nota}</span>}
    </div>
  );
}
