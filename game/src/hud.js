// hud.js — the DOM overlay: health, ammo, timer, score, feed, buy menu, banners.
// One job: mirror the sim state onto the page. It never simulates anything.
import { WEAPONS, BUY_LIST } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function makeHud() {
  const el = {
    hud: $('hud'), crosshair: $('crosshair'),
    chT: $('chT'), chB: $('chB'), chL: $('chL'), chR: $('chR'),
    hitmarker: $('hitmarker'), dmgdir: $('dmgdir'), dmgvig: $('dmgvig'), flash: $('flash'),
    score: document.querySelector('#topleft .score'),
    roundlabel: $('roundlabel'), clock: document.querySelector('#timer .clock'),
    phase: document.querySelector('#timer .phase'), bombfill: $('bombfill'),
    feed: $('feed'), roster: $('roster'),
    health: $('health'), armor: $('armor'), healthfill: $('healthfill'), money: $('money'),
    ammo: $('ammo'), weaponname: $('weaponname'), hint: $('hint'),
    banner: $('banner'), plantbar: $('plantbar'), plantfill: $('plantfill'),
    spec: $('spec'), buy: $('buy'), buyrows: $('buyrows'),
  };
  let feedItems = [];
  const H = {
    show() { el.hud.classList.remove('hidden'); },
    hide() { el.hud.classList.add('hidden'); },
    setCrosshair(spreadPx, scoped) {
      const g = Math.max(4, spreadPx);
      const t = 9, w = 2;
      el.chT.style.cssText = `left:-1px;top:${-g - t}px;width:${w}px;height:${t}px`;
      el.chB.style.cssText = `left:-1px;top:${g}px;width:${w}px;height:${t}px`;
      el.chL.style.cssText = `top:-1px;left:${-g - t}px;height:${w}px;width:${t}px`;
      el.chR.style.cssText = `top:-1px;left:${g}px;height:${w}px;width:${t}px`;
      el.crosshair.style.opacity = scoped ? 0.35 : 1;
    },
    hitmark(head) {
      el.hitmarker.style.opacity = 1;
      el.hitmarker.style.color = head ? '#ffb02e' : '#fff';
      setTimeout(() => { el.hitmarker.style.opacity = 0; }, 120);
    },
    damageFrom(angleDeg) {
      el.dmgdir.style.opacity = 1;
      el.dmgdir.style.transform = `rotate(${angleDeg}deg)`;
      el.dmgvig.style.opacity = 1;
      setTimeout(() => { el.dmgdir.style.opacity = 0; el.dmgvig.style.opacity = 0; }, 350);
    },
    flashBlind(strength) {
      el.flash.style.opacity = Math.min(1, strength);
      setTimeout(() => { el.flash.style.opacity = 0; }, 120);
      // Fade out slowly for a real flash.
      const step = () => {
        const o = parseFloat(el.flash.style.opacity || 0);
        if (o > 0.02) { el.flash.style.opacity = o * 0.86; setTimeout(step, 50); }
        else el.flash.style.opacity = 0;
      };
      setTimeout(step, 150);
    },
    pushFeed(a, b, hs) {
      feedItems.unshift({ a, b, hs, t: Date.now() });
      feedItems = feedItems.slice(0, 5);
      el.feed.innerHTML = feedItems.map(f =>
        `<div>${f.a} ${f.hs ? '<span class="hs">[HEADSHOT]</span> ' : ''}▸ ${f.b}</div>`).join('');
    },
    update(G, player, now) {
      const ws = player.ws;
      const def = WEAPONS[ws.current];
      el.score.innerHTML = `<span class="atlas">ATLAS ${G.scoreA}</span> — <span class="sentry">${G.scoreB} SENTRY</span>`;
      el.roundlabel.textContent = `ROUND ${G.round} / 9 · FIRST TO 5`;
      const t = Math.max(0, Math.ceil(G.timer));
      el.clock.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      el.phase.textContent = G.phase.toUpperCase() + (G.bomb.planted ? ' · BOMB PLANTED' : '');
      el.bombfill.style.width = G.bomb.planted ? `${Math.max(0, (G.bomb.timer / 35) * 100)}%` : '0%';
      el.health.textContent = Math.ceil(player.body.hp);
      el.armor.textContent = `ARMOR ${Math.ceil(player.body.armor)}`;
      el.healthfill.style.width = `${Math.max(0, player.body.hp)}%`;
      el.healthfill.style.background = player.body.hp > 50 ? '#5fd35f' : player.body.hp > 25 ? '#ffb02e' : '#ff5340';
      el.money.textContent = `$${player.money}`;
      const ammo = ws.ammo[ws.current] | 0, res = ws.reserve[ws.current] | 0;
      el.ammo.innerHTML = ws.reloading > 0 ? 'RELOADING' : `${ammo} <span class="res">/ ${res}</span>`;
      el.weaponname.textContent = `${def.name}${ws.current === 'awp' && player.body.scoped ? ' · SCOPED' : ''}${player.hasBomb ? ' · ★ BOMB' : ''}`;
      // Roster: teammates first, then enemies.
      el.roster.innerHTML = G.agents.map(a => {
        const cls = `${!a.body.alive ? 'dead' : ''} ${a.isPlayer ? 'me' : ''}`;
        const tag = a.team === 'ATLAS' ? 'A' : 'S';
        return `<div class="${cls}">[${tag}] ${a.name}${a.hasBomb ? ' ★' : ''} — ${a.body.alive ? Math.ceil(a.body.hp) : 'DEAD'}</div>`;
      }).join('');
      // Plant/defuse bar.
      if (G.bomb.plantProgress > 0 && !G.bomb.planted) {
        el.plantbar.classList.remove('hidden');
        el.plantbar.querySelector('.label').textContent = 'PLANTING…';
        el.plantfill.style.width = `${G.bomb.plantProgress * 100}%`;
      } else if (G.bomb.planted && G.bomb.defuseProgress > 0) {
        el.plantbar.classList.remove('hidden');
        el.plantbar.querySelector('.label').textContent = 'DEFUSING…';
        el.plantfill.style.width = `${G.bomb.defuseProgress * 100}%`;
      } else {
        el.plantbar.classList.add('hidden');
      }
      // Spectate line.
      if (!player.body.alive && G.spectate) {
        el.spec.classList.remove('hidden');
        el.spec.textContent = `SPECTATING ${G.spectate.name} — click to cycle`;
      } else el.spec.classList.add('hidden');
    },
    hint(text) { el.hint.textContent = text || ''; },
    banner(big, sub, cls) {
      el.banner.classList.remove('hidden');
      el.banner.querySelector('.big').textContent = big;
      el.banner.querySelector('.big').className = `big ${cls || ''}`;
      el.banner.querySelector('.sub').textContent = sub || '';
      clearTimeout(H._bt);
      H._bt = setTimeout(() => el.banner.classList.add('hidden'), 3200);
    },
    hideBanner() { el.banner.classList.add('hidden'); },
    openBuy(player) {
      el.buy.classList.remove('hidden');
      H.renderBuy(player);
    },
    closeBuy() { el.buy.classList.add('hidden'); },
    buyOpen() { return !el.buy.classList.contains('hidden'); },
    renderBuy(player) {
      const ws = player.ws;
      el.buyrows.innerHTML = BUY_LIST.map((b, i) => {
        const owned = b.id === 'armor' ? player.body.armor >= 100
          : b.id === 'smoke' ? ws.smokes > 0 : b.id === 'flash' ? ws.flashes > 0 : !!ws.owned[b.id];
        const afford = player.money >= b.price;
        return `<div class="row" data-buy="${b.id}">
          <span>${i + 1}. ${b.label}</span>
          <span class="${owned ? 'owned' : ''}">${owned ? 'OWNED' : afford ? `<span class="price">$${b.price}</span>` : `<span style="color:#ff7a6a">$${b.price} — NO CASH</span>`}</span>
        </div>`;
      }).join('');
    },
  };
  return H;
}
