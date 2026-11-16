// main.js — LANTERN QUAY bootstrap + fixed-step simulation.
// One state object (G) holds everything. The sim runs at a fixed 60 Hz,
// rendering reads the sim state; nothing in the sim uses wall-clock time,
// so staged screenshots and autotest are reproducible from a seed.

import * as THREE from 'three';
import { buildMap, MAP, findRoute } from './map.js';
import { WEAPONS, GRENADES, hitscan, buildViewmodels, buildTracers, buildSparks } from './weapons.js';
import { createBot, updateBot, killBot, EMBER_NAMES, WATCH_NAMES } from './bots.js';
import { createAudio } from './audio.js';
import { createHUD } from './hud.js';
import { mulberry32, clamp, moveCircle, hasLOS } from './util.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1337', 10);
const SHOT = params.get('shot') || null;
const AUTOTEST = params.get('autotest') === '1';

const rng = mulberry32(SEED);
const audio = createAudio();
const hud = createHUD(document);

// ---- three.js setup ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const map = buildMap(scene);
const colliders = map.colliders;
const viewmodel = buildViewmodels(camera);
const tracers = buildTracers(scene);
const sparks = buildSparks(scene);

// ---- game state ---------------------------------------------------------------
const FIRST_TO = 5;
const G = {
  time: 0, tick: 0, phase: 'menu', // menu | buy | live | planted | over | matchover
  round: 1, score: { ember: 0, watch: 0 },
  roundTimer: 0, frozen: false, started: false,
  plan: { site: 'A', label: 'SPLIT A', playerRole: 'ENTRY' },
  bomb: { state: 'none', carrierId: null, site: null, x: 0, z: 0, timer: 0 },
  sounds: [], // {x,z,time}
  smokes: [], // {x,y,z,until}
  grenades: [], // live projectiles
  spotted: new Map(), // enemy id -> time last seen by player
  kills: [], // {name, team, k, d}
  flashUntil: 0, // player flash-blind until (sim time)
  overReason: '',
  autotestLog: [],
};

const player = {
  id: 0, name: 'You', team: 'ember', kind: 'player', alive: true,
  hp: 100, armour: 0, cash: 800, x: -40, z: 20, y: 0,
  yaw: Math.PI / 2, pitch: 0, speed: 0, crouch: false,
  weapon: 'pistol', ammo: 12, reserve: 36,
  owned: ['pistol', 'knife'], grenades: { frag: 0, flash: 0, smoke: 0 },
  kills: 0, deaths: 0, isCarrier: false,
  recoil: 0, spreadBloom: 0, fireTimer: 0, reloadUntil: 0, reloadWeapon: null,
  channel: 0, channelKind: null, blindUntil: 0,
  headX: -40, headY: 1.62, headZ: 20, headR: 0.24,
  bodyBox: { x0: -40.35, x1: -39.65, y0: 0, y1: 1.7, z0: 19.65, z1: 20.35 },
  keys: {},
};
function syncPlayerHitbox() {
  player.headX = player.x; player.headY = player.y + 1.62; player.headZ = player.z;
  const b = player.bodyBox, h = player.crouch ? 1.15 : 1.7;
  b.x0 = player.x - 0.35; b.x1 = player.x + 0.35;
  b.y0 = player.y; b.y1 = player.y + h;
  b.z0 = player.z - 0.35; b.z1 = player.z + 0.35;
}

let bots = [];
let spectateBot = null;

// ---- helpers ------------------------------------------------------------------
function aliveOf(team) {
  let n = player.team === team && player.alive ? 1 : 0;
  for (const b of bots) if (b.team === team && b.alive) n++;
  return n;
}
function entitiesOf(team) {
  const out = [];
  if (player.team === team) out.push(player);
  for (const b of bots) if (b.team === team) out.push(b);
  return out;
}
function entityById(id) {
  if (id === 0) return player;
  return bots.find((b) => b.id === id);
}
function radio(bot, text) {
  hud.addRadio(bot.name, bot.team, text);
  audio.radio();
}
function addSound(x, z) {
  G.sounds.push({ x, z, time: G.time });
  if (G.sounds.length > 24) G.sounds.shift();
}
function inSmoke(ax, ay, az, bx, by, bz) {
  for (const s of G.smokes) {
    if (G.time > s.until) continue;
    // distance from segment to smoke center
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const t = clamp(((s.x - ax) * abx + (s.y - ay) * aby + (s.z - az) * abz) / (abx * abx + aby * aby + abz * abz || 1), 0, 1);
    const dx = ax + abx * t - s.x, dy = ay + aby * t - s.y, dz = az + abz * t - s.z;
    if (dx * dx + dy * dy + dz * dz < 2.4 * 2.4) return true;
  }
  return false;
}

// ---- damage / kills ------------------------------------------------------------
function damage(target, amount, head, attacker) {
  if (!target.alive) return;
  let left = amount;
  if (target.armour > 0) {
    const absorbed = Math.min(target.armour, left * 0.5);
    target.armour -= absorbed; left -= absorbed;
  }
  target.hp -= left;
  if (target === player) {
    hud.damageFlash(); audio.hurt();
    hud.setHealth(player.hp, player.armour);
  }
  if (attacker === player && target !== player) {
    hud.hitmarker(head, Math.round(amount));
    audio[head ? 'headshot' : 'hit']();
    G.spotted.set(target.id, G.time);
  }
  if (target.hp <= 0) {
    target.hp = 0; target.alive = false; target.deaths = (target.deaths || 0) + 1;
    if (attacker) attacker.kills = (attacker.kills || 0) + 1;
    const aName = attacker ? attacker.name : '—';
    hud.addKill(`${aName}  ✕  ${target.name}${head ? '  [HEADSHOT]' : ''}`, head);
    if (attacker) attacker.cash = (attacker.cash || 0) + 300;
    if (attacker === player) { audio.kill(); hud.setCash(player.cash); }
    if (target.kind === 'bot') {
      killBot(target, ctx);
    } else {
      // player died: spectate a random alive ally
      const allies = bots.filter((b) => b.team === 'ember' && b.alive);
      spectateBot = allies.length ? allies[Math.floor(rng() * allies.length)] : null;
      hud.showBanner('YOU ARE DOWN', spectateBot ? `Spectating ${spectateBot.name}` : 'No allies left', 0);
      viewmodel.group.visible = false;
    }
    if (target.isCarrier) dropBomb(target.x, target.z);
  }
}

