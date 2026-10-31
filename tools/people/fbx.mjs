import fs from 'node:fs';

// three's FBXLoader outside a browser: it asks for an <img> per texture, which this importer loads on its own
globalThis.self = globalThis;
globalThis.window = globalThis;
globalThis.document = { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {}, set src(v) {} }) };
const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');

function readFBX(file) {
  const b = fs.readFileSync(file);
  const warn = console.warn;
  console.warn = () => {};
  const root = new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
  console.warn = warn;
  root.updateMatrixWorld(true);
  return root;
}

export { readFBX };
