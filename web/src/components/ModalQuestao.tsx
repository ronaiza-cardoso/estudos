import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Images, Plus, Trash2, Wand2 } from 'lucide-react';
import { Modal } from './Modal';
import { Campo, Aviso } from './Campo';
import { ModalMateria } from './ModalMateria';
import { VisualizadorPrint } from './VisualizadorPrint';
import { api, type Importacao, type ItemImportado, type Materia } from '../lib/api';
import { parseColagem } from '../lib/parseColagem';
import { ehImagem, prepararPrint } from '../lib/imagem';
import { plural } from '../lib/format';

/**
 * Cadastro de questão — a única porta de entrada do banco.
 *
 * O primeiro campo é o importador: você solta os prints da videoaula, o OCR lê,
 * e o formulário abaixo já vem preenchido para conferir. Quando o lote tem mais
 * de uma questão, o modal vira passo-a-passo: salvar leva para a próxima.
 *
 * Um lote interrompido não se perde. Ao abrir, o modal pergunta ao servidor se
 * sobrou rascunho de alguma leitura anterior e oferece continuar de onde parou
 * — é o que substitui a aba de importação sem perder o trabalho no meio.
 */

const ALFABETO = 'ABCDEFGHIJ'.split('');

/** Com o que o formulário abre. Nem toda banca usa cinco. */
const LETRAS_INICIAIS = ['A', 'B', 'C', 'D'];

const NOVA_MATERIA = '__nova__';

