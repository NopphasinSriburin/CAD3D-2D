/* Classic worker: tessellates STEP / IGES / BREP files with OpenCascade (occt-import-js). */
importScripts('../vendor/occt/occt-import-js.js');

let occtReady = null;

function getOcct() {
  if (!occtReady) {
    occtReady = occtimportjs({ locateFile: (name) => '../vendor/occt/' + name });
  }
  return occtReady;
}

self.onmessage = async (event) => {
  const { id, format, buffer, params } = event.data;
  try {
    const occt = await getOcct();
    const result = occt.ReadFile(format, new Uint8Array(buffer), params);
    if (!result || !result.success) throw new Error('OCCT_READ_FAILED');

    const transfers = [];
    const meshes = result.meshes.map((m) => {
      const position = new Float32Array(m.attributes.position.array);
      const normal = m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null;
      const index = m.index ? new Uint32Array(m.index.array) : null;
      transfers.push(position.buffer);
      if (normal) transfers.push(normal.buffer);
      if (index) transfers.push(index.buffer);
      return { name: m.name, color: m.color || null, brepFaces: m.brep_faces || [], position, normal, index };
    });

    self.postMessage({ id, result: { root: result.root, meshes } }, transfers);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
