import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the production ray search on a numeric TSL adapter. Only texture sampling is substituted: a 20 m high
// building between x=10..30, z=-20..20. This catches wrong ray axes, overwritten bisection bounds and roof leaks.
const values = x => x instanceof N ? x.v : Array.isArray(x) ? x : [x];
class N {
  constructor(...v) { this.v = v.flatMap(values); }
  get x() { return new N(this.v[0]); } get y() { return new N(this.v[1]); }
  get z() { return new N(this.v[2]); } get w() { return new N(this.v[3]); }
  get r() { return this.x; } get g() { return this.y; }
  get xy() { return new N(this.v.slice(0, 2)); } get zw() { return new N(this.v.slice(2, 4)); }
  get xz() { return new N(this.v[0], this.v[2]); }
  op(b, fn) { b = values(b); return new N(Array.from({ length: Math.max(this.v.length, b.length) }, (_, i) => fn(this.v[i % this.v.length], b[i % b.length]))); }
  add(b) { return this.op(b, (a,b) => a+b); } sub(b) { return this.op(b, (a,b) => a-b); }
  mul(b) { return this.op(b, (a,b) => a*b); } div(b) { return this.op(b, (a,b) => a/b); }
  greaterThan(b) { return this.op(b, (a,b) => Number(a>b)); } lessThan(b) { return this.op(b, (a,b) => Number(a<b)); }
  and(b) { return this.op(b, (a,b) => Number(a && b)); }
  toVar() { return new N(this.v); } assign(b) { this.v = values(b).slice(); return this; }
}
const position = new N(0, 2, 0);
const source = readFileSync(new URL('../js/urban-light.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('const roofAt = Fn'), source.indexOf('const urbanSkyVisibility = Fn'));
const trace = vm.runInNewContext(body + '\ntraceUrbanReflection;', {
  positionWorld: position, frame: new N(-64, -64, 128, 128), heights: {},
  Fn: fn => (...args) => fn(args), float: v => new N(v), vec3: (...v) => new N(...v), vec4: (...v) => new N(...v),
  If: (condition, body) => { const yes = values(condition)[0]; if (yes) body(); return { Else: body => { if (!yes) body(); } }; },
  abs: n => new N(values(n).map(Math.abs)), max: (a,b) => new N(a).op(b, Math.max), step: (edge,v) => new N(v).op(edge, (a,b) => Number(a>=b)),
  texture: (_map, uv) => ({ level() { const [u,v] = values(uv), x = u*128-64, z = v*128-64; return new N(x>=10 && x<=30 && Math.abs(z)<=20 ? 20/255 : 0, 0, 0, 0); } })
});

test('the reflection ray resolves the facing wall and keeps open sky over its roof', () => {
  position.assign([0, 2, 0]);
  let hit = trace(new N(1, 0, 0)).v;
  assert.equal(hit[3], 1); assert.ok(Math.abs(hit[0] - 10) < 0.1); assert.equal(hit[1], 2); assert.equal(hit[2], 1);
  position.assign([0, 30, 0]);
  assert.equal(trace(new N(1, 0, 0)).w.v[0], 0, 'the top of the same building leaves the sky open');
});

test('reflections follow their own direction, including behind the camera, and never turn the ground into a wall', () => {
  position.assign([0, 2, 0]);
  assert.equal(trace(new N(-1, 0, 0)).w.v[0], 0, 'the opposite direction has no building');
  assert.equal(trace(new N(0, -1, 0)).w.v[0], 0, 'negative ray height belongs to the road');
  position.assign([20, 2, 40]);
  const hit = trace(new N(0, 0, -1)).v;
  assert.equal(hit[3], 1); assert.ok(Math.abs(hit[0] - 20) < 0.15); assert.equal(hit[2], 0, 'the north wall uses its x tangent');
});
