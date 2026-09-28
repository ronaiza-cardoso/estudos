/**
 * O servidor roda na mesma máquina que o app, então o horário local dele é o
 * horário do usuário. Guardamos datas como ISO local ("2026-09-24T14:32:00")
 * para que `substr(coluna, 1, 10)` já devolva o dia correto no SQLite.
 */
export function agoraLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export function diaLocal(d: Date = new Date()): string {
  return agoraLocal(d).slice(0, 10);
}

/** Lista de dias (YYYY-MM-DD) terminando hoje, do mais antigo ao mais novo. */
export function ultimosDias(n: number, base: Date = new Date()): string[] {
  const dias: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    dias.push(diaLocal(d));
  }
  return dias;
}

/** Dias consecutivos com estudo, contados a partir de hoje (ou de ontem). */
export function diasSeguidos(diasComEstudo: string[]): number {
  const conjunto = new Set(diasComEstudo);
  if (conjunto.size === 0) return 0;

  const hoje = new Date();
  let cursor = new Date(hoje);

  // Se ainda não estudou hoje, a sequência pode vir de ontem.
  if (!conjunto.has(diaLocal(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!conjunto.has(diaLocal(cursor))) return 0;
  }

  let total = 0;
  while (conjunto.has(diaLocal(cursor))) {
    total++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return total;
}
