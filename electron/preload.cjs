const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('restxDesktop', {
  onRuntimeStatus(callback) {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('runtime:status', listener);
    return () => ipcRenderer.removeListener('runtime:status', listener);
  },
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  openLogs: () => ipcRenderer.invoke('runtime:open-logs'),
  initializeSetup: () => ipcRenderer.invoke('setup:initialize'),
  loginSetup: (payload) => ipcRenderer.invoke('setup:login', payload),
  verifySetupTwoFactor: (code) => ipcRenderer.invoke('setup:verify-two-factor', code),
  registerTerminal: (payload) => ipcRenderer.invoke('setup:register', payload),
});
