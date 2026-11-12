// Bridges files opened from Explorer ("Open with MorphCAD") into the web app.
const { contextBridge, ipcRenderer } = require('electron');

let handler = null;
const queue = [];

ipcRenderer.on('open-files', (_e, files) => {
  if (handler) handler(files);
  else queue.push(files);
});

contextBridge.exposeInMainWorld('morphcadDesktop', {
  isDesktop: true,
  onOpenFiles(callback) {
    handler = callback;
    while (queue.length) callback(queue.shift());
  },
});
