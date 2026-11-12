import { inflateSync } from 'three/examples/jsm/libs/fflate.module.js';

/*
 * SolidWorks 2015+ files (.SLDPRT) are a sequence of records:
 *   14 00 06 00 08 00 | u32 ? | u32 ? | u32 compressedSize | u32 size | u32 nameLength | name (nibble-swapped) | raw deflate
 * Exact B-Rep geometry lives in a Parasolid partition that no open library reads, but
 * "Contents/DisplayLists" holds the display tessellation SolidWorks saved with the part.
 * Each face record (uoTempFaceTessData_c) is:
 *   i32 triangleCount, i32 stripCount,
 *   [4, 8, 2, n]   strip lengths (i32)
 *   [12, 100, 2, v] positions (float32 xyz, metres)
 *   [12, 100, 2, v] normals
 */

const RECORD_MARK = [0x14, 0x00, 0x06, 0x00, 0x08, 0x00];
const INT_HDR = [4, 0, 0, 0, 8, 0, 0, 0, 2, 0, 0, 0];
const VEC_HDR = [12, 0, 0, 0, 100, 0, 0, 0, 2, 0, 0, 0];

// SOLIDWORKS swLengthUnit_e → MorphCAD unit keys
const SW_UNITS = { 0: 'mm', 1: 'cm', 2: 'm', 3: 'in', 4: 'ft', 5: 'ft' };
const METRES_TO = { mm: 1000, cm: 100, m: 1, in: 1000 / 25.4, ft: 1000 / 304.8 };

function matchAt(b, p, pat) {
  for (let i = 0; i < pat.length; i++) if (b[p + i] !== pat[i]) return false;
  return true;
}

function find(b, pat, from) {
  const first = pat[0];
  for (let p = from, end = b.length - pat.length; p <= end; p++) {
    if (b[p] === first && matchAt(b, p, pat)) return p;
  }
  return -1;
}

function* records(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = find(bytes, RECORD_MARK, 0);
  while (p >= 0 && p + 26 <= bytes.length) {
    const csize = dv.getUint32(p + 14, true);
    const usize = dv.getUint32(p + 18, true);
    const nlen = dv.getUint32(p + 22, true);
    const nameStart = p + 26;
    if (nlen > 0 && nlen < 512 && nameStart + nlen + csize <= bytes.length) {
      let name = '';
      for (let i = 0; i < nlen; i++) {
        const x = bytes[nameStart + i];
        name += String.fromCharCode(((x & 0x0f) << 4) | (x >> 4));
      }
      const data = bytes.subarray(nameStart + nlen, nameStart + nlen + csize);
      yield { name, csize, usize, data };
      p = find(bytes, RECORD_MARK, nameStart + nlen + Math.max(csize, 1) - 1);
    } else {
      p = find(bytes, RECORD_MARK, p + 1);
    }
  }
}

function inflate(rec) {
  if (rec.csize === rec.usize) return rec.data;
  try {
    const out = inflateSync(rec.data, { out: new Uint8Array(rec.usize) });
    return out.length === rec.usize ? out : null;
  } catch {
    // Stale copies of streams inside the file do not inflate; the live copy does
    return null;
  }
}

function floats(bytes, offset, count) {
  return new Float32Array(bytes.slice(offset, offset + count * 4).buffer);
}

function readFace(b, dv, p) {
  if (p < 8 || p + 16 > b.length) return null;
  const triCount = dv.getInt32(p - 8, true);
  const stripCount = dv.getInt32(p - 4, true);
  const n = dv.getUint32(p + 12, true);
  if (n !== stripCount || n <= 0 || n > 1e6 || p + 16 + 4 * n > b.length) return null;
  const lens = new Int32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    const len = dv.getInt32(p + 16 + 4 * i, true);
    if (len < 3) return null;
    lens[i] = len;
    v += len;
  }
  if (v - 2 * n !== triCount) return null;
  const q = p + 16 + 4 * n;
  if (q + 16 + 12 * v > b.length || !matchAt(b, q, VEC_HDR) || dv.getUint32(q + 12, true) !== v) return null;
  const positions = floats(b, q + 16, v * 3);
  const q2 = q + 16 + 12 * v;
  let normals = null;
  let end = q2;
  if (q2 + 16 + 12 * v <= b.length && matchAt(b, q2, VEC_HDR) && dv.getUint32(q2 + 12, true) === v) {
    normals = floats(b, q2 + 16, v * 3);
    end = q2 + 16 + 12 * v;
  }
  return { lens, positions, normals, triCount, end };
}

