// bots.js — named humanoid bots with a tactical AI.
// States: push / hold / plant / defuse / retake / search / dead.
// Bots follow waypoint routes, hold sites, react to sight and sound, and
// call out contacts on the radio. All decisions are deterministic given the
// seeded RNG the sim passes in.

import * as THREE from 'three';
import { hasLOS, moveCircle, angDiff, clamp } from './util.js';
import { findRoute, zoneAt, MAP } from './map.js';
import { WEAPONS } from './weapons.js';

export const EMBER_NAMES = ['Mara', 'Joss', 'Pike', 'Wren'];
export const WATCH_NAMES = ['Tobin', 'Nessa', 'Harrow', 'Kett', 'Brine'];

const TEAM_COLOR = { ember: 0xc96a1e, watch: 0x2e8fa3 };
const TEAM_COLOR_CSS = { ember: '#ff9a3c', watch: '#4fc3d9' };

function nameSprite(name, team) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = team === 'ember' ? 'rgba(40,20,4,0.85)' : 'rgba(4,26,34,0.85)';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = TEAM_COLOR_CSS[team]; g.lineWidth = 4; g.strokeRect(2, 2, 252, 60);
  g.fillStyle = TEAM_COLOR_CSS[team];
  g.font = '900 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: true }));
  s.scale.set(2.4, 0.6, 1);
  return s;
}

function buildBotModel(team) {
  const g = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[team], roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.6, emissive: TEAM_COLOR[team], emissiveIntensity: 0.35 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), dark);
  torso.position.y = 1.15; g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, 0.38), accent);
  vest.position.y = 1.22; g.add(vest);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), skin);
  head.position.y = 1.68; g.add(head);
  const helm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.36), dark);
  helm.position.y = 1.86; g.add(helm);
  const vis = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.1, 0.05), visor);
  vis.position.set(0, 1.7, 0.18); g.add(vis);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.78, 0.24), dark);
  legL.position.set(-0.16, 0.39, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.16; g.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), dark);
  armL.position.set(-0.4, 1.25, 0.12); armL.rotation.x = -0.9; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.4; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), accent);
  gun.position.set(0.18, 1.28, 0.35); g.add(gun);
  return { group: g, legL, legR, gun };
}

export function createBot(scene, opts) {
  const { id, name, team, x, z, weapon, skill, rng } = opts;
  const model = buildBotModel(team);
  model.group.position.set(x, 0, z);
  scene.add(model.group);
  const tag = nameSprite(name, team);
  tag.position.y = 2.15;
  model.group.add(tag);
  return {
    id, name, team, kind: 'bot', alive: true, hp: 100, armour: 0,
    x, z, y: 0, yaw: team === 'ember' ? -Math.PI / 2 : Math.PI / 2, pitch: 0,
    weapon: weapon || 'rifle', ammo: WEAPONS[weapon || 'rifle'].mag,
    reserve: WEAPONS[weapon || 'rifle'].reserve,
    state: 'push', route: [], routeIdx: 0, holdPos: null, holdYaw: 0,
    target: null, lastSeen: 0, reactAt: 0, aimErr: 0.06, exposure: 0,
    burstLeft: 0, burstPause: 0, shootTimer: 0, think: rng() * 0.1,
    skill, moveSpeed: 4.2, walkPhase: 0, channel: 0, channelKind: null,
    isCarrier: false, searchPos: null, model, tag, strafeDir: 1, strafeT: 0,
    headX: x, headY: 1.62, headZ: z, headR: 0.24,
    bodyBox: { x0: x - 0.35, x1: x + 0.35, y0: 0, y1: 1.7, z0: z - 0.35, z1: z + 0.35 },
  };
}

function syncHitbox(b) {
  b.headX = b.x; b.headY = b.y + 1.62; b.headZ = b.z;
  const bb = b.bodyBox;
  bb.x0 = b.x - 0.35; bb.x1 = b.x + 0.35; bb.y0 = b.y; bb.y1 = b.y + 1.7;
  bb.z0 = b.z - 0.35; bb.z1 = b.z + 0.35;
}

