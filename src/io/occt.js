let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('workers/occt-worker.js', document.baseURI));
  worker.onmessage = (event) => {
    const { id, result, error } = event.data;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (error) job.reject(new Error(error));
    else job.resolve(result);
  };
  worker.onerror = (event) => {
    const err = new Error(event.message || 'OCCT_WORKER_ERROR');
    for (const job of pending.values()) job.reject(err);
    pending.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

export const MESH_QUALITY = {
  draft: { label: 'หยาบ (เร็ว)', linearDeflection: 0.004, angularDeflection: 0.8 },
  normal: { label: 'มาตรฐาน', linearDeflection: 0.001, angularDeflection: 0.5 },
  fine: { label: 'ละเอียด', linearDeflection: 0.0003, angularDeflection: 0.25 },
};

/** Tessellates a STEP / IGES / BREP buffer in a worker. The buffer is transferred. */
export function readBRep(format, buffer, quality = 'normal') {
  const q = MESH_QUALITY[quality] || MESH_QUALITY.normal;
  const params = {
    linearUnit: 'millimeter',
    linearDeflectionType: 'bounding_box_ratio',
    linearDeflection: q.linearDeflection,
    angularDeflection: q.angularDeflection,
  };
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, format, buffer, params }, [buffer]);
  });
}
