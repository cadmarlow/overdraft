// Offline visual retargeting. Both specs are already in metres, grounded at Y=0 and facing +Z.
// The target spec is an immutable physics contract; this module only transforms mesh attributes.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unit = (v) => {
  const length = Math.hypot(...v);
  if (!Number.isFinite(length) || length < 1e-12) throw new Error('Cannot fit an invalid normal');
  return v.map((n) => n / length);
};

// Positive slopes and a conservative tangent limit keep the curve monotone and its Jacobian nonsingular.
// End segments extrapolate linearly: mirrors or trim outside the reference body bounds must not be flattened.
function curve(xs, ys) {
  const h = [], delta = [];
  for (let i = 0; i < xs.length - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    delta[i] = (ys[i + 1] - ys[i]) / h[i];
    if (!(h[i] > 1e-8 && delta[i] > 0 && Number.isFinite(delta[i]))) throw new Error('Car fit anchors must be strictly ordered');
  }
  const slope = [delta[0]];
  for (let i = 1; i < xs.length - 1; i++) {
    const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1];
    slope[i] = Math.min((w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]), 2 * delta[i - 1], 2 * delta[i]);
  }
  slope.push(delta.at(-1));
  return (x) => {
    if (x <= xs[0]) return [ys[0] + (x - xs[0]) * slope[0], slope[0]];
    const last = xs.length - 1;
    if (x >= xs[last]) return [ys[last] + (x - xs[last]) * slope[last], slope[last]];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return [
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * slope[i]
        + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * slope[i + 1],
      ((6 * t2 - 6 * t) * ys[i] + (-6 * t2 + 6 * t) * ys[i + 1]) / h[i]
        + (3 * t2 - 4 * t + 1) * slope[i] + (3 * t2 - 2 * t) * slope[i + 1]
    ];
  };
}

function specification(spec, label) {
  const wheels = spec.wheels?.map((w) => Array.from(w));
  if (wheels?.length !== 4 || wheels.some((w) => w.length < 4 || !w.slice(0, 4).every(Number.isFinite) || w[1] <= 0 || w[3] <= 0)) {
    throw new Error(`${label}: four grounded wheel pivots and positive radii are required`);
  }
  const { zRear, zFront, halfW, height } = spec;
  if (![zRear, zFront, halfW, height].every(Number.isFinite) || halfW <= 0 || height <= Math.max(...wheels.map((w) => w[1]))) {
    throw new Error(`${label}: invalid body dimensions`);
  }
  const front = [0, 1], rear = [2, 3];
  const average = (indices, axis, absolute = false) => indices.reduce((sum, i) => sum + (absolute ? Math.abs(wheels[i][axis]) : wheels[i][axis]), 0) / indices.length;
  const axleZ = [average(rear, 2), average(front, 2)];
  if (!(zRear < axleZ[0] && axleZ[0] < axleZ[1] && axleZ[1] < zFront)) throw new Error(`${label}: axles must lie between rear and front bumpers`);
  const widths = spec.wheelWidths ? Array.from(spec.wheelWidths) : null;
  if (widths && (widths.length !== 4 || widths.some((w) => !Number.isFinite(w) || w <= 0))) throw new Error(`${label}: wheelWidths must contain four positive full widths`);
  return { zRear, zFront, halfW, height, wheels, widths, axleZ,
    tracks: [average(rear, 0, true), average(front, 0, true)], axleY: [average(rear, 1), average(front, 1)] };
}

/**
 * Source/target wheels are [x,y,z,radius], ordered front-left, front-right, rear-left, rear-right (+X is left).
 * halfW uses the importer's body-width reference (97th percentile of |x|, excluding mirrors where identified).
 * Optional wheelWidths are full local X widths; supplying source widths lets tyre shoulders stay within the new wings.
 * point()/normal() accept body-space arrays. wheelPoint()/wheelNormal() accept already centred, unsteered wheel arrays.
 * body()/wheel() copy pos/nor, retaining UVs, topology and other metadata without mutating the input.
 */
