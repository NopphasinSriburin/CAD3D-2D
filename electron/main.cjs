// Desktop shell for MorphCAD. The built web app (dist/) is served from an app:// scheme so web
// workers, WebAssembly and fetch() behave exactly as they do in a browser.
const { app, BrowserWindow, Menu, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const ORIGIN = 'app://morphcad';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};
const CAD_FILE = /\.(step|stp|iges|igs|brep|brp|sldprt|stl|obj|mtl|ply|glb|gltf|bin|fbx|3mf|dae|amf|3ds|wrl|vrml|off|dxf|svg)$/i;

// Office PCs often have no usable GPU (Remote Desktop, VDI, blocklisted drivers): allow WebGL to fall
// back to Chromium's software renderer instead of failing to show the 3D view.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let win = null;
let pendingFiles = filesFromArgv(process.argv);

function filesFromArgv(argv) {
  return argv.slice(1).filter((arg) => CAD_FILE.test(arg) && fs.existsSync(arg));
}

function sendFiles(paths) {
  if (!win || !paths.length) return;
  const files = paths.map((p) => ({ name: path.basename(p), data: fs.readFileSync(p) }));
  win.webContents.send('open-files', files);
}

function serveApp() {
  protocol.handle('app', (request) => {
    let rel = decodeURIComponent(new URL(request.url).pathname);
    if (!rel || rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return new Response('Not found', { status: 404 });
    }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
  });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'MorphCAD',
    backgroundColor: '#07080b',
    show: false,
    icon: path.join(DIST, 'icons', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('page-title-updated', (e) => e.preventDefault());

  const wc = win.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') wc.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  wc.session.on('will-download', (_e, item) => {
    const autoDir = process.env.MORPHCAD_DOWNLOAD_DIR;
    if (autoDir) item.setSavePath(path.join(autoDir, item.getFilename()));
    else item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  wc.on('did-finish-load', () => {
    sendFiles(pendingFiles);
    pendingFiles = [];
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
    sendFiles(filesFromArgv(argv));
  });
  app.whenReady().then(() => {
    serveApp();
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