function dropBomb(x, z) {
  if (G.bomb.state !== 'carried') return;
  G.bomb.state = 'dropped'; G.bomb.x = x; G.bomb.z = z; G.bomb.carrierId = null;
  const c = entityById(G.bomb.carrierId);
  if (c) c.isCarrier = false;
}

// ---- bomb ----------------------------------------------------------------------
function plantDone(bot) {
  G.bomb.state = 'planted';
  G.bomb.site = bot.team === 'ember' ? (inZoneA(bot) ? 'A' : 'B') : G.bomb.site;
  G.bomb.x = bot.x; G.bomb.z = bot.z; G.bomb.timer = 35;
  G.phase = 'planted'; G.roundTimer = 35;
  bot.cash = (bot.cash || 0) + 300;
  radio(bot, `Charge planted at ${G.bomb.site === 'A' ? 'Lantern Quay' : 'Fish Hall'} — hold it`);
  hud.setObjective(`DEFUSE AT ${G.bomb.site}: 35 S`, true);
  hud.showBanner('CHARGE PLANTED', G.bomb.site === 'A' ? 'Lantern Quay' : 'Fish Hall', 2600);
  audio.plantBeep();
}
function inZoneA(e) {
  return e.x >= MAP.plantA.x0 && e.x <= MAP.plantA.x1 && e.z >= MAP.plantA.z0 && e.z <= MAP.plantA.z1;
}
function defuseDone(bot) {
  endRound('watch', `DEFUSED AT ${G.bomb.site === 'A' ? 'LANTERN QUAY' : 'FISH HALL'}`);
}

// ---- rounds ----------------------------------------------------------------------
const PLANS = [
  { site: 'A', label: 'SPLIT A', playerRole: 'ENTRY' },
  { site: 'B', label: 'RUSH B', playerRole: 'ENTRY' },
  { site: 'A', label: 'MID CONTROL', playerRole: 'MID' },
  { site: 'B', label: 'QUAY PUSH', playerRole: 'LURK' },
];

function startRound() {
  G.phase = 'buy'; G.roundTimer = 12; G.time = 0;
  G.bomb = { state: 'none', carrierId: null, site: null, x: 0, z: 0, timer: 0 };
  G.smokes = []; G.grenades = []; G.sounds = [];
  G.plan = PLANS[Math.floor(rng() * PLANS.length)];
  // reset player
  const sp = MAP.emberSpawn[0];
  Object.assign(player, {
    alive: true, hp: 100, armour: player.armour, x: sp[0], z: sp[1], y: 0,
    yaw: Math.PI / 2, pitch: 0, recoil: 0, spreadBloom: 0, fireTimer: 0,
    reloadUntil: 0, channel: 0, channelKind: null, blindUntil: 0, isCarrier: false,
  });
  viewmodel.group.visible = true;
  spectateBot = null;
  hud.hideBanner();
  // (re)build bots
  for (const b of bots) b.model.group.removeFromParent();
  bots = [];
  const emberSpawns = MAP.emberSpawn, watchSpawns = MAP.watchSpawn;
  for (let i = 0; i < 4; i++) {
    const w = G.round === 1 ? 'pistol' : (rng() < 0.7 ? 'rifle' : 'smg');
    bots.push(createBot(scene, {
      id: 10 + i, name: EMBER_NAMES[i], team: 'ember',
      x: emberSpawns[i + 1][0], z: emberSpawns[i + 1][1],
      weapon: w, skill: 0.55 + rng() * 0.2, rng,
    }));
  }
  for (let i = 0; i < 5; i++) {
    const w = G.round === 1 ? 'pistol' : (rng() < 0.6 ? 'rifle' : (rng() < 0.5 ? 'smg' : 'shotgun'));
    bots.push(createBot(scene, {
      id: 20 + i, name: WATCH_NAMES[i], team: 'watch',
      x: watchSpawns[i][0], z: watchSpawns[i][1],
      weapon: w, skill: 0.55 + rng() * 0.22, rng,
    }));
  }
  // carrier: a random ember (player 30% of the time)
  const emberAlive = bots.filter((b) => b.team === 'ember');
  if (rng() < 0.3) {
    player.isCarrier = true; G.bomb.state = 'carried'; G.bomb.carrierId = 0;
  } else {
    const c = emberAlive[Math.floor(rng() * emberAlive.length)];
    c.isCarrier = true; G.bomb.state = 'carried'; G.bomb.carrierId = c.id;
  }
  // assign routes by plan
  const siteNode = G.plan.site === 'A' ? 'aSite' : 'bSite';
  const holdNodes = G.plan.site === 'A' ? ['aSite', 'aHold', 'loft', 'midS'] : ['bSite', 'bHold', 'bHall', 'quayE'];
  for (const b of bots) {
    if (b.team === 'ember') {
      b.state = 'push';
      const target = b.isCarrier ? siteNode : holdNodes[bots.indexOf(b) % holdNodes.length];
      const from = nearestNodeOf(b);
      b.route = findRouteLocal(from, target); b.routeIdx = 0;
    } else {
      b.state = 'hold';
      const spots = G.plan.site === 'A'
        ? [['aSite', 'aHold'], ['loft', 'midS'], ['bSite', 'quayE']]
        : [['bSite', 'bHold'], ['bHall', 'quayE'], ['aSite', 'loft']];
      const pick = spots[bots.indexOf(b) % spots.length];
      const node = pick[Math.floor(rng() * pick.length)];
      const from = nearestNodeOf(b);
      b.route = findRouteLocal(from, node); b.routeIdx = 0;
      b.state = 'push'; // walk to the hold spot, then hold
    }
  }
  hud.setPlan(`PLAN: ${G.plan.label} — YOU: ${G.plan.playerRole}`);
  hud.setObjective(player.isCarrier ? `YOU CARRY THE CHARGE — PLANT AT ${G.plan.site}` : `PLANT AT ${G.plan.site} — FOLLOW ${G.plan.label}`, false);
  hud.setScore(G.score.ember, G.score.watch, G.round, FIRST_TO);
  hud.setHealth(player.hp, player.armour);
  hud.setCash(player.cash);
  hud.setAmmo(player.ammo, player.reserve, WEAPONS[player.weapon].name);
  hud.setSlots(player.weapon, player.owned, player.grenades);
  hud.showBanner(`ROUND ${G.round}`, `PLAN: ${G.plan.label} — EMBER CO-OP vs HARBOUR WATCH`, 2800);
  syncPlayerHitbox();
}

