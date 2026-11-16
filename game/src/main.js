// main.js — OBSERVATORY: bootstrap, fixed-step simulation, round flow, input.
// One job: own the single game state G and run it. Systems live in the other
// modules; this file wires them together and renders.
import * as THREE from 'three';
import { buildWorld, mulberry32 } from './world.js';
import { WEAPONS, makeWeaponState, giveWeapon, tickWeapon, startReload, throwGrenade, tickGrenade } from './weapons.js';
import { makeBody, stepBody, eyePos, lookDir, healFull } from './player.js';
import { makeBot, planRound, botBuy, updateBot, ROLES } from './bots.js';
import { fireShot, tickPlant, tickDefuse } from './combat.js';
import { makeAudio } from './audio.js';
import { makeHud } from './hud.js';
import { makeEffects } from './effects.js';

const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '0', 10) || ((Math.random() * 1e9) | 0);
const rng = mulberry32(SEED);
const SHOT = params.get('shot') || '';
const AUTOPLAY = params.get('autoplay') === '1' || SHOT === 'play' || SHOT === 'end';

const DT = 1 / 60;
const ROUND_TIME = 100;
const FREEZE_TIME = 4;
const BOMB_TIME = 35;
const WIN_ROUNDS = 5;

// ---------- renderer / scene ----------
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060c);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- state (one place) ----------
const world = buildWorld(scene, rng);
const audio = makeAudio();
const hud = makeHud();
const fx = makeEffects(scene);
const lampOffMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });

const G = {
  world, rng, time: 0, timeScale: 1,
  phase: 'menu', // menu | freeze | live | end | match
  round: 1, scoreA: 0, scoreB: 0,
  timer: FREEZE_TIME, endTimer: 0,
  agents: [], player: null, spectate: null,
  bomb: { carrier: null, planted: false, site: null, x: 0, z: 0, timer: BOMB_TIME, plantProgress: 0, defuseProgress: 0, defuser: null, plantSite: null, beepAt: 0 },
  grenades: [], smokes: [], feed: [],
  lastSite: null, lastWonSite: null,
  lampOffMat,
  throwGrenade(agent, kind) { throwGrenadeFrom(G, agent, kind); },
};

// ---------- agents ----------
const ATLAS_NAMES = ['Vega', 'Orion', 'Lyra', 'Nova'];
const SENTRY_NAMES = ['Rigel', 'Altair', 'Deneb', 'Castor', 'Pollux'];
const ATLAS_ROLES = ['igl', 'entry', 'support', 'awper'];
const SENTRY_ROLES = ['igl', 'entry', 'support', 'lurker', 'awper'];

function makeAgent(id, name, team, role, isPlayer, x, z, yaw) {
  const a = isPlayer
    ? { id, name, team, role, isPlayer: true, body: makeBody(x, 0, z, yaw), ws: makeWeaponState(), kills: 0, deaths: 0, money: 800, hasBomb: false, ai: null }
    : makeBot(id, name, team, role, x, z, yaw);
  if (!isPlayer) a.body = makeBody(x, 0, z, yaw);
  a.spawnX = x; a.spawnZ = z; a.spawnYaw = yaw;
  a.mesh = buildAgentMesh(team);
  scene.add(a.mesh.group);
  return a;
}

function buildAgentMesh(team) {
  const col = team === 'ATLAS' ? 0x3a7bd5 : 0xd55a2a;
  const dark = team === 'ATLAS' ? 0x1c2f45 : 0x45231c;
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.15 });
  const matD = new THREE.MeshStandardMaterial({ color: dark, roughness: 0.8, metalness: 0.1 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x0a0f16, emissive: team === 'ATLAS' ? 0x2a9fff : 0xff5a2a, emissiveIntensity: 1.4 });
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), mat);
  torso.position.y = 1.05; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.32), matD);
  head.position.y = 1.56; g.add(head);
  const vs = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), visor);
  vs.position.set(0, 1.58, -0.17); g.add(vs);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), matD);
  legL.position.set(-0.14, 0.36, 0); g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.14; g.add(legR);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), mat);
  armR.position.set(0.32, 1.1, -0.12); armR.rotation.x = -1.1; g.add(armR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.85), matD);
  gun.position.set(0.18, 1.25, -0.45); g.add(gun);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.14), matD);
  pack.position.set(0, 1.1, 0.22); g.add(pack);
  return { group: g, legL, legR, armR, torso, head };
}

