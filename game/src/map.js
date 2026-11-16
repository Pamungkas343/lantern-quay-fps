// map.js — LANTERN QUAY: night harbour map.
// Builds all geometry, lights, signage, colliders, plant zones, spawns and
// the bot waypoint graph. Everything is procedural; no external assets.

import * as THREE from 'three';

// ---- canvas texture helpers ------------------------------------------------
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Big diegetic sign: main line + small sub-line, weathered paint look.
function signTex(main, sub, fg, bg) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 120px Arial, sans-serif';
    g.fillText(main, w / 2, sub ? h / 2 - 30 : h / 2);
    if (sub) { g.font = '700 56px Arial, sans-serif'; g.fillText(sub, w / 2, h - 62); }
  });
}

function groundTex() {
  return canvasTex(1024, 640, (g, w, h) => {
    g.fillStyle = '#20293d'; g.fillRect(0, 0, w, h);
    // wet speckle
    for (let i = 0; i < 2600; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.16)';
      g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4);
    }
    // expansion joints
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
    for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    // painted quay lane line + QUAY 7
    g.strokeStyle = 'rgba(255,176,66,0.75)'; g.lineWidth = 8; g.setLineDash([46, 30]);
    g.beginPath(); g.moveTo(0, h * 0.78); g.lineTo(w, h * 0.78); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,176,66,0.85)'; g.font = '900 92px Arial, sans-serif';
    g.textAlign = 'center'; g.fillText('QUAY 7', w * 0.5, h * 0.62);
    // hazard stripes near the water edge
    for (let x = 0; x < w; x += 64) {
      g.fillStyle = (x / 64) % 2 ? 'rgba(255,176,66,0.5)' : 'rgba(20,20,20,0.5)';
      g.save(); g.translate(x, h - 26); g.rotate(-0.5); g.fillRect(0, 0, 34, 52); g.restore();
    }
  });
}

function floorLetterTex(letter) {
  return canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,176,66,0.9)'; g.font = '900 200px Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, w / 2, h / 2 + 8);
    g.strokeStyle = 'rgba(255,176,66,0.9)'; g.lineWidth = 8;
    g.beginPath(); g.arc(w / 2, h / 2, 116, 0, Math.PI * 2); g.stroke();
  });
}

// ---- map -------------------------------------------------------------------
export const MAP = {
  bounds: { x0: -44, x1: 44, z0: -28, z1: 28 },
  plantA: { x0: -40, z0: -16, x1: -28, z1: -4 },
  plantB: { x0: 30, z0: -20, x1: 40, z1: -8 },
  emberSpawn: [[-40, 22], [-38, 18], [-42, 18], [-36, 22], [-40, 14]],
  watchSpawn: [[34, -20], [38, -14], [-36, -12], [30, -14], [38, -20]],
  // waypoint graph: id -> [x, z, zone]
  nodes: {
    eSpawn: [-40, 20, 'Quay 7'], eLane1: [-30, 16, 'Quay 7'], eLane2: [-12, 21, 'Quay 7'],
    quayMid: [0, 22, 'Quay 7'], quayE: [14, 21, 'Quay 7'], bDoor: [28, 14, 'Quay 7'],
    aYard: [-34, 12, 'Lantern Quay'], aSite: [-34, -10, 'Lantern Quay'], aCorner: [-40, -14, 'Lantern Quay'],
    midS: [0, 8, 'Net Loft'], loft: [0, -8, 'Net Loft'], midN: [0, -22, 'Tide Gate'],
    loftW: [-6, -8, 'Net Loft'], loftE: [6, -8, 'Net Loft'],
    northW: [-24, -23, 'Tide Gate'], northE: [12, -23, 'Tide Gate'], northB: [24, -22, 'Tide Gate'],
    bSite: [35, -14, 'Fish Hall'], bCorner: [38, -10, 'Fish Hall'], bHall: [34, 0, 'Fish Hall'],
    aHold: [-28, -12, 'Lantern Quay'], bHold: [32, -16, 'Fish Hall'],
  },
  // edges between node ids (undirected)
  edges: [
    ['eSpawn', 'eLane1'], ['eLane1', 'eLane2'], ['eLane2', 'quayMid'], ['quayMid', 'quayE'],
    ['quayE', 'bDoor'], ['bDoor', 'bHall'], ['bHall', 'bSite'], ['bSite', 'bCorner'],
    ['bCorner', 'northB'], ['northB', 'northE'], ['northE', 'midN'], ['midN', 'northW'],
    ['northW', 'aCorner'], ['aCorner', 'aSite'], ['aSite', 'aYard'], ['aYard', 'eLane1'],
    ['eLane2', 'midS'], ['midS', 'loft'], ['loft', 'midN'], ['loft', 'loftW'], ['loft', 'loftE'],
    ['loftW', 'midS'], ['loftE', 'midS'], ['midS', 'quayMid'], ['aSite', 'aHold'],
    ['bSite', 'bHold'], ['bHold', 'bHall'], ['quayE', 'northB'], ['aYard', 'midS'],
  ],
};

