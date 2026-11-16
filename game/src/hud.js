// hud.js — every DOM overlay: health/armour/cash/ammo, weapon slots,
// killfeed, radio feed, minimap, buy menu, banners, crosshair, hitmarker.
// The sim owns the numbers; this module only renders them.

import { WEAPONS, GRENADES } from './weapons.js';

export function createHUD(doc) {
  const $ = (id) => doc.getElementById(id);
  const el = {
    timer: $('timer'), score: $('score'), round: $('round'),
    plan: $('plan'), objective: $('objective'),
    healthBar: $('healthBar'), healthNum: $('healthNum'),
    armourBar: $('armourBar'), armourNum: $('armourNum'),
    cash: $('cash'), ammo: $('ammo'), ammoReserve: $('ammoReserve'),
    weaponName: $('weaponName'), slots: $('slots'), nades: $('nades'),
    killfeed: $('killfeed'), radio: $('radio'),
    minimap: $('minimap'), cross: $('crosshair'), hit: $('hitmarker'),
    dmg: $('dmgNums'), buy: $('buyMenu'), buyCash: $('buyCash'), buyGrid: $('buyGrid'),
    banner: $('roundBanner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
    start: $('startScreen'), scoreboard: $('scoreboard'), sbBody: $('sbBody'),
    plant: $('plantBar'), plantFill: $('plantFill'), plantLabel: $('plantLabel'),
    flash: $('flashOverlay'), vignette: $('dmgVignette'),
    hint: $('hint'),
  };
  const mm = el.minimap.getContext('2d');

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  const hud = {
    setTimer(s) { el.timer.textContent = fmtTime(s); },
    setScore(e, w, round, firstTo) {
      el.score.textContent = `EMBER ${e} — ${w} WATCH`;
      el.round.textContent = `ROUND ${round} · FIRST TO ${firstTo}`;
    },
    setPlan(text) { el.plan.textContent = text; el.plan.style.display = text ? 'block' : 'none'; },
    setObjective(text, warn) {
      el.objective.textContent = text;
      el.objective.style.display = text ? 'block' : 'none';
      el.objective.style.color = warn ? '#ff5a4e' : '#ffd27a';
    },
    setHealth(hp, armour) {
      el.healthNum.textContent = Math.ceil(hp);
      el.healthBar.style.width = Math.max(0, hp) + '%';
      el.healthBar.style.background = hp > 50 ? '#7fd67a' : hp > 25 ? '#ffb042' : '#ff5a4e';
      el.armourNum.textContent = Math.ceil(armour);
      el.armourBar.style.width = Math.max(0, armour) + '%';
    },
    setCash(c) { el.cash.textContent = '$' + c.toLocaleString('en-US'); },
    setAmmo(mag, reserve, name) {
      el.ammo.textContent = mag === Infinity ? '—' : mag;
      el.ammoReserve.textContent = reserve === Infinity ? '' : '/ ' + reserve;
      el.weaponName.textContent = name;
    },
    setSlots(current, owned, grenades) {
      let html = '';
      const order = ['rifle', 'smg', 'shotgun', 'pistol', 'knife'];
      for (const k of order) {
        if (!owned.includes(k)) continue;
        const w = WEAPONS[k];
        html += `<div class="slot${current === k ? ' cur' : ''}"><b>${w.slot}</b> ${w.name}</div>`;
      }
      el.slots.innerHTML = html;
      el.nades.innerHTML = Object.keys(GRENADES).map((k) =>
        `<div class="slot${grenades[k] ? '' : ' empty'}">G ${GRENADES[k].name} ×${grenades[k] || 0}</div>`).join('');
    },
    addKill(text, head) {
      const d = doc.createElement('div');
      d.className = 'kf' + (head ? ' hs' : '');
      d.textContent = text;
      el.killfeed.prepend(d);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => d.remove(), 7000);
    },
    addRadio(name, team, text) {
      const d = doc.createElement('div');
      d.className = 'radio-line';
      d.innerHTML = `<b style="color:${team === 'ember' ? '#ff9a3c' : '#4fc3d9'}">${name}</b> <span>${text}</span>`;
      el.radio.prepend(d);
      while (el.radio.children.length > 4) el.radio.lastChild.remove();
      setTimeout(() => d.remove(), 9000);
    },
    hitmarker(head, dmg) {
      el.hit.style.opacity = '1';
      el.hit.classList.toggle('hs', !!head);
      clearTimeout(hud._ht);
      hud._ht = setTimeout(() => { el.hit.style.opacity = '0'; }, 140);
      const d = doc.createElement('div');
      d.className = 'dmg' + (head ? ' hs' : '');
      d.textContent = (head ? 'HEAD ' : '') + dmg;
      d.style.left = (46 + Math.random() * 8) + '%';
      d.style.top = (42 + Math.random() * 6) + '%';
      el.dmg.appendChild(d);
      setTimeout(() => d.remove(), 900);
    },
    setCrosshair(spreadPx, firing) {
      el.cross.style.setProperty('--gap', spreadPx + 'px');
      el.cross.classList.toggle('firing', !!firing);
    },
    flashWhite(strength) {
      el.flash.style.opacity = String(strength);
      setTimeout(() => { el.flash.style.opacity = '0'; }, 120);
    },
    damageFlash() {
      el.vignette.style.opacity = '0.85';
      setTimeout(() => { el.vignette.style.opacity = '0'; }, 220);
    },
    setPlant(p, label) {
      if (p === null) { el.plant.style.display = 'none'; return; }
      el.plant.style.display = 'block';
      el.plantFill.style.width = (p * 100) + '%';
      el.plantLabel.textContent = label;
    },
    showBanner(title, sub, ms) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub || '';
      el.banner.style.display = 'block';
      clearTimeout(hud._bt);
      if (ms) hud._bt = setTimeout(() => { el.banner.style.display = 'none'; }, ms);
    },
    hideBanner() { el.banner.style.display = 'none'; },
    showStart() { el.start.style.display = 'flex'; },
    hideStart() { el.start.style.display = 'none'; },
    setHint(t) { el.hint.textContent = t; },
    showScoreboard(rows) {
      el.sbBody.innerHTML = rows.map((r) =>
        `<div class="sb-row ${r.team}"><span>${r.name}</span><span>${r.k}/${r.d}</span><span>$${r.cash}</span><span>${r.alive ? '●' : '✕'}</span></div>`).join('');
      el.scoreboard.style.display = 'block';
    },
    hideScoreboard() { el.scoreboard.style.display = 'none'; },
    showBuy(cash, owned, callback) {
      el.buyCash.textContent = '$' + cash.toLocaleString('en-US');
      const items = [
        { key: 'rifle', label: 'AR-77 VULTURE', sub: 'Mid rifle', price: 2700 },
        { key: 'smg', label: 'SMG-9 JACKAL', sub: 'Close quarters', price: 1500 },
        { key: 'shotgun', label: 'SG-12 BREACHER', sub: 'Site hold', price: 2000 },
        { key: 'armour', label: 'KEVLAR + HELMET', sub: '100 armour', price: 650 },
        { key: 'frag', label: 'FRAG-7', sub: 'Explosive', price: 300 },
        { key: 'flash', label: 'FLASH-2', sub: 'Blinds', price: 200 },
        { key: 'smoke', label: 'SMOKE-4', sub: 'Blocks sight', price: 300 },
      ];
      el.buyGrid.innerHTML = items.map((it) => {
        const have = owned.includes(it.key);
        const afford = cash >= it.price;
        return `<button class="buy-item${have ? ' owned' : ''}${afford ? '' : ' poor'}" data-key="${it.key}">
          <b>${it.label}</b><span>${it.sub}</span><i>${have ? 'OWNED' : '$' + it.price}</i></button>`;
      }).join('');
      el.buyGrid.querySelectorAll('button').forEach((b) => {
        b.onclick = () => callback(b.dataset.key);
      });
      el.buy.style.display = 'block';
    },
    hideBuy() { el.buy.style.display = 'none'; },
    drawMinimap(state) {
      // state: {colliders, player, allies, enemies, bomb, spots}
      const W = el.minimap.width, H = el.minimap.height;
      const sx = W / 96, sz = H / 62; // map -48..48, -31..31
      const X = (x) => (x + 48) * sx, Z = (z) => (z + 31) * sz;
      mm.clearRect(0, 0, W, H);
      mm.fillStyle = 'rgba(10,16,32,0.82)'; mm.fillRect(0, 0, W, H);
      // water strip
      mm.fillStyle = 'rgba(20,60,110,0.5)'; mm.fillRect(0, Z(28), W, H - Z(28));
      // walls
      mm.fillStyle = '#5a6a8a';
      for (const b of state.colliders) {
        if (b.y1 < 2) continue;
        mm.fillRect(X(b.x0), Z(b.z0), (b.x1 - b.x0) * sx, (b.z1 - b.z0) * sz);
      }
      // plant zones
      mm.fillStyle = 'rgba(255,176,66,0.25)';
      mm.fillRect(X(-40), Z(-16), 12 * sx, 12 * sz);
      mm.fillRect(X(30), Z(-20), 10 * sx, 12 * sz);
      mm.fillStyle = '#ffb042'; mm.font = 'bold 13px Arial'; mm.textAlign = 'center';
      mm.fillText('A', X(-34), Z(-10) + 4);
      mm.fillText('B', X(35), Z(-14) + 4);
      mm.fillStyle = '#7fd4e8'; mm.font = '10px Arial';
      mm.fillText('NET LOFT', X(0), Z(-8));
      mm.fillText('QUAY 7', X(0), Z(20));
      // bomb
      if (state.bomb && state.bomb.state === 'planted') {
        mm.fillStyle = '#ff3b30';
        mm.beginPath(); mm.arc(X(state.bomb.x), Z(state.bomb.z), 5, 0, 7); mm.fill();
      }
      // dots
      const dot = (x, z, color, r) => {
        mm.fillStyle = color;
        mm.beginPath(); mm.arc(X(x), Z(z), r || 3.4, 0, 7); mm.fill();
      };
      for (const a of state.allies) if (a.alive) dot(a.x, a.z, '#7fd67a', 3);
      for (const e of state.enemies) if (e.alive && state.spotted.has(e.id)) dot(e.x, e.z, '#ff5a4e', 3);
      // player arrow
      if (state.player.alive) {
        mm.save();
        mm.translate(X(state.player.x), Z(state.player.z));
        mm.rotate(Math.PI - state.player.yaw);
        mm.fillStyle = '#fff';
        mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4.4, 5); mm.lineTo(-4.4, 5); mm.closePath(); mm.fill();
        mm.restore();
      }
    },
  };
  return hud;
}
