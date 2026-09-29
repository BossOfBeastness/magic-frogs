/* Magic Frogs prototype, core B (Frog Stand): the run screen, new run model
   ("Changes after version 1", 2026-09-29 evening). Owns everything inside #run: the
   battlefield canvas (top 55%), the HUD, the fight-time spell/pot panel (bottom 45%),
   and the Magic Book overlay that opens between waves. ui.js never draws inside this
   screen; it only calls RunB.mount/start/pause/resume/stop and reacts to the hooks
   passed to start(). Global: RunB. Depends on SimB (sim-b.js), Meta (meta.js) and
   Art (art.js, drawing only, no state). */
(function (root) {
  'use strict';

  const FONT_NUM = '"Titan One", "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  const FONT_TXT = '"Kreon", Georgia, serif';
  const COL = {
    ink: '#241B3A', panelDark: '#262A3D', panelRaised: '#34395A', gold: '#C9A34A',
    go: '#54D63A', goShade: '#2F9C1E', ad: '#B44DFF', adShade: '#7F24C9',
    buy: '#FFB020', buyShade: '#D98300', good: '#2F86FF', bad: '#FF4D63', coin: '#FFC93C',
    parchment: '#EAD9B0', leather: '#5A3E2B', goldTrim: '#C9A34A',
  };
  const TIER_COLORS = [null, '#D8DCE8', '#6EE06A', '#4FA8FF', '#B266FF', '#FFC23D'];
  const ELEMENT_COLOR = {
    fire: '#FF7A2F', ice: '#6FE3FF', poison: '#8CFF3F', blast: '#C35CFF', storm: '#FFE14A',
    arcane: '#FF7BD5', nature: '#8FDB54',
  };

  let root_, canvas, ctx, panelCanvas, panelCtx, els = {};
  let run = null, hooks = null, paused = false, rafId = 0, lastT = 0, acc = 0;
  let inputTarget = null, dragging = false;
  let bolts = [], pops = [], floaters = [];
  let boltAcc = 0;
  let bossNameT = 0, bossNameStr = '';
  let bookShown = false, offerTaken = false, potSelected = null;
  let instantUI = false;   // true while a still shot is being rendered: skip the open/close animation

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
      'font-family:' + FONT_NUM + ';font-size:14px;color:#fff;background:' + bg +
      ';border:3px solid ' + COL.ink + ';border-radius:14px;box-shadow:0 5px 0 ' + COL.ink +
      ';padding:8px 10px;min-height:40px;cursor:pointer;-webkit-text-stroke:1px ' + COL.ink +
      ';paint-order:stroke fill;' + (extra || '');
    b.addEventListener('pointerdown', () => { b.style.transform = 'translateY(3px)'; b.style.boxShadow = '0 2px 0 ' + COL.ink; });
    const reset = () => { b.style.transform = ''; b.style.boxShadow = '0 5px 0 ' + COL.ink; };
    b.addEventListener('pointerup', reset);
    b.addEventListener('pointerleave', reset);
    b.addEventListener('pointerup', onClick);
    void shade;
    return b;
  }

  function div(cls, style) { const d = document.createElement('div'); d.className = cls; d.style.cssText = style; return d; }

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
    pauseEl.addEventListener('pointerup', () => { if (hooks && hooks.onEnd) { paused = true; hooks.onEnd(run); } });
    const bossBar = div('rb-boss-bar', 'position:absolute;top:48px;left:10%;right:10%;height:14px;border-radius:8px;border:3px solid ' + COL.ink + ';background:#3A2230;display:none;overflow:hidden;');
    const bossFill = document.createElement('div');
    bossFill.style.cssText = 'height:100%;width:100%;background:' + COL.bad + ';';
    bossBar.appendChild(bossFill);

    field.appendChild(waveEl); field.appendChild(coinsEl); field.appendChild(pauseEl); field.appendChild(bossBar);
    root_.appendChild(field);

    const panelWrap = document.createElement('div');
    panelWrap.style.cssText = 'position:relative;flex:1 1 45%;min-height:0;background:' + COL.panelDark + ';border-top:4px solid ' + COL.gold + ';';
    panelCanvas = document.createElement('canvas');
    panelCanvas.style.cssText = 'width:100%;height:100%;display:block;';
    panelWrap.appendChild(panelCanvas);
    root_.appendChild(panelWrap);

    buildBook();
    root_.appendChild(els.book);

    els = Object.assign(els, { field, waveEl, coinsEl, pauseEl, bossBar, bossFill, panelWrap });
    ctx = null; panelCtx = null;
    resizeCanvas();
    if (typeof window !== 'undefined') window.addEventListener('resize', resizeCanvas);
    bindInput();
  }

  function hudChip() {
    return 'background:' + COL.panelRaised + ';border:3px solid ' + COL.ink + ';border-radius:14px;box-shadow:0 4px 0 ' + COL.ink +
      ';padding:6px 12px;color:#fff;font-family:' + FONT_NUM + ';font-size:14px;-webkit-text-stroke:1px ' + COL.ink + ';paint-order:stroke fill;';
  }

  // ---- the Magic Book -----------------------------------------------------

  function buildBook() {
    const book = document.createElement('div');
    book.id = 'rb-book';
    book.dataset.open = 'false';
    book.style.cssText = 'position:absolute;inset:0;display:none;flex-direction:column;gap:1.5%;padding:3% 3%;box-sizing:border-box;perspective:900px;z-index:5;background:rgba(14,21,34,0.86);';

    const left = document.createElement('div');
    left.className = 'rb-page-left';
    left.style.cssText = pageStyle('right');
    const right = document.createElement('div');
    right.className = 'rb-page-right';
    right.style.cssText = pageStyle('left');

    // left page: 4 spell rows, then the pot.
    const spellRows = [];
    const spellCol = document.createElement('div');
    spellCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;overflow:hidden;flex:1 1 auto;min-height:0;';
    for (let i = 0; i < Meta.MAX_SPELLS; i++) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(90,62,43,0.12);border-radius:10px;padding:3px;flex:1 1 0;min-height:0;';
      const icon = document.createElement('canvas'); icon.width = 64; icon.height = 64;
      icon.style.cssText = 'width:34px;height:34px;flex:0 0 auto;';
      const name = document.createElement('div');
      name.style.cssText = 'flex:1 1 auto;font-family:' + FONT_TXT + ';font-size:10px;color:' + COL.ink + ';min-width:0;overflow:hidden;';
      const ing0 = document.createElement('canvas'); ing0.width = 48; ing0.height = 48;
      ing0.className = 'rb-ing-slot';
      ing0.style.cssText = 'width:26px;height:26px;flex:0 0 auto;border:2px dashed ' + COL.gold + ';border-radius:6px;cursor:pointer;';
      const ing1 = document.createElement('canvas'); ing1.width = 48; ing1.height = 48;
      ing1.className = 'rb-ing-slot';
      ing1.style.cssText = ing0.style.cssText;
      const si = i;
      ing0.addEventListener('pointerup', () => onIngSlotTap(si, 0));
      ing1.addEventListener('pointerup', () => onIngSlotTap(si, 1));
      row.appendChild(icon); row.appendChild(name); row.appendChild(ing0); row.appendChild(ing1);
      spellCol.appendChild(row);
      spellRows.push({ row, icon, name, ing0, ing1 });
    }

    const potRow = document.createElement('div');
    potRow.style.cssText = 'display:flex;gap:4px;justify-content:center;padding:4px 0;flex:0 0 auto;';
    const potCells = [];
    for (let i = 0; i < Meta.POT_SLOTS; i++) {
      const c = document.createElement('canvas'); c.width = 56; c.height = 56;
      c.className = 'rb-pot-slot';
      c.style.cssText = 'width:30px;height:30px;border:2px solid ' + COL.gold + ';border-radius:8px;cursor:pointer;background:rgba(90,62,43,0.08);';
      const pi = i;
      c.addEventListener('pointerup', () => onPotTap(pi));
      potRow.appendChild(c);
      potCells.push(c);
    }
    const binBtn = button('Discard', COL.panelRaised, COL.panelRaised, onBinTap, 'font-size:11px;padding:5px 8px;min-height:0;');
    potRow.appendChild(binBtn);

    left.appendChild(spellCol);
    left.appendChild(potRow);

    // right page: 3 offer cards, then the buttons.
    const offersRow = document.createElement('div');
    offersRow.style.cssText = 'display:flex;gap:6px;justify-content:center;flex:1 1 auto;min-height:0;align-items:center;';
    const offerCanvases = [];
    for (let i = 0; i < 3; i++) {
      const c = document.createElement('canvas'); c.width = 100; c.height = 140;
      c.className = 'rb-offer-card';
      c.style.cssText = 'width:31%;max-width:124px;height:auto;aspect-ratio:100/140;cursor:pointer;';
      const oi = i;
      c.addEventListener('pointerup', () => onOfferTap(oi));
      offersRow.appendChild(c);
      offerCanvases.push(c);
    }
    const actionsRow = document.createElement('div');
    actionsRow.style.cssText = 'display:flex;gap:6px;justify-content:center;flex-wrap:wrap;flex:0 0 auto;padding-top:6px;';
    const rerollBtn = button('Reroll', COL.buy, COL.buyShade, onReroll);
    const skipBtn = button('Skip: +20 coins', COL.panelRaised, COL.panelRaised, onSkip);
    const closeBtn = button('Close book', COL.go, COL.goShade, onCloseBook, 'font-size:17px;min-width:60%;');
    actionsRow.appendChild(rerollBtn); actionsRow.appendChild(skipBtn); actionsRow.appendChild(closeBtn);

    right.appendChild(offersRow);
    right.appendChild(actionsRow);

    // Portrait phone: the book opens top and bottom, offers on the top page, the frog's spells below.
    book.appendChild(right); book.appendChild(left);

    els.book = book; els.bookLeft = left; els.bookRight = right;
    els.spellRows = spellRows; els.potCells = potCells; els.binBtn = binBtn;
    els.offerCanvases = offerCanvases; els.rerollBtn = rerollBtn; els.skipBtn = skipBtn; els.closeBtn = closeBtn;
  }

  function pageStyle(spineSide) {
    return 'flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:4px;background:' + COL.parchment +
      ';border:6px solid ' + COL.leather + ';border-radius:10px;box-shadow:inset 0 0 0 3px ' + COL.goldTrim +
      ';padding:6px;box-sizing:border-box;transform-origin:' + spineSide + ' center;will-change:transform;';
  }

  function bookSetTransform(instant, open) {
    const t = instant ? 'none' : 'transform 0.3s ease';
    els.bookLeft.style.transition = t;
    els.bookRight.style.transition = t;
    els.bookLeft.style.transform = open ? 'rotateY(0deg)' : 'rotateY(-92deg)';
    els.bookRight.style.transform = open ? 'rotateY(0deg)' : 'rotateY(92deg)';
  }

  function showBook(instant) {
    els.book.style.display = 'flex';
    els.book.dataset.open = 'false';
    bookSetTransform(true, false);
    if (instant) {
      void els.book.offsetWidth;
      bookSetTransform(true, true);
      els.book.dataset.open = 'true';
    } else {
      requestAnimationFrame(() => {
        bookSetTransform(false, true);
        setTimeout(() => { if (els.book) els.book.dataset.open = 'true'; }, 320);
      });
    }
  }

  function hideBook(instant, after) {
    if (instant) {
      els.book.style.display = 'none';
      els.book.dataset.open = 'false';
      if (after) after();
      return;
    }
    bookSetTransform(false, false);
    els.book.dataset.open = 'false';
    setTimeout(() => {
      if (els.book) els.book.style.display = 'none';
      if (after) after();
    }, 320);
  }

  function onOfferTap(i) {
    if (!run || run.state !== 'brew' || offerTaken) return;
    if (SimB.takeOffer(run, i)) {
      offerTaken = true;
      maybeSpellFound();
      refreshBookLeft();
      refreshBookOffers();
    }
  }

  function onPotTap(i) {
    if (!run || run.state !== 'brew') return;
    const p = run.pot[i];
    if (potSelected == null) { if (p) potSelected = i; }
    else if (potSelected === i) { potSelected = null; }
    else if (p && SimB.canMergePot(run, potSelected, i)) { SimB.mergePot(run, potSelected, i); potSelected = null; }
    else if (p) { potSelected = i; }
    else { potSelected = null; }
    refreshBookLeft();
  }

  function onIngSlotTap(spellIndex, slot) {
    if (!run || run.state !== 'brew' || potSelected == null) return;
    if (!run.spells[spellIndex]) return;
    SimB.applyIngredient(run, potSelected, spellIndex, slot);
    potSelected = null;
    refreshBookLeft();
  }

  function onBinTap() {
    if (!run || run.state !== 'brew' || potSelected == null) return;
    SimB.discardPot(run, potSelected);
    potSelected = null;
    refreshBookLeft();
  }

  function onReroll() {
    if (!run || run.state !== 'brew') return;
    if (run.rerolls < 1) { SimB.reroll(run); offerTaken = false; refreshBookOffers(); }
    else if (typeof UI !== 'undefined' && UI.showAd) {
      UI.showAd('rewarded', 'a fresh set of offers', () => { SimB.reroll(run); offerTaken = false; refreshBookOffers(); });
    } else { SimB.reroll(run); offerTaken = false; refreshBookOffers(); }
  }

  function onSkip() {
    if (!run || run.state !== 'brew') return;
    run.coins += 20;
    if (hooks && hooks.onCoins) hooks.onCoins(run.coins);
    onCloseBook();
  }

  function onCloseBook() {
    if (!run || run.state !== 'brew') return;
    hideBook(instantUI, () => {
      SimB.nextWave(run);
      potSelected = null; offerTaken = false;
      refreshHud();
      if (!paused) resume();
    });
  }

  function maybeSpellFound() {
    for (const e of run.events) {
      if (e.t === 'spellfound' && hooks && hooks.onSpell) hooks.onSpell(Meta.SPELLS[e.spellType].name);
    }
    run.events.length = 0;
  }

  function refreshBookOffers() {
    if (!run) return;
    (run.offers || []).forEach((o, i) => {
      const c = els.offerCanvases[i];
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      if (o.kind === 'ing') call('card', [g, c.width * 0.05, c.height * 0.05, c.width * 0.9, c.height * 0.9, o.type, o.tier]);
      else spellCard(g, c.width * 0.05, c.height * 0.05, c.width * 0.9, c.height * 0.9, o.type, o.tier);
      c.style.opacity = offerTaken ? '0.4' : '1';
    });
    els.rerollBtn.textContent = run.rerolls < 1 ? 'Reroll' : 'Reroll: watch an ad';
  }

  function refreshBookLeft() {
    if (!run) return;
    els.spellRows.forEach((r, i) => {
      const s = run.spells[i];
      const gi = r.icon.getContext('2d');
      gi.clearRect(0, 0, r.icon.width, r.icon.height);
      if (s) {
        const def = Meta.SPELLS[s.type];
        call('bolt', [gi, r.icon.width / 2, r.icon.height / 2, r.icon.width * 0.42, def.element, -Math.PI / 2, 0]);
        r.name.innerHTML = def.name + '<br>' + pipsHtml(s.tier);
        r.row.style.opacity = '1';
      } else {
        r.name.textContent = 'Empty page';
        r.row.style.opacity = '0.5';
      }
      [r.ing0, r.ing1].forEach((slotC, slotIdx) => {
        const g = slotC.getContext('2d');
        g.clearRect(0, 0, slotC.width, slotC.height);
        const ing = s ? s.ings[slotIdx] : null;
        if (ing) call('ingredient', [g, slotC.width / 2, slotC.height / 2, slotC.width * 0.85, ing.type, ing.tier]);
      });
    });
    els.potCells.forEach((c, i) => {
      const g = c.getContext('2d');
      g.clearRect(0, 0, c.width, c.height);
      const p = run.pot[i];
      if (p) call('ingredient', [g, c.width / 2, c.height / 2, c.width * 0.85, p.type, p.tier]);
      c.style.boxShadow = potSelected === i ? '0 0 0 3px ' + COL.gold + ' inset' : 'none';
    });
  }

  function pipsHtml(tier) {
    const color = TIER_COLORS[tier] || TIER_COLORS[1];
    let out = '';
    for (let i = 0; i < tier; i++) {
      out += '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + color +
        ';border:1px solid ' + COL.ink + ';margin-right:2px;"></span>';
    }
    return out;
  }

  // A Slay the Spire style card for a held or offered spell: element-coloured frame,
  // the spell's own bolt as the art, its name and tier. art.js has no spell card.
  function spellCard(ctx2, x, y, w, h, type, tier) {
    const def = Meta.SPELLS[type];
    const frameColor = ELEMENT_COLOR[def.element] || COL.gold;
    const r = Math.min(w, h) * 0.06;
    ctx2.save();
    roundRectPath(ctx2, x, y, w, h, r);
    ctx2.fillStyle = darken(frameColor);
    ctx2.fill();
    ctx2.lineWidth = Math.max(1.5, w / 26);
    ctx2.strokeStyle = COL.ink;
    ctx2.stroke();
    const pad = w * 0.08, artH = h * 0.5;
    ctx2.fillStyle = '#2E3A5C';
    ctx2.fillRect(x + pad, y + pad, w - pad * 2, artH);
    ctx2.strokeRect(x + pad, y + pad, w - pad * 2, artH);
    ctx2.save();
    ctx2.beginPath(); ctx2.rect(x + pad, y + pad, w - pad * 2, artH); ctx2.clip();
    call('bolt', [ctx2, x + w / 2, y + pad + artH * 0.55, artH * 0.55, def.element, -Math.PI / 2, 0]);
    ctx2.restore();
    const bannerY = y + pad + artH - h * 0.05;
    ctx2.fillStyle = frameColor;
    ctx2.fillRect(x + pad * 0.6, bannerY, w - pad * 1.2, h * 0.09);
    ctx2.strokeRect(x + pad * 0.6, bannerY, w - pad * 1.2, h * 0.09);
    ctx2.fillStyle = COL.ink;
    ctx2.font = '700 ' + Math.round(h * 0.055) + 'px ' + FONT_TXT;
    ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
    ctx2.fillText(def.name, x + w / 2, bannerY + h * 0.045);
    const gx = x + w * 0.14, gy = y + h * 0.10;
    ctx2.fillStyle = TIER_COLORS[tier] || TIER_COLORS[1];
    ctx2.beginPath();
    ctx2.moveTo(gx, gy - w * 0.07); ctx2.lineTo(gx + w * 0.07, gy); ctx2.lineTo(gx, gy + w * 0.07); ctx2.lineTo(gx - w * 0.07, gy);
    ctx2.closePath(); ctx2.fill(); ctx2.lineWidth = 1.5; ctx2.stroke();
    ctx2.fillStyle = COL.ink;
    ctx2.font = '400 ' + Math.round(w * 0.09) + 'px "Titan One", cursive';
    ctx2.fillText(String(tier), gx, gy + w * 0.01);
    const boxY = y + pad + artH + h * 0.11, boxH = h - (boxY - y) - pad * 0.6;
    ctx2.fillStyle = COL.parchment;
    ctx2.fillRect(x + pad * 0.6, boxY, w - pad * 1.2, boxH);
    ctx2.strokeRect(x + pad * 0.6, boxY, w - pad * 1.2, boxH);
    ctx2.fillStyle = COL.ink;
    ctx2.font = '400 ' + Math.round(h * 0.045) + 'px ' + FONT_TXT;
    ctx2.fillText(def.text || '', x + w / 2, boxY + boxH * 0.5);
    ctx2.restore();
  }

  function roundRectPath(ctx2, x, y, w, h, r) {
    ctx2.beginPath();
    ctx2.moveTo(x + r, y);
    ctx2.arcTo(x + w, y, x + w, y + h, r);
    ctx2.arcTo(x + w, y + h, x, y + h, r);
    ctx2.arcTo(x, y + h, x, y, r);
    ctx2.arcTo(x, y, x + w, y, r);
    ctx2.closePath();
  }

  function darken(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    const f = v => Math.max(0, Math.round(v * 0.55));
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }

  function refreshBook() {
    if (!run) return;
    const isBrew = run.state === 'brew';
    if (isBrew && !bookShown) {
      bookShown = true; offerTaken = false; potSelected = null;
      refreshBookOffers(); refreshBookLeft();
      showBook(instantUI);
    } else if (!isBrew && bookShown) {
      bookShown = false;
    } else if (isBrew) {
      refreshBookOffers(); refreshBookLeft();
    }
  }

  // ---- fight-time HUD -------------------------------------------------------

  function resizeCanvas() {
    if (!canvas) return;
    const r = canvas.parentElement.getBoundingClientRect();
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ctx = canvas.getContext('2d');
    if (panelCanvas) {
      const pr = panelCanvas.parentElement.getBoundingClientRect();
      panelCanvas.width = Math.max(1, Math.round(pr.width * dpr));
      panelCanvas.height = Math.max(1, Math.round(pr.height * dpr));
      panelCtx = panelCanvas.getContext('2d');
    }
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

  function refreshHud() {
    if (!run) return;
    els.waveEl.textContent = 'WAVE ' + run.wave + ' / 15';
    els.coinsEl.textContent = fmt(run.coins);
    const showBoss = run.state === 'boss' && run.boss;
    els.bossBar.style.display = showBoss ? 'block' : 'none';
    if (showBoss) els.bossFill.style.width = Math.max(0, run.boss.hp / run.boss.max * 100) + '%';
  }

  function refreshAll() { refreshHud(); refreshBook(); }

  function processEvents() {
    for (const e of run.events) {
      if (e.t === 'pop') pops.push({ x: e.x, y: e.y, t: 0 });
      else if (e.t === 'bite') floaters.push({ x: run.frog.x, y: run.frog.y, text: '-' + Math.round(e.v), t: 0, col: COL.bad });
      else if (e.t === 'boss') { bossNameStr = e.name; bossNameT = 1.2; }
      else if (e.t === 'spellfound') { if (hooks && hooks.onSpell) hooks.onSpell(Meta.SPELLS[e.spellType].name); }
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
    const hatCol = '#5B6CFF', gemCol = (typeof Art !== 'undefined' && Art.COLORS) ? Art.COLORS.gold : '#FFC23D';
    call('frogSide', [ctx, fp.sx, fp.sy, fs, skin, hatCol, gemCol, t, run.firing]);

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
      const held = run.spells.filter(Boolean);
      const s = held.length ? held[Math.floor(Math.random() * held.length)] : null;
      const el = s ? Meta.SPELLS[s.type].element : 'arcane';
      bolts.push({ x: fp.sx, y: fp.sy - fs * 0.6, tx: fp.sx + H * 0.3, ty: fp.sy - fs * 0.6, el, t: 0 });
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

  // The fight-time panel: the 4 held spells (drawing, name, tier pips, cooldown ring)
  // and the pot underneath, purely for display; the book is where they are edited.
  function drawPanel() {
    if (!panelCtx || !panelCanvas || !run) return;
    const W = panelCanvas.width, H = panelCanvas.height;
    panelCtx.clearRect(0, 0, W, H);
    const n = Meta.MAX_SPELLS, cellW = W / n, cy = H * 0.32, s = Math.min(cellW, H * 0.6) * 0.75;
    for (let i = 0; i < n; i++) {
      const spell = run.spells[i];
      const cx = cellW * (i + 0.5);
      panelCtx.save();
      panelCtx.fillStyle = COL.panelRaised;
      panelCtx.beginPath(); panelCtx.arc(cx, cy, s * 0.62, 0, Math.PI * 2); panelCtx.fill();
      if (spell) {
        const def = Meta.SPELLS[spell.type];
        const frac = spell.cdMax > 0 ? clamp(1 - spell.timer / spell.cdMax, 0, 1) : 1;
        panelCtx.strokeStyle = COL.gold; panelCtx.lineWidth = Math.max(2, s * 0.08);
        panelCtx.beginPath(); panelCtx.arc(cx, cy, s * 0.7, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); panelCtx.stroke();
        call('bolt', [panelCtx, cx, cy, s * 0.85, def.element, -Math.PI / 2, performance.now() / 1000]);
        panelCtx.fillStyle = '#fff'; panelCtx.font = '600 ' + Math.round(Math.min(H * 0.04, cellW * 0.1)) + 'px ' + FONT_TXT;
        panelCtx.textAlign = 'center'; panelCtx.textBaseline = 'middle';
        panelCtx.fillText(def.name, cx, cy + s * 1.0, cellW * 0.92);
        for (let p = 0; p < spell.tier; p++) {
          panelCtx.beginPath();
          panelCtx.arc(cx - (spell.tier - 1) * H * 0.02 + p * H * 0.04, cy + s * 1.15, H * 0.012, 0, Math.PI * 2);
          panelCtx.fillStyle = TIER_COLORS[spell.tier];
          panelCtx.fill();
        }
      }
      panelCtx.restore();
    }
    const pn = Meta.POT_SLOTS, potW = W / pn, py = H * 0.78;
    for (let i = 0; i < pn; i++) {
      const p = run.pot[i];
      if (p) call('ingredient', [panelCtx, potW * (i + 0.5), py, Math.min(potW, H * 0.3) * 0.85, p.type, p.tier]);
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
    drawPanel();
    refreshHud();
    rafId = requestAnimationFrame(loop);
  }

  function start(runArg, hooksArg) {
    run = runArg; hooks = hooksArg || {};
    paused = false; lastT = 0; acc = 0; instantUI = false;
    bolts = []; pops = []; floaters = []; bookShown = false; offerTaken = false; potSelected = null;
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
          SimB.botBrew(attractRun);
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
        SimB.botBrew(r);
        SimB.nextWave(r);
      } else break;
    }
    return r;
  }

  function defaultShotMeta() {
    return (typeof Meta !== 'undefined') ? Meta.runMeta(Meta.newMetaSave(), 1) : undefined;
  }

  function shot(token) {
    let r;
    instantUI = true;
    if (token === 'b-run-w1') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      fastForward(r, 3 * 60, 'smart');
    } else if (token === 'b-run-w6') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      while (r.wave < 6 && r.state !== 'dead') fastForward(r, 600, 'smart');
      fastForward(r, 5 * 60, 'smart');
    } else if (token === 'b-run-w12') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      let guard = 0;
      while (r.wave < 12 && r.state !== 'won' && guard < 200) { fastForward(r, 600, 'smart'); guard++; if (r.state === 'dead') SimB.revive(r); }
      r.spells = [
        { type: 'ember', tier: 4, ings: [{ type: 'moon', tier: 3 }, { type: 'quick', tier: 3 }], timer: 0, cdMax: 1 },
        { type: 'blast', tier: 4, ings: [{ type: 'moon', tier: 3 }, { type: 'shade', tier: 2 }], timer: 0, cdMax: 1 },
        { type: 'frost', tier: 3, ings: [{ type: 'quick', tier: 3 }, { type: 'dew', tier: 2 }], timer: 0, cdMax: 1 },
        { type: 'missile', tier: 3, ings: [{ type: 'moon', tier: 2 }, null], timer: 0, cdMax: 1 },
      ];
      r.pot = [{ type: 'storm', tier: 2 }, null, null, null];
      SimB.recalc(r);
      fastForward(r, 3 * 60, 'smart');
    } else if (token === 'b-boss') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      let guard = 0;
      while (!(r.wave === 5 && r.boss) && r.state !== 'dead' && guard < 3000) { fastForward(r, 60, 'smart'); guard++; }
      if (r.boss) r.boss.hp = r.boss.max / 2;
    } else if (token === 'b-brew') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      let guard = 0;
      while ((r.state === 'run' || r.state === 'boss') && guard < 7200) {
        SimB.step(r, 1 / 60, SimB.autopilot(r));
        r.events.length = 0;
        guard++;
      }
    } else if (token === 'b-revive') {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
      let guard = 0;
      while (r.state !== 'dead' && guard < 6000) { fastForward(r, 60, 'careless'); guard++; }
    } else {
      r = SimB.createRun({ seed: 1, meta: defaultShotMeta() });
    }
    run = r;
    resizeCanvas();
    refreshAll();
    drawScene(2);
    drawPanel();
    const finish = () => { if (typeof window !== 'undefined') window.__shotReady = true; };
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(finish);
    else finish();
    return r;
  }

  root.RunB = { mount, start, pause, resume, stop, renderStill, startAttract, shot };
})(typeof window !== 'undefined' ? window : globalThis);
