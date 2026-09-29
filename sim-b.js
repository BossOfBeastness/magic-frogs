/* Magic Frogs prototype, core B (Frog Stand): the run simulation.
   Pure logic, no drawing and no DOM, so tools/balance-b.js can play whole runs in Node.
   Side view in metres: x runs 0 (left edge) to 12 (right edge, rats enter); y runs 0 to 4
   across the ground strip (depth). The frog holds the left side; rats walk in from the right.
   Reuses core A's brew (Sim.brew, Sim.makeOffers, Sim.pick, Sim.merge, Sim.canMerge,
   Sim.discard, Sim.reroll, Sim.autoMergeOnce, Sim.botBrew) and rat table (Sim.RATS). */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./sim.js'));
  else root.SimB = factory(root.Sim);
})(typeof window !== 'undefined' ? window : globalThis, function (Sim) {
  'use strict';

  const TUNE_B = {
    budgetSec: 10,      // wave HP budget = parDpsB(w) * budgetSec
    spit: 12,            // glob damage at wave 1, scaled by 1 + 0.08 * (w - 1)
    parGrowth: 1.22,    // per-wave growth of parDpsB (spec default 1.38)
    frogSpeed: 6,        // m/s the frog slides toward the target
    xMin: 0.8, xMax: 3.0, yMin: 0.3, yMax: 3.7,
    startX: 1.5, startY: 2.0,
    maxHp: 100,
    castRange: 11,
    castBase: 12,
    apprenticeBonus: 0.2,   // each apprentice adds this share of a cast's damage
    healShare: 0.3,         // heals this share of max at the start of each wave
    contactR: 0.6,
    contactMul: 1.5,          // a rat that reaches the frog does its bite times this
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
    bossSec: 10,      // boss HP = parDpsB(w) * bossSec (spec default 20)
    bossContactDps: 15,
    poisonSpreadShare: 0.8, // a poisoned rat passes on this share of its poison rate
    chainShare: 0.4,
    ratSpeed: { runt: 1.4, brute: 1.0, tank: 0.7 },
    bossNames: { 5: 'Rat King', 10: 'Sewer Queen', 15: 'Plague Lord' },
  };

  const parDpsB = w => 24 * Math.pow(TUNE_B.parGrowth, w - 1);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

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

  function createRun(opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    const run = {
      seed: opts.seed || 1, wave: 1, state: 'run', time: 0, waveTime: 0,
      frog: { x: TUNE_B.startX, y: TUNE_B.startY, hp: TUNE_B.maxHp, maxHp: TUNE_B.maxHp },
      apprentices: meta.apprenticeStart != null ? meta.apprenticeStart : 1,
      grid: new Array(Sim.TUNE.cauldron).fill(null),
      minTier: meta.minTier || 1,
      unlocked: meta.unlocked || Sim.ING_TYPES.slice(),
      powerBonus: meta.power || 0,
      stats: null, rats: [], globs: [], boss: null, bossSpawned: false,
      coins: 0, splatted: 0, revives: 0, rerolls: 0, offers: null,
      peak: 0, events: [], pending: [], def: null,
    };
    recalc(run);
    enterWave(run, 1);
    return run;
  }

  function recalc(run) { run.stats = Sim.brew(run.grid); }

  function enterWave(run, w) {
    run.wave = w;
    run.def = buildWaveB(run.seed, w);
    run.pending = run.def.spawns.slice();
    run.rats = []; run.globs = [];
    run.boss = null; run.bossSpawned = false;
    run.waveTime = 0;
    run.state = 'run';
    run.frog.hp = Math.min(run.frog.maxHp, run.frog.hp + run.frog.maxHp * TUNE_B.healShare);
    if (w > 1 && run.stats.recruit > 0) {
      const gain = Math.round(run.stats.recruit * 20);
      if (gain > 0) { run.apprentices += gain; run.events.push({ t: 'recruit', v: gain }); }
    }
    run.peak = Math.max(run.peak, run.apprentices);
  }

  function tickStatus(run, t, dt) {
    if (t.slowT > 0) { t.slowT -= dt; if (t.slowT <= 0) t.slow = 0; }
    let d = 0;
    if (t.burnT > 0) { d += t.burn * dt; t.burnT -= dt; }
    if (t.poisT > 0) { d += t.pois * dt; t.poisT -= dt; }
    if (d > 0) hitDamage(run, t, Math.min(d, t.hp));
  }

  function hitDamage(run, t, amount) {
    t.hp -= amount;
    if (t.isBoss || t.hp > 0 || t.dead) return;
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
  }

  function applyHit(run, t, dmg) {
    const S = run.stats;
    if (S.burn > 0) { t.burn = Math.max(t.burn, dmg * S.burn / Sim.TUNE.burnSec); t.burnT = Sim.TUNE.burnSec; }
    if (S.poison > 0) { t.pois = Math.max(t.pois, dmg * S.poison / Sim.TUNE.poisonSec); t.poisT = Sim.TUNE.poisonSec; }
    if (S.slow > 0) { t.slow = Math.max(t.slow, S.slow); t.slowT = Sim.TUNE.slowSec; }
    hitDamage(run, t, dmg);
    if (t.isBoss) return;
    if (S.splash > 0) {
      for (const r of run.rats) if (r !== t && r.hp > 0 && dist(r.x, r.y, t.x, t.y) <= S.splashR) hitDamage(run, r, Math.min(dmg * S.splash, r.hp));
    }
    if (S.chain > 0) {
      const near = run.rats.filter(r => r !== t && r.hp > 0 && dist(r.x, r.y, t.x, t.y) <= Sim.TUNE.chainRange)
        .sort((p, q) => dist(p.x, p.y, t.x, t.y) - dist(q.x, q.y, t.x, t.y)).slice(0, S.chain);
      for (const r of near) hitDamage(run, r, Math.min(dmg * TUNE_B.chainShare, r.hp));
      if (near.length) run.chainFx = { from: t, to: near };
    }
  }

  // Casting is a continuous flow of damage, exactly like core A's squad fire: it lands on
  // the nearest rat within range and, once that one is dead, spills onto the next nearest,
  // so a crowd of weak rats can be cut down in one sweep rather than one at a time.
  function castFlow(run, dt) {
    const f = run.frog, S = run.stats;
    const perSec = TUNE_B.castBase * (1 + S.power) * (1 + (run.powerBonus || 0)) * 2 * (1 + S.rate) * (1 + TUNE_B.apprenticeBonus * run.apprentices);
    let dmg = perSec * dt;
    // Rats first (the spec's target is "the rat with the smallest x"), so an approaching boss
    // never eclipses the mob it keeps summoning; the boss only draws fire once its rats are down.
    const targets = [];
    for (const r of run.rats) if (r.hp > 0 && r.x - f.x <= TUNE_B.castRange) targets.push(r);
    targets.sort((a, b) => a.x - b.x);
    if (run.boss && run.boss.hp > 0 && run.boss.x - f.x <= TUNE_B.castRange) targets.push(run.boss);
    run.firing = false;
    for (const t of targets) {
      if (dmg <= 0) break;
      run.firing = true;
      const use = Math.min(dmg, t.hp);
      applyHit(run, t, use);
      dmg -= use;
    }
  }

  function makeGlob(x, y, tx, ty) { return { x, y, tx, ty, dead: false }; }

  function waveEnd(run) {
    run.coins += Math.round(10 * run.wave + (run.def.boss ? 40 * run.wave : 0));
    if (run.wave >= 15) { run.state = 'won'; run.events.push({ t: 'won' }); return; }
    run.state = 'brew';
    run.rerolls = 0;
    run.offers = Sim.makeOffers(run);
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
        // Minions soak a fixed share of par damage, so the boss always draws some fire.
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

    castFlow(run, dt);

    run.rats = run.rats.filter(r => r.hp > 0);
    run.peak = Math.max(run.peak, run.apprentices);

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
    // A closing boss is a melee threat too: sidestep it the same way as a glob.
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

  const SimB = {
    TUNE_B, parDpsB, buildWaveB,
    createRun, step, nextWave, revive, autopilot, recalc,
  };
  return SimB;
});