function createAgents() {
  const ap = world.SPAWNS.attack, dp = world.SPAWNS.defend;
  const player = makeAgent('p0', 'YOU', 'ATLAS', 'lurker', true, ap[0][0], ap[0][1], Math.PI);
  G.player = player;
  G.agents.push(player);
  ATLAS_NAMES.forEach((n, i) => {
    const s = ap[i + 1];
    G.agents.push(makeAgent('a' + (i + 1), n, 'ATLAS', ATLAS_ROLES[i], false, s[0], s[1], Math.PI));
  });
  SENTRY_NAMES.forEach((n, i) => {
    const s = dp[i];
    // Defenders face south (toward the attackers).
    G.agents.push(makeAgent('s' + (i + 1), n, 'SENTRY', SENTRY_ROLES[i], false, s[0], s[1], 0));
  });
}

// Per round: reposition everyone at spawn and heal, but KEEP weapons, money,
// kills and deaths (the economy persists between rounds).
function resetRoundPositions() {
  for (const a of G.agents) {
    a.body.pos.set(a.spawnX, 0, a.spawnZ);
    a.body.yaw = a.spawnYaw;
    a.body.pitch = 0;
    a.body.vel.set(0, 0, 0);
    healFull(a.body);
    a.hasBomb = false;
    a.planting = false;
    if (a.ai) {
      a.ai.state = 'push'; a.ai.path = []; a.ai.pathI = 0; a.ai.target = null;
      a.ai.heard = null; a.ai.smokeThrown = false; a.ai.flashThrown = false;
      a.ai.blindUntil = 0;
    }
    a.mesh.group.visible = true;
  }
  G.spectate = null;
}

// ---------- viewmodel gun ----------
const viewGun = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5, metalness: 0.6 });
  const mid = new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.45, metalness: 0.7 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  viewGun.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 10), mid);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.45);
  viewGun.add(barrel);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), mid);
  sight.position.set(0, 0.1, -0.1);
  viewGun.add(sight);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.13, 0.14); grip.rotation.x = 0.35;
  viewGun.add(grip);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.09), mid);
  mag.position.set(0, -0.14, -0.08); mag.rotation.x = 0.12;
  viewGun.add(mag);
  viewGun.position.set(0.26, -0.24, -0.5);
  camera.add(viewGun);
  // A small fill light on the camera so the viewmodel and near geometry read
  // in the dark dome (the darkness is the map's character, not a black screen).
  const camFill = new THREE.PointLight(0xbfd0ff, 2.2, 5, 1.8);
  camFill.position.set(0.15, 0.1, -0.2);
  camera.add(camFill);
  scene.add(camera);
}
let gunKick = 0, gunReloadDip = 0;

// ---------- bomb mesh ----------
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.3), new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.6, metalness: 0.4 }));
  bombMesh.add(box);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2211, emissiveIntensity: 2 }));
  light.position.set(0.12, 0.13, 0);
  bombMesh.add(light);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// ---------- input ----------
const keys = {};
let mouseDown = false, mouseDownR = false;
let locked = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyR') tryReload();
  if (e.code === 'KeyB') toggleBuy();
  if (e.code === 'KeyG') throwPlayerGrenade('smoke');
  if (e.code === 'KeyF') throwPlayerGrenade('flash');
  if (e.code === 'Digit4') tryPlantKey();
  if (e.code.startsWith('Digit')) {
    const n = parseInt(e.code.slice(5), 10);
    if (n >= 1 && n <= 4) selectWeapon(n);
  }
  if (e.code === 'Escape') hud.closeBuy();
  if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