export function createCarFit(sourceSpec, lockedSpec) {
  const source = specification(sourceSpec, 'Source'), target = specification(lockedSpec, 'Target');
  const zCurve = curve([source.zRear, ...source.axleZ, source.zFront], [target.zRear, ...target.axleZ, target.zFront]);
  const trackFit = [...source.tracks].every((v) => v > 0 && v < source.halfW - 1e-5)
    && [...target.tracks].every((v) => v > 0 && v < target.halfW - 1e-5);
  const widthCurve = curve([0, source.halfW], [0, target.halfW]);
  const blend = (z) => {
    const t = clamp((z - source.axleZ[0]) / (source.axleZ[1] - source.axleZ[0]), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const at = (values, t) => values[0] + (values[1] - values[0]) * t;
  function section(x, y, z) {
    const t = blend(z);
    const xCurve = trackFit ? curve([0, at(source.tracks, t), source.halfW], [0, at(target.tracks, t), target.halfW]) : widthCurve;
    const yCurve = curve([0, at(source.axleY, t), source.height], [0, at(target.axleY, t), target.height]);
    const mappedX = xCurve(Math.abs(x)), mappedY = yCurve(y);
    return [Math.sign(x) * mappedX[0], mappedY[0], mappedX[1], mappedY[1]];
  }
  function point(p) {
    const s = section(...p);
    return [s[0], s[1], zCurve(p[2])[0]];
  }
  function normal(n, p) {
    const [x, y, z] = p, s = section(x, y, z), e = zCurve(z)[1];
    // Only the off-diagonal Z terms need a numerical derivative; X/Y and the longitudinal derivative are exact.
    // This includes changing track and axle height between the two axles instead of treating the fit as a scale.
    const h = (source.zFront - source.zRear) * 1e-5;
    const a = section(x, y, z - h), b = section(x, y, z + h);
    const dx = (b[0] - a[0]) / (2 * h), dy = (b[1] - a[1]) / (2 * h);
    const nx = n[0] / s[2], ny = n[1] / s[3];
    return unit([nx, ny, (n[2] - dx * nx - dy * ny) / e]);
  }
  const wheelScales = source.wheels.map((w, i) => {
    const radial = target.wheels[i][3] / w[3];
    let lateral = clamp(target.halfW / source.halfW, radial * 0.75, radial * 1.25);
    if (source.widths) {
      // Two centimetres allow a tyre shoulder at the body silhouette rather than burying its sidewall in the arch.
      const clearance = Math.max(0.04, target.halfW - Math.abs(target.wheels[i][0]) + 0.02);
      lateral = Math.min(lateral, clearance * 2 / source.widths[i]);
      if (target.widths) lateral = Math.min(lateral, target.widths[i] / source.widths[i]);
    }
    return [lateral, radial, radial];
  });
  const scales = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= 4) throw new Error('Wheel index must be between 0 and 3');
    return wheelScales[i];
  };
  const wheelPoint = (p, i) => { const s = scales(i); return p.map((v, axis) => v * s[axis]); };
  const wheelNormal = (n, i) => { const s = scales(i); return unit(n.map((v, axis) => v / s[axis])); };
  function transform(data, wheelIndex) {
    if (data.pos.length % 3 || data.nor.length !== data.pos.length) throw new Error('Position/normal arrays must contain matching triples');
    const pos = new Float64Array(data.pos.length), nor = new Float64Array(data.nor.length);
    for (let i = 0; i < data.pos.length; i += 3) {
      const p = Array.from(data.pos.slice(i, i + 3)), n = Array.from(data.nor.slice(i, i + 3));
      pos.set(wheelIndex === undefined ? point(p) : wheelPoint(p, wheelIndex), i);
      nor.set(wheelIndex === undefined ? normal(n, p) : wheelNormal(n, wheelIndex), i);
    }
    return { ...data, pos, nor };
  }
  return { point, normal, wheelPoint, wheelNormal, body: (data) => transform(data), wheel: (data, i) => transform(data, i) };
}
