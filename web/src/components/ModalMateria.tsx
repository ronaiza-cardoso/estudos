import { useState } from 'react';
import { Modal } from './Modal';
import { Campo, Aviso } from './Campo';
import { api } from '../lib/api';

type Props = {
  aoFechar: () => void;
  aoCriar: (id: number, nome: string) => void;
};

export function ModalMateria({ aoFechar, aoCriar }: Props) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!nome.trim()) return setErro('Informe o nome da matéria.');
    setSalvando(true);
    setErro('');
    try {
      const criada = await api.criarMateria(nome.trim());
      aoCriar(criada.id, criada.nome);
      aoFechar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo="Cadastrar nova matéria"
      aoFechar={aoFechar}
      rodape={
        <>
          <button className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar matéria'}
          </button>
        </>
      }
    >
      <div className="coluna">
        <Campo rotulo="Nome da matéria">
          <input
            autoFocus
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && salvar()}
            placeholder="Ex.: Direito Constitucional"
          />
        </Campo>
        {erro && <Aviso erro>{erro}</Aviso>}
      </div>
    </Modal>
  );
}