// Nearest visible enemy for a bot. Returns {e, dist} or null.
function scan(bot, ctx) {
  const eyeY = bot.y + 1.55;
  let best = null, bestD = Infinity;
  for (const e of ctx.enemiesOf(bot)) {
    if (!e.alive) continue;
    const dx = e.x - bot.x, dz = e.z - bot.z;
    const d = Math.hypot(dx, dz);
    if (d > 40 || d < 0.5) continue;
    // field of view ~110 deg, or very close
    const ang = Math.atan2(dx, dz);
    let diff = Math.abs(angDiff(bot.yaw, ang));
    if (d > 8 && diff > 1.1) continue;
    if (!hasLOS(bot.x, bot.z, e.x, e.z, ctx.colliders)) continue;
    if (ctx.inSmoke && ctx.inSmoke(bot.x, eyeY, bot.z, e.x, e.y + 1.4, e.z)) continue;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best ? { e: best, dist: bestD } : null;
}

function nearestNode(x, z) {
  let best = null, bd = Infinity;
  for (const [id, n] of Object.entries(MAP.nodes)) {
    const d = (n[0] - x) ** 2 + (n[1] - z) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

function routeTo(bot, nodeId) {
  const from = nearestNode(bot.x, bot.z);
  bot.route = findRoute(from, nodeId);
  bot.routeIdx = 0;
}

function decide(bot, ctx) {
  const rng = ctx.rng;
  const bomb = ctx.bomb;
  // dead / round over: idle
  if (ctx.phase === 'over' || ctx.phase === 'buy') { bot.state = 'hold'; return; }

  // Bomb planted: defenders retake/defuse, attackers hold the site.
  if (bomb.state === 'planted') {
    if (bot.team === 'watch') {
      const d = Math.hypot(bomb.x - bot.x, bomb.z - bot.z);
      if (d < 2.2) { bot.state = 'defuse'; bot.route = []; return; }
      bot.state = 'retake';
      // re-route only when the route is exhausted or the site changed;
      // routeTo() resets routeIdx, so calling it every think tick would
      // trap the bot oscillating around waypoint 0 forever
      if (bot.routeIdx >= bot.route.length || bot._retakeSite !== bomb.site) {
        routeTo(bot, bomb.site === 'A' ? 'aSite' : 'bSite');
        bot._retakeSite = bomb.site;
      }
      return;
    }
    bot.state = 'hold';
    bot.holdPos = [bomb.x + (rng() - 0.5) * 6, bomb.z + (rng() - 0.5) * 6];
    return;
  }

  // Carrier: push to the planned site and plant.
  if (bot.isCarrier && bot.team === 'ember') {
    const zone = ctx.plan.site === 'A' ? MAP.plantA : MAP.plantB;
    if (bot.x > zone.x0 && bot.x < zone.x1 && bot.z > zone.z0 && bot.z < zone.z1) {
      bot.state = 'plant'; bot.route = []; return;
    }
    if (bot.state !== 'push' || bot.routeIdx >= bot.route.length) {
      bot.state = 'push';
      routeTo(bot, ctx.plan.site === 'A' ? 'aSite' : 'bSite');
    }
    return;
  }

  // Combat: keep engaging a recently seen target.
  if (bot.target && ctx.time - bot.lastSeen < 1.2) {
    bot.state = 'engage';
    return;
  }

  // Follow the team plan route, then hold.
  if (bot.state === 'push') {
    if (bot.routeIdx >= bot.route.length) {
      bot.state = 'hold';
      bot.holdPos = [bot.x, bot.z];
      bot.holdYaw = bot.yaw;
    }
    return;
  }
  if (bot.state === 'search' && bot.searchPos) {
    const d = Math.hypot(bot.searchPos[0] - bot.x, bot.searchPos[1] - bot.z);
    if (d < 1.5) { bot.state = 'hold'; bot.holdPos = [bot.x, bot.z]; }
    return;
  }
  if (bot.state === 'hold' || bot.state === 'engage') {
    // resume an unfinished route when the round goes live (decide() set
    // everyone to hold during the buy phase, routes included)
    if (bot.route.length > 0 && bot.routeIdx < bot.route.length && ctx.phase === 'live') {
      bot.state = 'push';
      return;
    }
    // hear a recent sound event -> investigate
    const s = ctx.recentSound(bot);
    if (s && ctx.time - bot.lastSeen > 2) {
      bot.state = 'search'; bot.searchPos = [s.x, s.z];
      routeTo(bot, nearestNode(s.x, s.z));
    }
  }
}

function moveAlongRoute(bot, ctx, dt) {
  if (bot.routeIdx >= bot.route.length) return false;
  const [tx, tz] = bot.route[bot.routeIdx];
  const dx = tx - bot.x, dz = tz - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) { bot.routeIdx++; bot._lastWpDist = undefined; bot._stuckT = 0; return true; }
  // stuck detection: distance to the waypoint barely changes for 1.5 s
  // (wedged on a collider corner) -> skip to the next waypoint
  if (bot._lastWpDist === undefined || Math.abs(bot._lastWpDist - d) > 0.05) {
    bot._lastWpDist = d; bot._stuckT = 0;
  } else {
    bot._stuckT = (bot._stuckT || 0) + dt;
    if (bot._stuckT > 1.5) {
      bot.routeIdx++; bot._lastWpDist = undefined; bot._stuckT = 0;
      return true;
    }
  }
  const sp = bot.moveSpeed;
  const step = moveCircle(bot, (dx / d) * sp * dt, (dz / d) * sp * dt, 0.4, 1.7, ctx.colliders);
  bot.x = step.x; bot.z = step.z; bot.y = step.y;
  bot.yaw = Math.atan2(dx, dz);
  bot.walkPhase += dt * 9;
  return true;
}

function fireAt(bot, ctx, target, dt) {
  const w = WEAPONS[bot.weapon];
  bot.shootTimer -= dt * 1000;
  if (bot.shootTimer > 0) return;
  if (bot.burstLeft <= 0) {
    if (bot.burstPause > 0) { bot.burstPause -= dt; return; }
    bot.burstLeft = 3 + Math.floor(ctx.rng() * 3);
    bot.burstPause = 0.45 + ctx.rng() * 0.5;
  }
  bot.shootTimer = w.rof;
  bot.burstLeft--;
  if (bot.ammo <= 0) {
    bot.ammo = w.mag; bot.reserve -= w.mag;
    bot.shootTimer = 1600; bot.burstLeft = 0;
    return;
  }
  bot.ammo--;
  // aim error: shrinks with exposure, grows with distance + target speed
  const d = Math.hypot(target.x - bot.x, target.z - bot.z);
  const tSpeed = target.speed || 0;
  const pHit = clamp(0.58 - d * 0.008 - tSpeed * 0.05 + bot.skill * 0.25 - bot.aimErr, 0.06, 0.85);
  // muzzle position
  const mx = bot.x + Math.sin(bot.yaw) * 0.6, mz = bot.z + Math.cos(bot.yaw) * 0.6, my = bot.y + 1.35;
  let hx = target.x, hy = target.y + 1.2, hz = target.z;
  const hit = ctx.rng() < pHit;
  if (hit) {
    const head = ctx.rng() < (d < 12 ? 0.16 : 0.09);
    hy = head ? target.y + 1.62 : target.y + 1.1;
    ctx.damage(target, w.dmg * (head ? w.headMult : 1), head, bot);
  } else {
    // miss: scatter the tracer end point
    hx += (ctx.rng() - 0.5) * 2.4; hy += (ctx.rng() - 0.5) * 1.6; hz += (ctx.rng() - 0.5) * 2.4;
  }
  ctx.tracer(mx, my, mz, hx, hy, hz);
  ctx.shotSound(bot.x, bot.z, d);
  ctx.recoil(bot);
}

export function updateBot(bot, ctx, dt) {
  if (!bot.alive) return;
  bot.think -= dt;
  if (bot.think <= 0) {
    bot.think = 0.1;
    // flash-blinded: no perception, no target
    if (ctx.time < (bot.blindUntil || 0)) {
      bot.target = null;
      decide(bot, ctx);
      syncHitbox(bot);
      return;
    }
    // perception
    const seen = scan(bot, ctx);
    if (seen) {
      if (!bot.target) {
        bot.reactAt = ctx.time + 0.35 + seen.dist * 0.004 + ctx.rng() * 0.3;
        bot.exposure = 0;
        if (ctx.rng() < 0.45) ctx.radio(bot, `Contact at ${zoneAt(seen.e.x, seen.e.z)}, rotating`);
      }
      bot.target = seen.e; bot.lastSeen = ctx.time;
      bot.exposure += 0.1;
      bot.aimErr = clamp(0.09 - bot.exposure * 0.02, 0.015, 0.09);
    } else if (bot.target && ctx.time - bot.lastSeen > 1.2) {
      bot.target = null;
    }
    decide(bot, ctx);
  }

  // channel plant / defuse
  if (bot.state === 'plant' || bot.state === 'defuse') {
    const kind = bot.state;
    bot.channel += dt;
    const need = kind === 'plant' ? 3 : 5;
    if (bot.channel >= need) {
      bot.channel = 0;
      if (kind === 'plant') ctx.plantDone(bot); else ctx.defuseDone(bot);
    }
    // stand still while channelling; face the site
    syncHitbox(bot);
    return;
  }
  bot.channel = 0;

  // aiming at a live target
  if (bot.target && bot.target.alive && ctx.time >= bot.reactAt) {
    const dx = bot.target.x - bot.x, dz = bot.target.z - bot.z;
    const wantYaw = Math.atan2(dx, dz);
    bot.yaw += angDiff(bot.yaw, wantYaw) * Math.min(1, dt * 10);
    const d = Math.hypot(dx, dz);
    bot.pitch = Math.atan2((bot.target.y + 1.3) - (bot.y + 1.5), d);
    // strafe a little while engaging
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) { bot.strafeDir *= -1; bot.strafeT = 0.7 + ctx.rng() * 0.8; }
    const sx = Math.cos(bot.yaw) * bot.strafeDir, sz = -Math.sin(bot.yaw) * bot.strafeDir;
    const step = moveCircle(bot, sx * 1.1 * dt, sz * 1.1 * dt, 0.4, 1.7, ctx.colliders);
    bot.x = step.x; bot.z = step.z; bot.y = step.y;
    fireAt(bot, ctx, bot.target, dt);
  } else if (bot.state === 'push' || bot.state === 'retake' || bot.state === 'search') {
    moveAlongRoute(bot, ctx, dt);
  } else if (bot.state === 'hold') {
    // slow scan sweep
    bot.yaw += Math.sin(ctx.time * 0.5 + bot.id * 1.7) * dt * 0.35;
  }

  // sync the 3D model
  const m = bot.model.group;
  m.position.set(bot.x, bot.y, bot.z);
  m.rotation.y = bot.yaw;
  const moving = bot.state === 'push' || bot.state === 'retake' || bot.state === 'search';
  const sw = moving ? Math.sin(bot.walkPhase) * 0.45 : 0;
  bot.model.legL.rotation.x = sw;
  bot.model.legR.rotation.x = -sw;
  syncHitbox(bot);
}

export function killBot(bot, ctx) {
  bot.alive = false;
  bot.target = null;
  const m = bot.model.group;
  m.rotation.z = Math.PI / 2 * 0.9;
  m.position.y = 0.25;
  bot.tag.visible = false;
  syncHitbox(bot);
}