function nearestNodeOf(b) {
  let best = null, bd = Infinity;
  for (const [id, n] of Object.entries(MAP.nodes)) {
    const d = (n[0] - b.x) ** 2 + (n[1] - b.z) ** 2;
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}
function findRouteLocal(from, to) { return findRoute(from, to); }

function endRound(winner, reason) {
  if (G.phase === 'over' || G.phase === 'matchover') return;
  G.score[winner]++;
  const win = winner === 'ember';
  for (const e of entitiesOf('ember').concat(entitiesOf('watch'))) {
    if (e.alive) e.cash = (e.cash || 0) + (e.team === winner ? 3250 : 1900);
  }
  G.overReason = reason;
  G.phase = 'over'; G.roundTimer = 4;
  hud.setScore(G.score.ember, G.score.watch, G.round, FIRST_TO);
  hud.setObjective('', false);
  hud.showBanner(win ? 'ROUND WON' : 'ROUND LOST', reason, 0);
  audio[win ? 'roundWin' : 'roundLose']();
  if (G.score.ember >= FIRST_TO || G.score.watch >= FIRST_TO || G.round >= 2 * FIRST_TO - 1) {
    G.phase = 'matchover';
    hud.showBanner(G.score.ember > G.score.watch ? 'MATCH WON — EMBER CO-OP' : 'MATCH LOST — HARBOUR WATCH',
      `Final ${G.score.ember} — ${G.score.watch} · LANTERN QUAY`, 0);
  }
}

// ---- player shooting ---------------------------------------------------------------
function playerShoot() {
  const w = WEAPONS[player.weapon];
  if (player.weapon === 'knife') {
    // melee: short-range arc
    const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
    let best = null, bd = w.range;
    for (const e of entitiesOf('watch')) {
      if (!e.alive) continue;
      const ex = e.x - player.x, ez = e.z - player.z;
      const d = Math.hypot(ex, ez);
      if (d < bd && Math.abs(Math.atan2(ex, ez) - player.yaw) < 0.6) { bd = d; best = e; }
    }
    audio.shot('knife');
    if (best) damage(best, w.dmg, false, player);
    player.fireTimer = w.rof;
    return;
  }
  if (player.ammo <= 0) { audio.dryClick(); player.fireTimer = 250; return; }
  player.ammo--;
  player.fireTimer = w.rof;
  // spread: base + movement + bloom + recoil
  const moving = player.speed > 0.5 ? 1 : 0;
  const spread = w.spread + w.moveSpread * moving + player.spreadBloom + (player.crouch ? -0.004 : 0);
  const eyeY = player.y + 1.62;
  const ox = player.x, oy = eyeY, oz = player.z;
  for (let p = 0; p < w.pellets; p++) {
    const a = (rng() - 0.5) * 2 * spread, b = (rng() - 0.5) * 2 * spread;
    const yaw = player.yaw + a, pitch = player.pitch + b;
    const dx = Math.sin(yaw) * Math.cos(pitch), dy = Math.sin(pitch), dz = Math.cos(yaw) * Math.cos(pitch);
    const res = hitscan(ox, oy, oz, dx, dy, dz, w.range, entitiesOf('watch'), colliders);
    tracers.spawn(ox + dx * 0.7, oy - 0.12, oz + dz * 0.7, res.point[0], res.point[1], res.point[2]);
    if (res.hit) {
      damage(res.target, w.dmg * (res.head ? w.headMult : 1) * (res.dist > 40 ? 0.8 : 1), res.head, player);
    } else if (res.dist < w.range) {
      sparks.burst(res.point[0], res.point[1], res.point[2], 4);
    }
  }
  player.recoil = Math.min(0.09, player.recoil + w.recoil);
  player.spreadBloom = Math.min(0.05, player.spreadBloom + w.recoil * 0.5);
  viewmodel.fireFlash(1);
  viewmodel.kick(1);
  audio.shot(player.weapon);
  addSound(player.x, player.z);
}

function playerReload() {
  const w = WEAPONS[player.weapon];
  if (player.reloadUntil > 0 || player.ammo === w.mag || player.reserve <= 0 || w.mag === Infinity) return;
  player.reloadUntil = G.time + (player.weapon === 'rifle' ? 2.2 : 1.6);
  player.reloadWeapon = player.weapon;
  audio.reload();
}

function switchWeapon(key) {
  const w = WEAPONS[key];
  if (!w || !player.owned.includes(key) || player.weapon === key) return;
  storeAmmo();
  player.weapon = key;
  player.ammo = w.mag === Infinity ? Infinity : playerAmmo(key);
  player.reserve = playerReserve(key);
  player.reloadUntil = 0;
  viewmodel.show(key);
  hud.setAmmo(player.ammo, player.reserve, w.name);
  hud.setSlots(player.weapon, player.owned, player.grenades);
}
const ammoStore = {};
function playerAmmo(k) { return ammoStore[k] !== undefined ? ammoStore[k].mag : WEAPONS[k].mag; }
function playerReserve(k) { return ammoStore[k] !== undefined ? ammoStore[k].reserve : WEAPONS[k].reserve; }
function storeAmmo() {
  const w = WEAPONS[player.weapon];
  if (w.mag !== Infinity) ammoStore[player.weapon] = { mag: player.ammo, reserve: player.reserve };
}

function throwGrenade(kind) {
  if (!player.grenades[kind]) return;
  player.grenades[kind]--;
  const dx = Math.sin(player.yaw), dz = Math.cos(player.yaw);
  G.grenades.push({
    kind, x: player.x + dx * 0.6, y: player.y + 1.4, z: player.z + dz * 0.6,
    vx: dx * 14, vy: 4.5 + player.pitch * 8, vz: dz * 14,
    fuse: kind === 'frag' ? 1.6 : kind === 'flash' ? 1.1 : 0.9, owner: player,
  });
  hud.setSlots(player.weapon, player.owned, player.grenades);
  audio.shot('pistol', 0);
}

function explodeGrenade(gr) {
  if (gr.kind === 'frag') {
    audio.explosion();
    sparks.burst(gr.x, gr.y, gr.z, 24);
    for (const e of entitiesOf('ember').concat(entitiesOf('watch'))) {
      if (!e.alive || e === gr.owner) continue;
      const d = Math.hypot(e.x - gr.x, e.z - gr.z);
      if (d < GRENADES.frag.radius) {
        damage(e, GRENADES.frag.dmg * (1 - d / (GRENADES.frag.radius * 1.4)), false, gr.owner);
      }
    }
  } else if (gr.kind === 'flash') {
    audio.flash();
    for (const e of entitiesOf('ember').concat(entitiesOf('watch'))) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - gr.x, (e.y + 1.4) - gr.y, e.z - gr.z);
      if (d > 26) continue;
      if (!hasLOSGrenade(gr.x, gr.y, gr.z, e.x, e.y + 1.4, e.z)) continue;
      const dur = clamp(2.6 - d * 0.07, 0.6, 2.6);
      if (e === player) { player.blindUntil = G.time + dur; hud.flashWhite(0.95); }
      else e.blindUntil = G.time + dur;
    }
  } else {
    G.smokes.push({ x: gr.x, y: gr.y + 0.4, z: gr.z, until: G.time + 12 });
    sparks.burst(gr.x, gr.y, gr.z, 10);
  }
}
function hasLOSGrenade(ax, ay, az, bx, by, bz) { return hasLOS(ax, az, bx, bz, colliders); }

