import { blockAt, surveyedBlockAt } from './city-config.js';

const at = (ox, oz) => (x, z) => ({ x: ox + x, z: oz + z });
const lincolnPoint = at(-1324, -1720);
const ovalPoint = at(1395.7, 1985.2);
const lincolnBlock = blockAt(-1200, -1725);
const ovalBlock = surveyedBlockAt(1395.7, 1985.2);

// Centres in the current NYC building survey, in the district's metre frame.
const theatreSites = [
  { type: 'opera', at: [0.5, -0.5], face: 'east', outer: 68.4, inner: 63.2, span: [-28.8, 28.8], podium: 0.82 },
  { type: 'geffen', at: [125, -70.5], face: 'south', outer: -31.5, inner: -37.2, span: [96.3, 153.7], podium: 0.82 },
  { type: 'koch', at: [124.75, 59.75], face: 'north', outer: 20.5, inner: 25.7, span: [96, 153.8], podium: 0.82 }
];
function lincolnTheatres(buildings) {
  return theatreSites.map(site => {
    const { x, z } = lincolnPoint(...site.at);
    return { site, record: buildings.find(b => Math.hypot(b.cx - x, b.cz - z) < 2 && b.height >= 23) };
  }).filter(t => t.record);
}

const lincolnFountain = { ...lincolnPoint(124.75, -5.35), y: 1.32, audible: 43 };
const ovalFountain = { ...ovalPoint(0, -26), y: 0.64, audible: 34 };
const lincolnPlaza = [[64,-30.5],[169,-30.5],[172,-27],[172,17],[169,20.3],[64,20.3]];
const lincolnGarden = [[25,-83],[88,-83],[88,-40],[25,-40]];
const ovalLawn = [[-75,2],[-72,-16],[-61,-28],[-45,-37],[-24,-43],[0,-46],[24,-43],[45,-36],
  [63,-24],[72,-11],[75,1],[71,16],[60,27],[43,36],[21,43],[0,46.7],[-24,43],[-45,35],[-62,24],[-72,13]];
const ovalGround = [[-173,-68],[-118,-81],[-84,-105],[98,-105],[162,-78],[183,-48],[183,54],[119,77],
  [86,96],[-82,96],[-161,64],[-173,32]];
const ovalWalks = [
  { width: 5.2, points: [[-181,4],[-161,3],[-140,1],[-106,0],[-80,1],[-71,6]] },
  { width: 4.7, points: [[70,5],[86,6],[115,7],[147,6],[177,5],[189,5]] },
  { width: 4.6, points: [[0,-114],[-1,-100],[-3,-79],[-3,-55],[-3,-45]] },
  { width: 4.4, points: [[-12,103],[-12,89],[-15,67],[-11,48],[-10,45]] },
  { width: 2.8, points: [[-87,-23],[-86,-14],[-83,-6],[-79,1],[-84,13],[-84,22]] },
  { width: 3.1, points: [[89,-22],[88,-14],[86,0],[87,13],[89,22]] },
  { width: 2.6, points: [[-14,65],[-4,62],[13,62]] }
];
// The original estate is a coherent brick ensemble, with the low later additions retaining their survey dress.
function isStuyvesantResidence(b) {
  return b.year === 1940 && b.height >= 25 && surveyedBlockAt(b.cx, b.cz) === ovalBlock;
}

const urbanArrivals = {
  lincoln: { ...lincolnPoint(175.3, -5.3), heading: -Math.PI / 2, name: 'Lincoln Center', subtitle: 'Columbus Avenue · 64e Rue' },
  stuytown: { ...ovalPoint(-86, 1), heading: Math.PI / 2, name: 'Stuyvesant Oval', subtitle: 'Stuyvesant Town · 14e Rue' }
};

export { lincolnPoint, ovalPoint, lincolnBlock, ovalBlock, lincolnTheatres, lincolnPlaza, lincolnGarden,
  ovalLawn, ovalGround, ovalWalks, lincolnFountain, ovalFountain, isStuyvesantResidence, urbanArrivals };
