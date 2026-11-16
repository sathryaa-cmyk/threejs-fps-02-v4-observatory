// player.js — the first-person body: movement, camera, health.
// One job: turn input into a moving, colliding viewpoint with health and armor.
// No shooting here (weapons.js) and no decisions (bots.js).
import * as THREE from 'three';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const RADIUS = 0.36;

export function makeBody(x, y, z, yaw) {
  return {
    pos: new THREE.Vector3(x, y, z), // feet position
    vel: new THREE.Vector3(),
    yaw, pitch: 0,
    onGround: true,
    crouched: false,
    moving: false,
    hp: 100,
    armor: 0,
    alive: true,
    eyeHeight: EYE_STAND,
    bobPhase: 0,
    scoped: false,
  };
}

// Move a body for one fixed step. `input` is {f,b,l,r,jump,crouch,walk} in [-1..1]/bool.
// Returns the horizontal speed (for spread + bob).
export function stepBody(body, input, dt, world) {
  const accel = body.onGround ? 34 : 10;
  const maxSpeed = body.crouched ? 2.1 : input.walk ? 2.9 : 5.4;
  const sin = Math.sin(body.yaw), cos = Math.cos(body.yaw);
  // Wish direction in world space (yaw=0 faces -z).
  let wx = 0, wz = 0;
  const f = input.f - input.b, s = input.r - input.l;
  wx = -sin * f + cos * s;
  wz = -cos * f - sin * s;
  const wl = Math.hypot(wx, wz);
  if (wl > 0.001) { wx /= wl; wz /= wl; }
  const prevVx = body.vel.x, prevVz = body.vel.z;
  body.vel.x += wx * accel * dt;
  body.vel.z += wz * accel * dt;
  // Friction when no input, and clamp to max speed.
  if (wl < 0.001 && body.onGround) {
    const fr = Math.max(0, 1 - 11 * dt);
    body.vel.x *= fr; body.vel.z *= fr;
  }
  const sp = Math.hypot(body.vel.x, body.vel.z);
  if (sp > maxSpeed) {
    body.vel.x *= maxSpeed / sp;
    body.vel.z *= maxSpeed / sp;
  }
  if (input.jump && body.onGround) {
    body.vel.y = 5.2;
    body.onGround = false;
  }
  body.vel.y -= 16 * dt;
  // Integrate, axis separated so walls slide instead of sticking.
  const p = body.pos;
  p.x += body.vel.x * dt;
  world.collideCircle(p, RADIUS, 1.7);
  p.z += body.vel.z * dt;
  world.collideCircle(p, RADIUS, 1.7);
  p.y += body.vel.y * dt;
  // Ground: floor height under the feet (catwalk ring / bridge / ramp / floor).
  const floor = world.groundAt(p.x, p.z, p.y);
  // Step up onto the catwalk when walking into a stair: the stairs rise 0.4 a step;
  // allow a step-up of 0.45 when the target floor is just above the feet.
  const targetFloor = floor;
  if (p.y <= targetFloor + 0.45 && body.vel.y <= 0.1) {
    p.y = targetFloor;
    body.vel.y = 0;
    body.onGround = true;
  } else if (p.y < targetFloor) {
    p.y = targetFloor;
    body.vel.y = 0;
    body.onGround = true;
  } else if (p.y > targetFloor + 0.05) {
    body.onGround = false;
  }
  // Crouch changes the eye height smoothly.
  const wantEye = body.crouched ? EYE_CROUCH : EYE_STAND;
  body.eyeHeight += (wantEye - body.eyeHeight) * Math.min(1, dt * 12);
  const speed = Math.hypot(body.vel.x, body.vel.z);
  body.moving = speed > 0.6;
  if (body.moving && body.onGround) body.bobPhase += dt * speed * 1.6;
  // Keep the body out of walls after the y move too.
  world.collideCircle(p, RADIUS, 1.7);
  return speed;
}

// Camera transform for a body: eye position + look direction.
export function eyePos(body, out) {
  out.set(body.pos.x, body.pos.y + body.eyeHeight, body.pos.z);
  return out;
}

export function lookDir(body, out) {
  const cp = Math.cos(body.pitch), sp = Math.sin(body.pitch);
  const cy = Math.cos(body.yaw), sy = Math.sin(body.yaw);
  out.set(-sy * cp, sp, -cy * cp);
  return out;
}

// Damage with armor: armor absorbs 50% until it breaks.
export function applyDamage(body, dmg) {
  if (!body.alive) return 0;
  let remaining = dmg;
  if (body.armor > 0) {
    const absorbed = Math.min(body.armor, remaining * 0.5);
    body.armor -= absorbed;
    remaining -= absorbed;
  }
  body.hp -= remaining;
  if (body.hp <= 0) { body.hp = 0; body.alive = false; }
  return remaining;
}

export function healFull(body) {
  body.hp = 100;
  body.alive = true;
  body.vel.set(0, 0, 0);
}