// ---- bot context -------------------------------------------------------------------
const ctx = {
  get time() { return G.time; },
  rng,
  get phase() { return G.phase; },
  get bomb() { return G.bomb; },
  get plan() { return G.plan; },
  colliders,
  inSmoke,
  enemiesOf(bot) {
    return entitiesOf(bot.team === 'ember' ? 'watch' : 'ember').filter((e) => e.alive);
  },
  damage,
  tracer: (x0, y0, z0, x1, y1, z1) => tracers.spawn(x0, y0, z0, x1, y1, z1),
  shotSound(x, z, d) {
    const pd = Math.hypot(x - player.x, z - player.z);
    if (pd < 45) audio.shot('rifle', pd);
    addSound(x, z);
  },
  recoil() {},
  radio,
  plantDone, defuseDone,
  recentSound(bot) {
    for (let i = G.sounds.length - 1; i >= 0; i--) {
      const s = G.sounds[i];
      if (G.time - s.time < 6 && Math.hypot(s.x - bot.x, s.z - bot.z) < 26) return s;
    }
    return null;
  },
};

// ---- fixed-step sim ------------------------------------------------------------------
const DT = 1 / 60;
let acc = 0, lastT = performance.now();

function simStep() {
  G.time += DT; G.tick++;
  // round timer
  if (G.phase === 'buy') {
    G.roundTimer -= DT;
    if (G.roundTimer <= 0) { G.phase = 'live'; G.roundTimer = 100; hud.hideBuy(); hud.setObjective(player.isCarrier ? `YOU CARRY THE CHARGE — PLANT AT ${G.plan.site}` : `PLANT AT ${G.plan.site}`, false); }
  } else if (G.phase === 'live') {
    G.roundTimer -= DT;
    if (G.roundTimer <= 0) endRound('watch', 'TIME EXPIRED — CHARGE NEVER PLANTED');
  } else if (G.phase === 'planted') {
    G.roundTimer -= DT;
    if (G.roundTimer <= 0) {
      // detonation
      audio.explosion();
      sparks.burst(G.bomb.x, 1, G.bomb.z, 40);
      for (const e of entitiesOf('ember').concat(entitiesOf('watch'))) {
        if (e.alive && Math.hypot(e.x - G.bomb.x, e.z - G.bomb.z) < 10) damage(e, 500, false, null);
      }
      endRound('ember', `CHARGE DETONATED AT SITE ${G.bomb.site}`);
    } else if (Math.ceil(G.roundTimer * 2) !== Math.ceil((G.roundTimer + DT) * 2)) {
      audio.plantBeep();
    }
  } else if (G.phase === 'over') {
    G.roundTimer -= DT;
    if (G.roundTimer <= 0 && G.phase === 'over') {
      G.round++;
      if (G.score.ember >= FIRST_TO || G.score.watch >= FIRST_TO || G.round > 2 * FIRST_TO - 1) {
        G.phase = 'matchover';
      } else startRound();
    }
  }

  // bomb pickup (dropped)
  if (G.bomb.state === 'dropped') {
    for (const e of entitiesOf('ember')) {
      if (e.alive && Math.hypot(e.x - G.bomb.x, e.z - G.bomb.z) < 1.6) {
        e.isCarrier = true; G.bomb.state = 'carried'; G.bomb.carrierId = e.id;
        if (e === player) hud.setObjective(`YOU CARRY THE CHARGE — PLANT AT ${G.plan.site}`, false);
        break;
      }
    }
  }

  // player update (or the autotest bot driving the player slot)
  if (G.autoBot) {
    updateBot(G.autoBot, ctx, DT);
    camera.position.set(G.autoBot.x, G.autoBot.y + 1.62, G.autoBot.z);
    camera.rotation.set(G.autoBot.pitch || 0, G.autoBot.yaw + Math.PI, 0);
  } else {
    updatePlayer(DT);
  }
  // bots
  for (const b of bots) updateBot(b, ctx, DT);
  // grenades
  updateGrenades(DT);
  // round end by elimination (only when bomb not planted)
  if ((G.phase === 'live' || G.phase === 'buy') && G.bomb.state !== 'planted') {
    if (aliveOf('ember') === 0) endRound('watch', 'EMBER CO-OP ELIMINATED');
    else if (aliveOf('watch') === 0) endRound('ember', 'HARBOUR WATCH ELIMINATED');
  }
  // HUD timer/score refresh (cheap, every tick is fine at 60Hz for text)
  if (G.phase === 'buy' || G.phase === 'live' || G.phase === 'planted') hud.setTimer(G.roundTimer);
  if (G.phase === 'planted') hud.setObjective(`DEFUSE AT ${G.bomb.site}: ${Math.ceil(G.roundTimer)} S`, true);
  updateMinimap();
}

