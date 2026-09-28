import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, CirclePause, CirclePlay, Square } from 'lucide-react';
import { api, type Config } from '../lib/api';
import { mmss } from '../lib/format';
import {
  destravarAudio,
  iniciarDespertador,
  notificar,
  pararDespertador,
  pedirPermissaoNotificacao,
} from '../lib/som';

type Fase = 'foco' | 'pausa';
type Estado = 'parado' | 'rodando' | 'pausado';

type Props = {
  config: Config;
  aoSalvarSessao: () => void;
  /** Avisa o app que um ciclo está em andamento, para ocupar a tela toda. */
  aoMudarFoco?: (ativo: boolean) => void;
};

export function Pomodoro({ config, aoSalvarSessao, aoMudarFoco }: Props) {
  const focoMin = Number(config.foco_min ?? 25);
  const pausaMin = Number(config.pausa_min ?? 5);
  const ciclosAlvo = Number(config.ciclos_ate_pausa_longa ?? 4);
  const pausaAuto = config.pausa_auto === '1';
  const somAtivo = config.som_ativo === '1';
  const notifAtiva = config.notificacoes === '1';

  const [fase, setFase] = useState<Fase>('foco');
  const [estado, setEstado] = useState<Estado>('parado');
  const [restante, setRestante] = useState(focoMin * 60);
  const [ciclos, setCiclos] = useState(0);
  const [aviso, setAviso] = useState('');
  const [despertando, setDespertando] = useState<'foco' | 'pausa' | null>(null);

  // O fim é guardado como timestamp absoluto: se a aba dormir em segundo
  // plano, o tempo restante continua correto ao voltar.
  const fimEm = useRef<number | null>(null);
  const concluindo = useRef(false);
  /** Pausa pronta para começar assim que o alarme for silenciado. */
  const pausaArmada = useRef(false);

  const duracaoFase = fase === 'foco' ? focoMin * 60 : pausaMin * 60;

  // Enquanto parado, o relógio acompanha a duração configurada.
  useEffect(() => {
    if (estado === 'parado') setRestante(duracaoFase);
  }, [duracaoFase, estado]);

  const concluirFase = useCallback(async () => {
    if (concluindo.current) return;
    concluindo.current = true;
    fimEm.current = null;

    if (fase === 'foco') {
      try {
        await api.criarSessao({ minutos: focoMin, completa: true });
        aoSalvarSessao();
      } catch (e) {
        setAviso((e as Error).message);
      }
      setCiclos((c) => c + 1);

      if (notifAtiva) notificar('Foco concluído', `${focoMin} min registrados.`);
      setDespertando('foco');
      iniciarDespertador(somAtivo, () => setDespertando(null));

      // O relógio fica congelado enquanto o alarme toca: a pausa só começa
      // quando o usuário para o alarme, para ele não perder minutos de pausa
      // por ter demorado a voltar para a mesa.
      pausaArmada.current = pausaAuto;
      setFase('pausa');
      setRestante(pausaMin * 60);
      setEstado('parado');
    } else {
      if (notifAtiva) notificar('Pausa encerrada', 'Pronto para o próximo ciclo.');
      setDespertando('pausa');
      iniciarDespertador(somAtivo, () => setDespertando(null));
      setFase('foco');
      setRestante(focoMin * 60);
      setEstado('parado');
    }

    concluindo.current = false;
  }, [fase, focoMin, pausaMin, pausaAuto, somAtivo, notifAtiva, aoSalvarSessao]);

  // Relógio: recalcula sempre a partir do timestamp de término.
  useEffect(() => {
    if (estado !== 'rodando') return;

    const tique = () => {
      if (fimEm.current === null) return;
      const seg = Math.max(0, Math.round((fimEm.current - Date.now()) / 1000));
      setRestante(seg);
      if (seg === 0) void concluirFase();
    };

    tique();
    const id = window.setInterval(tique, 250);
    return () => window.clearInterval(id);
  }, [estado, concluirFase]);

  // O som nunca deve sobreviver ao componente.
  useEffect(() => pararDespertador, []);

  // Enquanto houver ciclo em andamento, o app mostra só o contador.
  useEffect(() => {
    // O alarme também ocupa a tela toda: é o momento em que mais importa ser visto.
    aoMudarFoco?.(estado !== 'parado' || despertando !== null);
  }, [estado, despertando, aoMudarFoco]);

  // Tempo restante no título da aba.
  useEffect(() => {
    document.title =
      estado === 'rodando'
        ? `${mmss(restante)} · ${fase === 'foco' ? 'Foco' : 'Pausa'} — Estudos`
        : 'Estudos';
    return () => {
      document.title = 'Estudos';
    };
  }, [estado, restante, fase]);

  /**
   * `iniciarPausa` só é true quando o usuário para o alarme de propósito.
   * Se o alarme desistir sozinho aos 30s, a pausa fica esperando o Iniciar —
   * assim ele pega os 5 minutos inteiros quando voltar.
   */
  function calarDespertador(iniciarPausa = false) {
    pararDespertador();
    setDespertando(null);

    if (iniciarPausa && pausaArmada.current) {
      pausaArmada.current = false;
      fimEm.current = Date.now() + pausaMin * 60_000;
      setRestante(pausaMin * 60);
      setEstado('rodando');
      return;
    }
    pausaArmada.current = false;
  }

  function iniciar() {
    calarDespertador();
    setAviso('');
    if (notifAtiva) void pedirPermissaoNotificacao();
    if (somAtivo) destravarAudio(); // sem isto o despertador não toca depois

    fimEm.current = Date.now() + duracaoFase * 1000;
    setRestante(duracaoFase);
    setEstado('rodando');
  }

  function pausar() {
    calarDespertador();
    if (fimEm.current !== null) {
      setRestante(Math.max(0, Math.round((fimEm.current - Date.now()) / 1000)));
    }
    fimEm.current = null;
    setEstado('pausado');
  }

  function retomar() {
    fimEm.current = Date.now() + restante * 1000;
    setEstado('rodando');
  }

  /** Encerra o ciclo; grava sessão parcial de foco a partir de 1 minuto. */
  async function encerrar() {
    calarDespertador();
    const minutos = Math.floor((duracaoFase - restante) / 60);

    fimEm.current = null;
    setEstado('parado');

    if (fase === 'foco' && minutos >= 1) {
      try {
        await api.criarSessao({ minutos, completa: false });
        aoSalvarSessao();
        setAviso(`Sessão interrompida salva: ${minutos} min.`);
      } catch (e) {
        setAviso((e as Error).message);
      }
    } else if (fase === 'foco') {
      setAviso('Menos de 1 minuto — nada foi registrado.');
    }

    setFase('foco');
    setRestante(focoMin * 60);
  }

  const progresso = duracaoFase > 0 ? 1 - restante / duracaoFase : 0;
  // A fileira reinicia a cada bloco: 4 ciclos -> 4 quadrados cheios, o 5º volta a 1.
  const ciclosPreenchidos = ciclos === 0 ? 0 : ((ciclos - 1) % ciclosAlvo) + 1;

  if (despertando) {
    return (
      <div className="despertador">
        <BellRing size={56} className="despertador-icone" />
        <h2 className="despertador-titulo">
          {despertando === 'foco' ? 'Foco concluído' : 'Pausa encerrada'}
        </h2>
        <p className="despertador-texto">
          {despertando === 'foco'
            ? `${focoMin} min registrados.${pausaAuto ? ` A pausa de ${pausaMin} min começa quando você parar o alarme.` : ' Hora da pausa.'}`
            : 'Pronto para o próximo ciclo de foco.'}
        </p>
        <button
          className="botao botao-g botao-primario"
          onClick={() => calarDespertador(true)}
          autoFocus
        >
          <Square size={16} /> Parar alarme
        </button>
      </div>
    );
  }

  return (
    <div className="timer">
      <div className="relogio-fase">
        <span className={`rotulo ${fase === 'pausa' ? 'rotulo-acento' : ''}`}>
          {fase === 'foco' ? 'Foco' : 'Pausa'}
        </span>
        {estado === 'pausado' && <span className="tag">Pausado</span>}
      </div>

      <div className={`relogio-tempo ${fase === 'pausa' ? 'relogio-pausa' : ''}`}>
        {mmss(restante)}
      </div>

      <div className="relogio-barra">
        <div
          className="relogio-barra-preenchida"
          style={{ width: `${Math.min(100, progresso * 100)}%` }}
        />
      </div>

      <div className="timer-acoes">
        {estado === 'rodando' ? (
          <button className="botao botao-g" onClick={pausar}>
            <CirclePause size={18} /> Pausar
          </button>
        ) : (
          <button
            className="botao botao-g botao-primario"
            onClick={estado === 'pausado' ? retomar : iniciar}
          >
            <CirclePlay size={18} /> {estado === 'pausado' ? 'Retomar' : 'Iniciar'}
          </button>
        )}

        <button
          className="botao botao-g botao-perigo"
          onClick={encerrar}
          disabled={estado === 'parado'}
        >
          <Square size={16} /> Encerrar
        </button>
      </div>

      <div className="coluna" style={{ alignItems: 'center', gap: 'var(--esp-2)' }}>
        <div className="ciclos">
          {Array.from({ length: ciclosAlvo }).map((_, i) => (
            <div key={i} className={`ciclo ${i < ciclosPreenchidos ? 'ciclo-cheio' : ''}`} />
          ))}
        </div>
        <span className="rotulo">
          {ciclos === 0 ? 'Nenhum ciclo concluído' : `${ciclos} ciclo${ciclos === 1 ? '' : 's'} concluído${ciclos === 1 ? '' : 's'}`}
        </span>
      </div>

      {aviso && <span className="rotulo">{aviso}</span>}
    </div>
  );
}
