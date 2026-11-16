// effects.js — transient visuals: tracers, muzzle flash, impacts, smoke, sparks.
// One job: make shots feel physical. All objects are pooled — nothing is allocated
// in the hot loop except on spawn, and pools are capped.
import * as THREE from 'three';

export function makeEffects(scene) {
  const tracerGeo = new THREE.BoxGeometry(0.03, 0.03, 1);
  const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 });
  const tracers = [];
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(tracerGeo, tracerMat.clone());
    m.visible = false;
    scene.add(m);
    tracers.push({ mesh: m, t: 0 });
  }
  let tracerI = 0;

  const sparkGeo = new THREE.BufferGeometry();
  const sparkPos = new Float32Array(240 * 3);
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffc860, size: 0.09, transparent: true, opacity: 0.95 }));
  scene.add(sparks);
  const sparkVel = new Float32Array(240 * 3);
  let sparkN = 0, sparkT = 0;

  // Smoke as camera-facing sprites with a soft radial falloff, so a puff reads
  // as a cloud from every angle (a bare low-poly sphere silhouettes as a
  // hard-edged square at this scale).
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = puffCanvas.height = 128;
  const pc = puffCanvas.getContext('2d');
  const grad = pc.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  pc.fillStyle = grad; pc.fillRect(0, 0, 128, 128);
  const puffTex = new THREE.CanvasTexture(puffCanvas);
  const smokePuffs = [];
  for (let i = 0; i < 14; i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0x9aa2b0, transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    smokePuffs.push({ mesh: m, t: 0, life: 0, x: 0, y: 0, z: 0, s: 1 });
  }

  const flashLight = new THREE.PointLight(0xfff2c0, 0, 9, 2);
  scene.add(flashLight);

  const E = {
    tracer(from, to, color = 0xffe9a8) {
      const tr = tracers[tracerI++ % tracers.length];
      const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
      const dir = new THREE.Vector3().subVectors(to, from);
      const len = dir.length();
      tr.mesh.position.copy(mid);
      tr.mesh.lookAt(to);
      tr.mesh.scale.set(1, 1, len);
      tr.mesh.material.color.setHex(color);
      tr.mesh.material.opacity = 0.9;
      tr.mesh.visible = true;
      tr.t = 0.09;
    },
    muzzle(pos, dir) {
      flashLight.position.copy(pos).addScaledVector(dir, 0.7);
      flashLight.intensity = 26;
      const p = new THREE.Vector3().copy(pos).addScaledVector(dir, 0.55);
      E.sparks(p, 6, 0xffd88a);
    },
    sparks(pos, n, color = 0xffc860) {
      sparks.material.color.setHex(color);
      for (let k = 0; k < n; k++) {
        const i = (sparkN + k) % 240;
        sparkPos[i * 3] = pos.x; sparkPos[i * 3 + 1] = pos.y; sparkPos[i * 3 + 2] = pos.z;
        sparkVel[i * 3] = (Math.random() - 0.5) * 5;
        sparkVel[i * 3 + 1] = Math.random() * 3.5;
        sparkVel[i * 3 + 2] = (Math.random() - 0.5) * 5;
      }
      sparkN = (sparkN + n) % 240;
      sparkT = 0.4;
    },
    impact(pos, normal) {
      E.sparks(pos, 8, 0xc8c8d8);
      // A small dust puff.
      const p = smokePuffs.find(s => s.life <= 0);
      if (p) {
        p.mesh.visible = true;
        p.mesh.position.copy(pos);
        p.mesh.scale.setScalar(0.3);
        p.mesh.material.opacity = 0.35;
        p.t = 0; p.life = 0.5; p.s = 0.3;
      }
    },
    smokeCloud(x, y, z) {
      let placed = 0;
      for (const p of smokePuffs) {
        if (placed >= 7) break;
        if (p.life > 0) continue;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 2.2;
        p.mesh.visible = true;
        p.mesh.position.set(x + Math.cos(a) * r, y + 0.4 + Math.random() * 0.9, z + Math.sin(a) * r);
        p.mesh.scale.setScalar(1.4 + Math.random());
        p.mesh.material.opacity = 0.5;
        p.t = 0; p.life = 14; p.s = 1.4 + Math.random();
        placed++;
      }
    },
    tick(dt) {
      for (const tr of tracers) {
        if (!tr.mesh.visible) continue;
        tr.t -= dt;
        tr.mesh.material.opacity = Math.max(0, tr.t / 0.09) * 0.9;
        if (tr.t <= 0) tr.mesh.visible = false;
      }
      flashLight.intensity = Math.max(0, flashLight.intensity - dt * 320);
      if (sparkT > 0) {
        sparkT -= dt;
        for (let i = 0; i < 240; i++) {
          sparkPos[i * 3] += sparkVel[i * 3] * dt;
          sparkPos[i * 3 + 1] += sparkVel[i * 3 + 1] * dt;
          sparkPos[i * 3 + 2] += sparkVel[i * 3 + 2] * dt;
          sparkVel[i * 3 + 1] -= 9 * dt;
        }
        sparkGeo.attributes.position.needsUpdate = true;
        sparks.material.opacity = Math.max(0, sparkT / 0.4) * 0.95;
      } else {
        sparks.material.opacity = 0;
      }
      for (const p of smokePuffs) {
        if (p.life <= 0) continue;
        p.t += dt;
        p.life -= dt;
        const grow = 1 + p.t * 0.12;
        p.mesh.scale.setScalar(p.s * grow);
        p.mesh.material.opacity = Math.min(0.5, p.life > 2 ? 0.5 : p.life * 0.25);
        if (p.life <= 0) { p.mesh.visible = false; p.mesh.material.opacity = 0; }
      }
    },
  };
  return E;
}
