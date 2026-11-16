// util.js — RNG seeded, math helpers, AABB collision + line-of-sight.
// No three.js dependency: pure sim math shared by player and bots.

// mulberry32: small deterministic PRNG. seed fixed per run so staged
// screenshots and autotest are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
// shortest signed angle difference, radians
export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export function angLerp(a, b, t) { return a + angDiff(a, b) * t; }

// ---- AABB colliders -------------------------------------------------------
// A box is {x0,z0,x1,z1,y0,y1}. y0/y1 are feet-space heights (ground = 0).
// moveCircle tries to move a circle (radius r, height h, feet at y) by dx,dz
// and steps up onto low ledges (<= 0.55) like stairs. Returns {x,z,y,hit}.
// colliders: array of boxes.
export function moveCircle(pos, dx, dz, r, h, colliders) {
  let x = pos.x, z = pos.z, y = pos.y;
  let hit = false;
  // X axis
  let nx = x + dx;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (nx + r > b.x0 && nx - r < b.x1 && z + r > b.z0 && z - r < b.z1) {
      if (y + h > b.y0 && y < b.y1) {
        if (b.y1 - y <= 0.55 && y + h > b.y1) {
          // step up onto the ledge
          y = b.y1;
        } else {
          nx = dx > 0 ? b.x0 - r : b.x1 + r;
          hit = true;
        }
      }
    }
  }
  x = nx;
  // Z axis
  let nz = z + dz;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (x + r > b.x0 && x - r < b.x1 && nz + r > b.z0 && nz - r < b.z1) {
      if (y + h > b.y0 && y < b.y1) {
        if (b.y1 - y <= 0.55 && y + h > b.y1) {
          y = b.y1;
        } else {
          nz = dz > 0 ? b.z0 - r : b.z1 + r;
          hit = true;
        }
      }
    }
  }
  z = nz;
  // gravity: fall to the highest supporting top under the feet, else ground 0
  let support = 0;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (x + r * 0.6 > b.x0 && x - r * 0.6 < b.x1 && z + r * 0.6 > b.z0 && z - r * 0.6 < b.z1) {
      if (b.y1 <= y + 0.56 && b.y1 > support) support = b.y1;
    }
  }
  if (y > support) y = Math.max(support, y - 0.35); // simple fall, ~21 u/s at 60Hz
  else y = support;
  return { x, z, y, hit };
}

// 2D segment (x0,z0)-(x1,z1) vs AABB (XZ). True when the segment is blocked.
export function segHitsBox(x0, z0, x1, z1, b) {
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) return false; }
  else {
    let t1 = (b.x0 - x0) / dx, t2 = (b.x1 - x0) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 || z0 > b.z1) return false; }
  else {
    let t1 = (b.z0 - z0) / dz, t2 = (b.z1 - z0) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}

// Line of sight in XZ between two eye points. Walls are boxes tall enough
// to block sight (y1 > 1.5 and y0 < 1.5). Returns true when the view is clear.
export function hasLOS(ax, az, bx, bz, colliders) {
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (b.y1 > 1.5 && b.y0 < 1.5 && segHitsBox(ax, az, bx, bz, b)) return false;
  }
  return true;
}

// Ray vs AABB (3D slab method). dir must be normalized. Returns distance
// along the ray, or Infinity when it misses.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0, tmax = Infinity;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return Infinity;
    } else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Ray vs sphere. Returns distance or Infinity.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  return tca - Math.sqrt(r2 - d2);
}
