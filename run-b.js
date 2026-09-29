/* Magic Frogs prototype, core B (Frog Stand): the run screen.
   Owns everything inside #run: the battlefield canvas (top 55%), the HUD, and the cauldron
   panel (bottom 45%) including the inline brew. ui.js never draws inside this screen; it only
   calls RunB.mount/start/pause/resume/stop and reacts to the hooks passed to start().
   Global: RunB. Depends on SimB (sim-b.js) and Art (art.js, drawing only, no state). */
(function (root) {
  'use strict';

  const FONT_NUM = '"Titan One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const FONT_TXT = '"Kreon", Georgia, serif';
  const COL = {
    ink: '#241B3A', panelDark: '#262A3D', panelRaised: '#34395A', gold: '#C9A34A',
    go: '#54D63A', goShade: '#2F9C1E', ad: '#B44DFF', adShade: '#7F24C9',
    buy: '#FFB020', buyShade: '#D98300', good: '#2F86FF', bad: '#FF4D63', coin: '#FFC93C',
  };

  let root_, canvas, ctx, els = {};
  let run = null, hooks = null, paused = false, rafId = 0, lastT = 0, acc = 0;
  let inputTarget = null, dragging = false;
  let bolts = [], pops = [], floaters = [];
  let seenSpells = new Set();
  let lastCoins = 0;
  let boltAcc = 0;
  let bossNameT = 0, bossNameStr = '';

  function has(name) { return typeof Art !== 'undefined' && typeof Art[name] === 'function'; }
  function call(name, args) { if (has(name)) Art[name].apply(Art, args); }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmt(n) {
    n = Math.round(n);
    if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString ? n.toLocaleString() : String(n);
  }

  function worldToScreen(x, y, W, H) {
    const sx = W * (0.04 + (x / 12) * 0.96);
    const t = clamp(y / 4, 0, 1);
    const sy = H * (0.55 - t * 0.25);
    const scale = 1 - t * 0.15;
    return { sx, sy, scale };
  }

  function button(label, bg, shade, onClick, extra) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText =
      'font-family:' + FONT_NUM + ';font-size:15px;color:#fff;background:' + bg +
      ';border:3px solid ' + COL.ink + ';border-radius:16px;box-shadow:0 5px 0 ' + COL.ink +
      ';padding:10px 14px;min-height:44px;cursor:pointer;-webkit-text-stroke:1px ' + COL.ink +
      ';paint-order:stroke fill;' + (extra || '');
    b.addEventListener('mousedown', () => { b.style.transform = 'translateY(3px)'; b.style.boxShadow = '0 2px 0 ' + COL.ink; });
    const reset = () => { b.style.transform = ''; b.style.boxShadow = '0 5px 0 ' + COL.ink; };
    b.addEventListener('mouseup', reset);
    b.addEventListener('mouseleave', reset);
    b.addEventListener('click', onClick);
    void shade;
    return b;
  }

  function mount(rootEl) {
    root_ = rootEl;
    root_.innerHTML = '';
    root_.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;overflow:hidden;background:#0E1522;';

    const field = document.createElement('div');
    field.style.cssText = 'position:relative;flex:0 0 55%;overflow:hidden;';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;';
    field.appendChild(canvas);

    const waveEl = div('rb-hud-wave', 'position:absolute;top:8px;left:50%;transform:translateX(-50%);' + hudChip());
    const coinsEl = div('rb-hud-coins', 'position:absolute;top:8px;right:8px;' + hudChip());
    const pauseEl = document.createElement('button');
    pauseEl.textContent = 'II';
    pauseEl.style.cssText = 'position:absolute;top:8px;left:8px;width:36px;height:36px;border-radius:12px;border:3px solid ' + COL.ink + ';background:' + COL.panelRaised + ';color:#fff;font-family:' + FONT_NUM + ';box-shadow:0 4px 0 ' + COL.ink + ';cursor:pointer;';
    pauseEl.addEventListener('click', () => { if (hooks && hooks.onEnd) { paused = true; hooks.onEnd(run); } });
    const bossBar = div('rb-boss-bar', 'position:absolute;top:48px;left:10%;right:10%;height:14px;border-radius:8px;border:3px solid ' + COL.ink + ';background:#3A2230;display:none;overflow:hidden;');
    const bossFill = document.createElement('div');
    bossFill.style.cssText = 'height:100%;width:100%;background:' + COL.bad + ';';
    bossBar.appendChild(bossFill);

    field.appendChild(waveEl); field.appendChild(coinsEl); field.appendChild(pauseEl); field.appendChild(bossBar);
    root_.appendChild(field);

    const cauldron = document.createElement('div');
    cauldron.style.cssText = 'position:relative;flex:1 1 45%;min-height:0;background:' + COL.panelDark + ';border-top:4px solid ' + COL.gold + ';display:flex;flex-direction:column;padding:8px;box-sizing:border-box;overflow:hidden;';

    const spellInfo = document.createElement('div');
    spellInfo.style.cssText = 'font-family:' + FONT_TXT + ';color:#fff;font-size:13px;margin-bottom:6px;';
    cauldron.appendChild(spellInfo);

    const brewRow = document.createElement('div');
    brewRow.style.cssText = 'display:none;flex-direction:column;gap:6px;flex:0 0 auto;';
    const offersRow = document.createElement('div');
    offersRow.style.cssText = 'display:flex;gap:8px;justify-content:center;';
    const offerCanvases = [0, 1, 2].map(() => {
      const c = document.createElement('canvas');
      c.width = 90; c.height = 120;
      c.style.cssText = 'width:80px;height:106px;cursor:pointer;';
      offersRow.appendChild(c);
      return c;
    });
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
    const rerollBtn = button('Reroll', COL.buy, COL.buyShade, onReroll);
    const skipBtn = button('Skip: +20 coins', COL.panelRaised, COL.panelRaised, onSkip);
    const playBtn = button('PLAY', COL.go, COL.goShade, onPlay);
    actionsRow.appendChild(rerollBtn); actionsRow.appendChild(skipBtn); actionsRow.appendChild(playBtn);
    brewRow.appendChild(offersRow); brewRow.appendChild(actionsRow);
    cauldron.appendChild(brewRow);

    const gridWrap = document.createElement('div');
    gridWrap.style.cssText = 'position:relative;display:flex;flex-wrap:wrap;gap:6px;width:100%;height:100%;justify-content:center;align-content:center;box-sizing:border-box;flex:1 1 auto;min-height:0;margin-top:8px;overflow:hidden;';
    const cells = [];
    for (let i = 0; i < 12; i++) {
      const cell = document.createElement('canvas');
      cell.width = 64; cell.height = 64;
      cell.style.cssText = 'display:block;flex:0 0 auto;aspect-ratio:1;background:' + COL.panelRaised + ';border:2px solid ' + COL.gold + ';border-radius:10px;cursor:pointer;';
      cell.addEventListener('click', () => onCellClick(i));
      gridWrap.appendChild(cell);
      cells.push(cell);
    }
    const lock = div('rb-lock', 'position:absolute;top:6px;right:6px;width:26px;height:26px;border-radius:50%;background:' + COL.panelRaised + ';border:2px solid ' + COL.gold + ';display:flex;align-items:center;justify-content:center;color:#fff;font-family:' + FONT_NUM + ';font-size:12px;');
    lock.textContent = 'L';
    cauldron.appendChild(gridWrap);
    cauldron.appendChild(lock);

    root_.appendChild(cauldron);

    els = { field, waveEl, coinsEl, pauseEl, bossBar, bossFill, cauldron, spellInfo, gridWrap, cells, lock, brewRow, offersRow, offerCanvases, actionsRow, rerollBtn, skipBtn, playBtn };
    ctx = null;
    resizeCanvas();
    layoutGrid();
    if (typeof window !== 'undefined') window.addEventListener('resize', applyLayout);
    bindInput();
  }

  function hudChip() {
    return 'background:' + COL.panelRaised + ';border:3px solid ' + COL.ink + ';border-radius:14px;box-shadow:0 4px 0 ' + COL.ink +
      ';padding:6px 12px;color:#fff;font-family:' + FONT_NUM + ';font-size:14px;-webkit-text-stroke:1px ' + COL.ink + ';paint-order:stroke fill;';
  }
  function div(cls, style) { const d = document.createElement('div'); d.className = cls; d.style.cssText = style; return d; }

  function resizeCanvas() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx = canvas.getContext('2d');
  }

  function applyLayout() {
    if (!els.field || !els.cauldron) return;
    const isBrew = !!run && run.state === 'brew';
    els.field.style.flex = isBrew ? '0 0 38%' : '0 0 55%';
    els.cauldron.style.flex = isBrew ? '1 1 62%' : '1 1 45%';
    resizeCanvas();
    layoutGrid();
  }

  function layoutGrid() {
    if (!els.gridWrap || !els.cells) return;
    const rect = els.gridWrap.getBoundingClientRect();
    const gap = 6, cols = 4, rows = 3;
    const availW = Math.max(0, rect.width - gap * (cols - 1));
    const availH = Math.max(0, rect.height - gap * (rows - 1));
    const size = Math.max(10, Math.floor(Math.min(availW / cols, availH / rows)));
    els.cells.forEach(c => { c.style.width = size + 'px'; c.style.height = size + 'px'; });
  }

  function bindInput() {
    if (!canvas) return;
    const toWorld = (clientX, clientY) => {
      const r = canvas.getBoundingClientRect();
      const px = (clientX - r.left) / r.width, py = (clientY - r.top) / r.height;
      const x = clamp(((px - 0.04) / 0.96) * 12, 0, 12);
      const t = clamp((1 - py) / (0.25 / 0.55), 0, 1);
      const y = t * 4;
      return { x, y };
    };
    canvas.addEventListener('pointerdown', e => { dragging = true; inputTarget = toWorld(e.clientX, e.clientY); });
    canvas.addEventListener('pointermove', e => { if (dragging) inputTarget = toWorld(e.clientX, e.clientY); });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('keydown', e => {
      if (!run || !inputTarget) return;
      const step = 0.15;
      if (e.key === 'ArrowUp') inputTarget.y = clamp(inputTarget.y - step, 0.3, 3.7);
      else if (e.key === 'ArrowDown') inputTarget.y = clamp(inputTarget.y + step, 0.3, 3.7);
      else if (e.key === 'ArrowLeft') inputTarget.x = clamp(inputTarget.x - step, 0.8, 3.0);
      else if (e.key === 'ArrowRight') inputTarget.x = clamp(inputTarget.x + step, 0.8, 3.0);
    });
  }

  function onCellClick(i) {
    if (!run || run.state !== 'brew') return;
    if (selected == null) { if (run.grid[i]) selected = i; }
    else if (selected === i) { selected = null; }
    else if (Sim.canMerge(run, selected, i)) { Sim.merge(run, selected, i); selected = null; maybeSpell(); }
    else if (run.grid[i]) { selected = i; }
    else { selected = null; }
    refreshGrid();
  }
  let selected = null;

  function maybeSpell() {
    const name = run.stats.spell;
    if (name && name !== 'Magic Missile' && !seenSpells.has(name)) {
      seenSpells.add(name);
      if (hooks && hooks.onSpell) hooks.onSpell(name);
    }
  }

  function onReroll() {
    if (!run || run.state !== 'brew') return;
    if (run.rerolls < 1) { Sim.reroll(run); refreshBrew(); }
    else if (typeof UI !== 'undefined' && UI.showAd) {
      UI.showAd('rewarded', 'a fresh set of offers', () => { Sim.reroll(run); refreshBrew(); });
    } else { Sim.reroll(run); refreshBrew(); }
  }
  function onSkip() {
    if (!run || run.state !== 'brew') return;
    run.coins += 20;
    if (hooks && hooks.onCoins) hooks.onCoins(run.coins);
    onPlay();
  }
  function onPlay() {
    if (!run || run.state !== 'brew') return;
    SimB.nextWave(run);
    selected = null;
    refreshAll();
    if (!paused) resume();
  }

  function refreshGrid() {
    if (!run) return;
    els.cells.forEach((c, i) => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const p = run.grid[i];
      const glow = selected != null && selected !== i && Sim.canMerge(run, selected, i);
      if (glow) { g.save(); g.fillStyle = COL.go; g.globalAlpha = 0.3; g.fillRect(0, 0, c.width, c.height); g.restore(); }
      if (i === selected) { g.save(); g.strokeStyle = COL.gold; g.lineWidth = 4; g.strokeRect(2, 2, c.width - 4, c.height - 4); g.restore(); }
      if (p) call('ingredient', [g, c.width / 2, c.height * 0.85, c.height * 0.7, p.type, p.tier]);
    });
    els.lock.style.display = run.state === 'brew' ? 'none' : 'flex';
  }

  function refreshBrew() {
    if (!run) return;
    const isBrew = run.state === 'brew';
    els.brewRow.style.display = isBrew ? 'flex' : 'none';
    applyLayout();
    if (!isBrew) return;
    (run.offers || []).forEach((o, i) => {
      const c = els.offerCanvases[i];
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const cw = c.width * 0.9, ch = c.height * 0.9;
      call('card', [g, (c.width - cw) / 2, (c.height - ch) / 2, cw, ch, o.type, o.tier]);
      c.onclick = () => { Sim.pick(run, i); selected = null; maybeSpell(); refreshAll(); };
    });
    els.rerollBtn.textContent = run.rerolls < 1 ? 'Reroll' : 'Reroll: watch an ad';
  }

  const ELEMENT_COLOR = {
    fire: '#FF7A2F', ice: '#6FE3FF', poison: '#8CFF3F', blast: '#C35CFF', storm: '#FFE14A',
    arcane: '#FF7BD5', nature: '#8FDB54',
  };

  function refreshSpellInfo() {
    if (!run) return;
    const s = run.stats;
    els.spellInfo.innerHTML = '';
    const nameEl = document.createElement('span');
    nameEl.textContent = s.spell || 'Magic Missile';
    els.spellInfo.appendChild(nameEl);
    const dotsRow = document.createElement('span');
    dotsRow.style.cssText = 'display:inline-flex;gap:4px;margin-left:8px;vertical-align:middle;';
    (s.elements || []).forEach(e => {
      const dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:50%;background:' +
        (ELEMENT_COLOR[e] || COL.gold) + ';border:1px solid ' + COL.ink + ';';
      dotsRow.appendChild(dot);
    });
    els.spellInfo.appendChild(dotsRow);
  }

  function refreshHud() {
    if (!run) return;
    els.waveEl.textContent = 'WAVE ' + run.wave + ' / 15';
    els.coinsEl.textContent = fmt(run.coins);
    const showBoss = run.state === 'boss' && run.boss;
    els.bossBar.style.display = showBoss ? 'block' : 'none';
    if (showBoss) els.bossFill.style.width = Math.max(0, run.boss.hp / run.boss.max * 100) + '%';
  }

  function refreshAll() { refreshGrid(); refreshBrew(); refreshSpellInfo(); refreshHud(); }

  function processEvents() {
    for (const e of run.events) {
      if (e.t === 'pop') pops.push({ x: e.x, y: e.y, t: 0 });
      else if (e.t === 'bite') floaters.push({ x: run.frog.x, y: run.frog.y, text: '-' + Math.round(e.v), t: 0, col: COL.bad });
      else if (e.t === 'recruit') floaters.push({ x: run.frog.x, y: run.frog.y, text: '+' + e.v + ' apprentice' + (e.v === 1 ? '' : 's'), t: 0, col: COL.good });
      else if (e.t === 'boss') { bossNameStr = e.name; bossNameT = 1.2; }
      else if (e.t === 'brew') { refreshAll(); }
      else if (e.t === 'dead') { if (hooks && hooks.onDead) { paused = true; hooks.onDead(run); } }
      else if (e.t === 'won') { if (hooks && hooks.onEnd) { paused = true; hooks.onEnd(run); } }
    }
    run.events.length = 0;
  }

  function step(dt) {
    if (!run) return;
    if (run.state !== 'run' && run.state !== 'boss') return;
    const before = run.coins;
    SimB.step(run, dt, inputTarget || { x: run.frog.x, y: run.frog.y });
    if (run.coins !== before && hooks && hooks.onCoins) hooks.onCoins(run.coins);
    processEvents();
    if (run.state === 'brew') refreshAll();
  }

  function drawScene(t) {
    if (!ctx || !canvas) return;
    const W = canvas.width, H = canvas.height;
    const Hs = H / 0.55;
    ctx.clearRect(0, 0, W, H);
    call('sceneryB', [ctx, W, Hs, t, 1]);
    if (!run) return;

    const entities = [];
    for (const r of run.rats) entities.push({ kind: 'rat', r, y: r.y });
    if (run.boss) entities.push({ kind: 'boss', r: run.boss, y: run.boss.y });
    for (const g of run.globs) entities.push({ kind: 'glob', r: g, y: g.y });
    entities.sort((a, b) => b.y - a.y);

    for (const e of entities) {
      if (e.kind === 'rat') {
        const p = worldToScreen(e.r.x, e.r.y, W, Hs);
        const s = H * 0.11 * p.scale;
        const status = { burnT: e.r.burnT, slowT: e.r.slowT, poisT: e.r.poisT, spitter: !!e.r.isSpitter };
        call('ratSide', [ctx, p.sx, p.sy, s, e.r.kind, t, status]);
        drawHpNumber(e.r, p.sx, p.sy - s * 1.1);
      } else if (e.kind === 'boss') {
        const p = worldToScreen(e.r.x, e.r.y, W, Hs);
        const s = H * 0.22 * p.scale;
        call('boss', [ctx, p.sx, p.sy, s, e.r.name, t, true]);
      } else if (e.kind === 'glob') {
        const p = worldToScreen(e.r.x, e.r.y, W, Hs);
        call('glob', [ctx, p.sx, p.sy, H * 0.03, t]);
      }
    }

    const fp = worldToScreen(run.frog.x, run.frog.y, W, Hs);
    const fs = H * 0.16;
    const skin = (typeof Art !== 'undefined' && Art.COLORS) ? Art.COLORS.skinLeaf : '#6DD35A';
    const skin2 = (typeof Art !== 'undefined' && Art.COLORS) ? Art.COLORS.skinLime : '#A8E04A';
    const hatCol = '#5B6CFF', gemCol = (typeof Art !== 'undefined' && Art.COLORS) ? Art.COLORS.gold : '#FFC23D';
    call('frogSide', [ctx, fp.sx, fp.sy, fs, skin, hatCol, gemCol, t, run.firing]);
    const rows = Math.min(run.apprentices, 12);
    for (let i = 0; i < rows; i++) {
      const row = i % 2, col = Math.floor(i / 2);
      const ax = fp.sx - fs * 0.5 - col * fs * 0.35;
      const ay = fp.sy - row * fs * 0.25;
      call('frogSide', [ctx, ax, ay, fs * 0.5, skin2, hatCol, gemCol, t, false]);
    }
    if (run.apprentices > 0) {
      ctx.save();
      ctx.font = '600 ' + Math.round(H * 0.03) + 'px ' + FONT_NUM;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 3; ctx.textAlign = 'center';
      const bx = fp.sx - fs * 0.7, by = fp.sy - fs * 1.15;
      ctx.strokeText(String(run.apprentices), bx, by);
      ctx.fillText(String(run.apprentices), bx, by);
      ctx.restore();
    }

    ctx.save();
    const barW = fs * 1.4, barH = H * 0.03, barX = fp.sx - barW / 2, barY = fp.sy - fs * 1.35;
    ctx.fillStyle = '#3A2230'; ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = COL.go; ctx.fillRect(barX, barY, barW * clamp(run.frog.hp / run.frog.maxHp, 0, 1), barH);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 3; ctx.strokeRect(barX, barY, barW, barH);
    ctx.font = '600 ' + Math.round(barH * 0.8) + 'px ' + FONT_NUM;
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.round(run.frog.hp) + ' / ' + run.frog.maxHp, barX + barW / 2, barY + barH / 2);
    ctx.restore();

    boltAcc += 1 / 60;
    if (run.firing && boltAcc > 0.1) {
      boltAcc = 0;
      const els2 = run.stats.elements && run.stats.elements.length ? run.stats.elements : [null];
      bolts.push({ x: fp.sx, y: fp.sy - fs * 0.6, tx: fp.sx + H * 0.3, ty: fp.sy - fs * 0.6, el: els2[Math.floor(Math.random() * els2.length)], t: 0 });
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i]; b.t += 1 / 60;
      call('bolt', [ctx, b.x + (b.tx - b.x) * Math.min(1, b.t / 0.18), b.y, H * 0.02, b.el, 0, t]);
      if (b.t > 0.18) bolts.splice(i, 1);
    }

    for (let i = pops.length - 1; i >= 0; i--) {
      const p = pops[i]; p.t += 1 / 60;
      const wp = worldToScreen(p.x, p.y, W, Hs);
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - p.t / 0.3); ctx.fillStyle = '#C9C0E8';
      ctx.beginPath(); ctx.arc(wp.sx, wp.sy - 10, 8 + p.t * 20, 0, Math.PI * 2); ctx.fill(); ctx.restore();
      if (p.t > 0.3) pops.splice(i, 1);
    }
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]; f.t += 1 / 60;
      const wp = worldToScreen(f.x, f.y, W, Hs);
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - f.t / 1); ctx.fillStyle = f.col;
      ctx.font = '600 16px ' + FONT_NUM; ctx.textAlign = 'center';
      ctx.fillText(f.text, wp.sx, wp.sy - 30 - f.t * 20); ctx.restore();
      if (f.t > 1) floaters.splice(i, 1);
    }
    if (run.chainFx) {
      ctx.save(); ctx.strokeStyle = COL.coin; ctx.lineWidth = 3;
      ctx.beginPath();
      const a = worldToScreen(run.chainFx.from.x, run.chainFx.from.y, W, Hs);
      ctx.moveTo(a.sx, a.sy);
      for (const to of run.chainFx.to) { const bpt = worldToScreen(to.x, to.y, W, Hs); ctx.lineTo(bpt.sx, bpt.sy); }
      ctx.stroke(); ctx.restore();
      run.chainFx = null;
    }
    if (bossNameT > 0) {
      bossNameT -= 1 / 60;
      ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 4;
      ctx.font = '700 ' + Math.round(H * 0.06) + 'px ' + FONT_NUM; ctx.textAlign = 'center';
      ctx.strokeText(bossNameStr, W / 2, H * 0.15); ctx.fillText(bossNameStr, W / 2, H * 0.15);
      ctx.restore();
    }
  }

  function drawHpNumber(r, sx, sy) {
    ctx.save();
    ctx.font = '600 14px ' + FONT_NUM;
    ctx.fillStyle = '#fff'; ctx.strokeStyle = COL.ink; ctx.lineWidth = 3; ctx.textAlign = 'center';
    const txt = String(Math.max(0, Math.round(r.hp)));
    ctx.strokeText(txt, sx, sy);
    ctx.fillText(txt, sx, sy);
    ctx.restore();
  }

  function loop(now) {
    if (paused) return;
    if (!lastT) lastT = now;
    let dt = (now - lastT) / 1000;
    lastT = now;
    if (dt > 0.1) dt = 0.1;
    acc += dt;
    while (acc >= 1 / 60) { step(1 / 60); acc -= 1 / 60; }
    drawScene(now / 1000);
    refreshHud();
    rafId = requestAnimationFrame(loop);
  }

  function start(runArg, hooksArg) {
    run = runArg; hooks = hooksArg || {};
    paused = false; lastT = 0; acc = 0;
    bolts = []; pops = []; floaters = []; seenSpells = new Set(); selected = null;
    lastCoins = run.coins;
    inputTarget = { x: run.frog.x, y: run.frog.y };
    resizeCanvas();
    refreshAll();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  function pause() { paused = true; if (rafId) cancelAnimationFrame(rafId); rafId = 0; }
  function resume() { if (paused) { paused = false; lastT = 0; rafId = requestAnimationFrame(loop); } }
  function stop() {
    paused = true;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0; run = null; hooks = null;
  }

  function renderStill(canvasArg, runArg, t) {
    const savedCanvas = canvas, savedCtx = ctx, savedRun = run;
    canvas = canvasArg; ctx = canvasArg.getContext('2d'); run = runArg;
    drawScene(t || 0);
    canvas = savedCanvas; ctx = savedCtx; run = savedRun;
  }

  function startAttract(canvasArg) {
    const attractRun = SimB.createRun({ seed: 7 });
    let stopped = false;
    let tAcc = 0;
    function tick() {
      if (stopped) return;
      for (let i = 0; i < 2; i++) {
        if (attractRun.state === 'run' || attractRun.state === 'boss') {
          SimB.step(attractRun, 1 / 60, SimB.autopilot(attractRun));
          attractRun.events.length = 0;
        } else if (attractRun.state === 'brew') {
          Sim.botBrew(attractRun);
          SimB.nextWave(attractRun);
        } else {
          const fresh = SimB.createRun({ seed: 7 });
          Object.assign(attractRun, fresh);
        }
      }
      tAcc += 1 / 30;
      renderStill(canvasArg, attractRun, tAcc);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    return { stop() { stopped = true; } };
  }

  function fastForward(r, steps, policy) {
    for (let i = 0; i < steps; i++) {
      if (r.state === 'run' || r.state === 'boss') {
        const target = policy === 'careless' ? { x: r.frog.x, y: r.frog.y } : SimB.autopilot(r);
        SimB.step(r, 1 / 60, target);
        r.events.length = 0;
      } else if (r.state === 'brew') {
        Sim.botBrew(r);
        SimB.nextWave(r);
      } else break;
    }
    return r;
  }

  function shot(token) {
    let r;
    if (token === 'b-run-w1') {
      r = SimB.createRun({ seed: 1 });
      fastForward(r, 3 * 60, 'smart');
    } else if (token === 'b-run-w6') {
      r = SimB.createRun({ seed: 1 });
      while (r.wave < 6 && r.state !== 'dead') fastForward(r, 600, 'smart');
      fastForward(r, 5 * 60, 'smart');
    } else if (token === 'b-run-w12') {
      r = SimB.createRun({ seed: 1 });
      let guard = 0;
      while (r.wave < 12 && r.state !== 'won' && guard < 200) { fastForward(r, 600, 'smart'); guard++; if (r.state === 'dead') SimB.revive(r); }
      r.apprentices = 12; r.peak = Math.max(r.peak, 12);
      r.grid = [
        { type: 'ember', tier: 4 }, { type: 'blast', tier: 4 }, { type: 'moon', tier: 3 },
        { type: 'quick', tier: 3 }, { type: 'storm', tier: 3 }, { type: 'shade', tier: 2 },
        null, null, null, null, null, null,
      ];
      SimB.recalc ? SimB.recalc(r) : (r.stats = Sim.brew(r.grid));
      fastForward(r, 3 * 60, 'smart');
    } else if (token === 'b-boss') {
      r = SimB.createRun({ seed: 1 });
      let guard = 0;
      while (!(r.wave === 5 && r.boss) && r.state !== 'dead' && guard < 3000) { fastForward(r, 60, 'smart'); guard++; }
      if (r.boss) r.boss.hp = r.boss.max / 2;
    } else if (token === 'b-brew') {
      r = SimB.createRun({ seed: 1 });
      let guard = 0;
      while ((r.state === 'run' || r.state === 'boss') && guard < 7200) {
        SimB.step(r, 1 / 60, SimB.autopilot(r));
        r.events.length = 0;
        guard++;
      }
    } else if (token === 'b-revive') {
      r = SimB.createRun({ seed: 1 });
      let guard = 0;
      while (r.state !== 'dead' && guard < 6000) { fastForward(r, 60, 'careless'); guard++; }
    } else {
      r = SimB.createRun({ seed: 1 });
    }
    run = r;
    resizeCanvas();
    refreshAll();
    drawScene(2);
    const finish = () => { if (typeof window !== 'undefined') window.__shotReady = true; };
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(finish);
    else finish();
    return r;
  }

  root.RunB = { mount, start, pause, resume, stop, renderStill, startAttract, shot };
})(typeof window !== 'undefined' ? window : globalThis);
