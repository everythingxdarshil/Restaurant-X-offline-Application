const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('restxDesktop', {
  onRuntimeStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('runtime:status', listener);
    return () => ipcRenderer.removeListener('runtime:status', listener);
  },
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  openLogs: () => ipcRenderer.invoke('runtime:open-logs'),
  changeTenant: () => ipcRenderer.invoke('runtime:change-tenant'),
  activateTerminal: (payload) => ipcRenderer.invoke('setup:activate', payload),
});
