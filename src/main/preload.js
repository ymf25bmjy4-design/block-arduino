/* Safe bridge between the UI and the main process. */
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('ba', {
  info: () => ipcRenderer.invoke('app:info'),
  setDirty: (d) => ipcRenderer.send('app:dirty', !!d),
  toolsStatus: () => ipcRenderer.invoke('tools:status'),
  installCore: (core) => ipcRenderer.invoke('tools:installCore', core),
  listPorts: () => ipcRenderer.invoke('ports:list'),
  verify: (args) => ipcRenderer.invoke('build:verify', args),
  upload: (args) => ipcRenderer.invoke('build:upload', args),
  serialOpen: (port, baud) => ipcRenderer.invoke('serial:open', { port, baud }),
  serialClose: () => ipcRenderer.invoke('serial:close'),
  serialSend: (text) => ipcRenderer.invoke('serial:send', text),
  saveProject: (args) => ipcRenderer.invoke('project:save', args),
  openProject: () => ipcRenderer.invoke('project:open'),
  exportIno: (args) => ipcRenderer.invoke('file:exportIno', args),
  openIde: (args) => ipcRenderer.invoke('file:openIde', args),
  exportBlocks: (defs) => ipcRenderer.invoke('blocks:export', { defs }),
  importBlocks: () => ipcRenderer.invoke('blocks:import'),
  burnBootloader: (args) => ipcRenderer.invoke('bootloader:burn', args),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  onMenu: on('menu'),
  onPorts: on('ports'),
  onLog: on('build:log'),
  onStep: on('build:step'),
  onNotice: on('build:notice'),
  onPort: on('build:port'),
  onSizes: on('build:sizes'),
  onSerialData: on('serial:data'),
  onSerialState: on('serial:state'),
});
