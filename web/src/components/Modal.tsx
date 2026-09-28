import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largo?: boolean;
};

export function Modal({ titulo, aoFechar, children, rodape, largo }: Props) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  return (
    <div
      className="modal-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className={largo ? 'modal modal-largo' : 'modal'} role="dialog" aria-modal="true">
        <div className="modal-cabecalho">
          <h2 style={{ fontSize: 'var(--texto-m)' }}>{titulo}</h2>
          <button className="botao botao-nu" onClick={aoFechar} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  );
}
