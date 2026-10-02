import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Os prints que geraram a questão, ao lado do texto lido.
 *
 * É o que torna a revisão possível de fazer: o OCR troca "I -" por "|-" e come
 * um acento aqui e ali, e sem o slide original você não tem como saber se o
 * texto estranho é erro de leitura ou se a banca escreveu assim mesmo.
 */

type Props = { importacaoId: number; arquivos: string[] };

export function VisualizadorPrint({ importacaoId, arquivos }: Props) {
  const [aberto, setAberto] = useState<number | null>(null);

  if (arquivos.length === 0) return null;

  return (
    <>
      <div className="tiras">
        {arquivos.map((arquivo, i) => (
          <button
            key={arquivo}
            className="tira"
            onClick={() => setAberto(i)}
            title={`Ver ${arquivo}`}
          >
            <img src={api.urlPrint(importacaoId, arquivo)} alt="" loading="lazy" />
          </button>
        ))}
      </div>

      {aberto !== null && (
        <Lente
          importacaoId={importacaoId}
          arquivos={arquivos}
          indice={aberto}
          aoMudar={setAberto}
          aoFechar={() => setAberto(null)}
        />
      )}
    </>
  );
}

function Lente({
  importacaoId,
  arquivos,
  indice,
  aoMudar,
  aoFechar,
}: {
  importacaoId: number;
  arquivos: string[];
  indice: number;
  aoMudar: (i: number) => void;
  aoFechar: () => void;
}) {
  const anterior = () => aoMudar((indice - 1 + arquivos.length) % arquivos.length);
  const proximo = () => aoMudar((indice + 1) % arquivos.length);

  // Teclado antes do mouse: você vai passar pelos frames comparando com o
  // texto, e tirar a mão do teclado a cada um atrapalha.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
      if (e.key === 'ArrowLeft') anterior();
      if (e.key === 'ArrowRight') proximo();
    };
    document.addEventListener('keydown', aoTeclar);
    return () => document.removeEventListener('keydown', aoTeclar);
  });

  return (
    <div
      className="lente"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div className="lente-topo">
        <span className="lente-nome">{arquivos[indice]}</span>
        {arquivos.length > 1 && (
          <span className="rotulo">
            {indice + 1} / {arquivos.length}
          </span>
        )}
        <button className="botao botao-p" onClick={aoFechar} aria-label="Fechar">
          <X size={14} />
        </button>
      </div>

      <div className="lente-corpo">
        {arquivos.length > 1 && (
          <button className="lente-seta" onClick={anterior} aria-label="Print anterior">
            <ChevronLeft size={20} />
          </button>
        )}

        <img src={api.urlPrint(importacaoId, arquivos[indice])} alt={arquivos[indice]} />

        {arquivos.length > 1 && (
          <button className="lente-seta" onClick={proximo} aria-label="Próximo print">
            <ChevronRight size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
