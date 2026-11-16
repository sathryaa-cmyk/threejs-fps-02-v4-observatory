// bots.js — bot AI: roles, team plans, waypoint pathing, vision, buying.
// One job: make nine bots play 5v5 plant/defuse like a team. It never renders
// anything and never owns the round — main.js does.
import { giveWeapon, makeWeaponState } from './weapons.js';
import { stepBody } from './player.js';
import { fireShot, siteAt } from './combat.js';

export const ROLES = ['igl', 'entry', 'support', 'lurker', 'awper'];

export function makeBot(id, name, team, role, x, z, yaw) {
  return {
    id, name, team, role,
    isPlayer: false,
    body: null, // set by main.js (makeBody)
    ws: makeWeaponState(),
    kills: 0, deaths: 0, money: 800, hasBomb: false,
    ai: {
      role,
      state: 'push',
      path: [], pathI: 0,
      target: null,         // enemy agent currently engaged
      acquireAt: 0,         // when the target was first seen
      aimErr: 0.05,
      burstLeft: 0, burstPause: 0,
      holdPos: null, holdYaw: 0,
      heard: null,
      planSite: 'A',
      repathAt: 0,
      plantAt: 0,
      smokeThrown: false,
      flashThrown: false,
      strafeDir: 1, strafeAt: 0,
    },
  };
}

function dist2d(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }

// Can `a` see `b`? LOS + facing + range + light. Darkness hides: out of the beam
// and away from lamps, a target is only visible close up.
export function canSee(G, a, b) {
  if (!b.body.alive) return false;
  const dx = b.body.pos.x - a.body.pos.x;
  const dz = b.body.pos.z - a.body.pos.z;
  const d = Math.hypot(dx, dz);
  const inBeam = G.world.inBeam(b.body.pos.x, b.body.pos.z);
  const range = inBeam ? 46 : 26;
  if (d > range) return false;
  // Facing: within ~105 degrees of the look direction.
  const lookX = -Math.sin(a.body.yaw), lookZ = -Math.cos(a.body.yaw);
  const dot = (dx * lookX + dz * lookZ) / (d || 1);
  if (dot < -0.15 && d > 6) return false;
  const from = { x: a.body.pos.x, y: a.body.pos.y + a.body.eyeHeight, z: a.body.pos.z };
  const to = { x: b.body.pos.x, y: b.body.pos.y + 1.2, z: b.body.pos.z };
  if (G.world.segmentBlocked(from, to)) return false;
  // Smoke: a cloud between the two blocks vision.
  for (const s of G.smokes || []) {
    const cx = s.x, cz = s.z;
    const ax = from.x, az = from.z, bx = to.x, bz = to.z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / len2)) : 0;
    const px = ax + dx * t, pz = az + dz * t;
    if (Math.hypot(px - cx, pz - cz) < s.r) return false;
  }
  // Darkness: a crouched, still target in the dark at >14m is hard to spot.
  if (!inBeam && d > 14 && b.body.crouched && !b.body.moving) return false;
  return true;
}

