/* Magic Frogs prototype, core A (Frog March): the run simulation.
   Pure logic, no drawing and no DOM, so tools/balance.js can play whole runs in Node.
   Units: metres and seconds. The squad runs up the road (z grows); x is across the road.
   A run is 15 waves. Between waves the player brews: ingredients go into a 12-slot cauldron,
   two equal ingredients merge into the next tier, and the mix decides the squad's spell. */
(function (root) {
  'use strict';

  const TUNE = {
    road: 3.2,          // half-width of the road
    steerLimit: 2.45,   // how far off-centre the squad can go
    steerSpeed: 9,      // m/s the squad slides toward the finger
    runSpeed: 7,        // m/s up the road
    waves: 15,
    bossWaves: [5, 10, 15],
    waveLen: 170,       // metres of road in a normal wave
    bossRoad: 90,       // road before the arena on a boss wave
    startCats: 8,
    baseDmg: 5,
    baseRate: 2,        // casts per second per wizard
    catGrowth: 1.5,     // par squad size grows this much per wave
    dpsGrowth: 1.22,    // par damage per wizard grows this much per wave
    ratHpGrowth: 1.2,
    hordeSec: 3.2,      // each horde has this many seconds of par squad fire in HP
    lateGrowth: 0.2,    // hordes and bosses grow this share of their wave-1 size every wave
    range: 24,
    gate: {
      add: 0.22,        // a normal "+" gate adds this share of the par squad
      lure: 0.45,       // the "+" behind a horde
      pumpSec: 2.0,     // seconds of par fire to pump a shootable gate by one par squad
      pumpCap: 0.55,    // a shootable gate tops out at this share of the par squad
      multUntil: 2,     // "x2" gates only up to this wave, then only before bosses
    },
    bossSec: 14,        // boss HP = par squad damage per second x this
    bossSpeed: 0.9,
    bossChomp: 0.08,    // share of the squad eaten per second in contact
    cauldron: 12,
    reviveShare: 0.5,   // a revive brings back this share of the peak squad
    reviveMin: 20,
    chainShare: 0.4,    // storm: each chained hit does this share of the hit
    chainRange: 2.6,
    burnSec: 2, poisonSec: 3, slowSec: 1.5,
    poisonSpread: 1.3,  // metres: a poisoned rat passes it on when it dies
  };

  // Par curves: what a steady player has at the start of wave w. Content is built from these,
  // never from the live squad, so a chapter is the same for everyone (no rubber-banding).
  const parCats = w => TUNE.startCats * Math.pow(TUNE.catGrowth, w - 1);
  const parDps = w => TUNE.baseDmg * TUNE.baseRate * Math.pow(TUNE.dpsGrowth, w - 1);
  const parSquad = w => parCats(w) * parDps(w);
  const ratHp = w => Math.pow(TUNE.ratHpGrowth, w - 1);

  const RATS = {
    runt:  { hp: 30,   bite: 1,  speed: 2.2, r: 0.26, coin: 1 },
    brute: { hp: 220,  bite: 7,  speed: 1.7, r: 0.45, coin: 5 },
    tank:  { hp: 1000, bite: 30, speed: 1.2, r: 0.62, coin: 20 },
  };

  // Ingredients. v[t] is the effect at tier t (1-5); two equal ingredients merge into tier t+1.
  const INGREDIENTS = {
    ember:  { name: 'Ember Salt',    element: 'fire',   stat: 'Burn',       v: [0, 0.3, 0.55, 0.9, 1.4, 2.1],  unit: '%' },
    frost:  { name: 'Frost Petal',   element: 'ice',    stat: 'Slow',       v: [0, 0.2, 0.3, 0.4, 0.5, 0.6],   unit: '%' },
    shade:  { name: 'Nightshade',    element: 'poison', stat: 'Poison',     v: [0, 0.35, 0.6, 1.0, 1.6, 2.4],  unit: '%' },
    blast:  { name: 'Blast Powder',  element: 'blast',  stat: 'Splash',     v: [0, 0.25, 0.4, 0.6, 0.85, 1.2], unit: '%' },
    storm:  { name: 'Storm Feather', element: 'storm',  stat: 'Chain',      v: [0, 1, 2, 3, 4, 6],             unit: '' },
    moon:   { name: 'Moon Dust',     element: 'arcane', stat: 'Power',      v: [0, 0.3, 0.7, 1.3, 2.3, 4.0],   unit: '%' },
    quick:  { name: 'Quicksilver',   element: 'arcane', stat: 'Cast speed', v: [0, 0.25, 0.55, 1.0, 1.7, 2.8], unit: '%' },
    spawn:  { name: 'Frogspawn',     element: 'nature', stat: 'Recruits',   v: [0, 0.06, 0.12, 0.2, 0.32, 0.5], unit: '%' },
  };
  const ING_TYPES = Object.keys(INGREDIENTS);
  const SPLASH_R = [0, 1.0, 1.2, 1.45, 1.7, 2.0];
  const ELEMENTS = ['fire', 'ice', 'poison', 'blast', 'storm'];

  // The spell a cauldron makes: named by its two strongest elements. A named pair adds 20% to both.
  const RECIPES = {
    'fire':         'Ember Bolt',   'ice': 'Frost Shard',     'poison': 'Venom Spit',  'blast': 'Blast Rune', 'storm': 'Spark',
    'blast+fire':   'Fireball',     'ice+storm': 'Blizzard',  'blast+poison': 'Plague Bomb',
    'fire+storm':   'Sunfire',      'ice+poison': 'Frostbite', 'fire+ice': 'Steam Burst',
    'poison+storm': 'Acid Rain',    'blast+ice': 'Shatter',   'blast+storm': 'Thunderclap', 'fire+poison': 'Hellbrew',
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // What the cauldron brews: the squad's per-wizard damage plus the spell's effects.
  function brew(grid) {
    const s = { power: 0, rate: 0, burn: 0, slow: 0, poison: 0, splash: 0, splashR: 0, chain: 0, recruit: 0, weight: {} };
    for (const e of ELEMENTS) s.weight[e] = 0;
    for (const p of grid) {
      if (!p) continue;
      const ing = INGREDIENTS[p.type], v = ing.v[p.tier];
      if (p.type === 'ember') s.burn += v;
      else if (p.type === 'frost') s.slow += v;
      else if (p.type === 'shade') s.poison += v;
      else if (p.type === 'blast') { s.splash += v; s.splashR = Math.max(s.splashR, SPLASH_R[p.tier]); }
      else if (p.type === 'storm') s.chain += v;
      else if (p.type === 'moon') s.power += v;
      else if (p.type === 'quick') s.rate += v;
      else if (p.type === 'spawn') s.recruit += v;
      if (s.weight[ing.element] !== undefined) s.weight[ing.element] += p.tier;
    }
    const top = ELEMENTS.filter(e => s.weight[e] > 0).sort((a, b) => s.weight[b] - s.weight[a] || ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b));
    s.elements = top.slice(0, 2);
    const key = s.elements.slice().sort().join('+');
    s.spell = RECIPES[key] || (s.elements.length ? RECIPES[s.elements[0]] : 'Magic Missile');
    s.recipe = s.elements.length === 2 && !!RECIPES[key];
    if (s.recipe) {
      const boost = { fire: 'burn', ice: 'slow', poison: 'poison', blast: 'splash', storm: 'chain' };
      for (const e of s.elements) s[boost[e]] *= 1.2;
    }
    s.slow = Math.min(s.slow, 0.7);
    s.chain = Math.min(Math.round(s.chain), 8);
    s.dpsPerCat = TUNE.baseDmg * (1 + s.power) * TUNE.baseRate * (1 + s.rate);
    return s;
  }

  // Build one wave of road content from the chapter seed. Same seed, same wave, same content.
  function buildWave(seed, w, hpScale) {
    const R = mulberry32(seed * 1000 + w * 7919);
    const boss = TUNE.bossWaves.includes(w);
    const len = boss ? TUNE.bossRoad : TUNE.waveLen;
    const E = parCats(w), P = parSquad(w) * hpScale, hpm = ratHp(w) * hpScale;
    const ev = { len, boss, gates: [], rats: [], barrels: [] };

    // Gate rows: two choices across the road. Values are sized to the par squad, so a big squad
    // gains less from a "+" gate than a small one; multipliers only appear early and before bosses.
    const G = TUNE.gate;
    const pointCost = P * G.pumpSec / Math.max(E, 4);   // damage per +1 on a shootable gate
    const add = f => ({ op: '+', v: Math.max(1, Math.round(E * f)) });
    const early = w <= G.multUntil;
    const rowKinds = boss ? ['mult'] : [early ? 'mult' : 'lure', 'shoot', 'ing', 'risk'];
    const rowZ = boss ? [35] : [30, 72, 112, 150];
    const lures = [];
    rowKinds.forEach((kind, i) => {
      let a, b;
      if (kind === 'mult') { a = add(G.add + R() * 0.1); b = { op: 'x', v: 2 }; }
      else if (kind === 'lure') { a = add(G.lure + R() * 0.1); b = add(G.add * 0.6); lures.push(i); }
      else if (kind === 'shoot') { a = { op: '+', v: -Math.max(1, Math.round(E * (0.2 + R() * 0.1))), shoot: true, cost: pointCost, cap: Math.round(E * G.pumpCap) }; b = add(G.add * 0.8 + R() * 0.05); }
      else if (kind === 'ing') { a = { op: 'ing', ing: ING_TYPES[Math.floor(R() * 7)], tier: w >= 9 ? 2 : 1 }; b = add(G.add + R() * 0.05); }
      else { a = { op: '-', v: Math.max(1, Math.round(E * (0.25 + R() * 0.15))) }; b = add(G.add * 1.1 + R() * 0.1); }
      const flip = R() < 0.5;
      ev.gates.push({ z: rowZ[i], left: flip ? b : a, right: flip ? a : b, lure: kind === 'lure' ? (flip ? -1 : 1) : 0 });
    });

    // Rat hordes from the wave's HP budget. Hordes span the road, so some always reach the squad.
    const pBrute = w >= 3 ? Math.min(0.5, 0.05 * w) : 0, pTank = w >= 6 ? Math.min(0.25, 0.025 * (w - 5)) : 0;
    const spawnGroup = (share, z0, cx, wide) => {
      let left = share, n = 0;
      while (left > 0 && n < 160) {
        const u = R();
        const kind = u < pTank ? 'tank' : u < pTank + pBrute ? 'brute' : 'runt';
        const hp = RATS[kind].hp * hpm;
        ev.rats.push({ kind, hp, max: hp, x: clamp(cx + (R() * 2 - 1) * wide, -2.9, 2.9), z: z0 + R() * 8 });
        left -= hp; n++;
      }
    };
    // A lure row puts the bigger "+" behind a horde in its own lane: take the risk or the safe gate.
    const horde = P * TUNE.hordeSec * (1 + TUNE.lateGrowth * (w - 1));
    for (const i of lures) {
      const row = ev.gates[i];
      spawnGroup(horde * 0.5, row.z + 14, row.lure * 1.6, 1.2);
    }
    const groups = boss ? 2 : 4;
    for (let g = 0; g < groups; g++) {
      const z0 = (len - 25) * (g + 0.5) / groups + 12;
      spawnGroup(horde * (boss ? 0.5 : 1) * (0.85 + R() * 0.3), z0, (R() * 2 - 1) * 0.8, 2.2);
    }

    // Powder kegs near the hordes: hit one and it blows up the rats around it.
    const nb = boss ? 1 : 2;
    for (let i = 0; i < nb; i++) {
      const hp = 30 * hpm;
      ev.barrels.push({ x: (R() * 2 - 1) * 2.2, z: 50 + R() * (len - 70), hp, max: hp, boom: P * 1.2 });
    }

    if (boss) {
      const hp = P * TUNE.bossSec * (1 + TUNE.lateGrowth * (w - 1));
      ev.bossDef = { name: w === 5 ? 'Rat King' : w === 10 ? 'Sewer Queen' : 'Plague Lord', hp, max: hp, minionEvery: 1.4, minions: 3 + Math.floor(w / 5) };
    }
    return ev;
  }

  // A run. opts.meta carries what the player has earned outside runs.
  function createRun(opts) {
    opts = opts || {};
    const meta = opts.meta || {};
    const run = {
      seed: opts.seed || 1, wave: 1, state: 'run', time: 0, waveTime: 0,
      count: TUNE.startCats + (meta.bonusCats || 0), peak: 0, x: 0, z: 0,
      grid: new Array(TUNE.cauldron).fill(null),
      minTier: meta.minTier || 1,       // wizard rank raises the lowest ingredient tier on offer
      unlocked: meta.unlocked || ING_TYPES.slice(),
      hpScale: meta.hpScale || 1,       // chapter difficulty
      power: meta.power || 0,           // permanent damage bonus from the tower
      stats: null, rats: [], barrels: [], gates: [], boss: null, bossNext: 0,
      coins: 0, splatted: 0, revives: 0, rerolls: 0, offers: null, aim: null, firing: false,
      events: [],   // drained by the renderer: gate passes, pops, booms, bites
    };
    recalc(run);
    enterWave(run, 1);
    return run;
  }

  function recalc(run) {
    run.stats = brew(run.grid);
    run.stats.dpsPerCat *= 1 + run.power;
  }

  function enterWave(run, w) {
    run.wave = w;
    const def = buildWave(run.seed, w, run.hpScale);
    run.def = def;
    run.z = 0; run.waveTime = 0;
    run.gates = def.gates.map(g => ({ z: g.z, lure: g.lure, done: false, left: { ...g.left }, right: { ...g.right } }));
    run.rats = def.rats.map(r => ratFrom(r));
    run.barrels = def.barrels.map(b => ({ ...b }));
    run.boss = null; run.bossNext = 0;
    run.state = 'run';
    if (w > 1 && run.stats.recruit > 0) {
      const gain = Math.max(2, Math.round(run.count * run.stats.recruit));
      run.count += gain;
      run.events.push({ t: 'recruit', v: gain });
    }
    run.peak = Math.max(run.peak, run.count);
  }

  function ratFrom(r) {
    const k = RATS[r.kind];
    return { kind: r.kind, hp: r.hp, max: r.max, x: r.x, z: r.z, bite: k.bite, speed: k.speed, r: k.r, coin: k.coin, burn: 0, burnT: 0, pois: 0, poisT: 0, slow: 0, slowT: 0 };
  }

  function squadRadius(count) { return Math.min(0.25 + 0.075 * Math.sqrt(Math.max(count, 1)), 1.9); }

  function step(run, dt, targetX) {
    if (run.state !== 'run' && run.state !== 'boss') return;
    run.time += dt; run.waveTime += dt;
    const S = run.stats;

    // Steering: slide toward the finger at a capped speed.
    const tx = clamp(targetX, -TUNE.steerLimit, TUNE.steerLimit);
    run.x += clamp(tx - run.x, -TUNE.steerSpeed * dt, TUNE.steerSpeed * dt);

    const R = squadRadius(run.count);
    if (run.state === 'run') run.z += TUNE.runSpeed * dt;

    // Damage over time and slows wear off.
    for (const r of run.rats) if (r.hp > 0) tickStatus(run, r, dt);
    if (run.boss && run.boss.hp > 0) tickStatus(run, run.boss, dt);

    // Rats walk toward the squad; close ones drift toward its line.
    for (const r of run.rats) {
      if (r.hp <= 0) continue;
      r.z -= r.speed * (1 - r.slow) * dt;
      const d = r.z - run.z;
      if (d < 14 && d > 0) r.x += clamp(run.x - r.x, -0.9 * dt, 0.9 * dt);
      if (d < 0.6 && d > -1.5 && Math.abs(r.x - run.x) < R + r.r) {
        run.count -= r.bite; r.hp = 0; r.dead = true;
        run.events.push({ t: 'bite', x: r.x, z: r.z, v: r.bite });
      }
    }

    // Boss arena.
    if (run.state === 'boss') {
      const b = run.boss;
      b.z = Math.max(run.z + 1.2, b.z - TUNE.bossSpeed * (1 - b.slow * 0.5) * dt);
      run.bossNext -= dt;
      if (run.bossNext <= 0) {
        run.bossNext = b.minionEvery;
        const hp = RATS.runt.hp * ratHp(run.wave) * run.hpScale;
        for (let i = 0; i < b.minions; i++) {
          const k = (i + 0.5) / b.minions * 2 - 1;
          run.rats.push(ratFrom({ kind: 'runt', hp, max: hp, x: clamp(k * 2.4, -2.9, 2.9), z: b.z - 0.5 }));
        }
      }
      if (b.z - run.z <= 1.25) {
        run.chompAcc = (run.chompAcc || 0) + Math.max(3, run.count * TUNE.bossChomp) * dt;
        if (run.chompAcc >= 1) { const n = Math.floor(run.chompAcc); run.chompAcc -= n; run.count -= n; run.events.push({ t: 'chomp', v: n }); }
      }
    }

    // Casting: damage flows to the nearest targets in the squad's line of fire.
    const half = R + 0.3;
    let dmg = run.count * S.dpsPerCat * dt;
    run.firing = false;
    const targets = [];
    for (const r of run.rats) if (r.hp > 0 && inLine(run, r.x, r.z, half + r.r)) targets.push(r);
    for (const b of run.barrels) if (b.hp > 0 && inLine(run, b.x, b.z, half + 0.4)) targets.push(b);
    for (const g of run.gates) {
      if (g.done) continue;
      for (const side of ['left', 'right']) {
        const o = g[side];
        if (!o.shoot) continue;
        const gx = side === 'left' ? -1.6 : 1.6;
        if (inLine(run, gx, g.z, half + 1.2)) targets.push({ gate: o, z: g.z, x: gx });
      }
    }
    if (run.boss && run.boss.hp > 0) targets.push(run.boss);
    targets.sort((a, b) => a.z - b.z);
    run.aim = targets.length ? targets[0] : null;
    for (const t of targets) {
      if (dmg <= 0) break;
      run.firing = true;
      if (t.gate) {                       // pump a shootable gate; it soaks the volley until full
        const room = (t.gate.cap - t.gate.v) * t.gate.cost;
        if (room <= 0) continue;
        const use = Math.min(dmg, room);
        t.gate.v += use / t.gate.cost;
        dmg -= use;
        break;
      }
      const use = Math.min(dmg, t.hp);
      spellHit(run, t, use, dt);
      dmg -= use;
    }

    // Gates the squad just walked through.
    for (const g of run.gates) {
      if (g.done || run.z < g.z) continue;
      g.done = true;
      applyGate(run, run.x < 0 ? g.left : g.right, run.x < 0 ? -1 : 1);
    }

    // End of road.
    if (run.state === 'run' && run.z >= run.def.len) {
      if (run.def.boss) {
        run.state = 'boss';
        const bd = run.def.bossDef;
        run.boss = { name: bd.name, hp: bd.hp, max: bd.max, x: 0, z: run.z + 20, r: 1.3, minionEvery: bd.minionEvery, minions: bd.minions, isBoss: true, burn: 0, burnT: 0, pois: 0, poisT: 0, slow: 0, slowT: 0 };
        run.events.push({ t: 'boss', name: bd.name });
      } else waveCleared(run);
    }
    if (run.state === 'boss' && run.boss.hp <= 0) {
      run.coins += Math.round(40 * run.wave);
      run.events.push({ t: 'bossdown', name: run.boss.name });
      waveCleared(run);
    }

    run.rats = run.rats.filter(r => r.hp > 0 && r.z - run.z > -3);
    run.peak = Math.max(run.peak, run.count);
    if (run.count <= 0) { run.count = 0; run.state = 'dead'; run.events.push({ t: 'dead' }); }
  }

  function tickStatus(run, t, dt) {
    if (t.slowT > 0) { t.slowT -= dt; if (t.slowT <= 0) t.slow = 0; }
    let d = 0;
    if (t.burnT > 0) { d += t.burn * dt; t.burnT -= dt; }
    if (t.poisT > 0) { d += t.pois * dt; t.poisT -= dt; }
    if (d > 0) hit(run, t, Math.min(d, t.hp));
  }

  function inLine(run, x, z, half) {
    const d = z - run.z;
    return d >= -0.5 && d <= TUNE.range && Math.abs(x - run.x) <= half;
  }

  // One volley landing on a target: direct damage plus whatever the brew adds.
  function spellHit(run, t, a, dt) {
    const S = run.stats;
    if (t.boom !== undefined) { hit(run, t, a); return; }   // powder keg
    const dps = a / dt;
    if (S.burn > 0) { t.burn = Math.max(t.burn, dps * S.burn / TUNE.burnSec); t.burnT = TUNE.burnSec; }
    if (S.poison > 0) { t.pois = Math.max(t.pois, dps * S.poison / TUNE.poisonSec); t.poisT = TUNE.poisonSec; }
    if (S.slow > 0) { t.slow = Math.max(t.slow, S.slow); t.slowT = TUNE.slowSec; }
    hit(run, t, a);
    if (t.isBoss) return;
    if (S.splash > 0) {
      for (const r of run.rats) if (r !== t && r.hp > 0 && Math.hypot(r.x - t.x, r.z - t.z) <= S.splashR) hit(run, r, Math.min(a * S.splash, r.hp));
    }
    if (S.chain > 0) {
      const near = run.rats.filter(r => r !== t && r.hp > 0 && Math.hypot(r.x - t.x, r.z - t.z) <= TUNE.chainRange)
        .sort((p, q) => Math.hypot(p.x - t.x, p.z - t.z) - Math.hypot(q.x - t.x, q.z - t.z)).slice(0, S.chain);
      for (const r of near) hit(run, r, Math.min(a * TUNE.chainShare, r.hp));
      if (near.length) run.chainFx = { from: t, to: near };
    }
  }

  function hit(run, t, amount) {
    t.hp -= amount;
    if (t.isBoss || t.hp > 0 || t.dead) return;
    t.dead = true;
    if (t.boom !== undefined) {            // powder keg
      run.events.push({ t: 'boom', x: t.x, z: t.z });
      for (const r of run.rats) if (r.hp > 0 && Math.hypot(r.x - t.x, r.z - t.z) < 2.4) hit(run, r, t.boom);
      return;
    }
    run.splatted++;
    run.coins += t.coin;
    run.events.push({ t: 'pop', x: t.x, z: t.z, kind: t.kind, pois: t.poisT > 0 });
    if (t.poisT > 0) {                     // poison jumps to rats close by
      for (const r of run.rats) {
        if (r.hp > 0 && r !== t && Math.hypot(r.x - t.x, r.z - t.z) <= TUNE.poisonSpread && r.poisT <= 0) { r.pois = t.pois * 0.8; r.poisT = TUNE.poisonSec; }
      }
    }
  }

  function applyGate(run, o, side) {
    const before = run.count;
    if (o.op === '+') run.count += Math.floor(o.v);
    else if (o.op === '-') run.count -= o.v;
    else if (o.op === 'x') run.count *= o.v;
    else if (o.op === 'ing') { addIngredient(run, { type: o.ing, tier: Math.max(o.tier, run.minTier) }); run.events.push({ t: 'gate', o, side, gain: 0 }); return; }
    run.count = Math.max(Math.round(run.count), 0);
    run.events.push({ t: 'gate', o, side, gain: run.count - before });
  }

  function waveCleared(run) {
    run.coins += 10 * run.wave;
    if (run.wave >= TUNE.waves) { run.state = 'won'; run.events.push({ t: 'won' }); return; }
    run.state = 'brew';
    run.rerolls = 0;
    run.offers = makeOffers(run);
    run.events.push({ t: 'brew' });
  }

  function makeOffers(run) {
    const R = mulberry32(run.seed * 31 + run.wave * 131 + run.rerolls * 17);
    const offers = [];
    const w = run.wave, pool = run.unlocked;
    while (offers.length < 3) {
      const type = pool[Math.floor(R() * pool.length)];
      if (offers.some(o => o.type === type) && pool.length > 3) continue;
      const roll = R();
      const tier = w >= 10 ? (roll < 0.1 ? 3 : roll < 0.5 ? 2 : 1) : w >= 5 ? (roll < 0.3 ? 2 : 1) : 1;
      offers.push({ type, tier: Math.min(5, Math.max(tier, run.minTier)) });
    }
    return offers;
  }

  function reroll(run) { run.rerolls++; run.offers = makeOffers(run); }

  function addIngredient(run, ing) {
    let i = run.grid.indexOf(null);
    if (i < 0) { if (!autoMergeOnce(run)) return false; i = run.grid.indexOf(null); }
    run.grid[i] = { type: ing.type, tier: ing.tier };
    recalc(run);
    return true;
  }

  function canMerge(run, a, b) {
    const p = run.grid[a], q = run.grid[b];
    return a !== b && !!p && !!q && p.type === q.type && p.tier === q.tier && p.tier < 5;
  }

  function merge(run, a, b) {
    if (!canMerge(run, a, b)) return false;
    run.grid[b] = { type: run.grid[b].type, tier: run.grid[b].tier + 1 };
    run.grid[a] = null;
    recalc(run);
    return true;
  }

  function autoMergeOnce(run) {
    for (let a = 0; a < run.grid.length; a++) for (let b = a + 1; b < run.grid.length; b++) {
      if (canMerge(run, a, b)) { merge(run, a, b); return true; }
    }
    return false;
  }

  function discard(run, i) { run.grid[i] = null; recalc(run); }

  function pick(run, i) {
    if (!addIngredient(run, run.offers[i])) return false;
    run.offers = null;
    return true;
  }

  function nextWave(run) { enterWave(run, run.wave + 1); }

  function revive(run) {
    run.revives++;
    run.count = Math.max(TUNE.reviveMin, Math.round(run.peak * TUNE.reviveShare));
    for (const r of run.rats) if (r.z - run.z < 12) { r.hp = 0; r.dead = true; }
    if (run.boss) run.boss.z = run.z + 8;
    run.state = run.boss ? 'boss' : 'run';
    run.events.push({ t: 'revive', v: run.count });
  }

  // The bot: steers for the better gate, lines up on the nearest horde, and brews greedily.
  function autopilot(run) {
    const R = squadRadius(run.count);
    const next = run.gates.find(g => !g.done && g.z - run.z < 34 && g.z - run.z > -0.5);
    if (next) {
      const score = o => {
        if (o.op === 'ing') return run.count * 1.25;
        let v = o.v;
        if (o.shoot) v = Math.min(o.cap, v + (run.count * run.stats.dpsPerCat * (next.z - run.z) / TUNE.runSpeed * 0.8) / o.cost);
        return o.op === '+' ? run.count + v : o.op === '-' ? run.count - v : run.count * v;
      };
      return score(next.left) > score(next.right) ? -1.6 : 1.6;
    }
    let best = null, bestD = 1e9;
    for (const r of run.rats) {
      const d = r.z - run.z;
      if (r.hp > 0 && d > 2 && d < bestD) { bestD = d; best = r; }
    }
    return best ? clamp(best.x, -TUNE.steerLimit + R * 0.3, TUNE.steerLimit - R * 0.3) : 0;
  }

  // A rough value for a brew against a horde: area effects count for more when rats crowd.
  function brewValue(grid) {
    const s = brew(grid);
    const area = 1 + s.splash * 1.5 + s.chain * 0.35 + s.poison * 0.5;
    return s.dpsPerCat * (1 + s.burn * 0.5 + s.poison * 0.3) * area * (1 + s.slow * 0.6) * (1 + s.recruit * 3);
  }

  function botBrew(run) {
    let bi = 0, bs = -1;
    run.offers.forEach((o, i) => {
      const g = run.grid.slice();
      let k = g.indexOf(null);
      const twin = g.findIndex(p => p && p.type === o.type && p.tier === o.tier && p.tier < 5);
      if (twin >= 0) { g[twin] = { type: o.type, tier: o.tier + 1 }; k = -1; }
      else if (k >= 0) g[k] = o;
      else return;
      const v = brewValue(g);
      if (v > bs) { bs = v; bi = i; }
    });
    pick(run, bi);
    while (autoMergeOnce(run));
  }

  const Sim = {
    TUNE, RATS, INGREDIENTS, ING_TYPES, ELEMENTS, RECIPES, SPLASH_R,
    parCats, parDps, parSquad, ratHp, brew, buildWave, squadRadius,
    createRun, step, pick, reroll, merge, canMerge, autoMergeOnce, discard, nextWave, revive, makeOffers, recalc,
    autopilot, botBrew, brewValue, mulberry32,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Sim;
  else root.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
