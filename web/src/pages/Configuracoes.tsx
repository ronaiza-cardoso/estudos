import { useRef, useState } from 'react';
import { Download, Save, Upload } from 'lucide-react';
import { api, type Config } from '../lib/api';
import { Campo, Aviso } from '../components/Campo';

type Props = { config: Config; aoSalvar: (novo: Config) => void };

export function Configuracoes({ config, aoSalvar }: Props) {
  const [rascunho, setRascunho] = useState<Config>(config);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const mudar = (chave: string, valor: string) =>
    setRascunho((r) => ({ ...r, [chave]: valor }));

  async function salvar() {
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      aoSalvar(await api.salvarConfig(rascunho));
      setAviso('Configurações salvas.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function exportar() {
    try {
      const dados = await api.backup();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = `estudos-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setAviso('Backup exportado.');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function importar(ev: React.ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    ev.target.value = '';
    if (!f) return;

    const substituir = confirm(
      'OK = SUBSTITUIR todos os dados atuais pelo backup.\n' +
        'Cancelar = MESCLAR, mantendo o que já existe.',
    );

    try {
      const conteudo = JSON.parse(await f.text());
      const r = await api.restaurarBackup(conteudo, substituir ? 'substituir' : 'mesclar');
      const linhas = Object.entries(r.resumo)
        .map(([t, n]) => `${t}: ${n}`)
        .join(' · ');
      setAviso(`Backup restaurado (${substituir ? 'substituição' : 'mesclagem'}). ${linhas}`);
      setErro('');
      location.reload();
    } catch (e) {
      setErro(`Falha ao importar: ${(e as Error).message}`);
    }
  }

  return (
    <>
      <h2>Configurações</h2>

      {erro && <Aviso erro>{erro}</Aviso>}
      {aviso && <Aviso>{aviso}</Aviso>}

      {/* ---------------- pomodoro ---------------- */}
      <section className="painel">
        <div className="painel-cabecalho">
          <span className="rotulo">Pomodoro</span>
        </div>
        <div className="painel-corpo coluna" style={{ gap: 'var(--esp-4)' }}>
          <div className="config-grupo">
            <Campo rotulo="Minutos de foco">
              <input
                inputMode="numeric"
                value={rascunho.foco_min ?? ''}
                onChange={(e) => mudar('foco_min', e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </Campo>
            <Campo rotulo="Minutos de pausa">
              <input
                inputMode="numeric"
                value={rascunho.pausa_min ?? ''}
                onChange={(e) => mudar('pausa_min', e.target.value.replace(/\D/g, '').slice(0, 3))}
              />
            </Campo>
            <Campo rotulo="Ciclos por bloco">
              <input
                inputMode="numeric"
                value={rascunho.ciclos_ate_pausa_longa ?? ''}
                onChange={(e) =>
                  mudar('ciclos_ate_pausa_longa', e.target.value.replace(/\D/g, '').slice(0, 2))
                }
              />
            </Campo>
          </div>

          <div className="coluna" style={{ gap: 'var(--esp-2)' }}>
            <Interruptor
              rotulo="Começar a pausa automaticamente"
              marcado={rascunho.pausa_auto === '1'}
              aoMudar={(v) => mudar('pausa_auto', v ? '1' : '0')}
            />
            <Interruptor
              rotulo="Tocar som ao terminar"
              marcado={rascunho.som_ativo === '1'}
              aoMudar={(v) => mudar('som_ativo', v ? '1' : '0')}
            />
            <Interruptor
              rotulo="Mostrar notificação do sistema"
              marcado={rascunho.notificacoes === '1'}
              aoMudar={(v) => mudar('notificacoes', v ? '1' : '0')}
            />
          </div>
        </div>
      </section>

      {/* ---------------- backup ---------------- */}
      <section className="painel">
        <div className="painel-cabecalho">
          <span className="rotulo">Backup</span>
        </div>
        <div className="painel-corpo coluna">
          <p className="suave" style={{ fontSize: 'var(--texto-p)' }}>
            O backup em JSON leva matérias, sessões, questões, respostas, anotações, provas,
            resultados e configurações.
          </p>
          <div className="linha">
            <button className="botao" onClick={exportar}>
              <Download size={15} /> Exportar backup
            </button>
            <button className="botao" onClick={() => arquivo.current?.click()}>
              <Upload size={15} /> Importar backup
            </button>
            <input
              ref={arquivo}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={importar}
            />
          </div>
        </div>
      </section>

      <div className="linha">
        <button className="botao botao-g botao-primario" onClick={salvar} disabled={salvando}>
          <Save size={16} /> {salvando ? 'Salvando…' : 'Salvar configurações'}
        </button>
      </div>
    </>
  );
}

function Interruptor({
  rotulo,
  marcado,
  aoMudar,
}: {
  rotulo: string;
  marcado: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <label className="linha" style={{ gap: 'var(--esp-2)', cursor: 'pointer' }}>
      <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} />
      <span style={{ fontSize: 'var(--texto-p)' }}>{rotulo}</span>
    </label>
  );
}
