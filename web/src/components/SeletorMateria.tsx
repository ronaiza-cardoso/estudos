import { useState } from 'react';
import { ModalMateria } from './ModalMateria';
import type { Materia } from '../lib/api';

/**
 * Seletor de matéria que também cadastra uma nova, sem sair da tela.
 *
 * Trabalha com o **nome** da matéria, e não com o id: na importação a matéria
 * ainda não existe no banco quando o rascunho é montado — ela é resolvida (ou
 * criada) na hora de confirmar o lote.
 */

const NOVA = '__nova__';

type Props = {
  materias: Materia[];
  valor: string | null;
  aoMudar: (nome: string | null) => void;
  aoAtualizarMaterias: () => void;
  vazio?: string;
  disabled?: boolean;
};

export function SeletorMateria({
  materias,
  valor,
  aoMudar,
  aoAtualizarMaterias,
  vazio = 'Sem matéria',
  disabled,
}: Props) {
  const [modal, setModal] = useState(false);

  // A matéria recém-criada só aparece na lista depois que o App recarrega.
  // Até lá ela entra aqui, senão o select voltaria sozinho para o vazio.
  const nomes = [...new Set([...materias.map((m) => m.nome), valor].filter(Boolean))];

  return (
    <>
      <select
        value={valor ?? ''}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === NOVA) return setModal(true);
          aoMudar(e.target.value || null);
        }}
      >
        <option value="">{vazio}</option>
        {nomes.map((nome) => (
          <option key={nome as string} value={nome as string}>
            {nome}
          </option>
        ))}
        <option value={NOVA}>+ Cadastrar nova matéria</option>
      </select>

      {modal && (
        <ModalMateria
          aoFechar={() => setModal(false)}
          aoCriar={(_id, nome) => {
            aoAtualizarMaterias();
            aoMudar(nome);
          }}
        />
      )}
    </>
  );
}