function nearestEnemy(G, bot) {
  let best = null, bd = Infinity;
  for (const a of G.agents) {
    if (a.team === bot.team || !a.body.alive) continue;
    const d = dist2d(bot.body.pos.x, bot.body.pos.z, a.body.pos.x, a.body.pos.z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function visibleEnemy(G, bot) {
  let best = null, bd = Infinity;
  for (const a of G.agents) {
    if (a.team === bot.team || !a.body.alive) continue;
    if (!canSee(G, bot, a)) continue;
    const d = dist2d(bot.body.pos.x, bot.body.pos.z, a.body.pos.x, a.body.pos.z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// Pick a waypoint target for a bot's current job, then BFS a path to it.
function setPathTo(G, bot, tx, tz, now) {
  const from = G.world.nearestWaypoint(bot.body.pos);
  const to = G.world.nearestWaypoint({ x: tx, y: bot.body.pos.y, z: tz });
  bot.ai.path = G.world.bfsPath(from, to);
  bot.ai.pathI = 0;
  bot.ai.repathAt = now + 2.5;
}

function sitePoint(G, site, rng) {
  if (site === 'A') {
    const a = rng() * Math.PI * 2, r = 2 + rng() * 4;
    return { x: 14 + Math.cos(a) * r, z: -10 + Math.sin(a) * r };
  }
  return { x: -19 + (rng() - 0.5) * 7, z: -11 + (rng() - 0.5) * 8 };
}

function holdPoint(G, bot) {
  // Defender hold spots per role.
  if (bot.ai.role === 'awper') return { x: 24, z: -16, yaw: Math.PI * 0.5 };
  if (bot.team === 'SENTRY') {
    if (bot.ai.holdSite === 'A') return { x: 20, z: -16, yaw: Math.PI * 0.75 };
    return { x: -16, z: -6, yaw: -Math.PI * 0.5 };
  }
  return { x: bot.body.pos.x, z: bot.body.pos.z, yaw: bot.body.yaw };
}

// Buy for a bot at round start, by economy. Prices are deducted.
export function botBuy(bot, round, rng) {
  const ws = bot.ws;
  if (bot.ai.role === 'awper' && bot.money >= 4750) { giveWeapon(ws, 'awp'); bot.money -= 4750; }
  else if (bot.money >= 2700) { giveWeapon(ws, 'rifle'); bot.money -= 2700; }
  else if (bot.money >= 1500) { giveWeapon(ws, 'smg'); bot.money -= 1500; }
  if (bot.money >= 650 && rng() < 0.7) { bot.body.armor = 100; bot.money -= 650; }
  if (rng() < 0.5 && bot.money >= 300) { ws.smokes = 1; bot.money -= 300; }
  if (rng() < 0.35 && bot.money >= 200) { ws.flashes = 1; bot.money -= 200; }
  // Equip the best owned gun.
  for (const id of ['awp', 'rifle', 'smg', 'pistol']) {
    if (ws.owned[id]) { ws.current = id; break; }
  }
}

// Round setup: assign plans. Attackers pick a site; defenders pick hold sites.
export function planRound(G, round, rng) {
  const attackers = G.agents.filter(a => a.team === 'ATLAS' && !a.isPlayer);
  const defenders = G.agents.filter(a => a.team === 'SENTRY');
  // IGL picks the site: alternate, but favour the site we won on last round.
  const igl = attackers.find(a => a.ai.role === 'igl') || attackers[0];
  let site = G.lastSite === 'A' ? 'B' : 'A';
  if (G.lastWonSite && rng() < 0.6) site = G.lastWonSite;
  if (igl) igl.ai.planSite = site;
  for (const a of attackers) a.ai.planSite = site;
  // Bomb carrier: the entry fragger — or the player, 40% of rounds.
  const carrier = rng() < 0.4 ? G.player : (attackers.find(a => a.ai.role === 'entry') || attackers[0]);
  for (const a of attackers) a.hasBomb = false;
  if (carrier) carrier.hasBomb = true;
  // Defenders: two A, two B, one mid.
  const order = [...defenders].sort(() => rng() - 0.5);
  order.forEach((d, i) => {
    d.ai.holdSite = i < 2 ? 'A' : i < 4 ? 'B' : 'mid';
    d.ai.state = 'hold';
    const hp = d.ai.holdSite === 'mid' ? { x: 0, z: 8 } : sitePoint(G, d.ai.holdSite, rng);
    d.ai.holdPos = hp;
    d.ai.holdYaw = rng() * Math.PI * 2;
  });
  for (const a of attackers) { a.ai.state = 'push'; a.ai.path = []; a.ai.smokeThrown = false; a.ai.flashThrown = false; }
}

// Move along the current path. Returns an input object for stepBody.
function followPath(G, bot, dt, now, rng) {
  const ai = bot.ai;
  const input = { f: 0, b: 0, l: 0, r: 0, jump: false, crouch: false, walk: false };
  if (!ai.path.length || ai.pathI >= ai.path.length) return input;
  const node = G.world.waypoints[ai.path[ai.pathI]];
  const dx = node.x - bot.body.pos.x, dz = node.z - bot.body.pos.z;
  const d = Math.hypot(dx, dz);
  // Arrived at this node (or close on the catwalk level)?
  const dy = Math.abs((node.y || 0) - bot.body.pos.y);
  if (d < 0.9 && dy < 1.2) { ai.pathI += 1; return input; }
  // Face the node; walk forward toward it.
  const wantYaw = Math.atan2(-dx, -dz);
  let dyaw = wantYaw - bot.body.yaw;
  while (dyaw > Math.PI) dyaw -= Math.PI * 2;
  while (dyaw < -Math.PI) dyaw += Math.PI * 2;
  bot.body.yaw += Math.max(-4.5 * dt, Math.min(4.5 * dt, dyaw));
  if (Math.abs(dyaw) < 0.9) input.f = 1;
  else if (Math.abs(dyaw) > 2.4) input.f = 0.3; // turn on the spot when far off
  else input.f = 0.6;
  // Strafe-jitter while pushing so the bot is not a straight-line target.
  if (now > ai.strafeAt) { ai.strafeDir *= -1; ai.strafeAt = now + 0.9 + rng() * 0.9; }
  if (ai.state === 'push' && d > 4) input.r = ai.strafeDir * 0.4;
  // Crouch when sneaking the last metres to a site.
  if (ai.state === 'push' && d < 6 && bot.ai.role === 'lurker') input.crouch = true;
  return input;
}

export function updateBot(G, bot, dt, now, rng) {
  const ai = bot.ai;
  const body = bot.body;
  if (!body.alive) return;
  const bomb = G.bomb;
  // --- pick a target (never while flash-blinded) ---
  const blinded = ai.blindUntil && now < ai.blindUntil;
  const seen = blinded ? null : visibleEnemy(G, bot);
  if (seen) {
    if (ai.target !== seen) { ai.target = seen; ai.acquireAt = now; ai.aimErr = 0.06; ai.burstLeft = 0; }
  } else if (ai.target && !ai.target.body.alive) {
    ai.target = null;
  } else if (ai.target && now - ai.acquireAt > 1.6) {
    ai.target = null; // lost them
  }
  // --- decide the job ---
  if (bot.team === 'SENTRY' && bomb.planted) ai.state = 'retake';
  else if (bot.team === 'SENTRY' && ai.state === 'retake' && !bomb.planted) ai.state = 'hold';
  if (bot.team === 'ATLAS' && bomb.planted) ai.state = 'hunt';
  if (bot.hasBomb && ai.state === 'push') {
    const site = siteAt(G.world, body.pos.x, body.pos.z);
    if (site === ai.planSite && !seen) ai.state = 'plant';
  }
  // --- movement target ---
  let moveTarget = null;
  if (ai.state === 'plant') {
    moveTarget = null; // stand still and plant (main.js runs the channel)
  } else if (ai.state === 'retake' || ai.state === 'hunt') {
    moveTarget = { x: bomb.x, z: bomb.z };
    if (ai.state === 'retake' && bomb.defuser) moveTarget = { x: bomb.x, z: bomb.z };
  } else if (ai.state === 'hold') {
    moveTarget = ai.holdPos;
  } else if (ai.state === 'push') {
    if (ai.role === 'lurker') {
      moveTarget = ai.planSite === 'A' ? { x: 12, z: -2 } : { x: -11, z: 0 }; // flank routes
      if (dist2d(body.pos.x, body.pos.z, moveTarget.x, moveTarget.z) < 2) moveTarget = sitePoint(G, ai.planSite, rng);
    } else if (ai.role === 'awper') {
      moveTarget = ai.planSite === 'A' ? { x: 24, z: -4 } : { x: -8, z: 2 }; // long angles
      if (dist2d(body.pos.x, body.pos.z, moveTarget.x, moveTarget.z) < 2) moveTarget = sitePoint(G, ai.planSite, rng);
    } else {
      moveTarget = sitePoint(G, ai.planSite, rng);
    }
  }
  // Repath when the target moved or the path ran out.
  if (moveTarget) {
    const needPath = !ai.path.length || ai.pathI >= ai.path.length || now > ai.repathAt;
    if (needPath) setPathTo(G, bot, moveTarget.x, moveTarget.z, now);
  }
  // --- aim + fire ---
  let input = followPath(G, bot, dt, now, rng);
  if (ai.state === 'plant') input = { f: 0, b: 0, l: 0, r: 0, jump: false, crouch: true, walk: false };
  if (ai.target) {
    const t = ai.target;
    const dx = t.body.pos.x - body.pos.x;
    const dz = t.body.pos.z - body.pos.z;
    const dy = (t.body.pos.y + 1.3) - (body.pos.y + body.eyeHeight);
    const d = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, d);
    // Aim error shrinks as the bot tracks, grows with target speed/distance.
    const tracking = Math.min(1, (now - ai.acquireAt) * 2.2);
    const errBase = 0.055 * (1 - tracking * 0.6) + d * 0.0009 + (t.body.moving ? 0.02 : 0);
    ai.aimErr = errBase;
    let dyaw = wantYaw - body.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turn = 5.5 * dt;
    body.yaw += Math.max(-turn, Math.min(turn, dyaw));
    body.pitch += Math.max(-turn, Math.min(turn, wantPitch - body.pitch));
    // Face the target and stop pushing while engaged.
    input = { f: 0, b: 0, l: 0, r: 0, jump: false, crouch: bot.ai.role === 'awper' || d > 18, walk: false };
    // Fire in bursts after the reaction time.
    const reacted = now - ai.acquireAt > 0.28 + (bot.ai.role === 'awper' ? 0.15 : 0);
    if (reacted) {
      if (ai.burstLeft <= 0) {
        if (ai.burstPause <= 0) {
          ai.burstLeft = bot.ws.current === 'awp' ? 1 : 3 + (rng() * 3 | 0);
          ai.burstPause = 0.45 + rng() * 0.5;
        } else ai.burstPause -= dt;
      }
      if (ai.burstLeft > 0) {
        // Add the aim error into the shot by nudging the yaw/pitch briefly.
        const eYaw = (rng() - 0.5) * 2 * ai.aimErr;
        const ePitch = (rng() - 0.5) * 2 * ai.aimErr;
        body.yaw += eYaw; body.pitch += ePitch;
        const ev = fireShot(G, bot, now, rng);
        body.yaw -= eYaw; body.pitch -= ePitch;
        if (ev) { ai.burstLeft -= 1; if (ai.burstLeft <= 0) ai.burstPause = 0.45 + rng() * 0.5; }
        else if (bot.ws.ammo[bot.ws.current] <= 0) {
          // Reload (weapons.js handles the timer); step back while reloading.
          input.b = 1;
        }
      }
    }
    // Strafe while duelling.
    if (now > ai.strafeAt) { ai.strafeDir *= -1; ai.strafeAt = now + 0.7 + rng() * 0.8; }
    input.r = ai.strafeDir * 0.5;
  } else if (ai.state === 'hold' && ai.holdPos) {
    // Hold: face the hold yaw, small sway, walk to the spot first.
    const d = dist2d(body.pos.x, body.pos.z, ai.holdPos.x, ai.holdPos.z);
    if (d > 1.2) {
      input = followPath(G, bot, dt, now, rng);
    } else {
      input = { f: 0, b: 0, l: 0, r: 0, jump: false, crouch: rng() < 0.4, walk: false };
      let dyaw = ai.holdYaw - body.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      body.yaw += Math.max(-3 * dt, Math.min(3 * dt, dyaw));
      body.pitch *= 0.95;
    }
    if (bot.ws.current === 'awp') body.scoped = true; else body.scoped = false;
  }
  // Grenades: smoke the site entrance on execute, flash before entry.
  if (ai.state === 'push' && !ai.smokeThrown && bot.ws.smokes > 0) {
    const sp = sitePoint(G, ai.planSite, rng);
    if (dist2d(body.pos.x, body.pos.z, sp.x, sp.z) < 12) {
      bot.ws.smokes -= 1; ai.smokeThrown = true;
      G.throwGrenade(bot, 'smoke');
    }
  }
  if (ai.target && !ai.flashThrown && bot.ws.flashes > 0 && dist2d(body.pos.x, body.pos.z, ai.target.body.pos.x, ai.target.body.pos.z) < 16) {
    bot.ws.flashes -= 1; ai.flashThrown = true;
    G.throwGrenade(bot, 'flash');
  }
  // Heard a shot nearby with no visual: turn toward it.
  if (!ai.target && ai.heard && now - ai.heard.t < 1.2) {
    const dx = ai.heard.x - body.pos.x, dz = ai.heard.z - body.pos.z;
    const wantYaw = Math.atan2(-dx, -dz);
    let dyaw = wantYaw - body.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    body.yaw += Math.max(-3.5 * dt, Math.min(3.5 * dt, dyaw));
  }
  body.crouched = !!input.crouch;
  stepBody(body, input, dt, G.world);
}