const INTERVALO_POLL = 1000;

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
  // As letras vivem em separado do texto: uma alternativa ainda em branco
  // precisa continuar na tela, e some do `alternativas` até ser digitada.
  const [letras, setLetras] = useState<string[]>(LETRAS_INICIAIS);
  const [gabarito, setGabarito] = useState('');
  const [anulada, setAnulada] = useState(false);

  const [lote, setLote] = useState<Importacao | null>(null);
  const [indice, setIndice] = useState(0);
  const [pendente, setPendente] = useState<Importacao | null>(null);

  const [modalMateria, setModalMateria] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const rascunhos = (lote?.itens ?? []).filter((i) => i.estado === 'rascunho');
  const item = rascunhos[indice] ?? null;

  /* ---------------------- preenchimento a partir do print ---------------------- */

  const adotar = useCallback(
    (fonte: ItemImportado) => {
      const letrasDoItem = Object.keys(fonte.alternativas).sort();
      setAlternativas(fonte.alternativas);
      setLetras(letrasDoItem.length >= 2 ? letrasDoItem : LETRAS_INICIAIS);
      setEnunciado(fonte.enunciado);
      setTextoAssoc(fonte.texto_assoc ?? '');
      setGabarito(fonte.gabarito ?? '');
      setAssunto(fonte.assunto ?? '');
      setBanca(fonte.banca ?? '');
      setAno(fonte.ano ? String(fonte.ano) : '');
      setOrgao(fonte.orgao ?? '');
      setProva(fonte.prova ?? '');
      setAnulada(false);

      // O OCR devolve o nome da matéria; o formulário trabalha com o id. Só
      // casa quando a matéria já existe — senão fica para você escolher.
      const achada = materias.find(
        (m) => m.nome.toLowerCase() === (fonte.materia ?? '').toLowerCase(),
      );
      if (achada) setMateriaId(achada.id);
    },
    [materias],
  );

  useEffect(() => {
    if (item) adotar(item);
  }, [item, adotar]);

  // Lote deixado pela metade numa sessão anterior.
  useEffect(() => {
    api
      .importacaoPendente()
      .then((r) => r.lote && setPendente(r.lote))
      .catch(() => undefined);
  }, []);

  function preencher() {
    const r = parseColagem(colagem);
    if (!r.enunciado && Object.keys(r.alternativas).length === 0) {
      setErro('Não consegui reconhecer nada. Confira se o texto tem o enunciado e as alternativas.');
      setAviso('');
      return;
    }
    if (r.enunciado) setEnunciado(r.enunciado);
    if (Object.keys(r.alternativas).length) {
      setAlternativas(r.alternativas);
      // A colagem manda nas letras: se o texto tem só três, o formulário fica
      // com três.
      setLetras(Object.keys(r.alternativas).sort());
    }
    setErro('');
    setAviso(
      `Reconhecido${r.numero ? ` — questão ${r.numero}` : ''}: ` +
        `${Object.keys(r.alternativas).length} alternativa(s).`,
    );
  }

  /* -------------------------------- salvar -------------------------------- */

  function limpar() {
    setEnunciado('');
    setAlternativas({});
    setLetras(LETRAS_INICIAIS);
    setGabarito('');
    setTextoAssoc('');
    setAnulada(false);
    setColagem('');
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

      // Veio de um print: o item sai da fila para não reaparecer depois.
      if (lote && item) {
        await api.confirmarImportacao(lote.id, { itens: [item.id] }).catch(() => undefined);

        const restantes = lote.itens.map((i) =>
          i.id === item.id ? { ...i, estado: 'importada' as const } : i,
        );
        setLote({ ...lote, itens: restantes });

        const faltam = restantes.filter((i) => i.estado === 'rascunho').length;
        if (faltam > 0) {
          // A lista encolheu, então o índice atual já aponta para a próxima.
          setIndice((i) => Math.min(i, faltam - 1));
          setAviso(`Questão salva — ${plural(faltam, 'ainda na fila', 'ainda na fila')}.`);
          return;
        }
      }

      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const emFila = rascunhos.length;

  return (
    <>
      <Modal
        largo
        titulo="Cadastrar questão"
        aoFechar={aoFechar}
        rodape={
          <>
            {emFila > 1 && (
              <button
                className="botao"
                onClick={() => setIndice((i) => (i + 1) % emFila)}
                title="Deixar esta para depois"
              >
                Pular <ChevronRight size={14} />
              </button>
            )}
            <button className="botao" onClick={aoFechar}>
              Fechar
            </button>
            <button className="botao botao-primario" onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : emFila > 1 ? 'Salvar e ir para a próxima' : 'Salvar questão'}
            </button>
          </>
        }
      >
        <div className="coluna" style={{ gap: 'var(--esp-4)' }}>
          {/* ---------- importador: o primeiro campo ---------- */}
          <Importador
            lote={lote}
            pendente={pendente}
            indice={indice}
            total={emFila}
            aoLer={(novo) => {
              setLote(novo);
              setIndice(0);
              setPendente(null);
              setErro('');
            }}
            aoRetomar={() => {
              if (!pendente) return;
              setLote(pendente);
              setIndice(0);
              setPendente(null);
            }}
            aoDispensarPendente={() => setPendente(null)}
            aoLimpar={() => {
              setLote(null);
              setIndice(0);
              limpar();
            }}
            aoErro={setErro}
          />

          {item && lote && (
            <div className="painel-print">
              <VisualizadorPrint importacaoId={lote.id} arquivos={item.arquivos} />
              <span className="dica">
                Confira contra o print — o OCR troca <code>I</code> por <code>|</code> e perde
                acento de vez em quando.{item.observacao ? ` ${item.observacao}` : ''}
              </span>
            </div>
          )}

          {/* ---------- colagem ---------- */}
          <div className="painel">
            <div className="painel-cabecalho">
              <span className="rotulo">Ou cole o texto da questão</span>
              <button className="botao botao-p" onClick={preencher} disabled={!colagem.trim()}>
                <Wand2 size={13} /> Preencher campos
              </button>
            </div>
            <textarea
              className="entrada"
              rows={3}
              value={colagem}
              onChange={(e) => setColagem(e.target.value)}
              placeholder={'QUESTÃO 12\nQual é a capital do Brasil?\n(A) São Paulo\n(B) Brasília\n…'}
            />
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
            <div className="linha" style={{ justifyContent: 'space-between' }}>
              <span className="rotulo">Alternativas</span>
              <span className="rotulo">
                {anulada ? 'questão anulada' : gabarito ? `gabarito ${gabarito}` : 'sem gabarito'}
              </span>
            </div>

            {letras.map((letra) => {
              const correta = !anulada && gabarito === letra;
              return (
                <div className="linha linha-alternativa" key={letra}>
                  {/* A própria letra marca o gabarito: é onde a mão já está. */}
                  <button
                    type="button"
                    className={`alternativa-letra letra-botao ${correta ? 'letra-certa' : ''}`}
                    disabled={anulada}
                    onClick={() => setGabarito(correta ? '' : letra)}
                    title={correta ? 'Desmarcar o gabarito' : `Marcar ${letra} como gabarito`}
                    aria-pressed={correta}
                  >
                    {correta ? <Check size={14} /> : letra}
                  </button>

                  <input
                    className="entrada"
                    placeholder={`Alternativa ${letra}`}
                    value={alternativas[letra] ?? ''}
                    onChange={(e) =>
                      setAlternativas((a) => ({ ...a, [letra]: e.target.value }))
                    }
                  />

                  <button
                    type="button"
                    className="botao botao-p botao-perigo"
                    disabled={letras.length <= 2}
                    title={
                      letras.length <= 2
                        ? 'Uma questão precisa de ao menos duas alternativas.'
                        : `Tirar a alternativa ${letra}`
                    }
                    aria-label={`Tirar a alternativa ${letra}`}
                    onClick={() => {
                      setLetras((l) => l.filter((x) => x !== letra));
                      setAlternativas((a) => {
                        const { [letra]: _fora, ...resto } = a;
                        return resto;
                      });
                      if (gabarito === letra) setGabarito('');
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}

            <div className="linha">
              <button
                type="button"
                className="botao botao-p"
                disabled={letras.length >= ALFABETO.length}
                onClick={() => {
                  const proxima = ALFABETO.find((l) => !letras.includes(l));
                  if (proxima) setLetras((l) => [...l, proxima]);
                }}
              >
                <Plus size={13} /> Adicionar alternativa
              </button>
              <span className="dica">
                Clique na letra para marcar o gabarito. Duas alternativas já bastam.
              </span>
            </div>
          </div>

          {/* ---------- anulada ---------- */}
          <div className="linha" style={{ gap: 'var(--esp-4)' }}>
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

/* ====================================================================== */

/** Primeiro campo do cadastro: solta os prints e o resto vem preenchido. */
function Importador({
  lote,
  pendente,
  indice,
  total,
  aoLer,
  aoRetomar,
  aoDispensarPendente,
  aoLimpar,
  aoErro,
}: {
  lote: Importacao | null;
  pendente: Importacao | null;
  indice: number;
  total: number;
  aoLer: (lote: Importacao) => void;
  aoRetomar: () => void;
  aoDispensarPendente: () => void;
  aoLimpar: () => void;
  aoErro: (mensagem: string) => void;
}) {
  const [lendo, setLendo] = useState(false);
  const [progresso, setProgresso] = useState({ feitos: 0, total: 0 });
  const entrada = useRef<HTMLInputElement>(null);

  async function escolher(lista: FileList | null) {
    if (!lista?.length) return;
    const imagens = [...lista].filter(ehImagem);

    if (imagens.length === 0) {
      aoErro(
        [...lista].some((a) => a.type === 'application/pdf')
          ? 'PDF de prova precisa do gabarito junto, com cargo e tipo. Use `npm run import`.'
          : 'Escolha prints de imagem (.png, .jpg, .webp).',
      );
      return;
    }

    setLendo(true);
    setProgresso({ feitos: 0, total: imagens.length });
    aoErro('');

    try {
      const preparados = await Promise.all(imagens.map(prepararPrint));
      const { id } = await api.criarImportacao(
        '',
        preparados.map(({ nome, mime, base64 }) => ({ nome, mime, base64 })),
      );

      // Espera a leitura inteira: o gabarito costuma vir num frame posterior,
      // e preencher o formulário antes disso mostraria a questão sem resposta.
      for (;;) {
        const atual = await api.importacao(id);
        setProgresso({ feitos: atual.processados, total: atual.total });

        if (atual.estado !== 'processando') {
          if (atual.itens.length === 0) {
            aoErro(
              atual.erro ??
                'Nenhuma questão reconhecida nestes prints. Slides de abertura são descartados.',
            );
          } else {
            aoLer(atual);
          }
          return;
        }
        await new Promise((r) => setTimeout(r, INTERVALO_POLL));
      }
    } catch (e) {
      aoErro((e as Error).message);
    } finally {
      setLendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <div className="painel">
      <div className="painel-cabecalho">
        <span className="rotulo">Importar de print</span>
        {total > 1 && (
          <span className="rotulo">
            questão {indice + 1} de {total}
          </span>
        )}
        {lote && (
          <button className="botao botao-p" onClick={aoLimpar}>
            Descartar leitura
          </button>
        )}
      </div>

      {pendente && !lote && (
        <div className="aviso linha" style={{ justifyContent: 'space-between' }}>
          <span>
            Sobraram {plural(pendente.itens.length, 'questão', 'questões')} de uma leitura
            anterior.
          </span>
          <div className="linha" style={{ gap: 'var(--esp-2)' }}>
            <button className="botao botao-p botao-primario" onClick={aoRetomar}>
              Continuar
            </button>
            <button className="botao botao-p" onClick={aoDispensarPendente}>
              Agora não
            </button>
          </div>
        </div>
      )}

      {lendo && (
        <div className="coluna" style={{ gap: 'var(--esp-2)' }}>
          <div className="barra-progresso" aria-hidden>
            <div
              className="barra-progresso-preenchida"
              style={{
                width: `${Math.round((progresso.feitos / Math.max(1, progresso.total)) * 100)}%`,
              }}
            />
          </div>
          <span className="rotulo">
            Lendo {progresso.feitos}/{progresso.total} prints…
          </span>
        </div>
      )}

      {!lendo && !lote && (
        <div
          className="area-solta"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void escolher(e.dataTransfer.files);
          }}
        >
          <Images size={24} className="suave" />
          <p>
            Arraste os prints aqui, ou{' '}
            <button className="botao botao-nu sublinhado" onClick={() => entrada.current?.click()}>
              escolha os arquivos
            </button>
            .
          </p>
          <span className="dica">
            Mande todos os frames da mesma questão — o limpo, o anotado e o do gabarito. Eles se
            juntam sozinhos, e o gabarito sai da alternativa que o slide pinta de vermelho.
          </span>
          <input
            ref={entrada}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void escolher(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