renderer.domElement.addEventListener('click', () => {
  if (G.phase === 'live' || G.phase === 'freeze') {
    if (!AUTOPLAY) renderer.domElement.requestPointerLock();
    if (!G.player.body.alive && G.spectate) cycleSpectate();
  }
});
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === renderer.domElement; });
addEventListener('mousemove', (e) => {
  if (!locked || !G.player.body.alive) return;
  const sens = G.player.body.scoped ? 0.0009 : 0.0021;
  G.player.body.yaw -= e.movementX * sens;
  G.player.body.pitch -= e.movementY * sens;
  G.player.body.pitch = Math.max(-1.5, Math.min(1.5, G.player.body.pitch));
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) mouseDown = true;
  if (e.button === 2) { mouseDownR = true; toggleScope(); }
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) mouseDownR = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
document.getElementById('playbtn').addEventListener('click', () => {
  audio.ensure();
  document.getElementById('menu').classList.add('hidden');
  startMatch();
});
document.getElementById('againbtn').addEventListener('click', () => {
  document.getElementById('endscreen').classList.add('hidden');
  startMatch();
});
document.getElementById('buyrows').addEventListener('click', (e) => {
  const row = e.target.closest('[data-buy]');
  if (row) buyItem(row.dataset.buy);
});

function selectWeapon(slot) {
  const p = G.player, ws = p.ws;
  const order = ['pistol', 'smg', 'rifle', 'awp'];
  const id = order[slot - 1];
  if (id && ws.owned[id] && ws.reloading <= 0) { ws.current = id; p.body.scoped = false; }
}
function tryReload() {
  const p = G.player;
  if (p.body.alive && startReload(p.ws, G.time)) audio.reload();
}
function toggleScope() {
  const p = G.player;
  if (p.ws.current === 'awp' && p.body.alive) {
    p.body.scoped = !p.body.scoped;
    camera.fov = p.body.scoped ? 32 : 75;
    camera.updateProjectionMatrix();
  }
}
function toggleBuy() {
  if (G.phase !== 'freeze' && G.phase !== 'live') return;
  if (hud.buyOpen()) { hud.closeBuy(); if (!AUTOPLAY) renderer.domElement.requestPointerLock(); }
  else { hud.openBuy(G.player); document.exitPointerLock?.(); }
}
function buyItem(id) {
  const p = G.player;
  if (id === 'armor') {
    if (p.money >= 650 && p.body.armor < 100) { p.money -= 650; p.body.armor = 100; audio.beep(880, 0.06, 0.1); }
  } else if (id === 'smoke') {
    if (p.money >= 300 && p.ws.smokes < 2) { p.money -= 300; p.ws.smokes += 1; audio.beep(880, 0.06, 0.1); }
  } else if (id === 'flash') {
    if (p.money >= 200 && p.ws.flashes < 2) { p.money -= 200; p.ws.flashes += 1; audio.beep(880, 0.06, 0.1); }
  } else if (WEAPONS[id]) {
    if (p.money >= WEAPONS[id].price && !p.ws.owned[id]) {
      p.money -= WEAPONS[id].price;
      giveWeapon(p.ws, id);
      p.ws.current = id;
      audio.beep(880, 0.06, 0.1);
    }
  }
  hud.renderBuy(p);
}
function throwPlayerGrenade(kind) {
  const p = G.player;
  if (!p.body.alive || G.phase !== 'live') return;
  const n = kind === 'smoke' ? p.ws.smokes : p.ws.flashes;
  if (n <= 0) { hud.hint(`No ${kind} grenade — buy one with B`); return; }
  if (kind === 'smoke') p.ws.smokes -= 1; else p.ws.flashes -= 1;
  throwGrenadeFrom(G, p, kind);
  audio.beep(660, 0.05, 0.08);
}
function throwGrenadeFrom(G, agent, kind) {
  const dir = new THREE.Vector3();
  lookDir(agent.body, dir);
  const origin = new THREE.Vector3();
  eyePos(agent.body, origin);
  origin.y -= 0.15;
  G.grenades.push(throwGrenade(origin, dir, kind));
}
function tryPlantKey() {
  const p = G.player;
  if (!p.body.alive || !p.hasBomb || G.phase !== 'live') return;
  p.planting = true;
  hud.hint('Planting — hold still…');
}