export function zoneAt(x, z) {
  if (x >= MAP.plantA.x0 && x <= MAP.plantA.x1 && z >= MAP.plantA.z0 && z <= MAP.plantA.z1) return 'Lantern Quay';
  if (x >= MAP.plantB.x0 && x <= MAP.plantB.x1 && z >= MAP.plantB.z0 && z <= MAP.plantB.z1) return 'Fish Hall';
  if (x >= -11 && x <= 11 && z >= -19 && z <= 3) return 'Net Loft';
  if (z > 10) return 'Quay 7';
  if (z < -19) return 'Tide Gate';
  return 'Mid';
}

// A* over the waypoint graph. Returns an array of [x,z] points.
export function findRoute(fromId, toId) {
  const nodes = MAP.nodes, edges = MAP.edges;
  const adj = {};
  for (const [a, b] of edges) {
    (adj[a] = adj[a] || []).push(b);
    (adj[b] = adj[b] || []).push(a);
  }
  const dist = (a, b) => {
    const pa = nodes[a], pb = nodes[b];
    return Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
  };
  const open = [[0, fromId]], came = {}, g = { [fromId]: 0 }, seen = new Set();
  while (open.length) {
    open.sort((p, q) => p[0] - q[0]);
    const [, cur] = open.shift();
    if (cur === toId) {
      const path = [cur]; let c = cur;
      while (came[c]) { c = came[c]; path.unshift(c); }
      return path.map(id => [nodes[id][0], nodes[id][1]]);
    }
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const nb of adj[cur] || []) {
      const ng = g[cur] + dist(cur, nb);
      if (g[nb] === undefined || ng < g[nb]) {
        g[nb] = ng; came[nb] = cur;
        open.push([ng + dist(nb, toId), nb]);
      }
    }
  }
  return [[nodes[toId][0], nodes[toId][1]]];
}

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const matGround = new THREE.MeshStandardMaterial({ map: groundTex(), roughness: 0.55, metalness: 0.15 });
  const matWall = new THREE.MeshStandardMaterial({ color: 0x3a4358, roughness: 0.9 });
  const matWallDark = new THREE.MeshStandardMaterial({ color: 0x272f42, roughness: 0.95 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0x8a5a2e, roughness: 0.5, metalness: 0.6 });
  const matContainer = new THREE.MeshStandardMaterial({ color: 0xb3541e, roughness: 0.6, metalness: 0.3 });
  const matContainer2 = new THREE.MeshStandardMaterial({ color: 0x2e6b7a, roughness: 0.6, metalness: 0.3 });
  const matCrate = new THREE.MeshStandardMaterial({ color: 0x6b4f2a, roughness: 0.9 });
  const matBarrel = new THREE.MeshStandardMaterial({ color: 0x9a3d2e, roughness: 0.7, metalness: 0.2 });
  const matRoof = new THREE.MeshStandardMaterial({ color: 0x1c2436, roughness: 0.85 });
  const matLight = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.8 });
  const matLampGlow = new THREE.MeshStandardMaterial({ color: 0xffb042, emissive: 0xff9a1e, emissiveIntensity: 2.2 });

  function box(x0, z0, x1, z1, y0, y1, mat, parent) {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    (parent || group).add(m);
    colliders.push({ x0, z0, x1, z1, y0, y1 });
    return m;
  }
  // visual-only box (no collider)
  function vbox(x0, z0, x1, z1, y0, y1, mat, parent) {
    const w = x1 - x0, d = z1 - z0, h = y1 - y0;
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    (parent || group).add(m);
    return m;
  }

  // ---- ground + water + sky -------------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(88, 56), matGround);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, 0); group.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(120, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a1a33, roughness: 0.25, metalness: 0.4 }));
  water.rotation.x = -Math.PI / 2; water.position.set(0, -0.4, 48); group.add(water);
  // distant skyline silhouettes (visual only)
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x0d1428 });
  for (let i = 0; i < 14; i++) {
    const w = 6 + (i % 4) * 4, h = 8 + ((i * 7) % 14);
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 4), skyMat);
    b.position.set(-70 + i * 11, h / 2 - 1, -44 - (i % 3) * 6);
    group.add(b);
  }
  // moon
  const moon = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24),
    new THREE.MeshBasicMaterial({ color: 0xdfe8ff, fog: false }));
  moon.position.set(-30, 42, -70); moon.lookAt(0, 0, 0); group.add(moon);

  // ---- perimeter ------------------------------------------------------------
  box(-44, -29, 44, -28, 0, 4, matWall);            // north wall
  box(-45, -28, -44, 28, 0, 4, matWall);           // west wall
  box(44, -28, 45, 28, 0, 4, matWall);             // east wall
  box(-44, 28, 44, 28.8, 0, 1.1, matWallDark);     // south parapet (low)

  // ---- Fish Hall (Site B) ----------------------------------------------------
  box(26, -25, 42, -24, 0, 5, matWallDark);        // north
  box(41, -24, 42, 4, 0, 5, matWallDark);          // east
  box(26, 3, 32, 4, 0, 5, matWallDark);            // south, west of door
  box(36, 3, 42, 4, 0, 5, matWallDark);            // south, east of door
  box(25, -24, 26, -12, 0, 5, matWallDark);        // west, north of door
  box(25, -8, 26, 4, 0, 5, matWallDark);           // west, south of door
  vbox(25, -25, 43, 5, 5, 5.4, matRoof);           // roof slab (visual)
  box(28, -21, 31, -18, 0, 1.2, matCrate);         // fish crates
  box(37, -21, 40, -18, 0, 1.2, matCrate);
  box(28, -11, 30.5, -8.5, 0, 1.2, matCrate);
  // hall pillars
  box(30, -14, 30.6, -13.4, 0, 5, matSteel);
  box(37, -14, 37.6, -13.4, 0, 5, matSteel);

  // ---- Net Loft (mid, 2 storeys) --------------------------------------------
  box(-10, -19, -4, -18, 0, 4.6, matWall);         // north, west of door
  box(4, -19, 10, -18, 0, 4.6, matWall);           // north, east of door
  box(-10, 1, -4, 2, 0, 4.6, matWall);             // south, west of door
  box(4, 1, 10, 2, 0, 4.6, matWall);               // south, east of door
  box(-11, -18, -10, -4, 0, 4.6, matWall);         // west, north of door
  box(-11, 0, -10, 2, 0, 4.6, matWall);            // west, south of door
  box(10, -18, 11, -4, 0, 4.6, matWall);           // east, north of door
  box(10, 0, 11, 2, 0, 4.6, matWall);              // east, south of door
  // upper walkway slab (north half), top y=4
  box(-10, -18, 10, -8, 3.9, 4.0, matRoof);
  // walkway support posts
  box(-9.6, -17.6, -9.2, -17.2, 0, 3.9, matSteel);
  box(9.2, -17.6, 9.6, -17.2, 0, 3.9, matSteel);
  box(-9.6, -8.6, -9.2, -8.2, 0, 3.9, matSteel);
  box(9.2, -8.6, 9.6, -8.2, 0, 3.9, matSteel);
  // railing along walkway south edge
  box(-10, -8.3, 10, -8, 4, 5.1, matSteel);
  // stairs (west side, 8 steps of 0.5)
  for (let i = 0; i < 8; i++) {
    box(-10, 2 - (i + 1), -9, 2 - i, 0, 0.5 * (i + 1), matSteel);
  }
  // netting rolls on the walkway (visual)
  vbox(-8, -17, -5, -15, 4, 4.7, matCrate);
  vbox(5, -17, 8, -15, 4, 4.7, matCrate);

  // ---- lighthouse (Site A landmark) ------------------------------------------
  const lh = new THREE.Group();
  const lhMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.8 });
  const lhRed = new THREE.MeshStandardMaterial({ color: 0xa32e22, roughness: 0.8 });
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 13, 16), lhMat);
  cyl.position.y = 6.5; lh.add(cyl);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.1, 2.2, 16), lhRed);
  band.position.y = 9.5; lh.add(band);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.6, 12), matLampGlow);
  lamp.position.y = 13.6; lh.add(lamp);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 12), matLight);
  cap.position.y = 15.2; lh.add(cap);
  lh.position.set(-40, 0, -23); group.add(lh);
  colliders.push({ x0: -42.5, z0: -25.5, x1: -37.5, z1: -20.5, y0: 0, y1: 14 });

  // ---- containers / crates / barrels (cover) ---------------------------------
  box(-23, 14.8, -17, 17.2, 0, 2.6, matContainer);
  box(-3, 16.8, 3, 19.2, 0, 2.6, matContainer2);
  box(15, 13.8, 21, 16.2, 0, 2.6, matContainer);
  box(-30, 6.8, -24, 9.2, 0, 2.6, matContainer2);
  box(-41, 2, -37, 5, 0, 2.6, matContainer); // blocks the A-site -> ember-spawn lane
  box(-33.5, -15.5, -30.5, -12.5, 0, 1.2, matCrate);
  box(-28, -15, -25.5, -12.5, 0, 1.2, matCrate);
  box(28, -18.5, 30.5, -16, 0, 1.2, matCrate);
  box(-17.5, -24.5, -15, -22, 0, 1.2, matCrate);
  box(13, -24.5, 15.5, -22, 0, 1.2, matCrate);
  box(4.5, 11, 7, 13.5, 0, 1.2, matCrate);
  box(7, 21, 9.5, 23.5, 0, 1.2, matCrate);
  box(-41.5, 9, -39, 11.5, 0, 1.2, matCrate);
  box(38.5, 9, 41, 11.5, 0, 1.2, matCrate);
  // barrels (cylinder visual + box collider)
  const barrelPos = [[-26, 4], [-14, 22], [24, 20], [36, -4], [-8, -16], [16, -12]];
  for (const [bx, bz] of barrelPos) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.2, 12), matBarrel);
    b.position.set(bx, 0.6, bz); group.add(b);
    colliders.push({ x0: bx - 0.55, z0: bz - 0.55, x1: bx + 0.55, z1: bz + 0.55, y0: 0, y1: 1.2 });
  }
  // boat in the water (visual only)
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(10, 1.6, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 }));
  hull.position.y = 0.4; boat.add(hull);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 2.4),
    new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.8 }));
  cabin.position.set(-1, 1.8, 0); boat.add(cabin);
  boat.position.set(8, -0.3, 36); boat.rotation.y = 0.3; group.add(boat);

  // ---- signage (diegetic, big) ----------------------------------------------
  function sign(main, sub, w, x, y, z, ry, fg, bg) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4),
      new THREE.MeshStandardMaterial({ map: signTex(main, sub, fg, bg), roughness: 0.85 }));
    m.position.set(x, y, z); m.rotation.y = ry; group.add(m);
    return m;
  }
  sign('LANTERN QUAY', 'SITE A', 14, -43.4, 3.2, -10, Math.PI / 2, '#ffb042', '#14213d');
  sign('FISH HALL', 'SITE B', 12, 34, 4.6, 3.9, Math.PI, '#7fd4e8', '#14213d');
  sign('NET LOFT', '', 10, 0, 4.2, 2.1, 0, '#ffb042', '#1c2436');
  sign('TIDE GATE', '', 9, -18, 3.4, -27.9, 0, '#7fd4e8', '#1c2436');
  sign('QUAY 7', 'HARBOUR', 10, -20, 3.0, 27.9, Math.PI, '#ffb042', '#14213d');
  // floor letters over the plant zones
  for (const [letter, px, pz] of [['A', -34, -10], ['B', 35, -14]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(5, 5),
      new THREE.MeshStandardMaterial({ map: floorLetterTex(letter), transparent: true, roughness: 0.8 }));
    p.rotation.x = -Math.PI / 2; p.position.set(px, 0.03, pz); group.add(p);
  }
  // glowing site markers above plant zones
  const markerA = new THREE.Mesh(new THREE.OctahedronGeometry(0.55),
    new THREE.MeshStandardMaterial({ color: 0xffb042, emissive: 0xff9a1e, emissiveIntensity: 2.5 }));
  markerA.position.set(-34, 3.4, -10); group.add(markerA);
  const markerB = markerA.clone();
  markerB.position.set(35, 3.4, -14); group.add(markerB);

  // ---- lighting ---------------------------------------------------------------
  scene.background = new THREE.Color(0x0b1026);
  scene.fog = new THREE.FogExp2(0x0b1026, 0.011);
  const hemi = new THREE.HemisphereLight(0x33456e, 0x1a1410, 0.85);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0x8fb0ff, 0.9);
  moonLight.position.set(-30, 50, -20); scene.add(moonLight);
  // lantern point lights (warm orange) along the quay + sites
  const lanterns = [];
  const lampXs = [-36, -12, 12, 34];
  for (const lx of lampXs) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.6, 8), matLight);
    post.position.set(lx, 2.3, 25.5); group.add(post);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), matLampGlow);
    bulb.position.set(lx, 4.7, 25.5); group.add(bulb);
    const pl = new THREE.PointLight(0xff9a1e, 30, 22, 1.8);
    pl.position.set(lx, 4.6, 25.5); scene.add(pl);
    lanterns.push(pl);
  }
  const siteA = new THREE.PointLight(0xff9a1e, 22, 18, 1.8);
  siteA.position.set(-34, 4.5, -10); scene.add(siteA);
  const siteB = new THREE.PointLight(0xff9a1e, 22, 18, 1.8);
  siteB.position.set(35, 4.2, -14); scene.add(siteB);
  const loftLight = new THREE.PointLight(0xffc46b, 16, 16, 1.8);
  loftLight.position.set(0, 4.2, -8); scene.add(loftLight);

  // per-frame update: lantern flicker + marker bob (driven by sim time, not wall clock)
  function update(t) {
    for (let i = 0; i < lanterns.length; i++) {
      lanterns[i].intensity = 30 + Math.sin(t * 7 + i * 2.1) * 2.2 + Math.sin(t * 13.7 + i) * 1.4;
    }
    markerA.position.y = 3.4 + Math.sin(t * 1.6) * 0.25;
    markerB.position.y = 3.4 + Math.sin(t * 1.6 + 2) * 0.25;
    markerA.rotation.y = t * 0.8; markerB.rotation.y = t * 0.8 + 1;
  }

  return { colliders, update };
}
