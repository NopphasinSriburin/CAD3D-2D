export const UNITS = {
  mm: { label: 'มิลลิเมตร (mm)', short: 'mm', toMM: 1, threeMF: 'millimeter', dxf: 4 },
  cm: { label: 'เซนติเมตร (cm)', short: 'cm', toMM: 10, threeMF: 'centimeter', dxf: 5 },
  m: { label: 'เมตร (m)', short: 'm', toMM: 1000, threeMF: 'meter', dxf: 6 },
  in: { label: 'นิ้ว (in)', short: 'in', toMM: 25.4, threeMF: 'inch', dxf: 1 },
  ft: { label: 'ฟุต (ft)', short: 'ft', toMM: 304.8, threeMF: 'foot', dxf: 2 },
};

export function unitScale(from, to) {
  return UNITS[from].toMM / UNITS[to].toMM;
}

export function unitFromDxfCode(code) {
  return { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }[code] || null;
}

/** Human friendly number: trims trailing zeros, adapts decimals to magnitude. */
export function fmtNum(v, digits = 2) {
  if (!Number.isFinite(v)) return '–';
  const abs = Math.abs(v);
  const d = abs >= 1000 ? 1 : abs >= 1 ? digits : abs >= 0.01 ? 3 : 4;
  return Number(v.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d });
}

/** Plain number for drawings / file formats (no thousands separators). */
export function fmtPlain(v, maxDecimals = 2) {
  return String(Number(v.toFixed(maxDecimals)));
}

export function fmtInt(n) {
  return Math.round(n).toLocaleString('en-US');
}

export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}