// ---------- round flow ----------
function startMatch() {
  G.scoreA = 0; G.scoreB = 0; G.round = 1;
  if (!G.agents.length) createAgents();
  for (const a of G.agents) { a.money = 800; a.kills = 0; a.deaths = 0; a.ws = makeWeaponState(); }
  startRound();
  hud.show();
}

function startRound() {
  resetRoundPositions();
  G.phase = 'freeze';
  G.timer = FREEZE_TIME;
  G.bomb = { carrier: null, planted: false, site: null, x: 0, z: 0, timer: BOMB_TIME, plantProgress: 0, defuseProgress: 0, defuser: null, plantSite: null, beepAt: 0 };
  G.grenades = []; G.smokes = []; G.feed = [];
  G.spectate = null;
  bombMesh.visible = false;
  planRound(G, G.round, rng);
  // Bots buy; the player gets the buy menu.
  for (const a of G.agents) {
    if (!a.isPlayer) botBuy(a, G.round, rng);
    a.body.scoped = false;
  }
  const carrier = G.agents.find(a => a.hasBomb);
  if (carrier) G.bomb.carrier = carrier;
  camera.fov = 75; camera.updateProjectionMatrix();
  hud.hideBanner();
  hud.hint(G.player.hasBomb ? 'You carry the bomb — plant at A or B (hold 4)' : 'Follow the plan — the IGL calls the site');
  if (!AUTOPLAY && G.round === 1) hud.openBuy(G.player);
}

function aliveCount(team) {
  return G.agents.filter(a => a.team === team && a.body.alive).length;
}

function endRound(winner, reason) {
  if (G.phase === 'end' || G.phase === 'match') return;
  G.phase = 'end';
  G.endTimer = 4.5;
  G.timeScale = 0.35; // round-end slow-mo
  if (winner === 'ATLAS') { G.scoreA += 1; G.lastWonSite = G.bomb.site || G.lastSite; }
  else G.scoreB += 1;
  // Economy.
  for (const a of G.agents) {
    if (a.team === winner) a.money += 3250;
    else a.money += 1900;
    a.money = Math.min(16000, a.money);
  }
  const win = winner === 'ATLAS';
  hud.banner(win ? 'ATLAS TAKES THE ROUND' : 'SENTRY HOLDS THE ROUND', reason, win ? 'winA' : 'winS');
  audio.sting(win);
  if (G.scoreA >= WIN_ROUNDS || G.scoreB >= WIN_ROUNDS || G.round >= 9) {
    G.endTimer = 5.5; // let the banner read before the match screen
    G.matchWinner = winner;
  }
}

function endMatch() {
  G.phase = 'match';
  G.timeScale = 1;
  const win = G.matchWinner === 'ATLAS';
  document.getElementById('endtitle').textContent = win ? 'ATLAS WINS THE MATCH' : 'SENTRY WINS THE MATCH';
  document.getElementById('endsub').textContent =
    `Final score ATLAS ${G.scoreA} — ${G.scoreB} SENTRY · ${G.player.kills} eliminations for you. ` +
    `The observatory keeps its secrets — run it back.`;
  document.getElementById('endscreen').classList.remove('hidden');
  hud.hide();
  document.exitPointerLock?.();
}

function cycleSpectate() {
  const alive = G.agents.filter(a => a.team === 'ATLAS' && a.body.alive && !a.isPlayer);
  if (!alive.length) return;
  const i = alive.indexOf(G.spectate);
  G.spectate = alive[(i + 1) % alive.length];
}

