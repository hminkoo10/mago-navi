'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// 파일 경로·임의 IPC를 노출하지 않는다. IPC event도 renderer로 넘기지 않는다.
if (process.isMainFrame) {
  contextBridge.exposeInMainWorld('magoNaviRoster', {
    get: () => ipcRenderer.invoke('academy-roster:get'),
    onChanged: (callback) => {
      if (typeof callback !== 'function') return () => {};
      const listener = () => callback();
      ipcRenderer.on('academy-roster:changed', listener);
      return () => ipcRenderer.removeListener('academy-roster:changed', listener);
    },
  });
}
