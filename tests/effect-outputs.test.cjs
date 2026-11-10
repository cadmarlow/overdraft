const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const { loadModule } = require('./helpers/module.cjs');

// Effects keep out of the reflections' outputs (js/effect-outputs.js): without it, in HAUTE, every puff of smoke was a
// black box (the ambient occlusion over the normals its quad had stamped).

const source = readFileSync(join(__dirname, '../js/effect-outputs.js'), 'utf8');
const load = () => loadModule(source, { imports: { 'three/tsl': { mrt: (outputs) => ({ outputs }), vec4: (...v) => v } } });
const node = (extra = {}) => ({ isNodeMaterial: true, transparent: true, mrtNode: null, ...extra });
const tree = (objects) => ({ traverse(fn) { for (const o of objects) fn(o); } });

test('an effect material draws its colour and nothing else', () => {
  const fx = load();
  const mrt = fx.transparentEffectMRT();
  assert.deepEqual(Object.keys(mrt.outputs).sort(), ['metalRough', 'normal']);
  for (const output of Object.values(mrt.outputs)) assert.deepEqual(Array.from(output), [0, 0, 0, 0]); // alpha 0: nothing is blended in
  const smoke = node();
  assert.equal(fx.sealEffect(smoke), smoke);
  assert.equal(smoke.mrtNode, mrt);
  // what already says what it writes keeps it; a material that is not a node material has no outputs to set
  const own = {};
  assert.equal(fx.sealEffect(node({ mrtNode: own })).mrtNode, own);
  assert.equal(fx.sealEffect({ transparent: true }).mrtNode, undefined);
  assert.equal(fx.sealEffect(null), null);
});

test('the scene is swept for effects made without it: unlit and see-through, never glass or a solid', () => {
  const fx = load();
  const smoke = node(), beam = node(), glass = node({ isMeshStandardNodeMaterial: true }), lamp = node({ transparent: false });
  const sealedAlready = node({ mrtNode: {} }), basic = { transparent: true };
  const sealed = fx.sealEffects(tree([
    { name: 'FxSmoke', material: smoke }, { name: '', material: [beam, glass] }, { name: 'Lamp', material: lamp },
    { name: 'Rain', material: sealedAlready }, { name: 'Old', material: basic }, { name: 'Group' }
  ]));
  assert.equal(sealed.length, 2);
  assert.equal(sealed[0], 'FxSmoke');
  assert.ok(smoke.mrtNode && beam.mrtNode === smoke.mrtNode);
  assert.equal(smoke.needsUpdate, true); // its shader is built again with the new outputs
  assert.equal(glass.mrtNode, null); // glass reflects: it is a surface
  assert.equal(lamp.mrtNode, null);
  assert.equal(basic.mrtNode, undefined);
  // a second sweep finds nothing left
  assert.deepEqual(Array.from(fx.sealEffects(tree([{ name: 'FxSmoke', material: smoke }]))), []);
});

test('without reflection outputs there is nothing to keep out of', () => {
  const fx = load();
  fx.disableEffectOutputs();
  assert.equal(fx.transparentEffectMRT(), null);
  const smoke = node();
  fx.sealEffect(smoke);
  assert.equal(smoke.mrtNode, null);
  assert.deepEqual(Array.from(fx.sealEffects(tree([{ name: 'FxSmoke', material: smoke }]))), []);
  assert.equal(smoke.mrtNode, null);
});

test('every see-through unlit material of the game says it is an effect where it is made', () => {
  const dir = join(__dirname, '../js');
  const UNLIT = /new THREE\.(MeshBasic|LineBasic|LineDashed|Sprite|Points)NodeMaterial\(/;
  const missing = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!UNLIT.test(line)) return;
      // the constructor's own options: up to the line that closes them
      let end = i;
      while (end < lines.length - 1 && end - i < 12 && !/\}\)/.test(lines[end])) end++;
      const options = lines.slice(i, end + 1).join('\n');
      if (!/transparent:\s*true|AdditiveBlending/.test(options)) return;
      // or it sets its own outputs before the function that makes it ends
      let last = end;
      while (last < lines.length - 1 && last - end < 45 && !/^(function |\}$)/.test(lines[last + 1])) last++;
      const after = lines.slice(i, last + 1).join('\n');
      if (!/sealEffect\(/.test(options) && !/mrtNode/.test(after)) missing.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(missing, []);
});

test('the game sweeps the scene before compiling its shaders, and again while it runs', () => {
  const main = readFileSync(join(__dirname, '../js/main.js'), 'utf8');
  const sweep = main.indexOf('sealEffects(scene);');
  assert.ok(sweep > 0 && sweep < main.indexOf('await precompileShaders();'));
  assert.ok(main.indexOf('const late = sweepEffects();') > main.indexOf('const frame = (now) => {'));
});

test('the running sweep walks the whole scene a few objects at a time, and starts again', () => {
  const fx = load();
  const late = node();
  const leaf = (name, material) => ({ name, material, children: [] });
  const root = { children: [{ children: [leaf('a', node({ transparent: false })), leaf('b', node({ isMeshStandardNodeMaterial: true }))] }, { children: [leaf('Beacon', late)] }] };
  const step = fx.effectSweeper(root, 2);
  const found = [];
  let steps = 0;
  while (!found.length && steps < 10) { found.push(...step()); steps++; }
  assert.deepEqual(found, ['Beacon']);
  assert.ok(steps > 1, 'not all at once');
  assert.ok(late.mrtNode && late.needsUpdate);
  // a material made after the first pass is found by a later one
  const later = node();
  root.children.push(leaf('Laser', later));
  const again = [];
  for (let i = 0; i < 12; i++) again.push(...step());
  assert.deepEqual(again, ['Laser']);
});
