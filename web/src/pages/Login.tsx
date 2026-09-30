import { useState } from 'react';
import { KeyRound, LogIn, UserPlus } from 'lucide-react';
import { api, type EstadoLogin } from '../lib/api';
import { Campo, Aviso } from '../components/Campo';

type Props = {
  /** Falso na primeira vez: a tela vira cadastro da conta. */
  configurado: boolean;
  aoEntrar: (estado: EstadoLogin) => void;
  /** Mensagem herdada de uma sessão que expirou no meio do uso. */
  avisoInicial?: string;
};

/**
 * Tela única de entrada. Com conta criada é login; sem conta, é o cadastro do
 * primeiro acesso — a rota do servidor se fecha sozinha depois disso, então
 * não existe o risco de alguém se cadastrar por cima.
 */
export function Login({ configurado, aoEntrar, avisoInicial }: Props) {
  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cadastro = !configurado;

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro('');

    if (cadastro && senha !== confirmacao) {
      setErro('As senhas não conferem.');
      return;
    }

    setEnviando(true);
    try {
      if (cadastro) await api.primeiroAcesso(login, senha);
      else await api.login(login, senha);
      // Relemos o estado em vez de montá-lo aqui: é o servidor que manda.
      aoEntrar(await api.sessao());
    } catch (e) {
      setErro((e as Error).message);
      setSenha('');
      setConfirmacao('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login">
      <form className="login-caixa" onSubmit={enviar}>
        <div className="marca login-marca">
          <span className="marca-ponto" />
          Estudos
        </div>

        <h1 className="login-titulo">{cadastro ? 'Criar acesso' : 'Entrar'}</h1>
        <p className="suave login-texto">
          {cadastro
            ? 'Primeiro acesso: escolha o usuário e a senha que vão destrancar o app.'
            : 'Informe seu usuário e senha para continuar.'}
        </p>

        {erro && <Aviso erro>{erro}</Aviso>}
        {!erro && avisoInicial && <Aviso erro>{avisoInicial}</Aviso>}

        <Campo rotulo="Usuário">
          <input
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Campo>

        <Campo rotulo="Senha">
          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            autoComplete={cadastro ? 'new-password' : 'current-password'}
            required
          />
        </Campo>

        {cadastro && (
          <Campo rotulo="Repita a senha">
            <input
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Campo>
        )}

        {cadastro && (
          <p className="fraco login-dica">
            Mínimo de 8 caracteres. Não há recuperação por e-mail: se esquecer, a senha é
            redefinida direto no banco.
          </p>
        )}

        <button className="botao botao-g botao-primario botao-bloco" disabled={enviando}>
          {cadastro ? <UserPlus size={16} /> : <LogIn size={16} />}
          {enviando ? 'Aguarde…' : cadastro ? 'Criar acesso e entrar' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

/** Troca de senha, usada na aba de configurações. */
export function TrocarSenha({ sessoes }: { sessoes?: number }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setErro('');
    setAviso('');

    if (nova !== confirmacao) {
      setErro('As senhas não conferem.');
      return;
    }

    setEnviando(true);
    try {
      await api.trocarSenha(atual, nova);
      setAtual('');
      setNova('');
      setConfirmacao('');
      setAviso('Senha alterada. Os outros acessos foram desconectados.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="painel">
      <div className="painel-cabecalho">
        <span className="rotulo">Acesso</span>
      </div>
      <div className="painel-corpo coluna" style={{ gap: 'var(--esp-4)' }}>
        {erro && <Aviso erro>{erro}</Aviso>}
        {aviso && <Aviso>{aviso}</Aviso>}

        <div className="config-grupo">
          <Campo rotulo="Senha atual">
            <input
              type="password"
              value={atual}
              onChange={(e) => setAtual(e.target.value)}
              autoComplete="current-password"
            />
          </Campo>
          <Campo rotulo="Nova senha">
            <input
              type="password"
              value={nova}
              onChange={(e) => setNova(e.target.value)}
              autoComplete="new-password"
            />
          </Campo>
          <Campo rotulo="Repita a nova senha">
            <input
              type="password"
              value={confirmacao}
              onChange={(e) => setConfirmacao(e.target.value)}
              autoComplete="new-password"
            />
          </Campo>
        </div>

        <p className="suave" style={{ fontSize: 'var(--texto-p)' }}>
          Trocar a senha encerra as outras sessões
          {typeof sessoes === 'number' && sessoes > 1 ? ` (há ${sessoes} ativas)` : ''} e mantém
          esta.
        </p>

        <div className="linha">
          <button
            className="botao"
            onClick={enviar}
            disabled={enviando || !atual || !nova || !confirmacao}
          >
            <KeyRound size={15} /> {enviando ? 'Alterando…' : 'Alterar senha'}
          </button>
        </div>
      </div>
    </section>
  );
}