function updateMinimap() {
  hud.drawMinimap({
    colliders,
    player, allies: bots.filter((b) => b.team === 'ember'),
    enemies: bots.filter((b) => b.team === 'watch'),
    bomb: G.bomb, spotted: G.spotted,
  });
  for (const [id, t] of G.spotted) if (G.time - t > 4) G.spotted.delete(id);
}

function updateGrenades(dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const gr = G.grenades[i];
    gr.fuse -= dt;
    gr.vy -= 12 * dt;
    let nx = gr.x + gr.vx * dt, ny = gr.y + gr.vy * dt, nz = gr.z + gr.vz * dt;
    // wall bounce (cheap: clamp against AABBs)
    for (const b of colliders) {
      if (nx > b.x0 && nx < b.x1 && nz > b.z0 && nz < b.z1 && ny > b.y0 && ny < b.y1) {
        if (Math.abs(gr.vx) > Math.abs(gr.vz)) { gr.vx *= -0.45; nx = gr.x; }
        else { gr.vz *= -0.45; nz = gr.z; }
      }
    }
    if (ny < 0.25) { ny = 0.25; gr.vy *= -0.4; gr.vx *= 0.7; gr.vz *= 0.7; if (gr.kind === 'smoke') { explodeGrenade(gr); G.grenades.splice(i, 1); continue; } }
    gr.x = nx; gr.y = ny; gr.z = nz;
    if (gr.fuse <= 0) { explodeGrenade(gr); G.grenades.splice(i, 1); }
  }
}

