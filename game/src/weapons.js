// weapons.js — weapon definitions, firing model, grenades.
// One job: know every gun and grenade (price, damage, recoil, spread) and turn a
// trigger pull into a shot. It never decides who shoots — combat.js does that.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P2000 · PISTOL', price: 0, slot: 1, auto: false,
    damage: 34, headMult: 4, rpm: 360, mag: 12, reserve: 48, reload: 1.5,
    spread: 0.011, moveSpread: 0.030, recoil: 0.011, recoilUp: 0.010, range: 46,
    tracer: 0xffe9a8, sound: 'pistol',
  },
  smg: {
    id: 'smg', name: 'VK-9 · SMG', price: 1500, slot: 2, auto: true,
    damage: 26, headMult: 4, rpm: 750, mag: 25, reserve: 100, reload: 2.0,
    spread: 0.016, moveSpread: 0.042, recoil: 0.009, recoilUp: 0.008, range: 38,
    tracer: 0xffd28a, sound: 'smg',
  },
  rifle: {
    id: 'rifle', name: 'AR-77 · RIFLE', price: 2700, slot: 3, auto: true,
    damage: 33, headMult: 4, rpm: 600, mag: 30, reserve: 90, reload: 2.4,
    spread: 0.008, moveSpread: 0.038, recoil: 0.014, recoilUp: 0.013, range: 60,
    tracer: 0xfff0b0, sound: 'rifle',
  },
  awp: {
    id: 'awp', name: 'LONGSHOT · AWP', price: 4750, slot: 4, auto: false,
    damage: 115, headMult: 2, rpm: 55, mag: 5, reserve: 15, reload: 3.2,
    spread: 0.001, moveSpread: 0.090, recoil: 0.075, recoilUp: 0.06, range: 90,
    tracer: 0xcfe8ff, sound: 'awp', zoom: 2.4, movePenalty: 0.55,
  },
  smoke: {
    id: 'smoke', name: 'SMOKE', price: 300, slot: 5, grenade: 'smoke', count: 1,
  },
  flash: {
    id: 'flash', name: 'FLASH', price: 200, slot: 6, grenade: 'flash', count: 1,
  },
};

export const BUY_LIST = [
  { id: 'smg', label: 'VK-9 SMG', price: 1500 },
  { id: 'rifle', label: 'AR-77 RIFLE', price: 2700 },
  { id: 'awp', label: 'LONGSHOT AWP', price: 4750 },
  { id: 'armor', label: 'KEVLAR VEST', price: 650 },
  { id: 'smoke', label: 'SMOKE GRENADE', price: 300 },
  { id: 'flash', label: 'FLASH GRENADE', price: 200 },
];

// A shooter's weapon state. One per agent; no allocation in the hot loop.
export function makeWeaponState() {
  return {
    current: 'pistol',
    owned: { pistol: true },
    ammo: { pistol: 12 },
    reserve: { pistol: 48 },
    armor: 0,
    smokes: 0,
    flashes: 0,
    reloading: 0,
    cooldown: 0,
    spreadBloom: 0,
    recoilPitch: 0,
    lastShot: -10,
  };
}

export function giveWeapon(ws, id) {
  const def = WEAPONS[id];
  if (!def || ws.owned[id]) return false;
  ws.owned[id] = true;
  ws.ammo[id] = def.mag;
  ws.reserve[id] = def.reserve;
  return true;
}

export function currentDef(ws) { return WEAPONS[ws.current]; }

// Can this shooter fire right now? Returns a reason string when not.
export function canFire(ws, now) {
  if (ws.reloading > 0) return 'reloading';
  if (ws.cooldown > now) return 'cooldown';
  const def = WEAPONS[ws.current];
  if ((ws.ammo[ws.current] | 0) <= 0) return 'empty';
  return null;
}

// Apply one trigger pull: consume ammo, set cooldown, grow bloom + recoil.
// Returns the shot's spread (radians) and recoil kick, or null if it cannot fire.
export function pullTrigger(ws, now, moving, crouched, scoped) {
  const why = canFire(ws, now);
  if (why) return null;
  const def = WEAPONS[ws.current];
  ws.ammo[ws.current] -= 1;
  ws.cooldown = now + 60 / def.rpm;
  ws.lastShot = now;
  let spread = def.spread + ws.spreadBloom;
  if (moving) spread += def.moveSpread;
  if (crouched) spread *= 0.7;
  if (scoped && def.zoom) spread *= 0.35;
  ws.spreadBloom = Math.min(0.045, ws.spreadBloom + def.recoil * 0.55);
  const kick = def.recoil * (1 + ws.spreadBloom * 14);
  ws.recoilPitch = Math.min(0.09, ws.recoilPitch + def.recoilUp);
  return { def, spread, kick };
}

export function startReload(ws, now) {
  const def = WEAPONS[ws.current];
  if (ws.reloading > 0 || (ws.reserve[ws.current] | 0) <= 0) return false;
  if ((ws.ammo[ws.current] | 0) >= def.mag) return false;
  ws.reloading = def.reload;
  return true;
}

export function tickWeapon(ws, dt) {
  if (ws.reloading > 0) {
    ws.reloading -= dt;
    if (ws.reloading <= 0) {
      ws.reloading = 0;
      const def = WEAPONS[ws.current];
      const need = def.mag - (ws.ammo[ws.current] | 0);
      const take = Math.min(need, ws.reserve[ws.current] | 0);
      ws.ammo[ws.current] = (ws.ammo[ws.current] | 0) + take;
      ws.reserve[ws.current] = (ws.reserve[ws.current] | 0) - take;
    }
  }
  ws.spreadBloom = Math.max(0, ws.spreadBloom - dt * 0.05);
  ws.recoilPitch = Math.max(0, ws.recoilPitch - dt * 0.22);
}

// Grenade flight: simple ballistic arc, no allocation.
export function throwGrenade(origin, dir, kind) {
  return {
    kind,
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: { x: dir.x * 13, y: dir.y * 13 + 4.5, z: dir.z * 13 },
    t: 0,
    fuse: kind === 'smoke' ? 1.15 : 1.5,
    done: false,
  };
}

export function tickGrenade(g, dt, world) {
  if (g.done) return;
  g.t += dt;
  g.vel.y -= 14 * dt;
  g.pos.x += g.vel.x * dt;
  g.pos.y += g.vel.y * dt;
  g.pos.z += g.vel.z * dt;
  // Floor bounce + wall clamp.
  const floor = world.groundAt(g.pos.x, g.pos.z, g.pos.y);
  if (g.pos.y < floor + 0.12) { g.pos.y = floor + 0.12; g.vel.y *= -0.35; g.vel.x *= 0.6; g.vel.z *= 0.6; }
  if (g.pos.y < floor + 0.12 && Math.abs(g.vel.y) < 1.2) g.vel.y = 0;
  const p = { x: g.pos.x, y: g.pos.y, z: g.pos.z };
  world.collideCircle(p, 0.12, 0.3);
  g.pos.x = p.x; g.pos.z = p.z;
  if (g.t >= g.fuse) g.done = true;
}
