'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meter', {
  onFight: (cb) => ipcRenderer.on('fight', (_e, data) => cb(data)),
  onClasses: (cb) => ipcRenderer.on('classes', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('status', (_e, data) => cb(data)),
  onCommand: (cb) => ipcRenderer.on('command', (_e, command) => cb(command)),
  reset: () => ipcRenderer.send('reset'),
  resetCumul: () => ipcRenderer.send('reset-cumul'),
  copy: (text) => ipcRenderer.send('copy', text),
  ignoreMouse: (ignore) => ipcRenderer.send('ignore-mouse', ignore),
  close: () => ipcRenderer.send('close'),
  fit: (width, height) => ipcRenderer.send('fit', { width, height }),
});
