const { contextBridge, ipcRenderer } = require('electron');

// Única ponte com o processo principal: pedir que a janela venha para a
// frente quando o timer acaba.
contextBridge.exposeInMainWorld('estudos', {
  desktop: true,
  alertar: () => ipcRenderer.send('estudos:alertar'),
  pararAlerta: () => ipcRenderer.send('estudos:parar-alerta'),
});
