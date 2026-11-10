// Split material-batched mesh primitives before the importer groups their parts into wheel assemblies.
// Position welding connects UV/normal seams for topology only; the output retains every original split vertex.
export function splitDisconnected(data, { weldTolerance = 1e-5 } = {}) {
  if (!Number.isFinite(weldTolerance) || weldTolerance <= 0) throw new Error('weldTolerance must be positive');
  if (!data.pos || data.pos.length % 3 || !data.index || data.index.length % 3) throw new Error('Expected positions and triangle indices');
  const count = data.pos.length / 3;
  if (!data.index.length) return [];
  const parent = Int32Array.from({ length: count }, (_, i) => i), rank = new Uint8Array(count), used = new Uint8Array(count);
  const root = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a, b) => {
    a = root(a); b = root(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  };
  for (const i of data.index) {
    if (!Number.isInteger(i) || i < 0 || i >= count) throw new Error('Triangle references a missing vertex');
    used[i] = 1;
  }
  const buckets = new Map(), tolerance2 = weldTolerance * weldTolerance;
  const key = (x, y, z) => `${x},${y},${z}`;
  for (let i = 0; i < count; i++) {
    if (!used[i]) continue;
    const x = data.pos[i * 3], y = data.pos[i * 3 + 1], z = data.pos[i * 3 + 2];
    if (![x, y, z].every(Number.isFinite)) throw new Error('Cannot split nonfinite mesh positions');
    const gx = Math.floor(x / weldTolerance), gy = Math.floor(y / weldTolerance), gz = Math.floor(z / weldTolerance);
    // Adjacent buckets matter: almost-identical seam vertices can lie on opposite sides of a quantization boundary.
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const candidates = buckets.get(key(gx + dx, gy + dy, gz + dz));
      if (!candidates) continue;
      for (const j of candidates) {
        const a = x - data.pos[j * 3], b = y - data.pos[j * 3 + 1], c = z - data.pos[j * 3 + 2];
        if (a * a + b * b + c * c <= tolerance2) join(i, j);
      }
    }
    const at = key(gx, gy, gz);
    let bucket = buckets.get(at);
    if (!bucket) buckets.set(at, bucket = []);
    bucket.push(i);
  }
  for (let i = 0; i < data.index.length; i += 3) {
    join(data.index[i], data.index[i + 1]); join(data.index[i], data.index[i + 2]);
  }
  const groups = new Map();
  for (let i = 0; i < data.index.length; i += 3) {
    const at = root(data.index[i]);
    let group = groups.get(at);
    if (!group) groups.set(at, group = []);
    group.push(data.index[i], data.index[i + 1], data.index[i + 2]);
  }
  const isArray = (value) => Array.isArray(value) || (ArrayBuffer.isView(value) && !(value instanceof DataView));
  const allocate = (source, size) => Array.isArray(source) ? new Array(size) : new source.constructor(size);
  const compact = (attribute, vertices) => {
    const size = attribute.length / count, output = allocate(attribute, vertices.length * size);
    for (let i = 0; i < vertices.length; i++) for (let j = 0; j < size; j++) output[i * size + j] = attribute[vertices[i] * size + j];
    return output;
  };
  // Plain data fields follow primitiveData's flat-array convention. Custom vertex metadata (flags, colors, IDs, etc.)
  // is compacted in the same way, while object metadata and scalar values remain attached to each resulting part.
  const attributes = Object.entries(data).filter(([name, value]) => name !== 'index' && isArray(value)
    && value.length > 0 && value.length % count === 0 && value.length / count <= 16);
  for (const name of ['nor', 'uv']) {
    const expected = name === 'nor' ? count * 3 : count * 2;
    if (data[name] && data[name].length !== expected) throw new Error(`${name} must match the source vertex count`);
  }
  return [...groups.values()].map((indices) => {
    const remap = new Map(), vertices = [];
    for (const i of indices) if (!remap.has(i)) { remap.set(i, vertices.length); vertices.push(i); }
    const result = { ...data };
    for (const [name, value] of attributes) result[name] = compact(value, vertices);
    result.index = allocate(data.index, indices.length);
    for (let i = 0; i < indices.length; i++) result.index[i] = remap.get(indices[i]);
    if (!data.sourceVertexIndices) result.sourceVertexIndices = Uint32Array.from(vertices);
    return result;
  });
}
