import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { api, type Materia, type Questao } from '../lib/api';
import { QuestaoCard } from '../components/QuestaoCard';
import { ModalQuestao } from '../components/ModalQuestao';
import { Campo } from '../components/Campo';
import { plural } from '../lib/format';

const POR_PAGINA = 10;

const SITUACOES = [
  { valor: '', nome: 'Todas' },
  { valor: 'nao_respondidas', nome: 'Não respondidas' },
  { valor: 'errei_ultima', nome: 'Errei na última' },
  { valor: 'agendadas', nome: 'Marcadas para depois' },
  { valor: 'com_anotacoes', nome: 'Com anotações' },
  { valor: 'selecionadas', nome: 'Selecionadas' },
];

type Props = {
  materias: Materia[];
  selecionadas: Set<string>;
  aoSelecionar: (id: string, marcada: boolean) => void;
  aoAtualizarMaterias: () => void;
};

export function Questoes({
  materias,
  selecionadas,
  aoSelecionar,
  aoAtualizarMaterias,
}: Props) {
  const [materiaId, setMateriaId] = useState('');
  const [situacao, setSituacao] = useState('');
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [pagina, setPagina] = useState(0);

  const [questoes, setQuestoes] = useState<Questao[]>([]);
  const [total, setTotal] = useState(0);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [modal, setModal] = useState(false);
  const [versao, setVersao] = useState(0);

  // A busca só vai ao servidor depois que o usuário para de digitar.
  useEffect(() => {
    const id = window.setTimeout(() => setBuscaAplicada(busca), 350);
    return () => window.clearTimeout(id);
  }, [busca]);

  useEffect(() => setPagina(0), [materiaId, situacao, buscaAplicada]);

  const idsSelecionados = useMemo(() => [...selecionadas].join(','), [selecionadas]);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);

    api
      .questoes({
        materia_id: materiaId || undefined,
        situacao: situacao || undefined,
        busca: buscaAplicada || undefined,
        ids: situacao === 'selecionadas' ? idsSelecionados : undefined,
        limite: POR_PAGINA,
        offset: pagina * POR_PAGINA,
      })
      .then((r) => {
        if (cancelado) return;
        setQuestoes(r.questoes);
        setTotal(r.total);
        setErro('');
      })
      .catch((e) => !cancelado && setErro((e as Error).message))
      .finally(() => !cancelado && setCarregando(false));

    return () => {
      cancelado = true;
    };
    // `idsSelecionados` só importa quando o filtro "selecionadas" está ativo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materiaId, situacao, buscaAplicada, pagina, versao, situacao === 'selecionadas' ? idsSelecionados : '']);

  useEffect(() => {
    api
      .contagemQuestoes()
      .then((r) =>
        setContagem(Object.fromEntries(r.por_materia.map((m) => [String(m.id), m.total]))),
      )
      .catch(() => undefined);
  }, [versao]);

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const recarregar = () => setVersao((v) => v + 1);

  return (
    <>
      <div className="secao-titulo">
        <h2>Banco de questões</h2>
        <button className="botao botao-primario" onClick={() => setModal(true)}>
          <Plus size={15} /> Cadastrar questão
        </button>
      </div>

      {/* ---------------- filtros ---------------- */}
      <div className="filtros">
        <Campo rotulo="Matéria">
          <select value={materiaId} onChange={(e) => setMateriaId(e.target.value)}>
            <option value="">Todas as matérias</option>
            {materias.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome} ({contagem[String(m.id)] ?? 0})
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Situação">
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
            {SITUACOES.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.nome}
                {s.valor === 'selecionadas' ? ` (${selecionadas.size})` : ''}
              </option>
            ))}
          </select>
        </Campo>

        <Campo rotulo="Buscar no enunciado">
          <div className="linha" style={{ flexWrap: 'nowrap', gap: 'var(--esp-2)' }}>
            <Search size={15} className="suave" />
            <input
              className="entrada"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Palavra ou trecho…"
            />
          </div>
        </Campo>
      </div>

      {/* ---------------- resultado ---------------- */}
      <div className="linha" style={{ justifyContent: 'space-between' }}>
        <span className="rotulo">
          {carregando ? 'Carregando…' : plural(total, 'questão', 'questões')}
        </span>
        {paginas > 1 && (
          <div className="linha" style={{ gap: 'var(--esp-2)' }}>
            <button
              className="botao botao-p"
              onClick={() => setPagina((p) => Math.max(0, p - 1))}
              disabled={pagina === 0}
            >
              <ChevronLeft size={13} /> Anterior
            </button>
            <span className="rotulo">
              {pagina + 1} / {paginas}
            </span>
            <button
              className="botao botao-p"
              onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))}
              disabled={pagina >= paginas - 1}
            >
              <ChevronRight size={13} /> Próxima
            </button>
          </div>
        )}
      </div>

      {erro && <div className="aviso aviso-erro">{erro}</div>}

      {!carregando && questoes.length === 0 && !erro && (
        <div className="painel vazio">Nenhuma questão para esses filtros.</div>
      )}

      <div className="coluna" style={{ gap: 'var(--esp-4)' }}>
        {questoes.map((q, i) => (
          <QuestaoCard
            key={q.id}
            questao={q}
            numero={pagina * POR_PAGINA + i + 1}
            selecionada={selecionadas.has(q.id)}
            aoSelecionar={aoSelecionar}
            aoAtualizar={recarregar}
          />
        ))}
      </div>

      {modal && (
        <ModalQuestao
          materias={materias}
          aoFechar={() => setModal(false)}
          aoSalvar={recarregar}
          aoAtualizarMaterias={aoAtualizarMaterias}
        />
      )}
    </>
  );
}
