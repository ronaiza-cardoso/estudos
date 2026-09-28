import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(here, '..');

/**
 * O app desktop roda o mesmo servidor Fastify em processo e abre uma janela
 * apontando para ele. Sem Docker e sem Postgres instalado: o banco é o PGlite,
 * gravado na pasta de dados do usuário.
 */
const PORTA = Number(process.env.ESTUDOS_PORT ?? 5199);

// Precisa ser definido antes de importar o servidor.
process.env.PORT = String(PORTA);
process.env.HOST = '127.0.0.1';
process.env.ESTUDOS_DATA_DIR ??= join(app.getPath('userData'), 'pglite');
process.env.ESTUDOS_WEB_DIR ??= join(raiz, 'web', 'dist');
process.env.ESTUDOS_SEED ??= join(raiz, 'seed-questoes.js');
// Sem DATABASE_URL o servidor usa o banco embutido.
delete process.env.DATABASE_URL;

let janela = null;
let idBounce = null;

async function subirServidor() {
  // O import dispara o listen; o módulo exporta quando já está no ar.
  await import(resolve(raiz, 'server', 'dist', 'index.js'));
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 480,
    minHeight: 520,
    backgroundColor: '#f3f2f2',
    title: 'Estudos',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(here, 'preload.cjs'),
    },
  });

  janela.once('ready-to-show', () => janela?.show());
  janela.loadURL(`http://127.0.0.1:${PORTA}`);

  // Link externo abre no navegador do sistema, nunca dentro do app.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * Fim de ciclo: a janela precisa aparecer mesmo com o usuário em outro app
 * ou em outra Space. Três camadas, porque no macOS nenhuma é garantida:
 *
 *  1. nível "screen-saver" + visível em todas as Spaces — sobe acima de tudo,
 *     inclusive de apps em tela cheia;
 *  2. `app.focus({ steal: true })` — ativa o app de fato;
 *  3. bounce crítico no dock — pula até o usuário reparar, caso o macOS
 *     recuse a ativação.
 *
 * O nível elevado fica até o alarme parar. Antes ele caía depois de 1,2s, e
 * a janela voltava para trás antes de o usuário olhar.
 */
ipcMain.on('estudos:alertar', () => {
  if (!janela) return;

  if (janela.isMinimized()) janela.restore();

  janela.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.show();
  janela.focus();

  app.focus({ steal: true });
  janela.flashFrame(true);

  if (process.platform === 'darwin') {
    idBounce = app.dock?.bounce('critical') ?? null;
  }

  console.log('alarme: janela trazida para a frente');
});

ipcMain.on('estudos:parar-alerta', () => {
  if (!janela) return;

  janela.setAlwaysOnTop(false);
  // Volta a se comportar como janela normal, presa à Space de origem.
  janela.setVisibleOnAllWorkspaces(false);
  janela.flashFrame(false);

  if (process.platform === 'darwin' && idBounce !== null) {
    app.dock?.cancelBounce(idBounce);
    idBounce = null;
  }
});

app.whenReady().then(async () => {
  try {
    await subirServidor();
  } catch (erro) {
    console.error('Falha ao subir o servidor:', erro);
    app.quit();
    return;
  }

  criarJanela();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

// No macOS o app costuma seguir vivo sem janelas, mas aqui ele é de uso
// pontual: fechar a janela encerra.
app.on('window-all-closed', () => app.quit());
