/* Magic Frogs prototype, core B (Frog Stand): the run simulation, new run model
   ("Changes after version 1", 2026-09-29 evening). One frog, no apprentices. Up to
   Meta.MAX_SPELLS held spells, each casting on its own timer at the nearest rat.
   Ingredients live in a pot and are dropped onto one spell's slot. Pure logic, no
   drawing and no DOM, so tools/balance-b.js can play whole runs in Node.
   Side view in metres: x runs 0 (left edge) to 12 (right edge, rats enter); y runs 0 to 4
   across the ground strip (depth). The frog holds the left side; rats walk in from the right.
   Reuses core A's rat table and RNG (Sim.RATS, Sim.mulberry32, Sim.SPLASH_R, Sim.TUNE). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./sim.js'), require('./meta.js'));
  else root.SimB = factory(root.Sim, root.Meta);
})(typeof window !== 'undefined' ? window : globalThis, function (Sim, Meta) {
  'use strict';

  const TUNE_B = {
    budgetSec: 10,      // wave HP budget = parDpsB(w) * budgetSec
    spit: 10,             // glob damage at wave 1, scaled by 1 + 0.08 * (w - 1)
    parGrowth: 1.19,   // per-wave growth of parDpsB
    parBase: 15,         // parDpsB(1)
    frogSpeed: 6,        // m/s the frog slides toward the target
    xMin: 0.8, xMax: 3.0, yMin: 0.3, yMax: 3.7,
    startX: 1.5, startY: 2.0,
    maxHp: 100,
    castRange: 7,
    healShare: 0.3,         // heals this share of max at the start of each wave
    contactR: 0.6,
    contactMul: 1.6,          // a rat that reaches the frog does its bite times this
    bossContactR: 0.6,
    globR: 0.45,
    globSpeed: 5,
    spawnWindow: 18,        // seconds over which a wave's rats spawn
    spitterShare: 0.4,      // share of runts that are spitters, from wave 3
    spitterXMin: 7, spitterXMax: 9,
    spitInterval: 2.2,
    bossSpitInterval: 3,
    bossMinionInterval: 2,
    bossMinions: 3,
    minionShare: 0.25,      // boss minions carry this share of par damage per second
    bossSpeed: 0.35,
    bossSec: 10,      // boss HP = parDpsB(w) * bossSec
    bossContactDps: 14,
    poisonSpreadShare: 0.8, // a poisoned rat passes on this share of its poison rate
    chainShare: 0.4,
    ratSpeed: { runt: 1.4, brute: 1.0, tank: 0.7 },
    bossNames: { 5: 'Rat King', 10: 'Sewer Queen', 15: 'Plague Lord' },
  };

  const parDpsB = w => TUNE_B.parBase * Math.pow(TUNE_B.parGrowth, w - 1);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
  function defaultMeta() {
    return { spellLevels: {}, gear: { hp: 0, power: 0, rate: 0, poison: 0, chain: 0, heal: 0 }, unlockedSpells: Meta.SPELL_TYPES.slice(), unlockedIngredients: Meta.INGREDIENT_TYPES.slice(), minTier: 1 };
  }

  // Build one wave's rat spawns from the chapter seed. Same seed, same wave, same content.
  function buildWaveB(seed, w) {
    const R = Sim.mulberry32(seed * 1000 + w * 7919);
    const budget = parDpsB(w) * TUNE_B.budgetSec;
    const pBrute = w >= 3 ? Math.min(0.5, 0.05 * w) : 0;
    const pTank = w >= 6 ? Math.min(0.25, 0.025 * (w - 5)) : 0;
    const hpMul = 0.7 * Math.pow(1.3, w - 1);
    const spawns = [];
    let left = budget, n = 0;
    while (left > 0 && n < 400) {
      const u = R();
      const kind = u < pTank ? 'tank' : u < pTank + pBrute ? 'brute' : 'runt';
      const hp = Sim.RATS[kind].hp * hpMul;
      const isSpitter = kind === 'runt' && w >= 3 && R() < TUNE_B.spitterShare;
      spawns.push({
        kind, hp, max: hp,
        y: R() * 4,
        t: R() * TUNE_B.spawnWindow,
        isSpitter,
        stopX: isSpitter ? TUNE_B.spitterXMin + R() * (TUNE_B.spitterXMax - TUNE_B.spitterXMin) : null,
      });
      left -= hp; n++;
    }
    spawns.sort((a, b) => a.t - b.t);
    const bossName = TUNE_B.bossNames[w];
    const boss = bossName ? { name: bossName, hp: parDpsB(w) * TUNE_B.bossSec, max: parDpsB(w) * TUNE_B.bossSec } : null;
    return { spawns, boss, hpMul };
  }

  function makeRat(p) {
    return {
      kind: p.kind, hp: p.hp, max: p.max, x: 12.5, y: p.y,
      bite: Sim.RATS[p.kind].bite, speed: TUNE_B.ratSpeed[p.kind], coin: Sim.RATS[p.kind].coin,
      isSpitter: p.isSpitter, stopX: p.stopX, stopped: false, spitTimer: TUNE_B.spitInterval,
      burn: 0, burnT: 0, pois: 0, poisT: 0, slow: 0, slowT: 0,
    };
  }

  function makeSpell(type, tier) {
    return { type, tier, ings: [null, null], timer: 0, cdMax: 1, c: null };
  }

  // What a spell actually does right now: its own tier and level, its two ingredients,
  // and the gear that applies to every spell.
  function compileSpell(meta, spell) {
    const def = Meta.SPELLS[spell.type];
    const tierMult = Meta.TIER_MULT[spell.tier] || 1;
    const level = (meta.spellLevels && meta.spellLevels[spell.type]) || 1;
    const gear = meta.gear || {};
    let ingPower = 0, ingRate = 0, ingHeal = 0, splashTier = 0;
    let burn = def.burn || 0, slow = def.slow || 0, poison = def.poison || 0, splash = def.splash || 0, chain = def.chain || 0;
    for (const ing of spell.ings) {
      if (!ing) continue;
      const idef = Meta.INGREDIENTS[ing.type];
      const v = idef.v[ing.tier];
      if (idef.stat === 'power') ingPower += v;
      else if (idef.stat === 'rate') ingRate += v;
      else if (idef.stat === 'heal') ingHeal += v;
      else if (idef.stat === 'burn') burn += v;
      else if (idef.stat === 'slow') slow += v;
      else if (idef.stat === 'poison') poison += v;
      else if (idef.stat === 'splash') { splash += v; splashTier = Math.max(splashTier, ing.tier); }
      else if (idef.stat === 'chain') chain += v;
    }
    poison += gear.poison || 0;
    chain += gear.chain || 0;
    const heal = ingHeal + (gear.heal || 0);
    const dmg = def.dmg * tierMult * (1 + Meta.levelBonus(level)) * (1 + (gear.power || 0)) * (1 + ingPower);
    const rate = def.rate * (1 + (gear.rate || 0)) * (1 + ingRate);
    let splashR = 0;
    if (splash > 0) splashR = Math.max(def.splashR || 0, splashTier ? Sim.SPLASH_R[splashTier] : 0);
    slow = Math.min(slow, 0.7);
    chain = Math.min(Math.round(chain), 8);
    return { dmg, rate, burn, slow, poison, splash, splashR, chain, heal };
  }

  function recalc(run) {
    for (const s of run.spells) {
      if (!s) continue;
      s.c = compileSpell(run.meta, s);
      s.cdMax = s.c.rate > 0 ? 1 / s.c.rate : 1;
      if (s.timer > s.cdMax) s.timer = s.cdMax;
    }
  }

  function createRun(opts) {
    opts = opts || {};
    const meta = opts.meta || defaultMeta();
    const run = {
      seed: opts.seed || 1, wave: 1, state: 'run', time: 0, waveTime: 0,
      frog: { x: TUNE_B.startX, y: TUNE_B.startY, hp: 0, maxHp: 0 },
      meta,
      spells: new Array(Meta.MAX_SPELLS).fill(null),
      pot: new Array(Meta.POT_SLOTS).fill(null),
      stats: null, rats: [], globs: [], boss: null, bossSpawned: false,
      coins: 0, splatted: 0, revives: 0, rerolls: 0, offers: null,
      events: [], pending: [], def: null, firing: false,
    };
    run.frog.maxHp = TUNE_B.maxHp + (meta.gear.hp || 0);
    run.frog.hp = run.frog.maxHp;
    run.spells[0] = makeSpell('missile', 1);
    recalc(run);
    enterWave(run, 1);
    return run;
  }

  function enterWave(run, w) {
    run.wave = w;
    run.def = buildWaveB(run.seed, w);
    run.pending = run.def.spawns.slice();
    run.rats = []; run.globs = [];
    run.boss = null; run.bossSpawned = false;
    run.waveTime = 0;
    run.state = 'run';
    run.frog.hp = Math.min(run.frog.maxHp, run.frog.hp + run.frog.maxHp * TUNE_B.healShare);
  }

  function tickStatus(run, t, dt) {
    if (t.slowT > 0) { t.slowT -= dt; if (t.slowT <= 0) t.slow = 0; }
    let d = 0;
    if (t.burnT > 0) { d += t.burn * dt; t.burnT -= dt; }
    if (t.poisT > 0) { d += t.pois * dt; t.poisT -= dt; }
    if (d > 0) hitDamage(run, t, Math.min(d, t.hp));
  }

  // Returns true when this hit was the one that dropped the target, so a heal-on-kill
  // ingredient or gear stat can be attributed to the spell that landed it.
  function hitDamage(run, t, amount) {
    t.hp -= amount;
    if (t.isBoss || t.hp > 0 || t.dead) return false;
    t.dead = true;
    run.splatted++;
    run.coins += t.coin;
    run.events.push({ t: 'pop', x: t.x, y: t.y, kind: t.kind, pois: t.poisT > 0 });
    if (t.poisT > 0) {
      for (const r of run.rats) {
        if (r.hp > 0 && r !== t && dist(r.x, r.y, t.x, t.y) <= Sim.TUNE.poisonSpread && r.poisT <= 0) {
          r.pois = t.pois * TUNE_B.poisonSpreadShare; r.poisT = Sim.TUNE.poisonSec;
        }
      }
    }
    return true;
  }

  function applySpellHit(run, c, t, dmg) {
    if (c.burn > 0) { t.burn = Math.max(t.burn, dmg * c.burn / Sim.TUNE.burnSec); t.burnT = Sim.TUNE.burnSec; }
    if (c.poison > 0) { t.pois = Math.max(t.pois, dmg * c.poison / Sim.TUNE.poisonSec); t.poisT = Sim.TUNE.poisonSec; }
    if (c.slow > 0) { t.slow = Math.max(t.slow, c.slow); t.slowT = Sim.TUNE.slowSec; }
    const killed = hitDamage(run, t, Math.min(dmg, t.hp));
    if (killed && c.heal > 0) run.frog.hp = Math.min(run.frog.maxHp, run.frog.hp + c.heal);
    if (t.isBoss) return;
    if (c.splash > 0) {
      for (const r of run.rats) if (r !== t && r.hp > 0 && dist(r.x, r.y, t.x, t.y) <= c.splashR) hitDamage(run, r, Math.min(dmg * c.splash, r.hp));
    }
    if (c.chain > 0) {
      const near = run.rats.filter(r => r !== t && r.hp > 0 && dist(r.x, r.y, t.x, t.y) <= Sim.TUNE.chainRange)
        .sort((p, q) => dist(p.x, p.y, t.x, t.y) - dist(q.x, q.y, t.x, t.y)).slice(0, c.chain);
      for (const r of near) hitDamage(run, r, Math.min(dmg * TUNE_B.chainShare, r.hp));
      if (near.length) run.chainFx = { from: t, to: near };
    }
  }

  // The nearest rat by x wins the cast; the boss is only picked once no rat is left in range,
  // so it never eclipses the minions it keeps summoning.
  function pickTarget(run, f) {
    let best = null, bestX = Infinity;
    for (const r of run.rats) if (r.hp > 0 && r.x - f.x <= TUNE_B.castRange && r.x < bestX) { bestX = r.x; best = r; }
    if (best) return best;
    if (run.boss && run.boss.hp > 0 && run.boss.x - f.x <= TUNE_B.castRange) return run.boss;
    return null;
  }

  function castSpells(run, dt) {
    const f = run.frog;
    let firing = false;
    for (const spell of run.spells) {
      if (!spell || !spell.c) continue;
      if (spell.timer > 0) { spell.timer -= dt; continue; }
      const t = pickTarget(run, f);
      if (!t) continue;
      firing = true;
      applySpellHit(run, spell.c, t, spell.c.dmg);
      spell.timer = spell.cdMax;
    }
    run.firing = firing;
  }

  function makeGlob(x, y, tx, ty) { return { x, y, tx, ty, dead: false }; }

  function waveEnd(run) {
    run.coins += Math.round(10 * run.wave + (run.def.boss ? 40 * run.wave : 0));
    if (run.wave >= 15) { run.state = 'won'; run.events.push({ t: 'won' }); return; }
    run.state = 'brew';
    run.rerolls = 0;
    run.offers = makeOffers(run);
    run.events.push({ t: 'brew' });
  }

  function step(run, dt, target) {
    if (run.state !== 'run' && run.state !== 'boss') return;
    run.time += dt; run.waveTime += dt;
    const f = run.frog;

    const tx = clamp(target.x, TUNE_B.xMin, TUNE_B.xMax), ty = clamp(target.y, TUNE_B.yMin, TUNE_B.yMax);
    const dx = tx - f.x, dy = ty - f.y, d0 = Math.hypot(dx, dy), stepLen = TUNE_B.frogSpeed * dt;
    if (d0 <= stepLen || d0 === 0) { f.x = tx; f.y = ty; } else { f.x += dx / d0 * stepLen; f.y += dy / d0 * stepLen; }

    while (run.pending.length && run.pending[0].t <= run.waveTime) run.rats.push(makeRat(run.pending.shift()));

    if (run.def.boss && !run.bossSpawned && run.waveTime >= TUNE_B.spawnWindow) {
      run.bossSpawned = true;
      run.boss = {
        name: run.def.boss.name, hp: run.def.boss.hp, max: run.def.boss.max,
        x: 12.5, y: 2.0, isBoss: true, spitTimer: TUNE_B.bossSpitInterval, minionTimer: TUNE_B.bossMinionInterval,
        burn: 0, burnT: 0, pois: 0, poisT: 0, slow: 0, slowT: 0,
      };
      run.state = 'boss';
      run.events.push({ t: 'boss', name: run.boss.name });
    }

    for (const r of run.rats) if (r.hp > 0) tickStatus(run, r, dt);
    if (run.boss && run.boss.hp > 0) tickStatus(run, run.boss, dt);

    for (const r of run.rats) {
      if (r.hp <= 0) continue;
      if (r.isSpitter) {
        if (!r.stopped && r.x <= r.stopX) r.stopped = true;
        if (!r.stopped) r.x -= r.speed * (1 - r.slow) * dt;
        else {
          r.spitTimer -= dt;
          if (r.spitTimer <= 0) { r.spitTimer += TUNE_B.spitInterval; run.globs.push(makeGlob(r.x, r.y, f.x, f.y)); }
        }
      } else {
        r.x -= r.speed * (1 - r.slow) * dt;
      }
      if (!r.stopped && (dist(r.x, r.y, f.x, f.y) < TUNE_B.contactR || r.x < 0.3)) {
        const dmg = r.bite * TUNE_B.contactMul;
        f.hp -= dmg;
        r.hp = 0; r.dead = true;
        run.events.push({ t: 'bite', x: r.x, y: r.y, v: dmg });
      }
    }

    if (run.boss && run.boss.hp > 0) {
      const b = run.boss;
      if (dist(b.x, b.y, f.x, f.y) > TUNE_B.bossContactR) b.x -= TUNE_B.bossSpeed * (1 - b.slow * 0.5) * dt;
      else f.hp -= TUNE_B.bossContactDps * dt;
      b.spitTimer -= dt;
      if (b.spitTimer <= 0) {
        b.spitTimer += TUNE_B.bossSpitInterval;
        const ang = Math.atan2(f.y - b.y, f.x - b.x);
        for (const off of [-0.3, 0, 0.3]) {
          const a2 = ang + off;
          run.globs.push(makeGlob(b.x, b.y, b.x + Math.cos(a2) * 20, b.y + Math.sin(a2) * 20));
        }
      }
      b.minionTimer -= dt;
      if (b.minionTimer <= 0) {
        b.minionTimer += TUNE_B.bossMinionInterval;
        const hp = parDpsB(run.wave) * TUNE_B.bossMinionInterval * TUNE_B.minionShare / TUNE_B.bossMinions;
        for (let i = 0; i < TUNE_B.bossMinions; i++) {
          run.rats.push(makeRat({ kind: 'runt', hp, max: hp, y: 0.5 + i * 1.5, isSpitter: false, stopX: null, t: 0 }));
        }
      }
    }

    for (const g of run.globs) {
      if (g.dead) continue;
      if (dist(g.x, g.y, f.x, f.y) < TUNE_B.globR) {
        f.hp -= TUNE_B.spit * (1 + 0.08 * (run.wave - 1));
        g.dead = true;
        continue;
      }
      const dx2 = g.tx - g.x, dy2 = g.ty - g.y, dd = Math.hypot(dx2, dy2);
      if (dd < 0.05) { g.dead = true; continue; }
      g.x += dx2 / dd * TUNE_B.globSpeed * dt;
      g.y += dy2 / dd * TUNE_B.globSpeed * dt;
    }
    run.globs = run.globs.filter(g => !g.dead);

    castSpells(run, dt);

    run.rats = run.rats.filter(r => r.hp > 0);

    if (f.hp <= 0) { f.hp = 0; run.state = 'dead'; run.events.push({ t: 'dead' }); return; }

    if (run.pending.length === 0 && run.rats.length === 0 && (!run.def.boss || (run.bossSpawned && run.boss.hp <= 0))) {
      waveEnd(run);
    }
  }

  function nextWave(run) { enterWave(run, run.wave + 1); }

  function revive(run) {
    run.revives++;
    run.frog.hp = run.frog.maxHp;
    const f = run.frog;
    run.rats = run.rats.filter(r => dist(r.x, r.y, f.x, f.y) > 4);
    run.globs = run.globs.filter(g => dist(g.x, g.y, f.x, f.y) > 4);
    if (run.boss) run.boss.x += 3;
    run.state = run.boss ? 'boss' : 'run';
    run.events.push({ t: 'revive' });
  }

  // The bot: dodge an incoming glob, else line up on the densest group of rats.
  function autopilot(run) {
    const f = run.frog;
    let threat = null, bestT = Infinity;
    for (const g of run.globs) {
      const d = dist(g.x, g.y, f.x, f.y);
      const t = d / TUNE_B.globSpeed;
      if (t < 0.6 && t < bestT) { bestT = t; threat = g; }
    }
    if (threat) {
      const y = clamp(f.y + (f.y >= threat.y ? 1.4 : -1.4), TUNE_B.yMin, TUNE_B.yMax);
      return { x: f.x, y };
    }
    if (run.boss && run.boss.hp > 0 && run.boss.x - f.x < 3 && Math.abs(f.y - run.boss.y) < 1) {
      const y = clamp(f.y + (f.y >= run.boss.y ? 1.4 : -1.4), TUNE_B.yMin, TUNE_B.yMax);
      return { x: f.x, y };
    }
    if (run.rats.length) {
      const bins = new Map();
      for (const r of run.rats) { const b = Math.round(r.y / 0.8); bins.set(b, (bins.get(b) || 0) + 1); }
      let bestB = 0, bestC = -1;
      for (const [b, c] of bins) if (c > bestC) { bestC = c; bestB = b; }
      return { x: TUNE_B.xMax, y: clamp(bestB * 0.8, TUNE_B.yMin, TUNE_B.yMax) };
    }
    return { x: TUNE_B.xMax, y: f.y };
  }

  // ---- offers, spells, the pot -------------------------------------------------

  function makeOffers(run) {
    const R = Sim.mulberry32(run.seed * 31 + run.wave * 131 + run.rerolls * 17);
    const w = run.wave, meta = run.meta;
    const offers = [];
    let guard = 0;
    while (offers.length < 3 && guard++ < 200) {
      const idx = offers.length;
      let wantSpell;
      if (w <= 3) wantSpell = idx < 2 || R() < 0.5;
      else if (w <= 9) wantSpell = R() < 0.5;
      else wantSpell = R() < 0.2;
      const roll = R();
      const tierRaw = w >= 10 ? (roll < 0.1 ? 3 : roll < 0.5 ? 2 : 1) : w >= 5 ? (roll < 0.3 ? 2 : 1) : 1;
      const tier = Math.min(5, Math.max(tierRaw, meta.minTier || 1));
      if (wantSpell && meta.unlockedSpells.length) {
        const type = meta.unlockedSpells[Math.floor(R() * meta.unlockedSpells.length)];
        offers.push({ kind: 'spell', type, tier });
      } else if (meta.unlockedIngredients.length) {
        const type = meta.unlockedIngredients[Math.floor(R() * meta.unlockedIngredients.length)];
        offers.push({ kind: 'ing', type, tier });
      }
    }
    return offers;
  }

  function reroll(run) { run.rerolls++; run.offers = makeOffers(run); }

  function addSpell(run, type, tier) {
    for (const s of run.spells) {
      if (s && s.type === type && s.tier === tier && s.tier < 5) {
        s.tier += 1;
        recalc(run);
        return true;
      }
    }
    const slot = run.spells.findIndex(s => !s);
    if (slot < 0) return false;
    const isNew = !run.spells.some(s => s && s.type === type);
    run.spells[slot] = makeSpell(type, tier);
    recalc(run);
    if (isNew) run.events.push({ t: 'spellfound', spellType: type });
    return true;
  }

  function addIngredientToPot(run, type, tier) {
    const dupIdx = run.pot.findIndex(p => p && p.type === type && p.tier === tier && p.tier < 5);
    if (dupIdx >= 0) { run.pot[dupIdx] = { type, tier: tier + 1 }; return true; }
    const slot = run.pot.findIndex(p => !p);
    if (slot < 0) return false;
    run.pot[slot] = { type, tier };
    return true;
  }

  function takeOffer(run, i) {
    const o = run.offers && run.offers[i];
    if (!o) return false;
    return o.kind === 'spell' ? addSpell(run, o.type, o.tier) : addIngredientToPot(run, o.type, o.tier);
  }

  function canMergePot(run, a, b) {
    const p = run.pot[a], q = run.pot[b];
    return a !== b && !!p && !!q && p.type === q.type && p.tier === q.tier && p.tier < 5;
  }

  function mergePot(run, a, b) {
    if (!canMergePot(run, a, b)) return false;
    run.pot[b] = { type: run.pot[b].type, tier: run.pot[b].tier + 1 };
    run.pot[a] = null;
    return true;
  }

  function applyIngredient(run, potIndex, spellIndex, slot) {
    const ing = run.pot[potIndex];
    const spell = run.spells[spellIndex];
    if (!ing || !spell) return false;
    const prev = spell.ings[slot];
    spell.ings[slot] = ing;
    run.pot[potIndex] = null;
    if (prev) {
      const backIdx = run.pot.findIndex(p => !p);
      if (backIdx >= 0) run.pot[backIdx] = prev;
    }
    recalc(run);
    return true;
  }

  function discardPot(run, i) { run.pot[i] = null; }

  // A rough value for a build: raw dps times a multiplier for area and status effects.
  function spellValue(meta, spell) {
    const c = compileSpell(meta, spell);
    const area = 1 + c.splash * 1.2 + c.chain * 0.3 + c.poison * 0.4;
    return c.dmg * c.rate * area * (1 + c.burn * 0.4) * (1 + c.slow * 0.5);
  }

  function totalValue(meta, spells) {
    let v = 0;
    for (const s of spells) if (s) v += spellValue(meta, s);
    return v;
  }

  function cloneTrial(run) {
    return {
      meta: run.meta, offers: run.offers, events: [],
      spells: run.spells.map(s => s ? { type: s.type, tier: s.tier, ings: s.ings.map(i => i ? { type: i.type, tier: i.tier } : null) } : null),
      pot: run.pot.map(p => p ? { type: p.type, tier: p.tier } : null),
    };
  }

  // The bot: take the offer that most raises a rough damage value (merges first), apply
  // pot ingredients to the spell they help most, then merge pot duplicates.
  function botBrew(run) {
    if (run.offers && run.offers.length) {
      let bi = -1, bestGain = -1;
      const before = totalValue(run.meta, run.spells);
      for (let i = 0; i < run.offers.length; i++) {
        const trial = cloneTrial(run);
        if (!takeOffer(trial, i)) continue;
        const gain = totalValue(run.meta, trial.spells) - before;
        if (gain > bestGain) { bestGain = gain; bi = i; }
      }
      if (bi < 0) { for (let i = 0; i < run.offers.length; i++) if (run.offers[i].kind === 'ing') { bi = i; break; } }
      if (bi >= 0) takeOffer(run, bi);
    }
    for (let p = 0; p < run.pot.length; p++) {
      if (!run.pot[p]) continue;
      let bestSpell = -1, bestSlot = -1, bestVal = totalValue(run.meta, run.spells);
      for (let si = 0; si < run.spells.length; si++) {
        const s = run.spells[si]; if (!s) continue;
        for (let slot = 0; slot < s.ings.length; slot++) {
          if (s.ings[slot]) continue;
          const trial = cloneTrial(run);
          applyIngredient(trial, p, si, slot);
          const v = totalValue(trial.meta, trial.spells);
          if (v > bestVal) { bestVal = v; bestSpell = si; bestSlot = slot; }
        }
      }
      if (bestSpell >= 0) applyIngredient(run, p, bestSpell, bestSlot);
    }
    let merged = true;
    while (merged) {
      merged = false;
      for (let a = 0; a < run.pot.length && !merged; a++)
        for (let b = 0; b < run.pot.length && !merged; b++)
          if (canMergePot(run, a, b)) { mergePot(run, a, b); merged = true; }
    }
  }

  const SimB = {
    TUNE_B, parDpsB, buildWaveB,
    createRun, step, nextWave, revive, autopilot, recalc,
    makeOffers, reroll, takeOffer, canMergePot, mergePot, applyIngredient, discardPot, botBrew,
  };
  return SimB;
});
