// combat.js — hitscan shooting, damage, and the bomb.
// One job: resolve a shot against bodies, walls and lamps, and run the plant/defuse
// channels. It never moves anyone and never decides — main.js and bots.js do that.
import * as THREE from 'three';
import { pullTrigger, WEAPONS } from './weapons.js';
import { applyDamage, eyePos, lookDir } from './player.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

function raySphere(origin, dir, center, r) {
  const ox = center.x - origin.x, oy = center.y - origin.y, oz = center.z - origin.z;
  const tca = ox * dir.x + oy * dir.y + oz * dir.z;
  if (tca < 0) return -1;
  const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

function rayAABB(origin, dir, c) {
  let t0 = 0, t1 = 1e9;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [c.x0, c.y0, c.z0], mx = [c.x1, c.y1, c.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < mn[i] || o[i] > mx[i]) return -1; continue; }
    let ta = (mn[i] - o[i]) / d[i], tb = (mx[i] - o[i]) / d[i];
    if (ta > tb) { const t = ta; ta = tb; tb = t; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}

// Cast one hitscan ray. Returns the closest hit or null.
// hit = { kind: 'head'|'body'|'wall'|'lamp', agent?, dist, point:Vector3, lamp? }
export function castRay(world, origin, dir, maxDist, agents, ignoreId) {
  let best = null;
  let bestT = maxDist;
  // Bodies (two spheres each: head + torso).
  for (const a of agents) {
    if (!a.body.alive || a.id === ignoreId) continue;
    const feet = a.body.pos.y;
    const crouchK = a.body.crouched ? 0.72 : 1;
    const headY = feet + 1.52 * crouchK;
    const bodyY = feet + 0.85 * crouchK;
    const hp = { x: a.body.pos.x, y: headY, z: a.body.pos.z };
    const bp = { x: a.body.pos.x, y: bodyY, z: a.body.pos.z };
    const th = raySphere(origin, dir, hp, 0.26);
    if (th > 0 && th < bestT) { bestT = th; best = { kind: 'head', agent: a, dist: th }; }
    const tb = raySphere(origin, dir, bp, 0.5);
    if (tb > 0 && tb < bestT) { bestT = tb; best = { kind: 'body', agent: a, dist: tb }; }
  }
  // Lamps (shootable).
  for (const L of world.lamps) {
    if (!L.alive) continue;
    const t = raySphere(origin, dir, L.pos, 0.34);
    if (t > 0 && t < bestT) { bestT = t; best = { kind: 'lamp', lamp: L, dist: t }; }
  }
  // Walls.
  for (const c of world.colliders) {
    const t = rayAABB(origin, dir, c);
    if (t > 0 && t < bestT) { bestT = t; best = { kind: 'wall', dist: t }; }
  }
  if (!best) return null;
  best.point = new THREE.Vector3(
    origin.x + dir.x * bestT, origin.y + dir.y * bestT, origin.z + dir.z * bestT);
  return best;
}

// Fire one shot from `shooter` (an agent). Returns an event object for effects/HUD,
// or null when the weapon cannot fire. `spread` is applied to the aim direction.
export function fireShot(G, shooter, now, rng) {
  const ws = shooter.ws;
  const def = WEAPONS[ws.current];
  const shot = pullTrigger(ws, now, shooter.body.moving, shooter.body.crouched, shooter.body.scoped);
  if (!shot) return null;
  eyePos(shooter.body, _o);
  lookDir(shooter.body, _d);
  // Spread: random cone offset + recoil pitch kick.
  const sp = shot.spread;
  const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * sp;
  const right = new THREE.Vector3(Math.cos(shooter.body.yaw), 0, -Math.sin(shooter.body.yaw));
  const up = new THREE.Vector3().crossVectors(right, _d).negate();
  _d.addScaledVector(right, Math.cos(a) * r);
  _d.addScaledVector(up, Math.sin(a) * r);
  _d.normalize();
  shooter.body.pitch += shot.kick * 0.55; // view kick; the bot's aim re-centres over time
  const hit = castRay(G.world, _o, _d, def.range, G.agents, shooter.id);
  const ev = { shooter, def, from: _o.clone(), dir: _d.clone(), hit, headshot: false, killed: false, dmg: 0 };
  if (hit && (hit.kind === 'head' || hit.kind === 'body')) {
    const falloff = Math.max(0.55, 1 - (hit.dist / def.range) * 0.45);
    let dmg = def.damage * falloff;
    if (hit.kind === 'head') { dmg *= def.headMult; ev.headshot = true; }
    ev.dmg = applyDamage(hit.agent.body, dmg);
    ev.killed = !hit.agent.body.alive;
    if (ev.killed) {
      hit.agent.deaths += 1;
      shooter.kills += 1;
      shooter.money += 300;
      G.feed.push({ a: shooter.name, b: hit.agent.name, hs: ev.headshot, t: now });
    }
    hit.agent.lastDamageFrom = shooter;
    hit.agent.lastDamageAt = now;
    // The victim hears the shot direction (bots react).
    if (hit.agent.ai) {
      hit.agent.ai.heard = { x: shooter.body.pos.x, z: shooter.body.pos.z, t: now };
    }
  } else if (hit && hit.kind === 'lamp') {
    hit.lamp.alive = false;
    hit.lamp.light.intensity = 0;
    hit.lamp.bulb.material = G.lampOffMat;
    ev.lampOut = true;
  }
  if (G.onShot) G.onShot(shooter, ev);
  return ev;
}

export function inSite(world, site, x, z) {
  if (site === 'A') {
    return Math.hypot(x - world.SITES.A.cx, z - world.SITES.A.cz) <= world.SITES.A.r;
  }
  const B = world.SITES.B;
  return x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1;
}

export function siteAt(world, x, z) {
  if (inSite(world, 'A', x, z)) return 'A';
  if (inSite(world, 'B', x, z)) return 'B';
  return null;
}

// Plant channel: returns 'planted' when the 3s channel completes.
export function tickPlant(G, agent, dt, now) {
  const bomb = G.bomb;
  if (bomb.planted || !agent.hasBomb || !agent.body.alive) return null;
  const site = siteAt(G.world, agent.body.pos.x, agent.body.pos.z);
  if (!site) { bomb.plantProgress = 0; return null; }
  bomb.plantProgress += dt / 3;
  bomb.plantSite = site;
  if (bomb.plantProgress >= 1) {
    bomb.planted = true;
    bomb.site = site;
    bomb.x = agent.body.pos.x; bomb.z = agent.body.pos.z;
    bomb.timer = 35;
    bomb.plantProgress = 0;
    agent.hasBomb = false;
    return 'planted';
  }
  return 'planting';
}

// Defuse channel: 5s. Returns 'defused' when complete.
export function tickDefuse(G, agent, dt) {
  const bomb = G.bomb;
  if (!bomb.planted || agent.team !== 'SENTRY' || !agent.body.alive) return null;
  const d = Math.hypot(agent.body.pos.x - bomb.x, agent.body.pos.z - bomb.z);
  if (d > 2.2) { if (bomb.defuser === agent) { bomb.defuseProgress = 0; bomb.defuser = null; } return null; }
  if (bomb.defuser && bomb.defuser !== agent) return null;
  bomb.defuser = agent;
  bomb.defuseProgress += dt / 5;
  if (bomb.defuseProgress >= 1) return 'defused';
  return 'defusing';
}
