// weapons.js — weapon definitions, hitscan firing, tracers, muzzle flash,
// viewmodel. All damage numbers live here; the sim calls fire() and reads
// back hit events. No DOM, no audio (audio.js owns sound).

import * as THREE from 'three';
import { rayBox, raySphere } from './util.js';

export const WEAPONS = {
  pistol: { name: 'VK-9 SIDEARM', slot: 2, price: 300, dmg: 34, headMult: 4, rof: 150, mag: 12, reserve: 36, spread: 0.011, moveSpread: 0.03, recoil: 0.011, auto: false, range: 60, pellets: 1, role: 'Sidearm' },
  rifle: { name: 'AR-77 VULTURE', slot: 1, price: 2700, dmg: 33, headMult: 4, rof: 100, mag: 25, reserve: 75, spread: 0.008, moveSpread: 0.028, recoil: 0.016, auto: true, range: 90, pellets: 1, role: 'Mid rifle' },
  smg: { name: 'SMG-9 JACKAL', slot: 1, price: 1500, dmg: 26, headMult: 3.5, rof: 80, mag: 32, reserve: 96, spread: 0.014, moveSpread: 0.022, recoil: 0.009, auto: true, range: 45, pellets: 1, role: 'Close quarters' },
  shotgun: { name: 'SG-12 BREACHER', slot: 1, price: 2000, dmg: 12, headMult: 2, rof: 800, mag: 6, reserve: 18, spread: 0.045, moveSpread: 0.05, recoil: 0.05, auto: false, range: 22, pellets: 8, role: 'Site hold' },
  knife: { name: 'K-1 CUTTER', slot: 3, price: 0, dmg: 40, headMult: 1, rof: 500, mag: Infinity, reserve: 0, spread: 0, moveSpread: 0, recoil: 0, auto: false, range: 2.2, pellets: 1, role: 'Melee' },
};

export const GRENADES = {
  frag: { name: 'FRAG-7', price: 300, dmg: 80, radius: 6 },
  flash: { name: 'FLASH-2', price: 200 },
  smoke: { name: 'SMOKE-4', price: 300 },
};

// One shot: hitscan from origin along dir (normalized).
// targets: [{x,y,z, alive, isHead...}] — actually entities with hitTest API:
//   each target provides head {x,y,z,r} and body box {x0,y0,z0,x1,y1,z1}.
// colliders: wall boxes. Returns {hit, target, head, dist, point} or {hit:false, dist, point}.
export function hitscan(ox, oy, oz, dx, dy, dz, range, targets, colliders) {
  let best = Infinity, bestTarget = null, bestHead = false;
  for (const t of targets) {
    if (!t.alive) continue;
    const hd = raySphere(ox, oy, oz, dx, dy, dz, t.headX, t.headY, t.headZ, t.headR);
    if (hd < best) { best = hd; bestTarget = t; bestHead = true; }
    const bd = rayBox(ox, oy, oz, dx, dy, dz, t.bodyBox);
    if (bd < best) { best = bd; bestTarget = t; bestHead = false; }
  }
  let wall = Infinity;
  for (let i = 0; i < colliders.length; i++) {
    const d = rayBox(ox, oy, oz, dx, dy, dz, colliders[i]);
    if (d < wall) wall = d;
  }
  const dist = Math.min(best, wall, range);
  return {
    hit: bestTarget !== null && best <= wall && best <= range,
    target: bestTarget, head: bestHead, dist,
    point: [ox + dx * dist, oy + dy * dist, oz + dz * dist],
  };
}

