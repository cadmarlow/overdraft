// Reproduction links: one address that puts anyone back where something was seen, looking the same way, at the same
// hour and in the same weather. `?qa=1&at=x,y,z,yaw,pitch&heure=13.5&meteo=rain`. A photo from the Architect's own eye
// adds that eye's exact pose, `&oeil=x,y,z,yaw,pitch,fov`: the camera is set there until the first key or click. The
// Architect writes one into every event and ticket; the game reads it once, when the player enters the city.

const WEATHERS = ['clear', 'cloudy', 'rain', 'storm'];
const round = (v, step) => Math.round(v / step) * step;
const fixed = (v, digits) => Number(v.toFixed(digits)).toString();

/**
 * @param {object} view - x, y, z (metres), yaw, pitch (radians), hour (0-24), weather (atmosphere name)
 * @param {string} base - the page the link opens (its own query is dropped)
 */
function buildReproLink({ x, y, z, yaw = 0, pitch = 0, hour = null, weather = null, eye = null }, base) {
  const url = new URL(base);
  url.search = '';
  url.hash = '';
  url.searchParams.set('qa', '1');
  url.searchParams.set('at', [fixed(round(x, 0.1), 1), fixed(round(y, 0.1), 1), fixed(round(z, 0.1), 1), fixed(yaw, 2), fixed(pitch, 2)].join(','));
  if (Number.isFinite(hour)) url.searchParams.set('heure', fixed(((hour % 24) + 24) % 24, 2));
  if (WEATHERS.includes(weather)) url.searchParams.set('meteo', weather);
  if (eye && [eye.x, eye.y, eye.z, eye.yaw, eye.pitch, eye.fov].every(Number.isFinite)) {
    url.searchParams.set('oeil', [fixed(round(eye.x, 0.1), 1), fixed(round(eye.y, 0.1), 1), fixed(round(eye.z, 0.1), 1), fixed(eye.yaw, 3), fixed(eye.pitch, 3), fixed(eye.fov, 0)].join(','));
  }
  // commas stay readable in a pasted link
  return url.href.replace(/%2C/g, ',');
}

// The view a link asks for, or null when it carries none (or a broken one)
function parseRepro(search) {
  const params = new URLSearchParams(search);
  const at = params.get('at');
  if (!at) return null;
  const [x, y, z, yaw = 0, pitch = 0] = at.split(',').map(Number);
  if (![x, y, z, yaw, pitch].every(Number.isFinite)) return null;
  const hour = Number(params.get('heure'));
  const weather = params.get('meteo');
  const e = (params.get('oeil') || '').split(',').map(Number);
  return {
    x, y, z, yaw, pitch,
    hour: params.has('heure') && Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : null,
    weather: WEATHERS.includes(weather) ? weather : null,
    eye: e.length === 6 && e.every(Number.isFinite) && e[5] > 0 && e[5] < 180 ? { x: e[0], y: e[1], z: e[2], yaw: e[3], pitch: e[4], fov: e[5] } : null
  };
}

export { WEATHERS, buildReproLink, parseRepro };
