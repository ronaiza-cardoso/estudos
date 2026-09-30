import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  FileText,
  ListChecks,
  LogOut,
  Settings,
  Timer,
  X,
} from 'lucide-react';
import {
  api,
  observarSessao,
  type Config,
  type EstadoLogin,
  type Estatisticas,
  type Licenca,
  type Materia,
} from './lib/api';
import { plural } from './lib/format';
import { Login } from './pages/Login';
import { Pomodoro } from './pages/Pomodoro';
import { Sessoes } from './pages/Sessoes';
import { Questoes } from './pages/Questoes';
import { Provas } from './pages/Provas';
import { Configuracoes } from './pages/Configuracoes';

type Aba = 'pomodoro' | 'sessoes' | 'questoes' | 'provas' | 'config';

const ABAS: { id: Aba; nome: string; icone: typeof Timer }[] = [
  { id: 'pomodoro', nome: 'Pomodoro', icone: Timer },
  { id: 'sessoes', nome: 'Sessões', icone: BarChart3 },
  { id: 'questoes', nome: 'Questões', icone: ListChecks },
  { id: 'provas', nome: 'Provas', icone: FileText },
  { id: 'config', nome: 'Config', icone: Settings },
];

export function App() {
  const [aba, setAba] = useState<Aba>('pomodoro');
  // null enquanto não sabemos se há login: nada é carregado antes disso.
  const [sessao, setSessao] = useState<EstadoLogin | null>(null);
  const [avisoSessao, setAvisoSessao] = useState('');
  const [materias, setMaterias] = useState<Materia[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [estatisticas, setEstatisticas] = useState<Estatisticas | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [nomeProva, setNomeProva] = useState('');
  const [erro, setErro] = useState('');
  const [emFoco, setEmFoco] = useState(false);
  const [licencas, setLicencas] = useState<Licenca[]>([]);

  const carregarMaterias = useCallback(() => {
    api.materias().then(setMaterias).catch((e) => setErro((e as Error).message));
  }, []);

  const carregarSessoes = useCallback(() => {
    api.estatisticas().then(setEstatisticas).catch((e) => setErro((e as Error).message));
  }, []);

  // Primeiro passo sempre: descobrir se o login está ligado e se já entramos.
  useEffect(() => {
    api.sessao()
      .then(setSessao)
      .catch((e) => setErro((e as Error).message));
  }, []);

  /**
   * Qualquer 401 vindo de qualquer chamada cai aqui — inclusive no meio do uso,
   * se a sessão vencer. Descartamos o `config` para que os dados sejam
   * recarregados do zero no próximo login.
   */
  useEffect(() => {
    observarSessao(() => {
      setSessao((atual) =>
        atual ? { ...atual, autenticado: false, usuario: null } : atual,
      );
      setConfig(null);
      setAvisoSessao('Sua sessão expirou. Entre novamente.');
    });
    return () => observarSessao(null);
  }, []);

  const autenticado = sessao ? !sessao.login_ativo || sessao.autenticado : false;

  // Os dados do app só são buscados depois de autenticado: antes disso a API
  // responderia 401 e a tela de login ficaria coberta de erros.
  useEffect(() => {
    if (!autenticado) return;
    carregarMaterias();
    carregarSessoes();
    api.config().then(setConfig).catch((e) => setErro((e as Error).message));
    // O carimbo das licenças é enfeite: falhar aqui não pode derrubar o app.
    api.licencas().then(setLicencas).catch(() => setLicencas([]));
  }, [autenticado, carregarMaterias, carregarSessoes]);

  // Responder questões e resolver provas mexem nas estatísticas, então elas
  // são recarregadas sempre que a aba de sessões volta a ficar visível.
  useEffect(() => {
    if (aba === 'sessoes') carregarSessoes();
  }, [aba, carregarSessoes]);

  const alternarSelecao = useCallback((id: string, marcada: boolean) => {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (marcada) novo.add(id);
      else novo.delete(id);
      return novo;
    });
  }, []);

  async function sair() {
    try {
      await api.logout();
    } catch {
      // Se o logout falhar, o cookie pode continuar de pé no servidor; ainda
      // assim voltamos para a tela de login, que é o que o usuário pediu.
    }
    setConfig(null);
    setErro('');
    setAvisoSessao('');
    setSessao(await api.sessao());
  }

  async function gerarProva() {
    const nome = nomeProva.trim() || `Prova de ${new Date().toLocaleDateString('pt-BR')}`;
    try {
      await api.criarProva(nome, [...selecionadas]);
      setSelecionadas(new Set());
      setNomeProva('');
      setAba('provas');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!sessao) {
    return (
      <div className="app">
        <div className="vazio">{erro || 'Conectando ao servidor…'}</div>
      </div>
    );
  }

  if (sessao.login_ativo && !sessao.autenticado) {
    return (
      <Login
        configurado={sessao.configurado}
        avisoInicial={avisoSessao}
        aoEntrar={(novo) => {
          setAvisoSessao('');
          setErro('');
          setSessao(novo);
        }}
      />
    );
  }

  if (!config) {
    return (
      <div className="app">
        <div className="vazio">{erro || 'Carregando…'}</div>
      </div>
    );
  }

  const mostraBarra = selecionadas.size > 0 && aba === 'questoes';

  return (
    <div className={`app ${emFoco ? 'app-foco' : ''}`}>
      {!emFoco && (
        <header className="topo">
          <div className="topo-interno">
            <div className="marca">
              <span className="marca-ponto" />
              Estudos
            </div>

            {/*
              Carimbo do pacote comprado. Fica no topo, visível em qualquer
              aba: é o que faz repassar o arquivo custar o próprio nome.
            */}
            {licencas.length > 0 && (
              <span className="carimbo" title={licencas.map((l) => l.banco).join(' · ')}>
                Licenciado para {licencas[0].para}
              </span>
            )}

            <nav className="abas">
              {ABAS.map(({ id, nome, icone: Icone }) => (
                <button
                  key={id}
                  className={`aba ${aba === id ? 'aba-ativa' : ''}`}
                  onClick={() => setAba(id)}
                >
                  <Icone size={15} />
                  {nome}
                </button>
              ))}
            </nav>

            {/* Só existe quando o login está ligado — no desktop não aparece. */}
            {sessao.login_ativo && (
              <button
                className="aba aba-sair"
                onClick={sair}
                title={sessao.usuario ? `Sair de ${sessao.usuario.login}` : 'Sair'}
              >
                <LogOut size={15} />
                Sair
              </button>
            )}
          </div>
        </header>
      )}

      <main className={`conteudo ${mostraBarra ? 'conteudo-com-barra' : ''}`}>
        {!emFoco && erro && (
          <div className="aviso aviso-erro linha" style={{ justifyContent: 'space-between' }}>
            {erro}
            <button className="botao botao-nu" onClick={() => setErro('')} aria-label="Fechar">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Sempre montado: desmontar o Pomodoro abortaria o ciclo em curso. */}
        <div className={aba === 'pomodoro' || emFoco ? 'aba-visivel' : 'aba-oculta'}>
          <Pomodoro
            config={config}
            aoSalvarSessao={carregarSessoes}
            aoMudarFoco={setEmFoco}
          />
        </div>

        {!emFoco && aba === 'sessoes' && (
          <Sessoes estatisticas={estatisticas} aoAtualizar={carregarSessoes} />
        )}

        {!emFoco && aba === 'questoes' && (
          <Questoes
            materias={materias}
            selecionadas={selecionadas}
            aoSelecionar={alternarSelecao}
            aoAtualizarMaterias={carregarMaterias}
          />
        )}

        {!emFoco && aba === 'provas' && <Provas materias={materias} aoAtualizar={carregarSessoes} />}

        {!emFoco && aba === 'config' && (
          <Configuracoes
            config={config}
            aoSalvar={setConfig}
            login={{ ativo: sessao.login_ativo, sessoes: sessao.sessoes }}
          />
        )}
      </main>

      {/* Barra fixa: aparece assim que há questões marcadas no banco. */}
      {!emFoco && mostraBarra && (
        <div className="barra-prova">
          <div className="barra-prova-interno">
            <span className="barra-prova-contador">
              {plural(selecionadas.size, 'questão selecionada', 'questões selecionadas')}
            </span>
            <input
              type="text"
              value={nomeProva}
              onChange={(e) => setNomeProva(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && gerarProva()}
              placeholder="Nome da prova"
            />
            <button className="botao" onClick={gerarProva}>
              <FileText size={15} /> Gerar prova
            </button>
            <button
              className="botao"
              onClick={() => setSelecionadas(new Set())}
              aria-label="Limpar seleção"
            >
              <X size={15} /> Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