// ---------- per-frame sim ----------
function playerInput() {
  const p = G.player.body;
  return {
    f: (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0),
    b: 0,
    l: (keys.KeyA ? 1 : 0),
    r: (keys.KeyD ? 1 : 0),
    jump: !!keys.Space,
    crouch: !!keys.ControlLeft || !!keys.ControlRight,
    walk: !!keys.ShiftLeft || !!keys.ShiftRight,
  };
}

function stepSim(dt) {
  const now = G.time;
  world.update(dt, now);
  // --- player ---
  const p = G.player;
  if (G.phase === 'live' || G.phase === 'freeze') {
    if (p.body.alive) {
      let input;
      if (AUTOPLAY) {
        // Drive the player with the same brain as the bots.
        if (!p.ai) p.ai = { role: 'lurker', state: 'push', path: [], pathI: 0, target: null, acquireAt: 0, aimErr: 0.05, burstLeft: 0, burstPause: 0, holdPos: null, holdYaw: 0, heard: null, planSite: G.agents.find(a => a.ai)?.ai.planSite || 'A', repathAt: 0, plantAt: 0, smokeThrown: false, flashThrown: false, strafeDir: 1, strafeAt: 0 };
        p.ai.planSite = G.agents.find(a => a.ai)?.ai.planSite || p.ai.planSite;
        updateBot(G, p, dt, now, rng);
        if (p.hasBomb && p.ai.state === 'plant') {
          const r = tickPlant(G, p, dt, now);
          if (r === 'planted') { p.planting = false; onPlanted(); }
        }
      } else {
        input = playerInput();
        p.body.crouched = !!input.crouch;
        const speed = stepBody(p.body, input, dt, world);
        if (speed > 3 && p.body.onGround && now - (p._stepAt || 0) > 0.34) {
          p._stepAt = now; audio.step(speed > 4);
        }
        // Fire while held (the G.onShot hook plays the effects + sound).
        if (mouseDown && locked) {
          const ev = fireShot(G, p, now, rng);
          if (!ev && (p.ws.ammo[p.ws.current] | 0) <= 0 && p.ws.reloading <= 0 && p.ws.cooldown <= now) audio.dryClick();
        }
        if (p.planting) {
          const r = tickPlant(G, p, dt, now);
          if (r === 'planted') { p.planting = false; onPlanted(); }
          else if (r === null) { p.planting = false; hud.hint('Step into a site to plant (hold 4)'); }
        }
      }
      tickWeapon(p.ws, dt);
      if (p.ws.reloading > 0 && p.ws.current === 'awp') p.body.scoped = false;
    } else if (G.phase === 'live' && !G.spectate) {
      cycleSpectate();
    }
  }
  // --- bots ---
  for (const a of G.agents) {
    if (a.isPlayer || !a.body.alive) continue;
    if (G.phase === 'live' || G.phase === 'freeze') {
      if (G.phase === 'live') {
        updateBot(G, a, dt, now, rng);
        tickWeapon(a.ws, dt);
        // Bot planting / defusing.
        if (a.hasBomb && a.ai.state === 'plant') {
          const r = tickPlant(G, a, dt, now);
          if (r === 'planted') onPlanted();
        }
        if (a.team === 'SENTRY' && G.bomb.planted) {
          const r = tickDefuse(G, a, dt);
          if (r === 'defused') endRound('SENTRY', 'Bomb defused — SENTRY holds the dome');
        }
      } else {
        // Freeze: bots idle at spawn, weapons tick.
        tickWeapon(a.ws, dt);
      }
    }
  }
  // --- grenades ---
  for (const g of G.grenades) {
    if (g.done) continue;
    tickGrenade(g, dt, world);
    if (g.done) {
      if (g.kind === 'smoke') {
        fx.smokeCloud(g.pos.x, g.pos.y, g.pos.z);
        G.smokes.push({ x: g.pos.x, z: g.pos.z, r: 3.6, t: 14 });
        audio.beep(300, 0.2, 0.06);
      } else {
        flashDetonate(g);
      }
    }
  }
  G.grenades = G.grenades.filter(g => !g.done);
  for (const s of G.smokes) s.t -= dt;
  G.smokes = G.smokes.filter(s => s.t > 0);
  // --- bomb ---
  const bomb = G.bomb;
  if (bomb.planted) {
    bomb.timer -= dt;
    if (now - bomb.beepAt > Math.max(0.35, bomb.timer / 35)) {
      bomb.beepAt = now;
      audio.beep(bomb.timer < 10 ? 1320 : 990, 0.07, 0.12);
    }
    if (bomb.timer <= 0) {
      bombMesh.visible = false;
      audio.explosion();
      fx.sparks(new THREE.Vector3(bomb.x, 1, bomb.z), 60, 0xff8030);
      endRound('ATLAS', 'The device detonated on the Telescope Deck');
    }
  }
  // --- round timer / phase transitions ---
  if (G.phase === 'freeze') {
    G.timer -= dt;
    if (G.timer <= 0) {
      G.phase = 'live';
      G.timer = ROUND_TIME;
      hud.closeBuy();
      hud.hint('');
      audio.beep(660, 0.08, 0.1);
    }
  } else if (G.phase === 'live') {
    G.timer -= dt;
    const aAlive = aliveCount('ATLAS'), sAlive = aliveCount('SENTRY');
    if (aAlive === 0) endRound('SENTRY', 'ATLAS eliminated');
    else if (sAlive === 0) endRound('ATLAS', 'SENTRY eliminated');
    else if (G.timer <= 0 && !bomb.planted) endRound('SENTRY', 'Time expired — the device was never planted');
  } else if (G.phase === 'end') {
    G.endTimer -= dt / Math.max(0.2, G.timeScale);
    G.timeScale = Math.min(1, G.timeScale + dt * 0.4);
    if (G.endTimer <= 0) {
      G.timeScale = 1;
      if (G.matchWinner) endMatch();
      else { G.round += 1; startRound(); }
    }
  }
}