function updatePlayer(dt) {
  if (!player.alive) {
    // spectate an ally
    if (spectateBot && spectateBot.alive) {
      camera.position.set(spectateBot.x, spectateBot.y + 1.62, spectateBot.z);
      camera.rotation.set(spectateBot.pitch || 0, spectateBot.yaw + Math.PI, 0);
    }
    return;
  }
  const k = player.keys;
  // movement
  let mx = 0, mz = 0;
  if (k['KeyW']) mz += 1;
  if (k['KeyS']) mz -= 1;
  if (k['KeyA']) mx -= 1;
  if (k['KeyD']) mx += 1;
  const len = Math.hypot(mx, mz) || 1;
  mx /= len; mz /= len;
  const crouch = !!k['ControlLeft'] || !!k['ControlRight'];
  player.crouch = crouch;
  const walk = !!k['ShiftLeft'] || !!k['ShiftRight'];
  const speed = crouch ? 2.6 : walk ? 3.4 : 5.4;
  // accelerate toward target velocity
  const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
  const tx = (sy * mz + cy * mx) * speed, tz = (cy * mz - sy * mx) * speed;
  const cur = { x: player.vx || 0, z: player.vz || 0 };
  const accel = 14;
  cur.x += clamp(tx - cur.x, -accel * dt, accel * dt);
  cur.z += clamp(tz - cur.z, -accel * dt, accel * dt);
  player.vx = cur.x; player.vz = cur.z;
  player.speed = Math.hypot(cur.x, cur.z);
  const step = moveCircle(player, cur.x * dt, cur.z * dt, 0.4, player.crouch ? 1.15 : 1.7, colliders);
  player.x = step.x; player.z = step.z; player.y = step.y;
  if (player.speed > 1 && Math.floor(G.time * 2.4) !== Math.floor((G.time - dt) * 2.4)) audio.step();
  syncPlayerHitbox();

  // recoil recovery + bloom decay
  player.recoil = Math.max(0, player.recoil - dt * 0.25);
  player.spreadBloom = Math.max(0, player.spreadBloom - dt * 0.06);
  camera.position.set(player.x, player.y + (player.crouch ? 1.1 : 1.62), player.z);
  camera.rotation.set(player.pitch + player.recoil, player.yaw + Math.PI, 0);
  viewmodel.kick(Math.min(1, Math.max(0, player.fireTimer / 120)));

  // firing
  player.fireTimer -= dt * 1000;
  const w = WEAPONS[player.weapon];
  const wantFire = player.mouseDown && G.phase !== 'buy' && G.phase !== 'menu' && player.reloadUntil <= 0 && G.time > player.blindUntil;
  if (wantFire && player.fireTimer <= 0 && (w.auto || !player.shotLatch)) {
    playerShoot();
    player.shotLatch = true;
  }
  if (!player.mouseDown) player.shotLatch = false;

  // reload finish
  if (player.reloadUntil > 0 && G.time >= player.reloadUntil) {
    const ww = WEAPONS[player.reloadWeapon];
    const need = ww.mag - player.ammo;
    const take = Math.min(need, player.reserve);
    player.ammo += take; player.reserve -= take;
    player.reloadUntil = 0;
    hud.setAmmo(player.ammo, player.reserve, ww.name);
  }

  // plant / defuse channel (hold E)
  const inA = player.x >= MAP.plantA.x0 && player.x <= MAP.plantA.x1 && player.z >= MAP.plantA.z0 && player.z <= MAP.plantA.z1;
  const inB = player.x >= MAP.plantB.x0 && player.x <= MAP.plantB.x1 && player.z >= MAP.plantB.z0 && player.z <= MAP.plantB.z1;
  if (k['KeyE'] && player.channelKind === null) {
    if (player.isCarrier && G.bomb.state === 'carried' && (inA || inB)) {
      player.channelKind = 'plant'; player.channel = 0;
      hud.setObjective('PLANTING…', true);
    } else if (G.bomb.state === 'planted' && Math.hypot(player.x - G.bomb.x, player.z - G.bomb.z) < 2.2) {
      player.channelKind = 'defuse'; player.channel = 0;
      hud.setObjective('DEFUSING…', true);
    }
  }
  if (player.channelKind) {
    const moving = player.speed > 0.5;
    if (!k['KeyE'] || moving || !player.alive) {
      player.channelKind = null; player.channel = 0;
      hud.setPlant(null);
      hud.setObjective(G.bomb.state === 'planted' ? `DEFUSE AT ${G.bomb.site}: ${Math.ceil(G.roundTimer)} S` : `PLANT AT ${G.plan.site}`, G.bomb.state === 'planted');
    } else {
      player.channel += dt;
      const need = player.channelKind === 'plant' ? 3 : 5;
      hud.setPlant(player.channel / need, player.channelKind === 'plant' ? 'PLANTING CHARGE…' : 'DEFUSING…');
      if (player.channel >= need) {
        if (player.channelKind === 'plant') plantDone(player);
        else defuseDone(player);
        player.channelKind = null; player.channel = 0;
        hud.setPlant(null);
      }
    }
  }

  // flash blindness overlay
  if (G.time < player.blindUntil) {
    hud.flashWhite(clamp((player.blindUntil - G.time) / 1.5, 0.2, 0.95));
  }
  // crosshair spread
  const spreadPx = 5 + player.spreadBloom * 260 + (player.speed > 0.5 ? 6 : 0) + (player.crouch ? -2 : 0);
  hud.setCrosshair(spreadPx, player.mouseDown);
}

