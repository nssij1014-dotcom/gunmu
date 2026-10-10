const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('gmFetchHolidays', () => ipcRenderer.invoke('gm-fetch-holidays'));
