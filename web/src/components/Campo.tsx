import type { ReactNode } from 'react';

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <label className="campo">
      <span className="rotulo">{rotulo}</span>
      {children}
    </label>
  );
}

export function Aviso({ erro, children }: { erro?: boolean; children: ReactNode }) {
  return <div className={`aviso ${erro ? 'aviso-erro' : 'aviso-ok'}`}>{children}</div>;
}
