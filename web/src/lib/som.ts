/**
 * Bipe curto gerado no próprio navegador — evita depender de um arquivo de
 * áudio. O AudioContext só é criado no primeiro uso, depois de um gesto do
 * usuário, que é o que os navegadores exigem.
 */
let contexto: AudioContext | null = null;

function pegarContexto(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctor) return null;
  if (!contexto) contexto = new Ctor();
  if (contexto.state === 'suspended') void contexto.resume();
  return contexto;
}

/**
 * Destrava o áudio sem fazer barulho. Os navegadores só liberam o
 * AudioContext depois de um gesto do usuário, então chamamos isto no clique
 * de Iniciar para que o despertador consiga tocar mais tarde.
 */
export function destravarAudio() {
  pegarContexto();
}

/** Toca uma sequência de bipes. `agudo` distingue fim de foco de fim de pausa. */
export function tocarAlarme(agudo = false) {
  const ctx = pegarContexto();
  if (!ctx) return;

  const base = agudo ? 880 : 660;
  const inicios = [0, 0.28, 0.56];

  for (const atraso of inicios) {
    const t = ctx.currentTime + atraso;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();

    osc.type = 'square';
    osc.frequency.setValueAtTime(base, t);

    ganho.gain.setValueAtTime(0.0001, t);
    ganho.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    osc.connect(ganho).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.24);
  }
}

/** Pede permissão de notificação (silenciosamente, se já houver resposta). */
export async function pedirPermissaoNotificacao(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

export function notificar(titulo: string, corpo: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  new Notification(titulo, { body: corpo, tag: 'estudos-pomodoro' });
}

/* ==========================================================================
   Despertador — toca até o usuário parar
   ========================================================================== */

type Ponte = {
  desktop?: boolean;
  alertar?: () => void;
  pararAlerta?: () => void;
};

function ponte(): Ponte | undefined {
  return (window as unknown as { estudos?: Ponte }).estudos;
}

/** True quando estamos rodando dentro do app desktop. */
export function noDesktop(): boolean {
  return ponte()?.desktop === true;
}

let repeticao: number | undefined;
let limite: number | undefined;

/** Bipe duplo, mais insistente que o aviso simples de fim de fase. */
function toqueDespertador() {
  tocarAlarme(true);
  window.setTimeout(() => tocarAlarme(false), 300);
}

/**
 * Começa o despertador: traz a janela para a frente e toca em laço.
 * Desiste sozinho depois de `segundos` e avisa por `aoParar`, para que a
 * tela do alarme também saia — senão ficaria pulsando para sempre.
 */
export function iniciarDespertador(
  comSom: boolean,
  aoParar?: () => void,
  segundos = 30,
) {
  pararDespertador();

  ponte()?.alertar?.();

  if (comSom) {
    toqueDespertador();
    repeticao = window.setInterval(toqueDespertador, 1600);
  }

  limite = window.setTimeout(() => {
    pararDespertador();
    aoParar?.();
  }, segundos * 1000);
}

export function pararDespertador() {
  window.clearInterval(repeticao);
  window.clearTimeout(limite);
  repeticao = undefined;
  limite = undefined;
  ponte()?.pararAlerta?.();
}