function readFaces(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const faces = [];
  let p = find(bytes, INT_HDR, 8);
  while (p >= 0) {
    const face = readFace(bytes, dv, p);
    if (face) {
      faces.push(face);
      p = find(bytes, INT_HDR, face.end);
    } else {
      p = find(bytes, INT_HDR, p + 1);
    }
  }
  return faces;
}

/** Triangle strips → flat triangle arrays; each triangle's winding follows the stored normals. */
function buildTriangles(faces, scale) {
  const triTotal = faces.reduce((s, f) => s + f.triCount, 0);
  const pos = new Float32Array(triTotal * 9);
  const nor = new Float32Array(triTotal * 9);
  let o = 0;
  for (const { lens, positions: P, normals: N } of faces) {
    let start = 0;
    for (const len of lens) {
      for (let k = 0; k < len - 2; k++) {
        let a = start + k;
        let b = start + k + 1;
        let c = start + k + 2;
        if (k % 2) [b, c] = [c, b];
        if (N) {
          const ux = P[b * 3] - P[a * 3];
          const uy = P[b * 3 + 1] - P[a * 3 + 1];
          const uz = P[b * 3 + 2] - P[a * 3 + 2];
          const wx = P[c * 3] - P[a * 3];
          const wy = P[c * 3 + 1] - P[a * 3 + 1];
          const wz = P[c * 3 + 2] - P[a * 3 + 2];
          const nx = uy * wz - uz * wy;
          const ny = uz * wx - ux * wz;
          const nz = ux * wy - uy * wx;
          const sx = N[a * 3] + N[b * 3] + N[c * 3];
          const sy = N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1];
          const sz = N[a * 3 + 2] + N[b * 3 + 2] + N[c * 3 + 2];
          if (nx * sx + ny * sy + nz * sz < 0) [b, c] = [c, b];
        }
        for (const idx of [a, b, c]) {
          pos[o] = P[idx * 3] * scale;
          pos[o + 1] = P[idx * 3 + 1] * scale;
          pos[o + 2] = P[idx * 3 + 2] * scale;
          if (N) {
            nor[o] = N[idx * 3];
            nor[o + 1] = N[idx * 3 + 1];
            nor[o + 2] = N[idx * 3 + 2];
          }
          o += 3;
        }
      }
      start += len;
    }
  }
  return { positions: pos, normals: faces.every((f) => f.normals) ? nor : null };
}

function xmlText(bytes) {
  return bytes ? new TextDecoder().decode(bytes) : '';
}

/**
 * Reads the display mesh of a SolidWorks 2015+ part.
 * Returns { positions, normals, faceCount, triangleCount, unit, meta } with coordinates in `unit` (Y-up).
 */
export function readSolidWorksMesh(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) throw new Error('SW_LEGACY_FORMAT');

  let display = null;
  let info = null;
  let core = null;
  for (const rec of records(bytes)) {
    if (rec.name === 'Contents/DisplayLists') {
      const data = inflate(rec);
      if (data && (!display || data.length > display.length)) display = data;
    } else if (rec.name === 'docProps/ISolidWorksInformation.xml') {
      info = inflate(rec) || info;
    } else if (rec.name === 'docProps/core.xml') {
      core = inflate(rec) || core;
    }
  }
  if (!display) throw new Error('SW_NOT_SOLIDWORKS');

  const faces = readFaces(display);
  if (!faces.length) throw new Error('SW_NO_TESSELLATION');

  const infoXml = xmlText(info);
  const unitCode = /name="SW_UnitsLinear"[^>]*>\s*<vt:i4>(\d+)</.exec(infoXml);
  const unit = SW_UNITS[unitCode ? Number(unitCode[1]) : 0] || 'mm';
  const { positions, normals } = buildTriangles(faces, METRES_TO[unit]);
  const coreXml = xmlText(core);
  return {
    positions,
    normals,
    faceCount: faces.length,
    triangleCount: positions.length / 9,
    unit,
    meta: {
      modified: (/<dcterms:modified[^>]*>([^<]+)</.exec(coreXml) || [])[1] || null,
      lastModifiedBy: (/<dc:lastModifiedBy>([^<]*)</.exec(coreXml) || [])[1] || null,
    },
  };
}
