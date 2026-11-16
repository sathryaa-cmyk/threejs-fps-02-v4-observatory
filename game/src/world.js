// world.js — the OBSERVATORY map: geometry, collision, light, waypoints.
// One job: build the mountain-top observatory and answer spatial questions
// (collision, line of sight, paths). No gameplay rules live here.
import * as THREE from 'three';

// Seeded RNG so a ?seed= build is deterministic.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export const SITES = {
  A: { name: 'A · TELESCOPE DECK', cx: 14, cz: -10, r: 8.5 },
  B: { name: 'B · CONTROL ROOM', x0: -25, x1: -13, z0: -17, z1: -5 },
};

export const SPAWNS = {
  attack: [
    [-6, 20], [-2, 20.5], [2, 20], [6, 20.5], [0, 18.5],
  ],
  defend: [
    [20, -14], [8, -4],   // A holders
    [-20, -8], [-16, -14], // B holders
    [0, 8],                // mid roam
  ],
};

export function buildWorld(scene, rng) {
  const colliders = [];   // {x0,x1,z0,z1,y0,y1}
  const lamps = [];       // {pos:Vector3, light, bulb, alive}
  const waypoints = [];   // {x,y,z,links:[]}
  const meshes = new THREE.Group();
  scene.add(meshes);

  // ---------- palette / materials ----------
  const floorTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#23262e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${20 + rng() * 30 | 0},${22 + rng() * 30 | 0},${28 + rng() * 34 | 0},0.5)`;
      g.fillRect(rng() * w, rng() * h, 2 + rng() * 4, 2 + rng() * 4);
    }
    g.strokeStyle = '#31363f'; g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
    }
  });
  floorTex.repeat.set(10, 8);
  const metalTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2b2f38'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a404c'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.fillRect(rng() * w, rng() * h, 20 + rng() * 40, 3);
    }
  });
  metalTex.repeat.set(6, 2);
  const hazardTex = canvasTex(128, 32, (g, w, h) => {
    g.fillStyle = '#c8a018'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#15161c';
    for (let x = -h; x < w; x += 32) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, h); g.fill();
    }
  });
  const screenTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#0a0202'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff2a1a';
    for (let y = 10; y < h - 8; y += 12) g.fillRect(10 + rng() * 20, y, 60 + rng() * 150, 3);
    g.fillStyle = '#ff6a55'; g.fillRect(10, 8, 90, 4);
  });
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0.08 }),
    wall: new THREE.MeshStandardMaterial({ map: metalTex, roughness: 0.75, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x14161d, roughness: 0.9, metalness: 0.2 }),
    dome: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.6, metalness: 0.55, side: THREE.BackSide }),
    domeOut: new THREE.MeshStandardMaterial({ color: 0x232833, roughness: 0.7, metalness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5a6474, roughness: 0.45, metalness: 0.8 }),
    brass: new THREE.MeshStandardMaterial({ color: 0x8a6f3a, roughness: 0.4, metalness: 0.9 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x4a3d28, roughness: 0.95, metalness: 0.05 }),
    console: new THREE.MeshStandardMaterial({ color: 0x1c2027, roughness: 0.6, metalness: 0.5 }),
    screen: new THREE.MeshStandardMaterial({ map: screenTex, emissive: 0xff2a1a, emissiveMap: screenTex, emissiveIntensity: 0.9, roughness: 0.4 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0a1420, roughness: 0.15, metalness: 0.9, transparent: true, opacity: 0.55 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.8 }),
    redGlow: new THREE.MeshStandardMaterial({ color: 0x330a08, emissive: 0xff1a08, emissiveIntensity: 1.6 }),
    lampOn: new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffd88a, emissiveIntensity: 2.2 }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 1, metalness: 0 }),
  };

  function box(x, y, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    meshes.add(m);
    if (collide) colliders.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, y0: y - h / 2, y1: y + h / 2 });
    return m;
  }
  function cyl(x, y, z, rTop, rBot, h, mat, seg = 18, collide = true) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
    m.position.set(x, y, z);
    meshes.add(m);
    if (collide) colliders.push({ x0: x - rBot, x1: x + rBot, z0: z - rBot, z1: z + rBot, y0: y - h / 2, y1: y + h / 2 });
    return m;
  }

  // ---------- sky: stars, moon, fog ----------
  scene.fog = new THREE.FogExp2(0x04060c, 0.016);
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(1600 * 3);
  for (let i = 0; i < 1600; i++) {
    const a = rng() * Math.PI * 2, e = rng() * Math.PI * 0.48 + 0.05;
    const r = 190;
    starPos[i * 3] = Math.cos(a) * Math.cos(e) * r;
    starPos[i * 3 + 1] = Math.sin(e) * r;
    starPos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe0ff, size: 0.9, sizeAttenuation: false, fog: false })));
  const moon = new THREE.DirectionalLight(0x8fa8d8, 0.85);
  moon.position.set(-40, 60, -30);
  scene.add(moon);
  scene.add(new THREE.AmbientLight(0x24344f, 0.95));
  // Soft moonlight pool over the dome floor so the arena reads at a glance.
  const domeFill = new THREE.PointLight(0x9db8e8, 26, 34, 1.6);
  domeFill.position.set(14, 9, -10);
  scene.add(domeFill);
  // Distant mountain silhouettes around the terrace
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3;
    const m = new THREE.Mesh(new THREE.ConeGeometry(28 + rng() * 22, 30 + rng() * 26, 5), M.rock);
    m.position.set(Math.cos(a) * 120, 4, Math.sin(a) * 120);
    meshes.add(m);
  }

  // ---------- floors ----------
  function floor(x, z, w, d, mat = M.floor) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, d), mat);
    m.position.set(x, -0.15, z);
    meshes.add(m);
  }
  floor(0, 0, 64, 48);            // main slab
  floor(14, -10, 30, 30, M.floor); // dome floor pad (slightly proud, same level)
  floor(0, 20, 24, 8);            // terrace

  // ---------- outer walls (with door gaps) ----------
  // North wall (z=-24): solid except B north window slits (decorative, no gap)
  box(0, 2, -24, 64, 4, 0.6, M.wall);
  // South wall (z=+24): terrace railing instead of a wall — low rail, see the drop
  box(-11, 0.55, 23.8, 42, 1.1, 0.4, M.steel); // rail north of terrace edge
  box(0, 2, 24, 64, 4, 0.6, M.wall); // keep the far south closed behind the terrace
  // West wall (x=-32)
  box(-32, 2, 0, 0.6, 4, 48, M.wall);
  // East wall (x=+32)
  box(32, 2, 0, 0.6, 4, 48, M.wall);

  // ---------- B site: Control Room (west, x -26..-12, z -18..-4) ----------
  box(-12, 2, -11, 0.6, 4, 14, M.wall);          // B east wall, door gap z -2..2 left open below
  box(-12, 2, -0.5, 0.6, 4, 3, M.wall);          // door frame north of gap
  box(-12, 2, -21.5, 0.6, 4, 3, M.wall);         // door frame south of gap
  box(-19, 2, -18, 14, 4, 0.6, M.wall);          // B north wall
  box(-19, 2, -4, 14, 4, 0.6, M.wall);           // B south wall
  // Console rows (cover + red glow)
  for (let r = 0; r < 3; r++) {
    const z = -15 + r * 4.5;
    box(-21, 0.7, z, 6, 1.4, 1.1, M.console);
    const scr = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.9, 0.15), M.screen);
    scr.position.set(-21, 1.55, z - 0.45); scr.rotation.x = -0.25;
    meshes.add(scr);
  }
  // Big wall screen on B north wall
  const bigScr = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 0.2), M.screen);
  bigScr.position.set(-19, 2.2, -17.6);
  meshes.add(bigScr);
  // Server racks along B west wall
  for (let i = 0; i < 4; i++) box(-30.5, 1.5, -16 + i * 3.4, 1.2, 3, 2.6, M.dark);
  // Red instrument lights in B
  const red1 = new THREE.PointLight(0xff2211, 14, 16, 2); red1.position.set(-19, 3.2, -11); scene.add(red1);
  const red2 = new THREE.PointLight(0xff2211, 9, 12, 2); red2.position.set(-28, 3.0, -8); scene.add(red2);
  // Hazard stripe around B site
  const hz = new THREE.Mesh(new THREE.BoxGeometry(12, 0.06, 0.5), M.hazard);
  hz.position.set(-19, 0.02, -4.2); meshes.add(hz);

  // ---------- A site: the Dome (center 14,-10, radius ~13) ----------
  const dome = new THREE.Mesh(new THREE.SphereGeometry(13.5, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.52), M.dome);
  dome.position.set(14, 0, -10);
  meshes.add(dome);
  // Dome base ring wall (low, so the dome reads as a room)
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(13.5, 13.5, 2.2, 40, 1, true), M.domeOut);
  ring.position.set(14, 1.1, -10); ring.material.side = THREE.DoubleSide;
  meshes.add(ring);
  // Dome wall collision: 16 AABB segments around the circle, with a gap at the
  // south door (angle PI/2, where the ground entrance is).
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue; // south door gap
    const wx = 14 + Math.cos(a) * 13.2, wz = -10 + Math.sin(a) * 13.2;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(5.6, 4, 0.6), M.domeOut);
    seg.position.set(wx, 2, wz); seg.rotation.y = -a + Math.PI / 2;
    meshes.add(seg);
    // Axis-aligned bound of the rotated segment: tangent (-sin a, cos a) half 2.8,
    // radial (cos a, sin a) half 0.3.
    const hx = 2.8 * Math.abs(Math.sin(a)) + 0.3 * Math.abs(Math.cos(a));
    const hz = 2.8 * Math.abs(Math.cos(a)) + 0.3 * Math.abs(Math.sin(a));
    colliders.push({ x0: wx - hx, x1: wx + hx, z0: wz - hz, z1: wz + hz, y0: 0, y1: 4 });
  }
  // Dome slit: a bright gap across the top + the starlight shaft
  const slit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 22), new THREE.MeshStandardMaterial({ color: 0x0a1020, emissive: 0xbfd8ff, emissiveIntensity: 1.4 }));
  slit.position.set(14, 12.6, -10); slit.rotation.z = 0.35;
  meshes.add(slit);
  const shaft = new THREE.SpotLight(0xaac8ff, 90, 30, 0.42, 0.55, 1.4);
  shaft.position.set(14, 12.4, -10);
  shaft.target.position.set(14, 0, -10);
  scene.add(shaft); scene.add(shaft.target);
  // Telescope: pier + tube aimed at the slit
  cyl(14, 1.1, -10, 1.7, 2.1, 2.2, M.steel);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 7.5, 16), M.brass);
  tube.position.set(14, 5.2, -10); tube.rotation.z = 0.5; tube.rotation.x = 0.12;
  meshes.add(tube);
  colliders.push({ x0: 12.4, x1: 15.6, z0: -11.6, z1: -8.4, y0: 0, y1: 8 });
  // Catwalk ring inside the dome at y=3.2 (8 arc segments).
  const walkY = 3.2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const wx = 14 + Math.cos(a) * 11.6, wz = -10 + Math.sin(a) * 11.6;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.25, 1.8), M.steel);
    seg.position.set(wx, walkY, wz); seg.rotation.y = -a + Math.PI / 2;
    meshes.add(seg);
    // railing posts
    for (let p = -1; p <= 1; p++) {
      const px = wx + Math.cos(a + Math.PI / 2) * p * 4;
      const pz = wz + Math.sin(a + Math.PI / 2) * p * 4;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), M.steel);
      post.position.set(px, walkY + 0.6, pz); meshes.add(post);
    }
  }
  // Ramp up to the catwalk from the dome floor (x 25.5, z -2 -> -10, rising 0 -> 3.2).
  // Visual steps; the walkable height comes from groundAt's ramp zone.
  for (let s = 0; s < 8; s++) {
    box(25.5, 0.2 + s * 0.4, -2 - s, 2.2, 0.4, 1.1, M.steel, false);
  }
  // Catwalk floor colliders: treat the ring as walkable — bots use waypoints, players use a
  // simple rule: y snaps to walkY when over a walk segment (handled in player.js via walkZones)
  // Bridge from dome ring west to B upper (y 3.2, x 2..-12, z -8)
  box(-5, walkY, -8, 15, 0.25, 1.8, M.steel, false);
  box(-5, walkY + 0.6, -8.95, 15, 1.1, 0.1, M.steel, false); // bridge rail north
  // ---------- mid hall + corridors ----------
  // Hall pillars
  box(-6, 1.6, 10, 1.2, 3.2, 1.2, M.wall);
  box(6, 1.6, 10, 1.2, 3.2, 1.2, M.wall);
  // West corridor walls (x -14..-8, z -6..14): corridor is open between hall and B door
  box(-14, 2, 4, 0.6, 4, 20, M.wall);
  box(-8, 2, -2, 0.6, 4, 8, M.wall);   // corridor east wall, gap z -6..2
  // East corridor walls (x 8..14)
  box(8, 2, 4, 0.6, 4, 20, M.wall);
  box(14, 2, 8, 0.6, 4, 12, M.wall);   // east wall of corridor, gap z -4..2 to dome
  // Service tunnel (low, x 10..14, z -2..10): a flank under the east side
  box(10, 1.3, 4, 0.6, 2.6, 12, M.dark);
  box(14, 1.3, 4, 0.6, 2.6, 12, M.dark);
  box(12, 2.6, 10, 4.6, 0.4, 0.6, M.dark); // tunnel roof south end (open gap north)
  // Crates as cover: A site, mid, terrace
  const crate = (x, z, s, ry = 0) => {
    const m = box(x, s / 2, z, s, s, s, M.crate);
    m.rotation.y = ry; return m;
  };
  crate(6, -16, 1.6); crate(8.5, -15, 1.2, 0.4); crate(20, -4, 1.6); crate(22, -16, 1.2, 0.7);
  crate(-4, 12, 1.6); crate(4, 14, 1.2, 0.3); crate(-8, 18, 1.4); crate(8, 19, 1.2, 0.5);
  crate(-16, 2, 1.5); crate(18, 2, 1.5, 0.6);
  // Pipes along the hall ceiling
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 20, 8), M.steel);
    p.rotation.x = Math.PI / 2; p.position.set(-3 + i * 3, 3.6, 8);
    meshes.add(p);
  }

  // ---------- lamps (shootable lights) ----------
  function lamp(x, y, z) {
    const fixture = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.3), M.dark);
    fixture.position.set(x, y, z); meshes.add(fixture);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), M.lampOn);
    bulb.position.set(x, y - 0.14, z); meshes.add(bulb);
    const light = new THREE.PointLight(0xffc98a, 14, 13, 2);
    light.position.set(x, y - 0.4, z);
    scene.add(light);
    const L = { pos: new THREE.Vector3(x, y - 0.14, z), light, bulb, alive: true };
    lamps.push(L);
    return L;
  }
  lamp(0, 3.4, 12); lamp(-6, 3.4, 4); lamp(6, 3.4, 4);
  lamp(-11, 3.2, -2); lamp(-11, 3.2, 8);
  lamp(11, 3.2, -2); lamp(11, 3.2, 8);
  lamp(-19, 3.2, -11); lamp(-25, 3.2, -11);
  lamp(14, 3.4, -2);

  // ---------- telescope tracking beam (sweeps the dome floor) ----------
  const beamLight = new THREE.SpotLight(0xbfd8ff, 60, 26, 0.16, 0.5, 1.2);
  beamLight.position.set(14, 11.5, -10);
  beamLight.target.position.set(14, 0, -10);
  scene.add(beamLight); scene.add(beamLight.target);
  const beamCone = new THREE.Mesh(
    new THREE.ConeGeometry(2.2, 11.5, 20, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  beamCone.position.set(14, 5.8, -10);
  scene.add(beamCone);

  // ---------- waypoints (ground y=0, catwalk y=3.2) ----------
  function wp(x, y, z) { waypoints.push({ x, y, z, links: [] }); return waypoints.length - 1; }
  const W = {};
  const defs = [
    ['tSpawn', 0, 0, 20], ['tGate', 0, 0, 14], ['hallC', 0, 0, 8], ['hallW', 0, -4, 8], ['hallE', 0, 4, 8],
    ['wCorr1', 0, -11, 8], ['wCorr2', 0, -11, 0], ['bDoor', 0, -11, -2], ['bMid', 0, -19, -11], ['bN', 0, -22, -15], ['bS', 0, -22, -6],
    ['eCorr1', 0, 11, 8], ['eCorr2', 0, 11, 0], ['tunS', 0, 12, 8], ['tunN', 0, 12, -2],
    ['aSouth', 0, 14, -2], ['aMid', 0, 14, -10], ['aTel', 0, 11, -12], ['aE', 0, 22, -10], ['aN', 0, 14, -18], ['aW', 0, 6, -10],
    ['stairs', 0, 25.5, -2], ['ramp1', 1.0, 25.5, -4], ['ramp2', 2.0, 25.5, -6.5], ['ramp3', 3.0, 25.5, -8.5],
    ['walkE', 3.2, 25.5, -10], ['walkN', 3.2, 14, -21], ['walkW', 3.2, 2.5, -10],
    ['bridge', 3.2, -5, -8], ['bUp', 3.2, -12, -8], ['aUp', 3.2, 14, -2],
  ];
  for (const [k, x, y, z] of defs) W[k] = wp(x, y, z);
  const link = (a, b) => { waypoints[W[a]].links.push(W[b]); waypoints[W[b]].links.push(W[a]); };
  link('tSpawn', 'tGate'); link('tGate', 'hallC'); link('hallC', 'hallW'); link('hallC', 'hallE');
  link('hallW', 'wCorr1'); link('wCorr1', 'wCorr2'); link('wCorr2', 'bDoor'); link('bDoor', 'bMid');
  link('bMid', 'bN'); link('bMid', 'bS');
  link('hallE', 'eCorr1'); link('eCorr1', 'eCorr2'); link('eCorr2', 'aSouth'); link('eCorr2', 'tunS');
  link('tunS', 'tunN'); link('tunN', 'aSouth');
  link('aSouth', 'aMid'); link('aMid', 'aTel'); link('aMid', 'aE'); link('aMid', 'aN'); link('aMid', 'aW');
  link('aW', 'walkW'); link('aE', 'walkE'); link('aN', 'walkN');
  link('eCorr2', 'stairs'); link('stairs', 'ramp1'); link('ramp1', 'ramp2'); link('ramp2', 'ramp3'); link('ramp3', 'walkE'); link('walkE', 'walkN'); link('walkN', 'walkW');
  link('walkW', 'bridge'); link('bridge', 'bUp'); link('bUp', 'bMid');
  link('aSouth', 'aUp'); link('aUp', 'walkE');

  // ---------- spatial queries ----------
  const _v = new THREE.Vector3();
  function collideCircle(p, r, height) {
    // Push a vertical capsule (x/z circle + y range) out of wall AABBs. Returns true if pushed.
    let hit = false;
    for (const c of colliders) {
      if (p.y + height <= c.y0 || p.y >= c.y1) continue;
      const nx = Math.max(c.x0, Math.min(p.x, c.x1));
      const nz = Math.max(c.z0, Math.min(p.z, c.z1));
      const dx = p.x - nx, dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (r - d) / d;
        p.x += dx * push; p.z += dz * push;
      } else {
        // centre inside the box: push out along the smallest penetration axis
        const pl = p.x - c.x0, pr = c.x1 - p.x, pt = p.z - c.z0, pb = c.z1 - p.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) p.x = c.x0 - r; else if (m === pr) p.x = c.x1 + r;
        else if (m === pt) p.z = c.z0 - r; else p.z = c.z1 + r;
      }
    }
    // Dome wall is AABB segments now (see above) — no radial clamp needed.
    // World bounds
    p.x = Math.max(-31.4, Math.min(31.4, p.x));
    p.z = Math.max(-23.4, Math.min(23.4, p.z));
    return hit;
  }
  function segmentBlocked(a, b) {
    // Segment vs AABB (slab test), plus the dome wall circle.
    for (const c of colliders) {
      let t0 = 0, t1 = 1;
      const axes = [
        [a.x, b.x - a.x, c.x0, c.x1],
        [a.y, b.y - a.y, c.y0, c.y1],
        [a.z, b.z - a.z, c.z0, c.z1],
      ];
      let blocked = true;
      for (const [o, d, mn, mx] of axes) {
        if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { blocked = false; break; } continue; }
        let ta = (mn - o) / d, tb = (mx - o) / d;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) { blocked = false; break; }
      }
      if (blocked) return true;
    }
    return false;
  }
  function nearestWaypoint(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const w = waypoints[i];
      const d = (w.x - p.x) ** 2 + (w.z - p.z) ** 2 + (w.y - p.y) ** 2 * 4;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  function bfsPath(from, to) {
    if (from === to) return [from];
    const prev = new Int16Array(waypoints.length).fill(-1);
    const q = [from]; prev[from] = from;
    while (q.length) {
      const cur = q.shift();
      for (const n of waypoints[cur].links) {
        if (prev[n] !== -1) continue;
        prev[n] = cur;
        if (n === to) {
          const path = [to]; let c = to;
          while (c !== from) { c = prev[c]; path.push(c); }
          return path.reverse();
        }
        q.push(n);
      }
    }
    return [from];
  }
  // Floor height at (x,z) for a body whose feet are at y: the highest floor no
  // more than 0.45 above the feet (a step-up), so walking under the catwalk does
  // not teleport the body onto it, and walking off an edge makes it fall.
  function groundAt(x, z, y = 0) {
    const floors = [0];
    const dx = x - 14, dz = z + 10;
    const dist = Math.hypot(dx, dz);
    if (dist > 10.2 && dist < 13.0) floors.push(3.2); // dome catwalk ring
    if (x >= -12.5 && x <= 2.5 && z >= -9 && z <= -7) floors.push(3.2); // bridge
    if (x >= 24.4 && x <= 26.6 && z >= -10 && z <= -2) floors.push(((-2 - z) / 8) * 3.2); // ramp
    let best = 0;
    for (const f of floors) if (f <= y + 0.45 && f > best) best = f;
    return best;
  }

  let beamAngle = 0;
  function update(dt, t) {
    // Telescope beam sweeps slowly around the dome.
    beamAngle = t * 0.12;
    const bx = 14 + Math.cos(beamAngle) * 7.5;
    const bz = -10 + Math.sin(beamAngle) * 7.5;
    beamLight.target.position.set(bx, 0, bz);
    beamCone.position.set((14 + bx) / 2, 5.8, (-10 + bz) / 2);
    beamCone.lookAt(bx, 0, bz);
    beamCone.rotateX(Math.PI / 2);
    // Starlight shaft shimmer
    shaft.intensity = 85 + Math.sin(t * 0.7) * 8;
  }
  function beamSpot() {
    return { x: 14 + Math.cos(beamAngle) * 7.5, z: -10 + Math.sin(beamAngle) * 7.5 };
  }
  function inBeam(x, z) {
    const s = beamSpot();
    return Math.hypot(x - s.x, z - s.z) < 2.4;
  }

  return {
    colliders, lamps, waypoints, SITES, SPAWNS,
    collideCircle, segmentBlocked, nearestWaypoint, bfsPath, groundAt,
    update, beamSpot, inBeam,
  };
}