function flashDetonate(g) {
  // Player flash: looking at it + line of sight + range.
  const p = G.player;
  if (p.body.alive) {
    const d = Math.hypot(p.body.pos.x - g.pos.x, p.body.pos.z - g.pos.z);
    if (d < 26) {
      const dir = new THREE.Vector3();
      lookDir(p.body, dir);
      const to = new THREE.Vector3(g.pos.x - p.body.pos.x, g.pos.y - (p.body.pos.y + p.body.eyeHeight), g.pos.z - p.body.pos.z).normalize();
      const facing = dir.dot(to);
      const from = { x: p.body.pos.x, y: p.body.pos.y + p.body.eyeHeight, z: p.body.pos.z };
      const blocked = world.segmentBlocked(from, { x: g.pos.x, y: g.pos.y, z: g.pos.z });
      if (facing > -0.2 && !blocked) {
        hud.flashBlind(Math.max(0.3, 1 - d / 26));
        audio.beep(1560, 0.15, 0.1);
      }
    }
  }
  // Bots: blinded if close and in line of sight.
  for (const a of G.agents) {
    if (a.isPlayer || !a.body.alive || !a.ai) continue;
    const d = Math.hypot(a.body.pos.x - g.pos.x, a.body.pos.z - g.pos.z);
    if (d < 20 && !world.segmentBlocked({ x: a.body.pos.x, y: a.body.pos.y + 1.4, z: a.body.pos.z }, { x: g.pos.x, y: g.pos.y, z: g.pos.z })) {
      a.ai.blindUntil = G.time + 2.2;
      a.ai.target = null;
    }
  }
  fx.sparks(new THREE.Vector3(g.pos.x, g.pos.y, g.pos.z), 20, 0xffffff);
}

