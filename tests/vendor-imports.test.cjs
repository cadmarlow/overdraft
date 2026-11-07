const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

// Every name the game imports from the vendored three.js builds must exist there: a missing one (a helper renamed
// between revisions) breaks the whole module graph, and the page never loads, without a test failing.

const root = join(__dirname, '..');
const exportedNames = (file) => {
  const source = readFileSync(join(root, file), 'utf8');
  const names = new Set();
  for (const [, list] of source.matchAll(/^export \{([^}]+)\}/gm)) {
    for (const entry of list.split(',')) {
      const m = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(entry);
      if (m) names.add(m[2] || m[1]);
    }
  }
  return names;
};

const exportsOf = {
  'three/tsl': exportedNames('vendor/three/build/three.tsl.js'),
  'three/webgpu': new Set([...exportedNames('vendor/three/build/three.webgpu.js'), ...exportedNames('vendor/three/build/three.core.js')])
};

const sources = [
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
  ...readdirSync(join(root, 'vendor/three/examples/jsm/tsl/display')).filter((f) => f.endsWith('.js')).map((f) => `vendor/three/examples/jsm/tsl/display/${f}`)
];

test('the vendored three.js builds export every named import of the game', () => {
  assert.ok(exportsOf['three/tsl'].has('Fn') && exportsOf['three/tsl'].has('uv'), 'the TSL export list was read');
  assert.ok(exportsOf['three/webgpu'].has('Vector3') && exportsOf['three/webgpu'].has('WebGPURenderer'), 'the WebGPU export list was read');
  const missing = [];
  for (const file of sources) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const [, list, specifier] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](three\/tsl|three\/webgpu)['"]/g)) {
      for (const entry of list.split(',')) {
        const name = entry.trim().split(/\s+as\s+/)[0].trim();
        if (name && !exportsOf[specifier].has(name)) missing.push(`${file}: ${name} from ${specifier}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});
