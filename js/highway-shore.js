// Shared baseline shore section, before the surveyed building clearance pass.
function sampleShore(west, z0, z1, landF, { blockSidewalks, shoreX }) {
  const STEP = 3, HWY_W = 15.2;
  const H = (r, o) => r.d0 + o * r.k;
    const sgn = west ? 1 : -1;
  const edgeD = (b, s) => (west ? b.cx - b.w / 2 - s : s - b.cx - b.w / 2);
  const near = blockSidewalks.filter((b) => edgeD(b, shoreX(b.cz, west)) < 80);
  const rows = [];
  for (let z = z0; z <= z1 + 1e-6; z += STEP) {
    const s = shoreX(z, west);
    let W = 40;
    for (const b of near) if (Math.abs(z - b.cz) < b.d / 2 + 9) W = Math.min(W, edgeD(b, s));
    rows.push({ z, s, sgn, west, raw: W });
  }
  const n = rows.length;
  const at = (i) => rows[Math.min(n - 1, Math.max(0, i))];
  rows.forEach((r, i) => { let m = Infinity; for (let k = -8; k <= 8; k++) m = Math.min(m, at(i + k).raw); r.min = m; });
  rows.forEach((r, i) => {
    let sum = 0;
    for (let k = -5; k <= 5; k++) sum += at(i + k).min;
    r.W = sum / 11;
    r.d0 = 0.6 + Math.max(0, r.W - 0.4 - HWY_W - 0.6) * landF(r.z); // river-side edge of the highway
    r.k = Math.min(1, Math.max(0.85, (r.W - r.d0 - 0.05) / HWY_W)); // narrower lanes where the strip is short
    r.river = r.d0 - 0.5 - 0.4 >= 3.4 ? [0.4, r.d0 - 0.5] : null; // belt between the greenway and the highway
    r.land = r.W - 0.3 - (r.d0 + HWY_W + 0.5) >= 3.4 ? [r.d0 + HWY_W + 0.5, r.W - 0.3] : null; // belt by the blocks
  });
  // Short pinches (a block corner within ~10 m of the shore for less than ~60 m of the smoothed W) don't break the
  // highway: its markings, barrier and traffic lanes carry on there at the narrowest lane width, past the corner
  for (let i = 0; i < n;) {
    if (H(rows[i], HWY_W) <= rows[i].W + 0.1) { i++; continue; }
    let j = i;
    let rawMin = Infinity;
    for (; j < n && H(rows[j], HWY_W) > rows[j].W + 0.1; j++) rawMin = Math.min(rawMin, rows[j].raw);
    if (i > 0 && j < n && j - i <= 20 && rawMin >= 9.5) for (let k = i; k < j; k++) rows[k].W = H(rows[k], HWY_W) + 0.4;
    i = j;
  }
  // Where a block front stands well back from the smoothed strip (a receding front, the wider shore of a cove), the
  // belt by the blocks reaches out to its curb instead of leaving bare asphalt; not across the cross streets, and
  // not for small set-backs along Riverside Park's wall
  for (const r of rows) {
    let front = Infinity;
    for (const b of near) if (Math.abs(r.z - b.cz) < b.d / 2 - 1) front = Math.min(front, edgeD(b, r.s));
    const a = r.land ? r.land[0] : r.d0 + HWY_W + 0.5;
    if (front < Infinity && front - 1.2 - (r.land ? r.land[1] : a) >= (west && r.z < -350 ? 14 : 8)) r.land = [a, front - 1.2];
  }
  return rows;
}


// Complete the southern railing and taper from the esplanade's outer edge to Battery's inner edge. Exact clipped
// endpoints join the existing strips; a lateral jump here would leave a car-sized opening beside the last post.
function southernShoreRails(coast, boundsAtZ, excluded = () => false) {
  const result = [];
  const area = coast.reduce((sum,a,i) => { const b=coast[(i+1)%coast.length]; return sum+a.x*b.z-b.x*a.z; },0);
  const sign = area > 0 ? 1 : -1;
  for (let i=0;i<coast.length;i++) {
    const a=coast[i],b=coast[(i+1)%coast.length],length=Math.hypot(b.x-a.x,b.z-a.z);
    if (length<.01) continue;
    const ox=sign*(b.z-a.z)/length,oz=-sign*(b.x-a.x)/length,count=Math.ceil(length/6);
    for (let k=0;k<count;k++) {
      let A={x:a.x+(b.x-a.x)*k/count,z:a.z+(b.z-a.z)*k/count};
      let B={x:a.x+(b.x-a.x)*(k+1)/count,z:a.z+(b.z-a.z)*(k+1)/count};
      const x=(A.x+B.x)/2,z=(A.z+B.z)/2,shore=boundsAtZ(z);
      const west=Math.abs(x-shore.westX)<Math.abs(x-shore.eastX),start=west?6000:6150;
      if (Math.max(A.z,B.z)<=start) continue;
      const cross=() => ({x:A.x+(B.x-A.x)*(start-A.z)/(B.z-A.z),z:start});
      if(A.z<start) A=cross(); else if(B.z<start) B=cross();
      if(excluded((A.x+B.x)/2,(A.z+B.z)/2)) continue;
      const shift=p=>{
        const t=Math.min(1,Math.max(0,(p.z-start)/30));
        return {x:p.x+(west?-5.8:5.8)*(1-t)-ox*.6*t,z:p.z-oz*.6*t};
      };
      A=shift(A);B=shift(B);result.push([A.x,A.z,B.x,B.z]);
    }
  }
  return result;
}

export { sampleShore, southernShoreRails };