// Called for EVERY shot (player and bots) via the G.onShot hook in combat.js:
// tracer + muzzle + distance-attenuated sound always; player-only UI on top.
function onShotFired(shooter, ev) {
  const def = ev.def;
  const p = G.player;
  const dist = Math.hypot(shooter.body.pos.x - p.body.pos.x, shooter.body.pos.z - p.body.pos.z);
  audio.shot(def.sound, dist);
  const end = ev.hit ? ev.hit.point : new THREE.Vector3().copy(ev.from).addScaledVector(ev.dir, def.range);
  fx.tracer(ev.from, end, def.tracer);
  fx.muzzle(ev.from, ev.dir);
  if (shooter.isPlayer) gunKick = Math.min(0.09, gunKick + def.recoil * 0.5);
  if (ev.hit) {
    if (ev.hit.kind === 'wall') fx.impact(ev.hit.point);
    else if (ev.hit.kind === 'lamp') fx.sparks(ev.hit.point, 14, 0xffd88a);
    else if (shooter.isPlayer) { hud.hitmark(ev.headshot); audio.hit(ev.headshot); }
    if (ev.hit.agent && ev.hit.agent.isPlayer) {
      const dx = shooter.body.pos.x - p.body.pos.x, dz = shooter.body.pos.z - p.body.pos.z;
      const ang = Math.atan2(dx, dz) - p.body.yaw;
      hud.damageFrom((-ang * 180) / Math.PI);
      audio.hurt();
    }
    if (ev.killed && ev.hit.agent) hud.pushFeed(shooter.name, ev.hit.agent.name, ev.headshot);
  }
}
G.onShot = onShotFired;

function onPlanted() {
  const bomb = G.bomb;
  bombMesh.visible = true;
  bombMesh.position.set(bomb.x, 0.15, bomb.z);
  hud.banner('DEVICE PLANTED', `${bomb.site === 'A' ? 'Telescope Deck' : 'Control Room'} — SENTRY must defuse in 35 seconds`, 'winA');
  audio.beep(880, 0.12, 0.14);
  setTimeout(() => audio.beep(880, 0.12, 0.14), 180);
  G.lastSite = bomb.site;
}

// ---------- camera + render ----------
const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
let camOrbit = 0;

function render() {
  const p = G.player;
  if (G.phase === 'menu') {
    // Slow orbit around the dome for the title screen.
    camOrbit += 0.0006;
    camera.position.set(14 + Math.cos(camOrbit) * 20, 9 + Math.sin(camOrbit * 0.7) * 2, -10 + Math.sin(camOrbit) * 20);
    camera.lookAt(14, 3, -10);
    camera.fov = 60; camera.updateProjectionMatrix();
  } else if (p.body.alive) {
    eyePos(p.body, _eye);
    // View bob.
    const bob = p.body.moving && p.body.onGround ? Math.sin(p.body.bobPhase * 2) * 0.035 : 0;
    _eye.y += bob;
    camera.position.copy(_eye);
    camera.rotation.set(p.body.pitch, p.body.yaw, 0);
    if (p.body.scoped) { camera.fov += (32 - camera.fov) * 0.2; camera.updateProjectionMatrix(); }
    else if (Math.abs(camera.fov - 75) > 0.1) { camera.fov += (75 - camera.fov) * 0.2; camera.updateProjectionMatrix(); }
  } else if (G.spectate) {
    // Death cam: chase the spectated teammate.
    const s = G.spectate;
    eyePos(s.body, _eye);
    camera.position.set(_eye.x - Math.sin(s.body.yaw) * -2.4, _eye.y + 1.4, _eye.z - Math.cos(s.body.yaw) * -2.4);
    camera.lookAt(s.body.pos.x, s.body.pos.y + 1.2, s.body.pos.z);
  }
  // Viewmodel.
  gunKick = Math.max(0, gunKick - 0.008);
  gunReloadDip = p.ws.reloading > 0 ? Math.min(1, gunReloadDip + 0.08) : Math.max(0, gunReloadDip - 0.08);
  viewGun.position.z = -0.5 + gunKick;
  viewGun.position.y = -0.24 - gunReloadDip * 0.18;
  viewGun.rotation.x = gunKick * 1.6 + gunReloadDip * 0.5;
  viewGun.visible = p.body.alive && (G.phase === 'live' || G.phase === 'freeze');
  // Bot meshes.
  for (const a of G.agents) {
    if (a.isPlayer) { a.mesh.group.visible = false; continue; }
    const m = a.mesh.group;
    m.visible = true;
    m.position.set(a.body.pos.x, a.body.pos.y, a.body.pos.z);
    m.rotation.y = a.body.yaw;
    if (!a.body.alive) {
      m.rotation.x = -Math.PI / 2 + 0.12;
      m.position.y = 0.25;
      m.rotation.z = 0.3;
    } else {
      m.rotation.x = 0; m.rotation.z = 0;
      const swing = a.body.moving ? Math.sin(a.body.bobPhase * 2) * 0.5 : 0;
      a.mesh.legL.rotation.x = swing;
      a.mesh.legR.rotation.x = -swing;
    }
    // Bomb on the carrier's back is shown by the roster star; no extra mesh here.
  }
  // Bomb blink.
  if (G.bomb.planted) {
    bombMesh.children[1].material.emissiveIntensity = (Math.sin(G.time * 9) > 0) ? 3 : 0.2;
  }
  fx.tick(1 / 60);
  renderer.render(scene, camera);
  // HUD.
  if (G.phase !== 'menu' && G.phase !== 'match') {
    hud.update(G, p, G.time);
    const ws = p.ws;
    const def = WEAPONS[ws.current];
    const spreadPx = 6 + (def.spread + ws.spreadBloom) * 900 + (p.body.moving ? 7 : 0);
    hud.setCrosshair(spreadPx, p.body.scoped);
  }
}