// ---- input ----------------------------------------------------------------------
const canvas = renderer.domElement;
addEventListener('keydown', (e) => {
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(); return; }
  player.keys[e.code] = true;
  if (e.code === 'KeyB' && G.phase === 'buy') {
    if (hud._buyOpen) { hud.hideBuy(); hud._buyOpen = false; }
    else { hud.showBuy(player.cash, player.owned, buyItem); hud._buyOpen = true; }
  }
  if (e.code === 'KeyR') playerReload();
  if (e.code === 'Digit1') switchWeapon('rifle');
  if (e.code === 'Digit2') switchWeapon('smg');
  if (e.code === 'Digit3') switchWeapon('shotgun');
  if (e.code === 'Digit4') switchWeapon('pistol');
  if (e.code === 'Digit5') switchWeapon('knife');
  if (e.code === 'Digit6') throwGrenade('frag');
  if (e.code === 'Digit7') throwGrenade('flash');
  if (e.code === 'Digit8') throwGrenade('smoke');
});
addEventListener('keyup', (e) => { player.keys[e.code] = false; if (e.code === 'Tab') hud.hideScoreboard(); });
function showScoreboard() {
  const rows = [];
  for (const e of entitiesOf('ember').concat(entitiesOf('watch'))) {
    rows.push({ name: e.name, team: e.team, k: e.kills || 0, d: e.deaths || 0, cash: e.cash || 0, alive: e.alive });
  }
  hud.showScoreboard(rows);
}
function buyItem(key) {
  if (key === 'armour') {
    if (player.cash >= 650 && player.armour < 100) {
      player.cash -= 650; player.armour = 100; audio.buy();
      hud.setCash(player.cash); hud.setHealth(player.hp, player.armour);
    }
    return;
  }
  if (GRENADES[key]) {
    if (player.cash >= GRENADES[key].price) {
      player.cash -= GRENADES[key].price; player.grenades[key]++;
      audio.buy(); hud.setCash(player.cash); hud.setSlots(player.weapon, player.owned, player.grenades);
    }
    return;
  }
  const w = WEAPONS[key];
  if (!w) return;
  if (player.owned.includes(key)) {
    // already owned: buy a fresh ammo refill for $200
    if (player.cash >= 200 && w.mag !== Infinity) {
      storeAmmo();
      player.cash -= 200;
      ammoStore[key] = { mag: w.mag, reserve: w.reserve };
      if (player.weapon === key) { player.ammo = w.mag; player.reserve = w.reserve; }
      audio.buy(); hud.setCash(player.cash);
      hud.setAmmo(player.ammo, player.reserve, w.name);
      hud.showBuy(player.cash, player.owned, buyItem);
    }
    return;
  }
  if (player.cash >= w.price) {
    storeAmmo();
    player.cash -= w.price; player.owned.push(key);
    ammoStore[key] = { mag: w.mag, reserve: w.reserve };
    switchWeapon(key); audio.buy();
    hud.setCash(player.cash);
    hud.showBuy(player.cash, player.owned, buyItem);
  }
}
canvas.addEventListener('click', () => {
  if (G.phase === 'menu') return;
  if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
  audio.unlock();
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || !player.alive) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = clamp(player.pitch - e.movementY * 0.0022, -1.5, 1.5);
});
canvas.addEventListener('mousedown', (e) => { if (e.button === 0) player.mouseDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) player.mouseDown = false; });
canvas.addEventListener('wheel', (e) => {
  const order = ['rifle', 'smg', 'shotgun', 'pistol', 'knife'].filter((k) => player.owned.includes(k));
  const i = order.indexOf(player.weapon);
  const n = order[(i + (e.deltaY > 0 ? 1 : -1) + order.length) % order.length];
  if (n) switchWeapon(n);
}, { passive: true });
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---- staging (?shot=) + autotest ---------------------------------------------------
// Deterministic staged scenes for the 4 screenshots.
function applyShot() {
  if (!SHOT) return;
  const freezeAfter = { cover: 0.9, buy: 0.2, plant: 0.6, end: 0.4 }[SHOT] ?? 0.5;
  G.shotFreezeAt = freezeAfter;
  if (SHOT === 'cover') {
    G.round = 6; G.score = { ember: 3, watch: 2 };
    startRound();
    G.phase = 'live'; G.roundTimer = 62;
    // player mid-quay, looking north into the Net Loft approach
    // (forward = (sin yaw, cos yaw); yaw ~ -3.05 faces -z with the two
    // staged enemies and the loft door inside the frame)
    player.x = 2; player.z = 17; player.yaw = -3.05; player.pitch = 0.02;
    switchWeapon('rifle');
    player.owned.push('rifle'); switchWeapon('rifle');
    player.ammo = 18; player.armour = 50; player.hp = 82;
    // enemies in frame: one centre-left by the loft door, one right
    const e1 = bots.find((b) => b.team === 'watch' && b.name === 'Tobin');
    const e2 = bots.find((b) => b.team === 'watch' && b.name === 'Nessa');
    const ally = bots.find((b) => b.team === 'ember' && b.name === 'Mara');
    if (e1) { e1.x = -5; e1.z = 6; e1.yaw = 2.6; e1.state = 'hold'; }
    if (e2) { e2.x = 9; e2.z = 2; e2.yaw = -2.4; e2.state = 'hold'; }
    if (ally) { ally.x = -2; ally.z = 12; ally.yaw = -2.6; ally.state = 'hold'; }
    // pre-filled killfeed + radio, plan banner
    hud.addKill('You  ✕  Tobin  [HEADSHOT]', true);
    hud.addKill('Mara  ✕  Harrow  [HEADSHOT]', true);
    hud.addKill('Kett  ✕  Joss', false);
    hud.addRadio('Mara', 'ember', 'Contact at Lantern Quay, rotating');
    hud.setPlan('PLAN: SPLIT A — YOU: ENTRY');
    hud.setObjective('PLANT AT A — 62 S', false);
    hud.setHealth(player.hp, player.armour);
    hud.setCash(3100);
    // player fires at the freeze moment (handled in the frame loop)
    G.shotFireAtFreeze = true;
  } else if (SHOT === 'buy') {
    G.round = 1;
    startRound();
    // mid-quay, looking north at the Net Loft (clean backdrop, no bot in frame)
    player.x = -20; player.z = 21; player.yaw = Math.PI; player.pitch = 0;
    player.cash = 2700;
    hud.showBuy(player.cash, player.owned, buyItem);
    hud.setCash(2700);
  } else if (SHOT === 'plant') {
    G.round = 3; G.score = { ember: 2, watch: 1 };
    startRound();
    G.phase = 'live'; G.roundTimer = 41;
    player.isCarrier = true; G.bomb.state = 'carried'; G.bomb.carrierId = 0;
    // SE corner of Site A, looking NW at the lighthouse (crates off-centre)
    player.x = -30; player.z = -6; player.yaw = -2.61; player.pitch = 0.02;
    player.channelKind = 'plant'; player.channel = 1.8; player.keys['KeyE'] = true;
    const ally = bots.find((b) => b.team === 'ember' && b.name === 'Joss');
    if (ally) { ally.x = -36; ally.z = -16; ally.yaw = 2.2; ally.state = 'hold'; }
    hud.setObjective('PLANTING…', true);
    hud.setPlan('PLAN: SPLIT A — YOU: ENTRY');
    hud.setHealth(100, 50); player.armour = 50;
  } else if (SHOT === 'end') {
    G.round = 6; G.score = { ember: 4, watch: 2 };
    startRound();
    G.phase = 'over'; G.roundTimer = 4;
    G.score.ember = 4;
    // south of the Fish Hall, looking NNE at its south wall + FISH HALL sign
    player.x = 26; player.z = 22; player.yaw = 2.68; player.pitch = 0.05;
    sparks.burst(35, 1.5, -14, 30);
    hud.setScore(4, 2, 6, FIRST_TO);
    hud.setTimer(4); // 'over' phase never refreshes the timer itself
    hud.showBanner('ROUND WON', 'CHARGE DETONATED AT SITE B — FISH HALL', 0);
    hud.addKill('You  ✕  Brine  [HEADSHOT]', true);
    hud.addKill('Mara  ✕  Kett', false);
  }
  syncPlayerHitbox();
}

