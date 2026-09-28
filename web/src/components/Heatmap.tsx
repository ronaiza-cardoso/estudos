import { useMemo, useState } from 'react';
import type { DiaAtividade } from '../lib/api';
import { minutosHumanos, plural } from '../lib/format';

/** 53 semanas, como no GitHub. */
const SEMANAS = 53;
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

type Celula = { dia: string; data: Date; minutos: number; sessoes: number; futuro: boolean };

type Props = {
  atividade: DiaAtividade[];
  selecionado: string | null;
  aoSelecionar: (dia: string) => void;
};

function chave(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 0 = sem estudo; 1 a 4 conforme o tempo do dia. */
function nivel(minutos: number): number {
  if (minutos <= 0) return 0;
  if (minutos < 30) return 1;
  if (minutos < 60) return 2;
  if (minutos < 120) return 3;
  return 4;
}

export function Heatmap({ atividade, selecionado, aoSelecionar }: Props) {
  const [dica, setDica] = useState<{ x: number; y: number; texto: string } | null>(null);

  const { semanas, rotulosMes } = useMemo(() => {
    const porDia = new Map(atividade.map((a) => [a.dia, a]));

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // O grid termina no sábado da semana atual e começa 53 semanas antes,
    // sempre num domingo — assim as colunas ficam alinhadas por semana.
    const fim = new Date(hoje);
    fim.setDate(fim.getDate() + (6 - fim.getDay()));

    const inicio = new Date(fim);
    inicio.setDate(inicio.getDate() - (SEMANAS * 7 - 1));

    const colunas: Celula[][] = [];
    const marcas: { coluna: number; texto: string }[] = [];
    let mesAnterior = -1;

    const cursor = new Date(inicio);
    for (let c = 0; c < SEMANAS; c++) {
      const coluna: Celula[] = [];
      for (let d = 0; d < 7; d++) {
        const dia = chave(cursor);
        const registro = porDia.get(dia);
        coluna.push({
          dia,
          data: new Date(cursor),
          minutos: registro?.minutos ?? 0,
          sessoes: registro?.sessoes ?? 0,
          futuro: cursor > hoje,
        });

        // O rótulo do mês entra na coluna onde o mês vira.
        if (d === 0 && cursor.getMonth() !== mesAnterior) {
          mesAnterior = cursor.getMonth();
          marcas.push({ coluna: c, texto: MESES[mesAnterior] });
        }

        cursor.setDate(cursor.getDate() + 1);
      }
      colunas.push(coluna);
    }

    // Dois rótulos colados se sobrepõem. Quando isso acontece, fica o da
    // direita: o mês da esquerda aparece com poucos dias na borda do grid.
    const visiveis = marcas.filter(
      (m, i) => i === marcas.length - 1 || marcas[i + 1].coluna - m.coluna >= 3,
    );

    return { semanas: colunas, rotulosMes: visiveis };
  }, [atividade]);

  const hojeChave = chave(new Date());

  return (
    <div className="heatmap">
      <div className="heatmap-rolagem">
        <div className="heatmap-interno">
          {/* rótulos de mês */}
          <div className="heatmap-meses">
            {rotulosMes.map((m) => (
              <span key={`${m.texto}-${m.coluna}`} style={{ gridColumn: m.coluna + 1 }}>
                {m.texto}
              </span>
            ))}
          </div>

          <div className="heatmap-corpo">
            {/* dias da semana */}
            <div className="heatmap-dias">
              {DIAS_SEMANA.map((d, i) => (
                <span key={d}>{i % 2 === 1 ? d : ''}</span>
              ))}
            </div>

            <div className="heatmap-grade">
              {semanas.map((coluna, c) => (
                <div className="heatmap-coluna" key={c}>
                  {coluna.map((celula) => {
                    if (celula.futuro) {
                      return <span className="heatmap-celula heatmap-vazia" key={celula.dia} />;
                    }

                    const texto =
                      celula.minutos > 0
                        ? `${minutosHumanos(celula.minutos)} em ${plural(celula.sessoes, 'sessão', 'sessões')}`
                        : 'sem estudo';

                    return (
                      <button
                        key={celula.dia}
                        type="button"
                        className={[
                          'heatmap-celula',
                          `heatmap-n${nivel(celula.minutos)}`,
                          celula.dia === hojeChave ? 'heatmap-hoje' : '',
                          celula.dia === selecionado ? 'heatmap-selecionada' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => aoSelecionar(celula.dia)}
                        onMouseEnter={(ev) => {
                          const r = ev.currentTarget.getBoundingClientRect();
                          setDica({
                            x: r.left + r.width / 2,
                            y: r.top,
                            texto: `${celula.data.toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })} — ${texto}`,
                          });
                        }}
                        onMouseLeave={() => setDica(null)}
                        aria-label={`${celula.dia}: ${texto}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="heatmap-legenda">
        <span className="rotulo">Clique num dia para ver o detalhe</span>
        <div className="heatmap-escala">
          <span className="rotulo">menos</span>
          {[0, 1, 2, 3, 4].map((n) => (
            <span key={n} className={`heatmap-celula heatmap-n${n}`} />
          ))}
          <span className="rotulo">mais</span>
        </div>
      </div>

      {dica && (
        <div className="heatmap-dica" style={{ left: dica.x, top: dica.y }}>
          {dica.texto}
        </div>
      )}
    </div>
  );
}
