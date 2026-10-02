import { Fragment } from 'react';

/**
 * Enunciado com os grifos do slide preservados.
 *
 * Questões de banca do tipo "os termos sublinhados acima constituem,
 * respectivamente:" são impossíveis de responder sem ver o sublinhado. A
 * leitura dos prints guarda essa marcação embutida no texto — `__assim__` para
 * sublinhado, `==assim==` para marca-texto — e é aqui que ela volta a ser
 * visível.
 *
 * O texto continua texto: nada de HTML vindo do modelo, só estas duas marcas.
 */

const MARCAS = /(__[^_]+?__|==[^=]+?==)/g;

export function TextoMarcado({ texto }: { texto: string }) {
  if (!texto.includes('__') && !texto.includes('==')) return <>{texto}</>;

  return (
    <>
      {texto.split(MARCAS).map((pedaco, i) => {
        if (pedaco.startsWith('__') && pedaco.endsWith('__')) {
          return (
            <u className="grifo-sublinhado" key={i}>
              {pedaco.slice(2, -2)}
            </u>
          );
        }
        if (pedaco.startsWith('==') && pedaco.endsWith('==')) {
          return (
            <mark className="grifo-marcado" key={i}>
              {pedaco.slice(2, -2)}
            </mark>
          );
        }
        return <Fragment key={i}>{pedaco}</Fragment>;
      })}
    </>
  );
}

/** Versão sem marcação, para caber em uma linha de tabela ou num título. */
export function semMarcas(texto: string): string {
  return texto.replace(/__|==/g, '');
}
