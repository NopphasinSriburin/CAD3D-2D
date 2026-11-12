import { icon } from './icons.js';

const ICONS = { success: 'circle-check', error: 'triangle-alert', info: 'info' };

let host = null;

export function toast(message, { type = 'info', title = '', timeout = 4200 } = {}) {
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `
    <span class="toast__icon">${icon(ICONS[type] || 'info', { size: 18 })}</span>
    <div class="toast__body">${title ? `<strong>${title}</strong>` : ''}<span></span></div>
    <button class="toast__close" aria-label="ปิด">${icon('x', { size: 14 })}</button>`;
  el.querySelector('.toast__body span').textContent = message;
  const close = () => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector('.toast__close').addEventListener('click', close);
  host.appendChild(el);
  const live = host.querySelectorAll('.toast:not(.is-leaving)');
  if (live.length > 3) live[0].querySelector('.toast__close').click();
  if (timeout) setTimeout(close, timeout);
  return close;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
