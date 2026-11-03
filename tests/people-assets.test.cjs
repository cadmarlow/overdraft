const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { join, basename } = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

test('avatars request only packaged textures, preserving detail maps when supplied', async () => {
  const requests = [];
  class Geometry {
    setAttribute() {}
    setIndex() {}
    addGroup() {}
    computeBoundingSphere() {}
  }
  class ImageLoader {
    setOptions() { return this; }
    async loadAsync(url) {
      requests.push(url);
      if (!existsSync(fileURLToPath(url))) throw new Error(`Missing texture: ${url}`);
      return { filename: basename(fileURLToPath(url)) };
    }
  }
  const filename = join(__dirname, '../js/people-assets.js');
  const { loadPerson } = loadModule(readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(filename).href)), {
    filename,
    imports: { 'three/webgpu': {
      BufferGeometry: Geometry, BufferAttribute: class {}, Uint16BufferAttribute: class {}, Float32BufferAttribute: class {},
      ImageBitmapLoader: ImageLoader, Texture: class { constructor(image) { this.image = image; } },
      SRGBColorSpace: 'srgb', NoColorSpace: '', RepeatWrapping: 1000, LinearMipmapLinearFilter: 1008
    } },
    globals: { URL, TextDecoder, fetch: async (url) => {
      const bytes = readFileSync(url);
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    } }
  });
  for (const id of ['hero', 'suit', 'swat', 'cop', 'cop-b', 'detective', 'crew', 'guard']) {
    const person = await loadPerson(id);
    for (const { name, color, normal, specular } of person.maps) {
      assert.equal(color.image.filename, `${id}_${name}_c.webp`);
      assert.equal(color.colorSpace, 'srgb');
      for (const [map, suffix] of [[normal, 'n'], [specular, 's']]) {
        const asset = `${id}_${name}_${suffix}.webp`;
        if (existsSync(join(__dirname, '../assets/people', asset))) {
          assert.equal(map?.image.filename, asset, `${asset} remains available to the material`);
        } else {
          assert.equal(map, null, `${asset} has no source map`);
        }
      }
    }
  }
  assert.ok(requests.length > 50, 'the real avatar headers exercised their texture sets');
  assert.deepEqual(requests.filter((url) => !existsSync(fileURLToPath(url))), [], 'no request falls back from a missing file');
});
