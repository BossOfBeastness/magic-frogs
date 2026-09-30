/* Magic Frogs prototype B: "Potion Shelf", a colour-sort pouring puzzle.
   Uses the shared Art (../../art.js) and Meta (../../meta.js) tables. Pure canvas 2D,
   pointer events only (no click), no dependencies. */
'use strict';

(function () {
  const C = Art.COLORS;
  const ELEMENTS = ['fire', 'ice', 'poison', 'blast', 'storm'];
  const EL_COLOR = { fire: C.fire, ice: C.ice, poison: C.poison, blast: C.blast, storm: C.storm };
  // element -> Meta.INGREDIENTS key that carries its magnitude table
  const EL_ING = { fire: 'ember', ice: 'frost', poison: 'shade', blast: 'blast', storm: 'storm' };
  const EL_STAT = { fire: 'burn', ice: 'slow', poison: 'poison', blast: 'splash', storm: 'chain' };
  // element -> Meta.SPELLS/EVOLUTIONS key, so "fire, blast" can look up Fireball
  const EL_SPELL = { fire: 'ember', ice: 'frost', poison: 'venom', blast: 'blast', storm: 'spark' };

  const FLASK_MAX = 4;
  const FLASK_BASE_COUNT = 5;
  const FLASK_MAX_COUNT = 6;
  const BUY_FLASK_COST = 15;
  const SWIRL_COST = 5;
  const MAX_WAVE = 5;
  const BASE_DMG = 10;
  const BASE_RATE = 1.2; // casts per second
  const FROG_HP_MAX = 100;

  const WAVES = [
    { kinds: ['runt', 'runt', 'runt', 'runt'], hp: 16 },
    { kinds: ['runt', 'runt', 'runt', 'runt', 'runt'], hp: 20 },
    { kinds: ['runt', 'brute', 'runt', 'brute', 'runt'], hp: 22 },
    { kinds: ['brute', 'brute', 'runt', 'brute', 'tank'], hp: 26 },
    { boss: 'Rat King', hp: 220 },
  ];

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rnd(arr.length)]; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
  }

  // ---- game state -----------------------------------------------------------

  const state = {
    gold: Meta.START_GOLD,
    wave: 1,
    waveActive: false,
    waveOver: false,
    frogHp: FROG_HP_MAX,
    rats: [],          // {kind, hp, maxHp, x, spawnOrder, isBoss}
    spawnQueue: 0,
    spawnTimer: 0,
    nextSpawnOrder: 0,
    flasks: [],         // array of arrays (bottom->top element strings)
    flaskCount: FLASK_BASE_COUNT,
    boughtExtraFlask: false,
    belt: [],           // {element, count}
    offers: [],
    rerollsUsed: 0,
    lifted: null,       // {type:'flask'|'bottle', index}
    firstPourDone: false,
    gameOver: null,     // null | 'win' | {lose: wave}
    t: 0,
    pourAnim: null,      // active pour animation
    corkAnims: [],       // active cork-pop animations
    dmgNumbers: [],       // floating damage numbers on the fight canvas
    bolts: [],
    frogCastCooldown: 0,
    bounces: {},        // key -> t remaining, small scale bounce or shake
  };

  for (let i = 0; i < state.flaskCount; i++) state.flasks.push([]);

  // ---- economy / shop ---------------------------------------------------------

  function bottlePrice(layers) { return layers.length === 1 ? 8 : 12; }

  function makeBottle() {
    const roll = rnd(3);
    let layers;
    if (roll === 0) layers = [pick(ELEMENTS)];
    else if (roll === 1) { const e = pick(ELEMENTS); layers = [e, e]; }
    else {
      let a = pick(ELEMENTS), b = pick(ELEMENTS);
      while (b === a) b = pick(ELEMENTS);
      layers = [a, b];
    }
    return { layers, price: bottlePrice(layers), sold: false };
  }

  function refillOffers() { state.offers = [makeBottle(), makeBottle(), makeBottle()]; }
  refillOffers();

  function rerollCost() { return Meta.rerollCost(state.rerollsUsed); }

  // ---- flask / pour logic -----------------------------------------------------

  // Returns {legal:true, moveCount, color} or {legal:false, reason}.
  function pourPlan(source, target) {
    if (!source || source.length === 0) return { legal: false, reason: 'That flask is empty' };
    if (target.length >= FLASK_MAX) return { legal: false, reason: 'That flask is full' };
    const color = source[source.length - 1];
    const topTarget = target.length ? target[target.length - 1] : null;
    if (topTarget !== null && topTarget !== color) return { legal: false, reason: 'Colours will not mix' };
    let n = 0;
    for (let i = source.length - 1; i >= 0 && source[i] === color; i--) n++;
    const room = FLASK_MAX - target.length;
    const moveCount = Math.min(n, room);
    if (moveCount <= 0) return { legal: false, reason: 'No room' };
    return { legal: true, moveCount, color };
  }

  function isCorked(layers) {
    return layers.length === FLASK_MAX && layers.every(c => c === layers[0]);
  }

  function applyPotion(element) {
    const existing = state.belt.find(p => p.element === element);
    if (existing) { existing.count = clamp(existing.count + 1, 1, 5); return; }
    if (state.belt.length < 3) { state.belt.push({ element, count: 1 }); return; }
    // belt already carries three different elements: the run keeps going without a new slot.
  }

  function evolutionName() {
    const els = state.belt.map(p => p.element);
    for (let i = 0; i < els.length; i++) for (let j = 0; j < els.length; j++) {
      if (i === j) continue;
      const a = EL_SPELL[els[i]], b = EL_SPELL[els[j]];
      const evos = (Meta.EVOLUTIONS[a] || []);
      const hit = evos.find(e => e.with === b);
      if (hit) return hit.name;
    }
    return null;
  }

  function beltStats() {
    let dmg = BASE_DMG, rate = BASE_RATE;
    const eff = { burn: 0, slow: 0, poison: 0, splash: 0, chain: 0 };
    let total = 0;
    for (const p of state.belt) {
      total += p.count;
      const ingKey = EL_ING[p.element];
      const v = Meta.INGREDIENTS[ingKey].v[clamp(p.count, 1, 5)];
      eff[EL_STAT[p.element]] += v;
    }
    dmg *= (1 + 0.15 * total);
    rate *= (1 + 0.05 * total);
    const evo = evolutionName();
    if (evo) dmg *= Meta.EVO_MULT;
    return { dmg, rate, eff, evo };
  }

  // ---- fight sim ---------------------------------------------------------------

  const FROG_X = 60, FROG_Y = 300, FROG_S = 130;
  const FRONT_X = 130, QUEUE_GAP = 40, SPAWN_X = 410;

  function ratMaxHp(kind, hp) {
    if (kind === 'tank') return Math.round(hp * 2.2);
    if (kind === 'brute') return Math.round(hp * 1.5);
    return hp;
  }

  function startWave() {
    const cfg = WAVES[state.wave - 1];
    state.rats = [];
    state.nextSpawnOrder = 0;
    if (cfg.boss) {
      state.spawnQueue = 1;
    } else {
      state.spawnQueue = cfg.kinds.length;
      state.waveKinds = cfg.kinds.slice();
      state.waveBaseHp = cfg.hp;
    }
    state.spawnTimer = 0;
    state.waveActive = true;
    state.waveOver = false;
    state.frogCastCooldown = 0;
    updateLockUI();
  }

  function spawnNext() {
    const cfg = WAVES[state.wave - 1];
    if (cfg.boss) {
      state.rats.push({ kind: 'boss', isBoss: true, hp: cfg.hp, maxHp: cfg.hp, x: SPAWN_X, spawnOrder: state.nextSpawnOrder++, slowT: 0 });
    } else {
      const kind = state.waveKinds.shift();
      const maxHp = ratMaxHp(kind, state.waveBaseHp);
      state.rats.push({ kind, hp: maxHp, maxHp, x: SPAWN_X, spawnOrder: state.nextSpawnOrder++, slowT: 0 });
    }
    state.spawnQueue--;
  }

  function queueTargetX(rat) {
    const alive = state.rats.filter(r => r.hp > 0).sort((a, b) => a.spawnOrder - b.spawnOrder);
    const idx = alive.indexOf(rat);
    return FRONT_X + Math.max(0, idx) * QUEUE_GAP;
  }

  function goldForKill(kind) { return kind === 'boss' ? 50 : 1; }

  function addDmgNumber(x, y, text, color) {
    state.dmgNumbers.push({ x, y, text, color, t: 0 });
  }

  function fireBolt(target, stats) {
    const element = state.belt.length ? state.belt[0].element : null;
    state.bolts.push({
      x: FROG_X + FROG_S * 0.5, y: FROG_Y - FROG_S * 0.62,
      tx: target.x, ty: FROG_Y - 60, t: 0, dur: 0.22,
      target, stats, element,
      chainLeft: Math.floor(stats.eff.chain), resolved: false,
    });
  }

  function hitRat(rat, stats, isSecondary) {
    if (!rat || rat.hp <= 0) return;
    const dmg = stats.dmg * (isSecondary ? 0.5 : 1);
    rat.hp -= dmg;
    addDmgNumber(rat.x, FROG_Y - 100, Math.round(dmg) + '', '#fff');
    if (stats.eff.burn > 0) {
      const b = stats.dmg * stats.eff.burn;
      rat.hp -= b;
      addDmgNumber(rat.x - 10, FROG_Y - 80, Math.round(b) + '', C.fire);
    }
    if (stats.eff.poison > 0) {
      const p = stats.dmg * stats.eff.poison;
      rat.hp -= p;
      addDmgNumber(rat.x + 10, FROG_Y - 80, Math.round(p) + '', C.poison);
    }
    if (stats.eff.slow > 0) rat.slowT = 2;
    if (rat.hp <= 0 && !rat.dead) {
      rat.dead = true;
      state.gold += goldForKill(rat.kind);
      bumpGold();
    }
  }

  function updateFight(dt) {
    state.t += dt;
    if (!state.waveActive) return;

    if (state.spawnQueue > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) { spawnNext(); state.spawnTimer = 0.9; }
    }

    for (const rat of state.rats) {
      if (rat.hp <= 0) continue;
      if (rat.slowT > 0) rat.slowT -= dt;
      const speed = rat.slowT > 0 ? 40 : 70;
      const tx = queueTargetX(rat);
      if (rat.x > tx) rat.x = Math.max(tx, rat.x - speed * dt);
      if (rat.x <= FRONT_X + 2) {
        rat.meleeTimer = (rat.meleeTimer === undefined) ? 1 : rat.meleeTimer - dt;
        if (rat.meleeTimer <= 0) {
          state.frogHp = Math.max(0, state.frogHp - (rat.isBoss ? 10 : 5));
          rat.meleeTimer = 1;
          updateHpUI();
        }
      }
    }

    const stats = beltStats();
    state.frogCastCooldown -= dt;
    const liveTarget = state.rats.filter(r => r.hp > 0).sort((a, b) => a.x - b.x)[0];
    if (state.frogCastCooldown <= 0 && liveTarget) {
      state.frogCastCooldown = 1 / stats.rate;
      state.casting = 0.18;
      fireBolt(liveTarget, stats);
    }
    if (state.casting > 0) state.casting -= dt;

    for (const b of state.bolts) b.t += dt / b.dur;
    for (const b of state.bolts) {
      if (b.t >= 1 && !b.resolved) {
        b.resolved = true;
        hitRat(b.target, b.stats, false);
        if (b.stats.eff.splash > 0) {
          const alive = state.rats.filter(r => r.hp > 0 && r !== b.target).sort((a, c) => a.x - c.x);
          if (alive[0]) hitRat(alive[0], b.stats, true);
        }
        if (b.chainLeft > 0) {
          const alive = state.rats.filter(r => r.hp > 0 && r !== b.target).sort((a, c) => a.x - c.x);
          for (let i = 0; i < Math.min(b.chainLeft, alive.length); i++) hitRat(alive[i], b.stats, true);
        }
      }
    }
    state.bolts = state.bolts.filter(b => b.t < 1.15);
    state.rats = state.rats.filter(r => r.hp > 0);

    if (state.spawnQueue === 0 && state.rats.length === 0 && state.nextSpawnOrder > 0) {
      endWave();
    }
    if (state.frogHp <= 0 && !state.gameOver) {
      state.gameOver = { lose: state.wave };
      state.waveActive = false;
      showEnd();
    }
  }

  function endWave() {
    if (state.waveOver) return;
    state.waveOver = true;
    state.waveActive = false;
    state.gold += 10;
    bumpGold();
    if (state.wave >= MAX_WAVE) {
      state.gameOver = 'win';
      showEnd();
      return;
    }
    state.wave++;
    updateWaveUI();
    refillOffers();
    state.rerollsUsed = 0;
    updateLockUI();
    renderShop();
  }

  // ---- DOM wiring ---------------------------------------------------------------

  const fightCanvas = document.getElementById('fight-canvas');
  const fightCtx = fightCanvas.getContext('2d');
  const fxCanvas = document.getElementById('fx-canvas');
  const fxCtx = fxCanvas.getContext('2d');
  const shelfRow = document.getElementById('shelf-row');
  const beltSlots = document.getElementById('belt-slots');
  const offersEl = document.getElementById('offers');
  const lockOverlay = document.getElementById('lock-overlay');
  const btnPlay = document.getElementById('btn-play');
  const btnReroll = document.getElementById('btn-reroll');
  const btnBuyFlask = document.getElementById('btn-buy-flask');
  const btnSwirl = document.getElementById('btn-swirl');
  const rerollCostEl = document.getElementById('reroll-cost');
  const flaskCostEl = document.getElementById('flask-cost');
  const swirlCostEl = document.getElementById('swirl-cost');
  const hintLine = document.getElementById('hint-line');
  const refuseLine = document.getElementById('refuse-line');
  const goldNum = document.getElementById('gold-num');
  const hudWave = document.getElementById('hud-wave');
  const hpFill = document.getElementById('hud-hp-fill');
  const statDmg = document.getElementById('stat-dmg');
  const statRate = document.getElementById('stat-rate');
  const statEffects = document.getElementById('stat-effects');
  const helpOverlay = document.getElementById('help-overlay');
  const endOverlay = document.getElementById('end-overlay');
  const endTitle = document.getElementById('end-title');

  let flaskCanvases = [];
  let bottleCanvases = [];
  let refuseTimer = null;

  function showRefuse(text) {
    refuseLine.textContent = text;
    refuseLine.hidden = false;
    if (refuseTimer) clearTimeout(refuseTimer);
    refuseTimer = setTimeout(() => { refuseLine.hidden = true; }, 1300);
  }

  function bumpGold() {
    goldNum.textContent = String(state.gold);
    goldNum.classList.remove('tick-up');
    void goldNum.offsetWidth;
    goldNum.classList.add('tick-up');
    renderShop();
  }

  function updateWaveUI() { hudWave.textContent = 'WAVE ' + state.wave + ' / ' + MAX_WAVE; }
  function updateHpUI() { hpFill.style.width = Math.max(0, (state.frogHp / FROG_HP_MAX) * 100) + '%'; }

  function updateLockUI() {
    lockOverlay.hidden = !state.waveActive;
    btnPlay.disabled = state.waveActive || (!state.firstPourDone && state.wave === 1);
    btnReroll.disabled = state.waveActive;
    btnBuyFlask.disabled = state.waveActive || state.boughtExtraFlask || state.flaskCount >= FLASK_MAX_COUNT || state.gold < BUY_FLASK_COST;
    btnSwirl.disabled = state.waveActive || state.gold < SWIRL_COST;
    if (!state.waveActive && !state.firstPourDone && state.wave === 1) {
      hintLine.hidden = false;
      hintLine.textContent = 'Buy a bottle and pour it into a flask to begin';
      btnPlay.classList.add('pulse');
    } else {
      hintLine.hidden = true;
      btnPlay.classList.remove('pulse');
    }
  }

  function buildShelfDom() {
    shelfRow.innerHTML = '';
    flaskCanvases = [];
    for (let i = 0; i < state.flaskCount; i++) {
      const cv = document.createElement('canvas');
      cv.className = 'flask-canvas';
      cv.width = 56; cv.height = 170;
      cv.dataset.index = String(i);
      shelfRow.appendChild(cv);
      flaskCanvases.push(cv);
      wireFlaskPointer(cv, i);
    }
  }
  buildShelfDom();

  function renderShop() {
    offersEl.innerHTML = '';
    bottleCanvases = [];
    state.offers.forEach((offer, i) => {
      const cv = document.createElement('canvas');
      cv.className = 'bottle-canvas';
      cv.width = 90; cv.height = 130;
      cv.dataset.index = String(i);
      const affordable = !offer.sold && state.gold >= offer.price;
      cv.style.opacity = offer.sold ? '0.25' : (affordable ? '1' : '0.5');
      offersEl.appendChild(cv);
      bottleCanvases.push(cv);
      wireBottlePointer(cv, i);
      if (!offer.sold && affordable && state.wave === 1 && !state.firstPourDone && i === 0) {
        cv.classList.add('pulse');
      }
    });
    rerollCostEl.textContent = rerollCost() === 0 ? 'free' : String(rerollCost());
    flaskCostEl.textContent = String(BUY_FLASK_COST);
    swirlCostEl.textContent = String(SWIRL_COST);
    updateLockUI();
    render();
  }

  function renderBelt() {
    beltSlots.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const cv = document.createElement('canvas');
      cv.className = 'belt-canvas';
      cv.width = 44; cv.height = 44;
      beltSlots.appendChild(cv);
      const ctx = cv.getContext('2d');
      drawBeltSlot(ctx, 44, 44, state.belt[i] || null);
    }
  }

  // ---- pointer interaction -----------------------------------------------------

  function sourceLayers(src) {
    if (!src) return null;
    if (src.type === 'flask') return state.flasks[src.index];
    return state.offers[src.index].layers;
  }

  function sameSource(a, b) { return a && b && a.type === b.type && a.index === b.index; }

  function clearLift() { state.lifted = null; render(); }

  function attemptPour(src, targetFlaskIndex) {
    const layers = sourceLayers(src);
    const target = state.flasks[targetFlaskIndex];
    if (src.type === 'flask' && src.index === targetFlaskIndex) { clearLift(); return; }
    const plan = pourPlan(layers, target);
    if (!plan.legal) {
      showRefuse(plan.reason);
      state.lifted = null;
      state.bounces['shake' + targetFlaskIndex] = 0.4;
      render();
      return;
    }
    const fromCv = src.type === 'flask' ? flaskCanvases[src.index] : bottleCanvases[src.index];
    const fromRect = fromCv.getBoundingClientRect();
    const toRect = flaskCanvases[targetFlaskIndex].getBoundingClientRect();
    const phoneRect = document.getElementById('phone').getBoundingClientRect();
    state.pourAnim = {
      t: 0, dur: 0.55, color: plan.color,
      fromX: fromRect.left + fromRect.width / 2 - phoneRect.left,
      fromY: fromRect.top - phoneRect.top,
      toX: toRect.left + toRect.width / 2 - phoneRect.left,
      toY: toRect.top - phoneRect.top,
      onDone: function () {
        for (let i = 0; i < plan.moveCount; i++) layers.pop();
        for (let i = 0; i < plan.moveCount; i++) target.push(plan.color);
        if (src.type === 'bottle') state.offers[src.index].sold = true;
        state.bounces['flask' + targetFlaskIndex] = 0.35;
        vibrate(15);
        state.firstPourDone = true;
        if (isCorked(target)) corkFlask(targetFlaskIndex);
        state.lifted = null;
        renderShop();
        renderBelt();
        updateLockUI();
      },
    };
  }

  function corkFlask(index) {
    const element = state.flasks[index][0];
    state.flasks[index] = [];
    applyPotion(element);
    state.corkAnims.push({ t: 0, dur: 0.5, index, element });
    vibrate([20, 30, 20]);
    state.bounces['flask' + index] = 0.5;
  }

  function highlightFor(src) {
    const layers = sourceLayers(src);
    return state.flasks.map((f, i) => {
      if (src.type === 'flask' && src.index === i) return null;
      const plan = pourPlan(layers, f);
      return plan.legal ? 'green' : 'red';
    });
  }

  function wireFlaskPointer(cv, index) {
    let downX = 0, downY = 0, dragging = false, pid = null;
    cv.addEventListener('pointerdown', ev => {
      pid = ev.pointerId; downX = ev.clientX; downY = ev.clientY; dragging = false;
      cv.setPointerCapture(pid);
    });
    cv.addEventListener('pointermove', ev => {
      if (pid === null || ev.pointerId !== pid || state.waveActive) return;
      if (!dragging && Math.hypot(ev.clientX - downX, ev.clientY - downY) > 8) {
        dragging = true;
        if (!state.lifted && state.flasks[index].length) { state.lifted = { type: 'flask', index }; render(); }
      }
    });
    cv.addEventListener('pointerup', ev => {
      if (pid === null || ev.pointerId !== pid) return;
      cv.releasePointerCapture(pid);
      pid = null;
      if (dragging) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCv = el && el.closest && el.closest('.flask-canvas');
        if (state.lifted && targetCv) {
          attemptPour(state.lifted, Number(targetCv.dataset.index));
        } else {
          state.lifted = null; render();
        }
        return;
      }
      if (state.waveActive) return;
      if (!state.lifted) {
        if (state.flasks[index].length) { state.lifted = { type: 'flask', index }; render(); }
        return;
      }
      if (sameSource(state.lifted, { type: 'flask', index })) { clearLift(); return; }
      attemptPour(state.lifted, index);
    });
  }

  function wireBottlePointer(cv, index) {
    cv.addEventListener('pointerdown', ev => { cv.setPointerCapture(ev.pointerId); });
    cv.addEventListener('pointerup', () => {
      if (state.waveActive) return;
      const offer = state.offers[index];
      if (!offer || offer.sold) return;
      if (state.lifted && state.lifted.type === 'bottle' && state.lifted.index === index) { clearLift(); return; }
      if (state.gold < offer.price) { showRefuse('Not enough gold'); return; }
      state.gold -= offer.price;
      bumpGold();
      state.lifted = { type: 'bottle', index };
      render();
    });
  }

  btnPlay.addEventListener('pointerdown', () => { if (!btnPlay.disabled) startWave(); });
  btnReroll.addEventListener('pointerdown', () => {
    if (btnReroll.disabled) return;
    const cost = rerollCost();
    if (state.gold < cost) { showRefuse('Not enough gold to reroll'); return; }
    state.gold -= cost;
    state.rerollsUsed++;
    refillOffers();
    bumpGold();
  });
  btnBuyFlask.addEventListener('pointerdown', () => {
    if (btnBuyFlask.disabled) return;
    state.gold -= BUY_FLASK_COST;
    state.flaskCount++;
    state.boughtExtraFlask = true;
    state.flasks.push([]);
    buildShelfDom();
    bumpGold();
  });
  btnSwirl.addEventListener('pointerdown', () => {
    if (btnSwirl.disabled) return;
    state.gold -= SWIRL_COST;
    const tops = [];
    state.flasks.forEach((f, i) => { if (f.length) tops.push({ i, color: f[f.length - 1] }); });
    const colors = tops.map(t => t.color);
    for (let i = colors.length - 1; i > 0; i--) { const j = rnd(i + 1); const tmp = colors[i]; colors[i] = colors[j]; colors[j] = tmp; }
    tops.forEach((t, k) => { state.flasks[t.i][state.flasks[t.i].length - 1] = colors[k]; });
    bumpGold();
  });

  document.getElementById('btn-help').addEventListener('pointerdown', () => { helpOverlay.hidden = false; });
  document.getElementById('btn-help-close').addEventListener('pointerdown', () => { helpOverlay.hidden = true; });
  document.getElementById('btn-retry').addEventListener('pointerdown', () => { location.reload(); });

  function showEnd() {
    endTitle.textContent = state.gameOver === 'win' ? 'Victory' : ('Defeated on wave ' + state.gameOver.lose);
    endOverlay.hidden = false;
  }

  // ---- drawing: flasks, bottles, belt -------------------------------------------

  function drawFlaskGlass(ctx, w, h, glow) {
    const neckW = w * 0.34, bodyTop = h * 0.28;
    ctx.beginPath();
    ctx.moveTo(w / 2 - neckW / 2, 2);
    ctx.lineTo(w / 2 - neckW / 2, bodyTop);
    ctx.quadraticCurveTo(4, bodyTop, 4, h * 0.55);
    ctx.quadraticCurveTo(4, h - 4, w * 0.5, h - 4);
    ctx.quadraticCurveTo(w - 4, h - 4, w - 4, h * 0.55);
    ctx.quadraticCurveTo(w - 4, bodyTop, w / 2 + neckW / 2, bodyTop);
    ctx.lineTo(w / 2 + neckW / 2, 2);
    ctx.strokeStyle = glow || 'rgba(255,255,255,0.75)';
    ctx.lineWidth = glow ? 3.5 : 2;
    ctx.stroke();
    return { bodyTop };
  }

  function drawLiquid(ctx, w, h, layers, bodyTop) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(4, bodyTop);
    ctx.quadraticCurveTo(4, bodyTop, 4, h * 0.55);
    ctx.quadraticCurveTo(4, h - 4, w * 0.5, h - 4);
    ctx.quadraticCurveTo(w - 4, h - 4, w - 4, h * 0.55);
    ctx.quadraticCurveTo(w - 4, bodyTop, w - 4, bodyTop);
    ctx.closePath();
    ctx.clip();
    const bodyH = h - 4 - bodyTop, layerH = bodyH / FLASK_MAX;
    layers.forEach((color, i) => {
      const y0 = h - 4 - (i + 1) * layerH;
      ctx.fillStyle = EL_COLOR[color];
      ctx.fillRect(0, y0, w, layerH + 1);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, y0, w, layerH * 0.25);
    });
    ctx.restore();
  }

  function drawFlaskCanvas(ctx, w, h, layers, glowMode, bounceT, shakeT) {
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    let dx = 0;
    if (shakeT > 0) dx = Math.sin(shakeT * 60) * 4 * shakeT;
    const scale = bounceT > 0 ? 1 + Math.sin(bounceT * Math.PI) * 0.12 : 1;
    ctx.translate(w / 2 + dx, h);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h);
    const glow = glowMode === 'green' ? '#4CFF6E' : glowMode === 'red' ? '#FF5A5A' : glowMode === 'lift' ? '#FFE14A' : null;
    const { bodyTop } = drawFlaskGlass(ctx, w, h, glow);
    drawLiquid(ctx, w, h, layers, bodyTop);
    drawFlaskGlass(ctx, w, h, glow);
    ctx.restore();
  }

  function drawBottleCanvas(ctx, w, h, offer) {
    ctx.clearRect(0, 0, w, h);
    const bw = w * 0.5, bh = h * 0.62, bx = (w - bw) / 2, by = h * 0.06;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.3, by);
    ctx.lineTo(bx + bw * 0.3, by + bh * 0.16);
    ctx.quadraticCurveTo(bx, by + bh * 0.3, bx, by + bh * 0.5);
    ctx.quadraticCurveTo(bx, by + bh, bx + bw / 2, by + bh);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw, by + bh * 0.5);
    ctx.quadraticCurveTo(bx + bw, by + bh * 0.3, bx + bw * 0.7, by + bh * 0.16);
    ctx.lineTo(bx + bw * 0.7, by);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
    ctx.clip();
    const layerH = (bh * 0.82) / 2;
    offer.layers.forEach((color, i) => {
      const y0 = by + bh - (i + 1) * layerH;
      ctx.fillStyle = EL_COLOR[color];
      ctx.fillRect(bx, y0, bw, layerH + 1);
    });
    ctx.restore();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(bx + bw * 0.3, by);
    ctx.lineTo(bx + bw * 0.3, by + bh * 0.16);
    ctx.quadraticCurveTo(bx, by + bh * 0.3, bx, by + bh * 0.5);
    ctx.quadraticCurveTo(bx, by + bh, bx + bw / 2, by + bh);
    ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw, by + bh * 0.5);
    ctx.quadraticCurveTo(bx + bw, by + bh * 0.3, bx + bw * 0.7, by + bh * 0.16);
    ctx.lineTo(bx + bw * 0.7, by);
    ctx.stroke();
    ctx.fillStyle = '#8A5A3A';
    ctx.fillRect(bx + bw * 0.32, by - 8, bw * 0.36, 9);
    ctx.fillStyle = offer.sold ? '#666' : '#FFC93C';
    ctx.font = '700 15px "Titan One", cursive';
    ctx.textAlign = 'center';
    ctx.fillText(offer.sold ? 'sold' : String(offer.price), w / 2, h - 8);
  }

  function drawBeltSlot(ctx, w, h, potion) {
    ctx.clearRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.42, 0, Math.PI * 2);
    ctx.strokeStyle = potion ? EL_COLOR[potion.element] : 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 2.5;
    if (potion) { ctx.fillStyle = EL_COLOR[potion.element]; ctx.fill(); }
    ctx.stroke();
    if (potion && potion.count > 1) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 12px "Titan One", cursive';
      ctx.textAlign = 'center';
      ctx.fillText('x' + potion.count, w / 2, h / 2 + 4);
    }
  }

  // ---- fight rendering ------------------------------------------------------

  function drawFight() {
    const ctx = fightCtx, W = 390, H = 355;
    Art.sceneryB(ctx, W, H, state.t);
    ctx.fillStyle = '#5FA88E';
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    Art.frogSide(ctx, FROG_X, FROG_Y, FROG_S, C.skinLeaf, '#5B6CFF', C.gem, state.t, (state.casting || 0) > 0);
    for (const rat of state.rats) {
      if (rat.hp <= 0) continue;
      if (rat.isBoss) Art.boss(ctx, rat.x, FROG_Y, 150, 'Rat King', state.t, true);
      else Art.ratSide(ctx, rat.x, FROG_Y, 70, rat.kind, state.t, { burnT: 0, slowT: rat.slowT, poisT: 0 });
      const bw = 46;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(rat.x - bw / 2, FROG_Y - 165, bw, 6);
      ctx.fillStyle = '#4CFF6E';
      ctx.fillRect(rat.x - bw / 2, FROG_Y - 165, bw * clamp(rat.hp / rat.maxHp, 0, 1), 6);
    }
    for (const b of state.bolts) {
      if (b.t > 1) continue;
      const x = b.x + (b.tx - b.x) * b.t, y = b.y + (b.ty - b.y) * b.t;
      Art.bolt(ctx, x, y, 40, b.element || 'arcane', 0, state.t);
    }
    ctx.textAlign = 'center';
    for (const d of state.dmgNumbers) {
      ctx.globalAlpha = clamp(1 - d.t / 0.8, 0, 1);
      ctx.fillStyle = d.color;
      ctx.font = '700 16px "Titan One", cursive';
      ctx.fillText(d.text, d.x, d.y - d.t * 40);
    }
    ctx.globalAlpha = 1;
  }

  // ---- fx overlay: pour arc + cork pop --------------------------------------

  function drawFx() {
    fxCtx.clearRect(0, 0, 390, 844);
    if (state.pourAnim) {
      const a = state.pourAnim;
      const p = clamp(a.t / a.dur, 0, 1);
      const midX = (a.fromX + a.toX) / 2, midY = Math.min(a.fromY, a.toY) - 30;
      const x = (1 - p) * (1 - p) * a.fromX + 2 * (1 - p) * p * midX + p * p * a.toX;
      const y = (1 - p) * (1 - p) * a.fromY + 2 * (1 - p) * p * midY + p * p * a.toY;
      fxCtx.strokeStyle = EL_COLOR[a.color];
      fxCtx.lineWidth = 5;
      fxCtx.lineCap = 'round';
      fxCtx.beginPath();
      fxCtx.moveTo(a.fromX, a.fromY);
      fxCtx.quadraticCurveTo(midX, midY, x, y);
      fxCtx.stroke();
    }
    for (const c of state.corkAnims) {
      const p = clamp(c.t / c.dur, 0, 1);
      const rect = flaskCanvases[c.index] && flaskCanvases[c.index].getBoundingClientRect();
      if (!rect) continue;
      const phoneRect = document.getElementById('phone').getBoundingClientRect();
      const cx = rect.left + rect.width / 2 - phoneRect.left;
      const cy = rect.top - phoneRect.top - p * 60;
      fxCtx.globalAlpha = 1 - p;
      fxCtx.fillStyle = EL_COLOR[c.element];
      fxCtx.beginPath();
      fxCtx.arc(cx, cy, 12 + p * 6, 0, Math.PI * 2);
      fxCtx.fill();
      fxCtx.fillStyle = '#8A5A3A';
      fxCtx.fillRect(cx - 4, cy - 20 - p * 10, 8, 10);
      fxCtx.globalAlpha = 1;
    }
  }

  // ---- main render / loop -----------------------------------------------------

  function render() {
    const hi = state.lifted ? highlightFor(state.lifted) : null;
    state.flasks.forEach((f, i) => {
      const ctx = flaskCanvases[i].getContext('2d');
      const glow = hi ? hi[i] : (state.lifted && state.lifted.type === 'flask' && state.lifted.index === i ? 'lift' : null);
      const bounceT = state.bounces['flask' + i] || 0;
      const shakeT = state.bounces['shake' + i] || 0;
      drawFlaskCanvas(ctx, 56, 170, f, glow, bounceT, shakeT);
      flaskCanvases[i].style.transform = (state.lifted && state.lifted.type === 'flask' && state.lifted.index === i) ? 'translateY(-14px)' : '';
    });
    bottleCanvases.forEach((cv, i) => {
      const offer = state.offers[i];
      if (!offer) return;
      drawBottleCanvas(cv.getContext('2d'), 90, 130, offer);
      cv.style.transform = (state.lifted && state.lifted.type === 'bottle' && state.lifted.index === i) ? 'translateY(-10px)' : '';
      cv.style.opacity = offer.sold ? '0.25' : (state.gold >= offer.price ? '1' : '0.5');
    });
    const stats = beltStats();
    statDmg.textContent = 'DMG ' + Math.round(stats.dmg);
    statRate.textContent = 'RATE ' + stats.rate.toFixed(1) + '/s';
    const parts = [];
    if (stats.eff.burn > 0) parts.push('BURN +' + Math.round(stats.eff.burn * 100) + '%');
    if (stats.eff.slow > 0) parts.push('SLOW +' + Math.round(stats.eff.slow * 100) + '%');
    if (stats.eff.poison > 0) parts.push('POISON +' + Math.round(stats.eff.poison * 100) + '%');
    if (stats.eff.splash > 0) parts.push('SPLASH +' + Math.round(stats.eff.splash * 100) + '%');
    if (stats.eff.chain > 0) parts.push('CHAIN +' + Math.round(stats.eff.chain));
    if (stats.evo) parts.push(stats.evo.toUpperCase() + '!');
    statEffects.textContent = parts.join('  ');
    updateLockUI();
  }

  let lastT = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    updateFight(dt);
    for (const k of Object.keys(state.bounces)) { state.bounces[k] -= dt; if (state.bounces[k] <= 0) delete state.bounces[k]; }
    for (const d of state.dmgNumbers) d.t += dt;
    state.dmgNumbers = state.dmgNumbers.filter(d => d.t < 0.8);
    if (state.pourAnim) {
      state.pourAnim.t += dt;
      if (state.pourAnim.t >= state.pourAnim.dur) { const a = state.pourAnim; state.pourAnim = null; a.onDone(); render(); }
    }
    for (const c of state.corkAnims) c.t += dt;
    state.corkAnims = state.corkAnims.filter(c => c.t < c.dur);
    drawFight();
    drawFx();
    if (!state.pourAnim) {
      state.flasks.forEach((f, i) => {
        const bounceT = state.bounces['flask' + i] || 0;
        const shakeT = state.bounces['shake' + i] || 0;
        if (bounceT > 0 || shakeT > 0) {
          const hi = state.lifted ? highlightFor(state.lifted) : null;
          const glow = hi ? hi[i] : (state.lifted && state.lifted.type === 'flask' && state.lifted.index === i ? 'lift' : null);
          drawFlaskCanvas(flaskCanvases[i].getContext('2d'), 56, 170, f, glow, bounceT, shakeT);
        }
      });
    }
    requestAnimationFrame(loop);
  }

  // ---- boot ---------------------------------------------------------------------

  updateWaveUI();
  updateHpUI();
  renderShop();
  renderBelt();
  render();
  requestAnimationFrame(loop);

  // Read-only hook for test.js: the gate inspects this to confirm state changed after
  // real pointer taps. Nothing in test.js writes to it or calls into this closure.
  window.__ps = state;
})();