// ---- viewmodel --------------------------------------------------------------
// A small gun built from boxes, parented to the camera, with a simple hand.
// One viewmodel per weapon kind; swap by visibility.
export function buildViewmodels(camera) {
  const group = new THREE.Group();
  camera.add(group);
  const models = {};
  const matGun = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.45, metalness: 0.7 });
  const matGun2 = new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.6, metalness: 0.3 });
  const matAccent = new THREE.MeshStandardMaterial({ color: 0xc96a1e, roughness: 0.5, metalness: 0.4 });
  const matHand = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });

  function part(parent, w, h, d, x, y, z, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || matGun);
    m.position.set(x, y, z); parent.add(m); return m;
  }

  function baseGun() {
    const g = new THREE.Group();
    part(g, 0.09, 0.11, 0.5, 0, 0, -0.1);            // receiver
    part(g, 0.05, 0.05, 0.34, 0, 0.02, -0.42);      // barrel
    part(g, 0.07, 0.09, 0.12, 0, -0.09, 0.02, matGun2); // grip
    part(g, 0.06, 0.1, 0.1, 0, -0.1, -0.18, matGun2);   // magazine
    part(g, 0.02, 0.05, 0.02, 0, 0.09, -0.3, matAccent); // front sight
    part(g, 0.09, 0.06, 0.2, 0, -0.02, -0.05, matHand);  // hand guard
    return g;
  }
  const rifle = baseGun();
  part(rifle, 0.03, 0.03, 0.22, 0, 0.045, -0.5, matAccent); // long barrel tip
  const smg = baseGun();
  smg.scale.set(0.85, 0.85, 0.7);
  part(smg, 0.1, 0.04, 0.08, 0, 0.07, -0.05, matGun2); // top rail
  const shotgun = baseGun();
  part(shotgun, 0.07, 0.07, 0.42, 0, 0.01, -0.45);   // fat barrel
  part(shotgun, 0.08, 0.05, 0.3, 0, -0.06, -0.35, matGun2); // pump
  shotgun.scale.set(1.05, 1.05, 1.05);
  const pistol = new THREE.Group();
  part(pistol, 0.07, 0.09, 0.3, 0, 0, -0.05);
  part(pistol, 0.05, 0.05, 0.12, 0, 0.01, -0.26);
  part(pistol, 0.06, 0.11, 0.09, 0, -0.09, 0.04, matGun2);
  const knife = new THREE.Group();
  part(knife, 0.015, 0.1, 0.34, 0, 0.02, -0.25, new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.25, metalness: 0.9 }));
  part(knife, 0.05, 0.06, 0.12, 0, -0.04, -0.02, matGun2);

  models.rifle = rifle; models.smg = smg; models.shotgun = shotgun;
  models.pistol = pistol; models.knife = knife;
  for (const k of Object.keys(models)) {
    models[k].position.set(0.32, -0.28, -0.55);
    models[k].visible = false;
    group.add(models[k]);
  }
  // hand on the grip
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.14), matHand);
  hand.position.set(0.32, -0.36, -0.5); group.add(hand);
  // muzzle flash: two crossed bright planes + point light at the barrel tip
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, side: THREE.DoubleSide });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flash.position.set(0.32, -0.26, -1.05); group.add(flash);
  const flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), flashMat);
  flash2.position.copy(flash.position); flash2.rotation.y = Math.PI / 2; group.add(flash2);
  const flashLight = new THREE.PointLight(0xffb042, 0, 9, 1.6);
  flashLight.position.set(0.32, -0.2, -1.0); group.add(flashLight);

  return {
    group, models, flash, flashMat, flashLight, hand,
    show(kind) {
      for (const k of Object.keys(models)) models[k].visible = (k === kind);
      this.hand.visible = kind !== 'knife';
    },
    kick(amount) {
      for (const k of Object.keys(models)) {
        models[k].position.z = -0.55 + amount * 0.12;
        models[k].position.y = -0.28 + amount * 0.05;
      }
    },
    fireFlash(strength) {
      flashMat.opacity = strength;
      flash.rotation.z = Math.random() * Math.PI;
      flashLight.intensity = 26 * strength;
      const s = 0.7 + Math.random() * 0.6;
      flash.scale.set(s, s, s);
    },
  };
}

// ---- tracers + impacts --------------------------------------------------------
// Pooled line segments, faded over 90 ms. No per-frame allocation.
export function buildTracers(scene, max = 28) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 6);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  const slots = [];
  for (let i = 0; i < max; i++) slots.push({ life: 0, x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 });
  let cursor = 0;
  return {
    spawn(x0, y0, z0, x1, y1, z1) {
      const s = slots[cursor]; cursor = (cursor + 1) % max;
      s.life = 0.09; s.x0 = x0; s.y0 = y0; s.z0 = z0; s.x1 = x1; s.y1 = y1; s.z1 = z1;
    },
    update(dt) {
      let n = 0;
      for (let i = 0; i < max; i++) {
        const s = slots[i];
        if (s.life <= 0) continue;
        s.life -= dt;
        pos[n * 6] = s.x0; pos[n * 6 + 1] = s.y0; pos[n * 6 + 2] = s.z0;
        pos[n * 6 + 3] = s.x1; pos[n * 6 + 4] = s.y1; pos[n * 6 + 5] = s.z1;
        n++;
      }
      geo.setDrawRange(0, n * 2);
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.9;
    },
  };
}

// Impact sparks: small pooled points burst.
export function buildSparks(scene, max = 120) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.09, transparent: true, opacity: 0.95 });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  const parts = [];
  for (let i = 0; i < max; i++) parts.push({ life: 0, vx: 0, vy: 0, vz: 0 });
  let cursor = 0;
  return {
    burst(x, y, z, n) {
      for (let k = 0; k < n; k++) {
        const p = parts[cursor]; cursor = (cursor + 1) % max;
        p.life = 0.25 + Math.random() * 0.2;
        p.vx = (Math.random() - 0.5) * 4; p.vy = Math.random() * 3 + 1; p.vz = (Math.random() - 0.5) * 4;
        pos[cursor * 3] = x; pos[cursor * 3 + 1] = y; pos[cursor * 3 + 2] = z;
      }
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        const p = parts[i];
        if (p.life <= 0) { pos[i * 3 + 1] = -100; continue; }
        p.life -= dt;
        pos[i * 3] += p.vx * dt; pos[i * 3 + 1] += p.vy * dt; pos[i * 3 + 2] += p.vz * dt;
        p.vy -= 9 * dt;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
