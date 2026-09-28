/** Formatação de tempo e datas, sempre em pt-BR. */

export function minutosHumanos(min: number): string {
  if (!min) return '0min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

export function mmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function hhmmss(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const h = Math.floor(s / 3600);
  const resto = s % 3600;
  const base = `${String(Math.floor(resto / 60)).padStart(2, '0')}:${String(resto % 60).padStart(2, '0')}`;
  return h > 0 ? `${String(h).padStart(2, '0')}:${base}` : base;
}

/** "2026-09-24T14:32:00" -> "24/09 14:32" */
export function dataHora(iso: string): string {
  const [data, hora = ''] = iso.split('T');
  const [, mes, dia] = data.split('-');
  return `${dia}/${mes}${hora ? ` ${hora.slice(0, 5)}` : ''}`;
}

/** "2026-09-24" -> "24/09" */
export function diaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return `${dia}/${mes}`;
}

export function dataCompleta(iso: string): string {
  const [data, hora = ''] = iso.split('T');
  const [ano, mes, dia] = data.split('-');
  return `${dia}/${mes}/${ano}${hora ? ` às ${hora.slice(0, 5)}` : ''}`;
}

/** Concordância de número: plural(2, 'questão', 'questões') -> "2 questões". */
export function plural(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Data de hoje no fuso do navegador, como AAAA-MM-DD. */
export function diaLocal(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
