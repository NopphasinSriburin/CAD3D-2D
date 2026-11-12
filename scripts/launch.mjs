// Builds (if needed), serves the app locally and opens it in Chrome — or Edge / the default browser.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const rebuild = process.argv.includes('--build');

async function isUp() {
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

function findBrowser() {
  const env = process.env;
  const candidates = [
    join(env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
    join(env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    join(env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    join(env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    join(env.ProgramFiles || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  return candidates.find((p) => existsSync(p)) || null;
}

function openBrowser() {
  const exe = findBrowser();
  if (exe) {
    spawn(exe, [URL], { detached: true, stdio: 'ignore' }).unref();
    return exe.toLowerCase().includes('chrome') ? 'Chrome' : 'Edge';
  }
  spawn('cmd', ['/c', 'start', '', URL], { detached: true, stdio: 'ignore' }).unref();
  return 'เบราว์เซอร์หลัก';
}

function newestMtime(path) {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return readdirSync(path).reduce((max, name) => Math.max(max, newestMtime(join(path, name))), 0);
}

function buildIsStale() {
  const built = join(root, 'dist', 'index.html');
  if (!existsSync(built)) return true;
  const sources = ['src', 'public', 'index.html', 'vite.config.js'].map((p) => join(root, p)).filter(existsSync);
  return Math.max(...sources.map(newestMtime)) > statSync(built).mtimeMs;
}

if (rebuild || buildIsStale()) {
  console.log('กำลังสร้างเว็บ (build)…');
  await build({ root, logLevel: 'warn' });
}

let server = null;
if (await isUp()) {
  console.log(`MorphCAD ทำงานอยู่แล้วที่ ${URL}`);
} else {
  server = await preview({ root, logLevel: 'warn', preview: { port: PORT, strictPort: true, open: false } });
}

const browser = openBrowser();
console.log('');
console.log(`  MorphCAD พร้อมใช้งาน → ${URL}`);
console.log(`  เปิดด้วย ${browser} แล้ว`);
console.log('  ติดตั้งเป็นแอป: กดปุ่ม "ติดตั้งแอป" มุมขวาบนของเว็บ');
if (server) console.log('  ปิดหน้าต่างนี้เพื่อหยุดเซิร์ฟเวอร์ (แอปที่ติดตั้งแล้วยังเปิดได้)');
console.log('');
if (!server) process.exit(0);