// autotest: bot-only, 10 rounds, headless sim, log results.
// The player slot is played by a real bot named "You" (own model + AI);
// the human player entity is marked dead for the duration.
function runAutotest() {
  G.frozen = true; // keep the rAF loop from stepping the sim concurrently
  console.log('[autotest] start seed=' + SEED);
  const results = [];
  for (let r = 1; r <= 10; r++) {
    startRound();
    player.alive = false; // human entity sits out; the 'You' bot plays
    const auto = createBot(scene, {
      id: 0, name: 'You', team: 'ember', x: player.x, z: player.z,
      weapon: 'rifle', skill: 0.65, rng,
    });
    auto.isCarrier = player.isCarrier;
    if (player.isCarrier) G.bomb.carrierId = 0;
    bots.push(auto);
    G.autoBot = auto;
    G.phase = 'live'; G.roundTimer = 100;
    let ticks = 0, plants = 0;
    const before = { ...G.score };
    while (G.phase !== 'over' && G.phase !== 'matchover' && ticks < 60 * 130) {
      if (G.bomb.state === 'planted') plants = 1;
      simStep();
      ticks++;
    }
    auto.model.group.removeFromParent();
    bots.splice(bots.indexOf(auto), 1);
    G.autoBot = null;
    player.alive = true;
    const winner = G.score.ember > before.ember ? 'ember' : G.score.watch > before.watch ? 'watch' : 'none';
    results.push({ round: r, winner, reason: G.overReason, ticks, plants, emberAlive: aliveOf('ember'), watchAlive: aliveOf('watch') });
    console.log(`[autotest] round ${r}: winner=${winner} reason="${G.overReason}" ticks=${ticks} plants=${plants} alive E${aliveOf('ember')}/W${aliveOf('watch')}`);
    if (G.phase === 'matchover') break;
    G.round++;
    if (G.score.ember >= FIRST_TO || G.score.watch >= FIRST_TO) break;
  }
  const summary = {
    rounds: results.length,
    emberWins: results.filter((x) => x.winner === 'ember').length,
    watchWins: results.filter((x) => x.winner === 'watch').length,
    plants: results.reduce((a, x) => a + x.plants, 0),
    score: G.score,
  };
  console.log('[autotest] SUMMARY ' + JSON.stringify(summary));
  document.title = 'AUTOTEST DONE ' + JSON.stringify(summary);
  window.__lantern.autotest = summary;
}

// ---- frame loop ------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastT);
  lastT = now;
  if (!G.frozen && G.started && G.phase !== 'menu' && G.phase !== 'matchover') {
    acc += dtMs / 1000;
    let n = 0;
    while (acc >= DT && n < 5) { simStep(); acc -= DT; n++; }
    // staged freeze: by game time, or after 3 rendered frames — whichever
    // comes first. (Software rendering can be ~1 fps, so the time-based
    // freeze alone may never fire before a screenshot is taken.)
    if (G.shotFreezeAt !== undefined) {
      G.shotFrames = (G.shotFrames || 0) + 1;
      // require a little sim time too: the first rAF callbacks can arrive
      // in a burst with ~0 dt, so frame 3 may fire before any simStep has
      // positioned the camera / updated the HUD
      if ((G.time >= G.shotFreezeAt || G.shotFrames >= 3) && G.time >= 0.1) {
        G.frozen = true;
        if (G.shotFireAtFreeze) {
          // one staged shot so the cover shows muzzle flash + tracer
          player.mouseDown = true;
          player.fireTimer = 0;
          playerShoot();
          player.mouseDown = false;
        }
      }
    }
  }
  map.update(G.time);
  if (!G.frozen) {
    tracers.update(dtMs / 1000);
    sparks.update(dtMs / 1000);
    viewmodel.flashMat.opacity = Math.max(0, viewmodel.flashMat.opacity - dtMs / 90);
    viewmodel.flashLight.intensity = Math.max(0, viewmodel.flashLight.intensity - dtMs * 0.4);
  }
  renderer.render(scene, camera);
}

// ---- start -------------------------------------------------------------------------
window.__lantern = {
  G, player, bots: () => bots,
  state: () => ({ phase: G.phase, round: G.round, score: G.score, timer: G.roundTimer, aliveE: aliveOf('ember'), aliveW: aliveOf('watch'), bomb: G.bomb.state }),
  start() {
    G.started = true;
    hud.hideStart();
    startRound();
  },
};

hud.setHealth(100, 0);
hud.setCash(800);
hud.setAmmo(12, 36, 'VK-9 SIDEARM');
hud.setSlots('pistol', ['pistol', 'knife'], { frag: 0, flash: 0, smoke: 0 });

if (AUTOTEST) {
  // headless: no pointer lock, no audio, run the sim fast
  G.started = true;
  hud.hideStart();
  setTimeout(runAutotest, 300);
} else if (SHOT) {
  G.started = true;
  hud.hideStart();
  applyShot();
} else {
  hud.showStart();
  document.getElementById('playBtn').addEventListener('click', () => {
    audio.unlock();
    canvas.requestPointerLock();
    window.__lantern.start();
  });
}
requestAnimationFrame(frame);