// ---------- main loop ----------
let last = performance.now();
let acc = 0;
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, nowMs - last);
  last = nowMs;
  if (G.phase !== 'menu' && G.phase !== 'match') {
    acc += (dtMs / 1000) * G.timeScale;
    let steps = 0;
    while (acc >= DT && steps < 5) {
      G.time += DT;
      stepSim(DT);
      acc -= DT;
      steps += 1;
    }
    if (steps === 5) acc = 0;
  } else {
    world.update(dtMs / 1000, G.time);
    G.time += dtMs / 1000;
  }
  render();
}

// ---------- shot modes (deterministic setups for screenshots) ----------
function setupShot() {
  audio.ensure();
  document.getElementById('menu').classList.add('hidden');
  if (SHOT === 'start') {
    // Title orbit handled by render(); keep the menu visible instead.
    document.getElementById('menu').classList.remove('hidden');
    return;
  }
  startMatch();
  if (SHOT === 'play') {
    // Fast-forward ~18s of live play so bots are mid-fight, then hold.
    G.phase = 'live'; G.timer = ROUND_TIME - 18;
    for (let i = 0; i < 18 * 60; i++) { G.time += DT; stepSim(DT); }
    // Put the player on the catwalk overlooking A for a strong frame.
    // (22.2, -18.2) is on the ring (dist 11.6 from the dome centre), facing the deck.
    const p = G.player;
    p.body.pos.set(22.2, 3.2, -18.2);
    p.body.yaw = Math.PI * 0.75; p.body.pitch = -0.08;
  } else if (SHOT === 'end') {
    // Jump straight to the deciding round: ATLAS leads 4-3 in round 9, then
    // the round ends and the match screen comes up after the slow-mo beat.
    G.scoreA = 4; G.scoreB = 3; G.round = 9;
    endRound('ATLAS', 'The device detonated on the Telescope Deck');
    for (let i = 0; i < 8 * 60; i++) { G.time += DT; stepSim(DT); }
  }
}

createAgents();
hud.hide();
if (SHOT) setupShot();
else if (AUTOPLAY) {
  // Headless autoplay (grader / soak test): skip the menu and start the match.
  document.getElementById('menu').classList.add('hidden');
  startMatch();
}
requestAnimationFrame(frame);
