import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Modal } from './Modal';
import { Campo, Aviso } from './Campo';
import { ModalMateria } from './ModalMateria';
import { api, type Materia } from '../lib/api';
import { parseColagem } from '../lib/parseColagem';

const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const NOVA_MATERIA = '__nova__';

type Props = {
  materias: Materia[];
  aoFechar: () => void;
  aoSalvar: () => void;
  aoAtualizarMaterias: () => void;
};

export function ModalQuestao({ materias, aoFechar, aoSalvar, aoAtualizarMaterias }: Props) {
  const [colagem, setColagem] = useState('');
  const [materiaId, setMateriaId] = useState<number | ''>('');
  const [assunto, setAssunto] = useState('');
  const [banca, setBanca] = useState('');
  const [ano, setAno] = useState('');
  const [orgao, setOrgao] = useState('');
  const [prova, setProva] = useState('');
  const [textoAssoc, setTextoAssoc] = useState('');
  const [enunciado, setEnunciado] = useState('');
  const [alternativas, setAlternativas] = useState<Record<string, string>>({});
  const [gabarito, setGabarito] = useState('');
  const [anulada, setAnulada] = useState(false);

  const [modalMateria, setModalMateria] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  function preencher() {
    const r = parseColagem(colagem);
    if (!r.enunciado && Object.keys(r.alternativas).length === 0) {
      setErro('Não consegui reconhecer nada. Confira se o texto tem o enunciado e as alternativas.');
      setAviso('');
      return;
    }
    if (r.enunciado) setEnunciado(r.enunciado);
    if (Object.keys(r.alternativas).length) setAlternativas(r.alternativas);
    setErro('');
    setAviso(
      `Reconhecido${r.numero ? ` — questão ${r.numero}` : ''}: ` +
        `${Object.keys(r.alternativas).length} alternativa(s).`,
    );
  }

  async function salvar() {
    setErro('');
    if (materiaId === '') return setErro('Escolha uma matéria.');
    if (!enunciado.trim()) return setErro('O enunciado é obrigatório.');

    const preenchidas = Object.entries(alternativas).filter(([, v]) => v?.trim());
    if (preenchidas.length < 2) return setErro('Preencha ao menos duas alternativas.');
    if (!anulada && !gabarito) return setErro('Informe o gabarito ou marque a questão como anulada.');
    if (!anulada && !preenchidas.some(([l]) => l === gabarito))
      return setErro('O gabarito precisa apontar para uma alternativa preenchida.');

    setSalvando(true);
    try {
      await api.criarQuestao({
        materia_id: materiaId,
        assunto,
        banca,
        ano: ano ? Number(ano) : null,
        orgao,
        prova,
        texto_assoc: textoAssoc,
        enunciado,
        alternativas: Object.fromEntries(preenchidas),
        gabarito,
        anulada,
      });
      aoSalvar();
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Modal
        largo
        titulo="Cadastrar questão"
        aoFechar={aoFechar}
        rodape={
          <>
            <button className="botao" onClick={aoFechar}>
              Cancelar
            </button>
            <button className="botao botao-primario" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar questão'}
            </button>
          </>
        }
      >
        <div className="coluna" style={{ gap: 'var(--esp-4)' }}>
          {/* ---------- colagem ---------- */}
          <div className="painel">
            <div className="painel-cabecalho">
              <span className="rotulo">Colar questão</span>
              <button className="botao botao-p" onClick={preencher} disabled={!colagem.trim()}>
                <Wand2 size={13} /> Preencher campos
              </button>
            </div>
            <div className="painel-corpo">
              <textarea
                className="entrada"
                style={{ minHeight: 130 }}
                value={colagem}
                onChange={(e) => setColagem(e.target.value)}
                placeholder={'QUESTÃO 12\nQual é a capital do Brasil?\n(A) São Paulo\n(B) Brasília\n…'}
              />
            </div>
          </div>

          {/* ---------- identificação ---------- */}
          <div className="config-grupo">
            <Campo rotulo="Matéria">
              <select
                value={materiaId}
                onChange={(e) => {
                  if (e.target.value === NOVA_MATERIA) return setModalMateria(true);
                  setMateriaId(e.target.value === '' ? '' : Number(e.target.value));
                }}
              >
                <option value="">Selecione…</option>
                {materias.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
                <option value={NOVA_MATERIA}>+ Cadastrar nova matéria</option>
              </select>
            </Campo>

            <Campo rotulo="Assunto">
              <input value={assunto} onChange={(e) => setAssunto(e.target.value)} />
            </Campo>
            <Campo rotulo="Banca">
              <input value={banca} onChange={(e) => setBanca(e.target.value)} />
            </Campo>
            <Campo rotulo="Ano">
              <input
                inputMode="numeric"
                value={ano}
                onChange={(e) => setAno(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </Campo>
            <Campo rotulo="Órgão">
              <input value={orgao} onChange={(e) => setOrgao(e.target.value)} />
            </Campo>
            <Campo rotulo="Prova">
              <input value={prova} onChange={(e) => setProva(e.target.value)} />
            </Campo>
          </div>

          <Campo rotulo="Texto associado (opcional)">
            <textarea value={textoAssoc} onChange={(e) => setTextoAssoc(e.target.value)} />
          </Campo>

          <Campo rotulo="Enunciado">
            <textarea value={enunciado} onChange={(e) => setEnunciado(e.target.value)} />
          </Campo>

          {/* ---------- alternativas ---------- */}
          <div className="coluna" style={{ gap: 'var(--esp-2)' }}>
            <span className="rotulo">Alternativas</span>
            {LETRAS.map((letra) => (
              <div className="linha" key={letra} style={{ flexWrap: 'nowrap' }}>
                <span className="alternativa-letra">{letra}</span>
                <input
                  className="entrada"
                  value={alternativas[letra] ?? ''}
                  onChange={(e) =>
                    setAlternativas((a) => ({ ...a, [letra]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          {/* ---------- gabarito ---------- */}
          <div className="linha" style={{ gap: 'var(--esp-4)' }}>
            <Campo rotulo="Gabarito">
              <select
                value={gabarito}
                disabled={anulada}
                onChange={(e) => setGabarito(e.target.value)}
              >
                <option value="">—</option>
                {LETRAS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Campo>

            <label className="linha" style={{ gap: 'var(--esp-2)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={anulada}
                onChange={(e) => {
                  setAnulada(e.target.checked);
                  if (e.target.checked) setGabarito('');
                }}
              />
              <span className="rotulo">Questão anulada</span>
            </label>
          </div>

          {aviso && <Aviso>{aviso}</Aviso>}
          {erro && <Aviso erro>{erro}</Aviso>}
        </div>
      </Modal>

      {modalMateria && (
        <ModalMateria
          aoFechar={() => setModalMateria(false)}
          aoCriar={(id) => {
            aoAtualizarMaterias();
            setMateriaId(id);
          }}
        />
      )}
    </>
  );
}
