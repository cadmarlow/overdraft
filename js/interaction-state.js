export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export function angleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}
export function doorPosition(car, side = 1) {
  const z = ((car.spec?.doors?.[0] ?? 0.8) + (car.spec?.doors?.[1] ?? -0.35)) / 2;
  return {
    x: car.position.x + Math.cos(car.heading) * 1.4 * side + Math.sin(car.heading) * z,
    z: car.position.z - Math.sin(car.heading) * 1.4 * side + Math.cos(car.heading) * z
  };
}
export function canInteract(state, speed = 0) {
  return state === 'onFoot' || (state === 'driving' && Math.abs(speed) < 1.5);
}
export function validPosition(position) {
  return position && ['x', 'y', 'z'].every(k => Number.isFinite(position[k])) &&
    Math.abs(position.x) < 50000 && Math.abs(position.z) < 50000 && position.y >= -20 && position.y < 1000;
}
