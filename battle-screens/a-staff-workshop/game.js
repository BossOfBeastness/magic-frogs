/* Staff Workshop (prototype A): Gun Hero's build grid, Magic Frogs themed.
   Zero build step, loads ../../art.js and ../../meta.js for pictures and data.
   Pure DOM + canvas, pointer events only (never click). */
(function () {
  'use strict';

  var COLS = 6, ROWS = 5;
  var BENCH_COLS = 5, BENCH_ROWS = 2;
  var STAFF_CELLS = [[2, 2], [2, 3]]; // 0-indexed: visually row 3, columns 3-4
  var TYPES = Meta.INGREDIENT_TYPES.slice(); // ember, frost, shade, blast, storm, moon, quick, dew
  var ELEMENT_OF = { ember: 'fire', frost: 'ice', shade: 'poison', blast: 'blast', storm: 'storm' };
  var BASE_DAMAGE = 8, BASE_RATE = 1.1;
  var FROG_MAX_HP = 30;
  var WAVE_COUNT = 5;
  var DRAG_THRESHOLD = 8;

  // ---- state ---------------------------------------------------------------

  var grid = makeGrid(ROWS, COLS);
  var bench = makeGrid(BENCH_ROWS, BENCH_COLS);
  for (var i = 0; i < STAFF_CELLS.length; i++) {
    grid[STAFF_CELLS[i][0]][STAFF_CELLS[i][1]] = { staff: true };
  }

  var gold = Meta.START_GOLD;
  var wave = 1;
  var phase = 'break'; // 'break' | 'fight' | 'lost' | 'won'
  var offers = [null, null, null];
  var rerollCount = 0;
  var everPlaced = false;
  var firstBreak = true;

  var fight = null; // active fight state while phase === 'fight'

  // ---- DOM refs --------------------------------------------------------------

  var el = {
    phone: document.getElementById('phone'),
    fightCanvas: document.getElementById('fight'),
    hudWave: document.getElementById('hud-wave'),
    hudGold: document.getElementById('gold-value'),
    build: document.getElementById('build'),
    lockBadge: document.getElementById('lock-badge'),
    statsBar: document.getElementById('stats-bar'),
    grid: document.getElementById('grid'),
    bench: document.getElementById('bench'),
    shop: document.getElementById('shop'),
    bin: document.getElementById('bin'),
    btnReroll: document.getElementById('btn-reroll'),
    rerollCost: document.getElementById('reroll-cost'),
    btnPlay: document.getElementById('btn-play'),
    hintLine: document.getElementById('hint-line'),
    btnHelp: document.getElementById('btn-help'),
    overlayHelp: document.getElementById('overlay-help'),
    btnHelpClose: document.getElementById('btn-help-close'),
    overlayEnd: document.getElementById('overlay-end'),
    endTitle: document.getElementById('end-title'),
    endText: document.getElementById('end-text'),
    btnRetry: document.getElementById('btn-retry'),
  };

  var fctx = el.fightCanvas.getContext('2d');

  function makeGrid(rows, cols) {
    var g = [];
    for (var r = 0; r < rows; r++) { g.push(new Array(cols).fill(null)); }
    return g;
  }

  function vibrate(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
  }

  // ---- pricing / helpers -----------------------------------------------------

  function price(tier) { return Meta.ING_PRICE[tier]; }
  function sellValue(tier) { return Math.floor(price(tier) / 2); }
  function pct(x) { return Math.round(x * 100) + '%'; }

  function randomTierForWave(w) {
    var roll = Math.random();
    if (w >= 4 && roll < 0.30) return 2;
    if (w >= 2 && roll < 0.15) return 2;
    return 1;
  }

  function rollOffer(w) {
    var type = TYPES[Math.floor(Math.random() * TYPES.length)];
    var tier = randomTierForWave(w);
    return { type: type, tier: tier, price: price(tier), sold: false };
  }

  function rollShop() {
    offers = [rollOffer(wave), rollOffer(wave), rollOffer(wave)];
    rerollCount = 0;
  }

  // ---- stats -------------------------------------------------------------

  function computeStats() {
    var dmgAdd = 0, power = 0, rate = 0;
    var burn = 0, slow = 0, poison = 0, splash = 0, chain = 0, heal = 0;
    var elementTotal = { fire: 0, ice: 0, poison: 0, blast: 0, storm: 0 };
    var partCount = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = grid[r][c];
        if (!p || p.staff) continue;
        partCount++;
        dmgAdd += 5 * Meta.TIER_MULT[p.tier];
        var v = Meta.INGREDIENTS[p.type].v[p.tier];
        if (p.type === 'moon') power += v;
        else if (p.type === 'quick') rate += v;
        else if (p.type === 'ember') { burn += v; elementTotal.fire += v; }
        else if (p.type === 'frost') { slow += v; elementTotal.ice += v; }
        else if (p.type === 'shade') { poison += v; elementTotal.poison += v; }
        else if (p.type === 'blast') { splash += v; elementTotal.blast += v; }
        else if (p.type === 'storm') { chain += v; elementTotal.storm += v; }
        else if (p.type === 'dew') heal += v;
      }
    }
    var damage = Math.round((BASE_DAMAGE + dmgAdd) * (1 + power));
    var rateOut = Math.round((BASE_RATE * (1 + rate)) * 100) / 100;
    var bestEl = null, bestV = 0;
    for (var k in elementTotal) { if (elementTotal[k] > bestV) { bestV = elementTotal[k]; bestEl = k; } }
    return {
      damage: damage, rate: rateOut,
      burn: burn, slow: slow, poison: poison, splash: splash, chain: chain, heal: heal,
      bestElement: bestEl, bestValue: bestV, partCount: partCount,
    };
  }

  function renderStats(tickFields) {
    var s = computeStats();
    var parts = [];
    parts.push({ id: 'dmg', html: 'DMG <b>' + s.damage + '</b>' });
    parts.push({ id: 'rate', html: 'SPD <b>' + s.rate + '/s</b>' });
    if (s.burn > 0) parts.push({ id: 'burn', html: 'Burn +' + pct(s.burn) });
    if (s.slow > 0) parts.push({ id: 'slow', html: 'Slow +' + pct(s.slow) });
    if (s.poison > 0) parts.push({ id: 'poison', html: 'Poison +' + pct(s.poison) });
    if (s.splash > 0) parts.push({ id: 'splash', html: 'Splash +' + pct(s.splash) });
    if (s.chain > 0) parts.push({ id: 'chain', html: 'Chain +' + Math.round(s.chain) });
    if (s.heal > 0) parts.push({ id: 'heal', html: 'Heal ' + Math.round(s.heal) });
    el.statsBar.innerHTML = '';
    for (var i = 0; i < parts.length; i++) {
      var span = document.createElement('span');
      span.className = 'stat';
      if (tickFields && tickFields.indexOf(parts[i].id) !== -1) span.className += ' tick';
      span.innerHTML = parts[i].html;
      el.statsBar.appendChild(span);
    }
    return s;
  }

  // ---- grid / bench rendering --------------------------------------------

  function cellEl(kind, r, c) {
    var container = kind === 'grid' ? el.grid : el.bench;
    return container.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
  }

  function buildCellDom() {
    el.grid.innerHTML = '';
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var isStaffA = (r === STAFF_CELLS[0][0] && c === STAFF_CELLS[0][1]);
        var isStaffB = (r === STAFF_CELLS[1][0] && c === STAFF_CELLS[1][1]);
        if (isStaffB) continue; // staff spans two columns, one dom cell
        var div = document.createElement('div');
        div.className = 'cell' + (isStaffA ? ' staff-cell' : '');
        div.dataset.kind = 'grid';
        div.dataset.r = r;
        div.dataset.c = c;
        if (isStaffA) {
          div.style.gridColumn = (c + 1) + ' / ' + (c + 3);
          div.style.gridRow = (r + 1) + ' / ' + (r + 2);
        }
        var canvas = document.createElement('canvas');
        div.appendChild(canvas);
        el.grid.appendChild(div);
      }
    }
    el.bench.innerHTML = '';
    for (var br = 0; br < BENCH_ROWS; br++) {
      for (var bc = 0; bc < BENCH_COLS; bc++) {
        var bdiv = document.createElement('div');
        bdiv.className = 'cell';
        bdiv.dataset.kind = 'bench';
        bdiv.dataset.r = br;
        bdiv.dataset.c = bc;
        var bcanvas = document.createElement('canvas');
        bdiv.appendChild(bcanvas);
        el.bench.appendChild(bdiv);
      }
    }
  }

  function drawStaffGlow(stats) {
    var staffCell = cellEl('grid', STAFF_CELLS[0][0], STAFF_CELLS[0][1]);
    var canvas = staffCell.querySelector('canvas');
    sizeCanvas(canvas);
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    var gemColor = stats.bestElement ? Art.COLORS[stats.bestElement] : Art.COLORS.gold;
    var glowAlpha = Math.min(0.9, 0.25 + 0.12 * stats.partCount);
    ctx.save();
    ctx.translate(w * 0.5, h * 0.85);
    var s = h * 1.05;
    // wooden pole
    ctx.strokeStyle = '#7A5230';
    ctx.lineWidth = Math.max(2, s * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s * 0.10, -s * 0.85);
    ctx.stroke();
    // glow halo
    ctx.beginPath();
    ctx.arc(s * 0.10, -s * 0.85, s * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = gemColor;
    ctx.globalAlpha = glowAlpha * 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    // gem
    ctx.beginPath();
    ctx.arc(s * 0.10, -s * 0.85, s * 0.10, 0, Math.PI * 2);
    ctx.fillStyle = gemColor;
    ctx.fill();
    ctx.strokeStyle = Art.COLORS.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function sizeCanvas(canvas) {
    var rect = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }

  function drawPart(canvas, part) {
    sizeCanvas(canvas);
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!part) return;
    Art.ingredient(ctx, w * 0.5, h * 0.56, Math.min(w, h) * 0.92, part.type, part.tier);
  }

  function renderGridAndBench(stats) {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var p = grid[r][c];
        if (p && p.staff) continue;
        var gce = cellEl('grid', r, c);
        if (!gce) continue;
        drawPart(gce.querySelector('canvas'), p);
      }
    }
    for (var br = 0; br < BENCH_ROWS; br++) {
      for (var bc = 0; bc < BENCH_COLS; bc++) {
        var bce = cellEl('bench', br, bc);
        drawPart(bce.querySelector('canvas'), bench[br][bc]);
      }
    }
    drawStaffGlow(stats);
  }

  function refresh(tickFields) {
    var stats = renderStats(tickFields);
    renderGridAndBench(stats);
    renderShop();
    updatePlayGate();
    if (phase !== 'fight' && stats) drawIdle(stats);
  }

  // ---- shop ----------------------------------------------------------------

  function renderShop() {
    el.shop.innerHTML = '';
    for (var i = 0; i < offers.length; i++) {
      (function (idx) {
        var offer = offers[idx];
        var card = document.createElement('div');
        card.className = 'offer';
        if (!offer || offer.sold) card.className += ' sold';
        else if (offer.price > gold) card.className += ' unaffordable';
        if (firstBreak && !everPlaced && offer && !offer.sold && offer.price <= gold) {
          card.className += ' hint';
        }
        var canvas = document.createElement('canvas');
        card.appendChild(canvas);
        var priceEl = document.createElement('div');
        priceEl.className = 'price';
        priceEl.textContent = offer && !offer.sold ? offer.price + 'g' : '-';
        card.appendChild(priceEl);
        el.shop.appendChild(card);
        if (offer && !offer.sold) drawPart(canvas, offer);
        addTapHandler(card, function () { buyOffer(idx); });
      })(i);
    }
  }

  function buyOffer(idx) {
    if (phase !== 'break') return;
    var offer = offers[idx];
    if (!offer || offer.sold) return;
    if (offer.price > gold) { showHint('Not enough gold for that yet.'); return; }
    var slot = findEmptyBench();
    if (!slot) { showHint('The bench is full. Place or sell a part first.'); return; }
    gold -= offer.price;
    bench[slot[0]][slot[1]] = { type: offer.type, tier: offer.tier };
    offer.sold = true;
    updateGoldHud();
    refresh();
    var bce = cellEl('bench', slot[0], slot[1]);
    bounceCell(bce);
    vibrate(15);
  }

  function findEmptyBench() {
    for (var r = 0; r < BENCH_ROWS; r++) {
      for (var c = 0; c < BENCH_COLS; c++) {
        if (!bench[r][c]) return [r, c];
      }
    }
    return null;
  }

  function rerollShopCost() {
    var table = [0, 5, 10, 20];
    return table[Math.min(rerollCount, table.length - 1)];
  }

  function updateRerollButton() {
    var cost = rerollShopCost();
    el.rerollCost.textContent = cost === 0 ? 'free' : cost + 'g';
    el.btnReroll.disabled = phase !== 'break' || cost > gold;
  }

  addTapHandler(el.btnReroll, function () {
    if (phase !== 'break') return;
    var cost = rerollShopCost();
    if (cost > gold) return;
    gold -= cost;
    rerollCount++;
    for (var i = 0; i < 3; i++) offers[i] = rollOffer(wave);
    updateGoldHud();
    refresh();
  });

  // ---- hints -----------------------------------------------------------

  var hintTimer = null;
  function showHint(text) {
    el.hintLine.textContent = text;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () {
      if (firstBreak && !everPlaced) return; // keep the persistent first-break hint
      el.hintLine.textContent = '';
    }, 2200);
  }

  function updateFirstBreakHint() {
    if (firstBreak && !everPlaced) {
      el.hintLine.textContent = 'Tap an affordable part, then tap a glowing cell to place it.';
    } else if (el.hintLine.textContent.indexOf('Tap an affordable') === 0) {
      el.hintLine.textContent = '';
    }
  }

  function updatePlayGate() {
    var canPlay = phase === 'break' && (!firstBreak || everPlaced);
    el.btnPlay.disabled = !canPlay;
    el.btnPlay.className = (firstBreak && !everPlaced) ? 'hint' : '';
    if (firstBreak && everPlaced) el.btnPlay.className = '';
    updateFirstBreakHint();
    updateRerollButton();
  }

  // ---- fx ---------------------------------------------------------------

  function bounceCell(cellDiv) {
    cellDiv.classList.remove('bounce');
    void cellDiv.offsetWidth;
    cellDiv.classList.add('bounce');
    setTimeout(function () { cellDiv.classList.remove('bounce'); }, 320);
  }
  function mergeFlashCell(cellDiv) {
    cellDiv.classList.remove('merge-flash');
    void cellDiv.offsetWidth;
    cellDiv.classList.add('merge-flash');
    setTimeout(function () { cellDiv.classList.remove('merge-flash'); }, 420);
  }
  function shakeCell(cellDiv) {
    cellDiv.classList.remove('shake');
    void cellDiv.offsetWidth;
    cellDiv.classList.add('shake');
    setTimeout(function () { cellDiv.classList.remove('shake'); }, 320);
  }

  // ---- placement legality --------------------------------------------------

  function isAdjacentToBuilt(r, c) {
    var deltas = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (var i = 0; i < deltas.length; i++) {
      var rr = r + deltas[i][0], cc = c + deltas[i][1];
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      if (grid[rr][cc]) return true;
    }
    return false;
  }

  function gridCellLegality(r, c, piece) {
    var target = grid[r][c];
    if (target && target.staff) return 'illegal';
    if (!target) return isAdjacentToBuilt(r, c) ? 'legal' : 'illegal';
    if (target.type === piece.type && target.tier === piece.tier && target.tier < 5) return 'legal';
    return 'illegal';
  }

  // ---- pointer / drag state machine -----------------------------------------

  function readPart(kind, r, c) {
    var g = kind === 'grid' ? grid[r][c] : bench[r][c];
    if (!g || g.staff) return null;
    return { kind: kind, r: r, c: c, type: g.type, tier: g.tier };
  }

  function addTapHandler(target, fn) {
    var down = null;
    target.addEventListener('pointerdown', function (e) {
      down = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.preventDefault();
    }, { passive: false });
    target.addEventListener('pointerup', function (e) {
      if (!down || down.id !== e.pointerId) return;
      var dist = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (dist < DRAG_THRESHOLD) fn(e);
    });
    target.addEventListener('pointercancel', function () { down = null; });
  }

  var held = null;        // { kind, r, c, type, tier, dragging }
  var pendingDown = null; // { pointerId, x, y, source? , targetElAtDown? }
  var ghost = null;
  var dragPointerId = null;

  function clearHighlights() {
    var cells = el.grid.querySelectorAll('.cell.legal, .cell.illegal, .cell.held');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('legal', 'illegal', 'held');
    var bcells = el.bench.querySelectorAll('.cell.legal, .cell.illegal, .cell.held');
    for (var j = 0; j < bcells.length; j++) bcells[j].classList.remove('legal', 'illegal', 'held');
    el.bin.classList.remove('legal');
  }

  function paintLegality(piece) {
    clearHighlights();
    var origin = cellEl(piece.kind, piece.r, piece.c);
    if (origin) origin.classList.add('held');
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (r === piece.r && c === piece.c && piece.kind === 'grid') continue;
        var ce = cellEl('grid', r, c);
        if (!ce) continue;
        var verdict = gridCellLegality(r, c, piece);
        ce.classList.add(verdict);
      }
    }
    for (var br = 0; br < BENCH_ROWS; br++) {
      for (var bc = 0; bc < BENCH_COLS; bc++) {
        if (br === piece.r && bc === piece.c && piece.kind === 'bench') continue;
        var bce = cellEl('bench', br, bc);
        var occ = bench[br][bc];
        bce.classList.add(!occ ? 'legal' : (occ.type === piece.type && occ.tier === piece.tier && occ.tier < 5 ? 'legal' : 'illegal'));
      }
    }
    el.bin.classList.add('legal');
  }

  function createGhost(piece, x, y) {
    ghost = document.createElement('canvas');
    ghost.style.position = 'fixed';
    ghost.style.width = '46px';
    ghost.style.height = '46px';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '30';
    ghost.style.opacity = '0.9';
    ghost.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.6))';
    document.body.appendChild(ghost);
    sizeGhostCanvas();
    Art.ingredient(ghost.getContext('2d'), ghost.width * 0.5, ghost.height * 0.56, Math.min(ghost.width, ghost.height) * 0.92, piece.type, piece.tier);
    moveGhostTo(x, y);
  }
  function sizeGhostCanvas() {
    var dpr = window.devicePixelRatio || 1;
    ghost.width = Math.round(46 * dpr);
    ghost.height = Math.round(46 * dpr);
  }
  function moveGhostTo(x, y) {
    if (!ghost) return;
    ghost.style.left = (x - 23) + 'px';
    ghost.style.top = (y - 23) + 'px';
  }
  function removeGhost() {
    if (ghost && ghost.parentElement) ghost.parentElement.removeChild(ghost);
    ghost = null;
  }

  function elementDescriptor(elm) {
    if (!elm) return null;
    var cell = elm.closest ? elm.closest('.cell') : null;
    if (cell) return { type: 'cell', kind: cell.dataset.kind, r: +cell.dataset.r, c: +cell.dataset.c };
    var bin = elm.closest ? elm.closest('#bin') : null;
    if (bin) return { type: 'bin' };
    return null;
  }

  function resolveDrop(piece, dropElm) {
    var desc = elementDescriptor(dropElm);
    var originCell = cellEl(piece.kind, piece.r, piece.c);
    if (!desc) {
      showHint('Drop it back on the grid or bench.');
      if (originCell) shakeCell(originCell);
      return;
    }
    if (desc.type === 'bin') {
      var refund = sellValue(piece.tier);
      setCell(piece.kind, piece.r, piece.c, null);
      gold += refund;
      updateGoldHud();
      refresh();
      showHint('Sold for ' + refund + ' gold.');
      vibrate(15);
      return;
    }
    if (desc.kind === piece.kind && desc.r === piece.r && desc.c === piece.c) return; // dropped on itself
    if (desc.kind === 'grid' && grid[desc.r][desc.c] && grid[desc.r][desc.c].staff) {
      showHint('The staff cannot be moved or covered.');
      if (originCell) shakeCell(originCell);
      return;
    }
    var targetOcc = desc.kind === 'grid' ? grid[desc.r][desc.c] : bench[desc.r][desc.c];
    if (targetOcc) {
      if (targetOcc.type === piece.type && targetOcc.tier === piece.tier) {
        if (targetOcc.tier >= 5) {
          showHint('Already at the top tier.');
          if (originCell) shakeCell(originCell);
          return;
        }
        setCell(piece.kind, piece.r, piece.c, null);
        setCell(desc.kind, desc.r, desc.c, { type: piece.type, tier: piece.tier + 1 });
        refresh(['dmg', 'rate', ELEMENT_STAT[piece.type]]);
        var targetCell = cellEl(desc.kind, desc.r, desc.c);
        mergeFlashCell(targetCell);
        vibrate([20, 30, 20]);
        return;
      }
      showHint('That cell holds a different part.');
      if (originCell) shakeCell(originCell);
      return;
    }
    if (desc.kind === 'grid' && !isAdjacentToBuilt(desc.r, desc.c)) {
      showHint('A part must touch the staff or another part.');
      if (originCell) shakeCell(originCell);
      return;
    }
    setCell(piece.kind, piece.r, piece.c, null);
    setCell(desc.kind, desc.r, desc.c, { type: piece.type, tier: piece.tier });
    if (desc.kind === 'grid') everPlaced = true;
    refresh(['dmg', 'rate', ELEMENT_STAT[piece.type]]);
    var placedCell = cellEl(desc.kind, desc.r, desc.c);
    bounceCell(placedCell);
    vibrate(15);
  }

  var ELEMENT_STAT = { ember: 'burn', frost: 'slow', shade: 'poison', blast: 'splash', storm: 'chain', moon: 'dmg', quick: 'rate', dew: 'heal' };

  function setCell(kind, r, c, value) {
    if (kind === 'grid') grid[r][c] = value; else bench[r][c] = value;
  }

  function cleanupInteraction() {
    held = null;
    pendingDown = null;
    dragPointerId = null;
    removeGhost();
    clearHighlights();
  }

  function onBuildPointerDown(e) {
    if (phase !== 'break') return;
    var desc = elementDescriptor(e.target);
    if (held === null) {
      if (!desc || desc.type !== 'cell') return;
      var piece = readPart(desc.kind, desc.r, desc.c);
      if (!piece) return;
      pendingDown = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, source: piece };
    } else {
      pendingDown = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, targetElAtDown: e.target };
    }
  }

  function onBuildPointerMove(e) {
    if (held && held.dragging && dragPointerId === e.pointerId) {
      moveGhostTo(e.clientX, e.clientY);
      return;
    }
    if (!pendingDown || pendingDown.pointerId !== e.pointerId) return;
    var dist = Math.hypot(e.clientX - pendingDown.x, e.clientY - pendingDown.y);
    if (dist > DRAG_THRESHOLD) {
      if (!held) held = { kind: pendingDown.source.kind, r: pendingDown.source.r, c: pendingDown.source.c, type: pendingDown.source.type, tier: pendingDown.source.tier, dragging: true };
      else held.dragging = true;
      dragPointerId = e.pointerId;
      paintLegality(held);
      createGhost(held, e.clientX, e.clientY);
      pendingDown = null;
    }
  }

  function onBuildPointerUp(e) {
    if (held && held.dragging && dragPointerId === e.pointerId) {
      var dropElm = document.elementFromPoint(e.clientX, e.clientY);
      var piece = held;
      cleanupInteraction();
      resolveDrop(piece, dropElm);
      return;
    }
    if (pendingDown && pendingDown.pointerId === e.pointerId) {
      if (!held) {
        held = { kind: pendingDown.source.kind, r: pendingDown.source.r, c: pendingDown.source.c, type: pendingDown.source.type, tier: pendingDown.source.tier, dragging: false };
        paintLegality(held);
        pendingDown = null;
      } else {
        var targetElm = pendingDown.targetElAtDown;
        var pieceHeld = held;
        cleanupInteraction();
        resolveDrop(pieceHeld, targetElm);
      }
    }
  }

  el.build.addEventListener('pointerdown', onBuildPointerDown);
  window.addEventListener('pointermove', onBuildPointerMove);
  window.addEventListener('pointerup', onBuildPointerUp);
  window.addEventListener('pointercancel', cleanupInteraction);

  // ---- help / end overlays ----------------------------------------------

  addTapHandler(el.btnHelp, function () { el.overlayHelp.classList.remove('hidden'); });
  addTapHandler(el.btnHelpClose, function () { el.overlayHelp.classList.add('hidden'); });
  addTapHandler(el.btnRetry, function () { location.reload(); });

  function showEnd(won, text) {
    el.endTitle.textContent = won ? 'Victory' : 'Defeated on wave ' + wave;
    el.endText.textContent = text;
    el.overlayEnd.classList.remove('hidden');
  }

  // ---- fight simulation ------------------------------------------------

  function waveConfig(w) {
    if (w === WAVE_COUNT) return { boss: true, name: 'Rat King', hp: 140, count: 1 };
    return { boss: false, count: 3 + w, hp: 8 + w * 4 };
  }

  function startFight() {
    phase = 'fight';
    el.build.classList.add('locked');
    el.lockBadge.classList.add('on');
    el.btnPlay.disabled = true;
    var stats = computeStats();
    var cfg = waveConfig(wave);
    var W = el.fightCanvas.clientWidth || 390;
    var H = el.fightCanvas.clientHeight || 354;
    fight = {
      stats: stats,
      cfg: cfg,
      frogHP: FROG_MAX_HP,
      frogX: W * 0.24,
      groundY: H * 0.55,
      meleeX: W * 0.46,
      spawnX: W * 1.04,
      rats: [],
      spawnQueue: cfg.count,
      spawnTimer: 0,
      castTimer: 0,
      castFlash: 0,
      bolts: [],
      dmgNumbers: [],
      t: 0,
      lastFrame: performance.now(),
      ended: false,
    };
    requestAnimationFrame(fightLoop);
  }

  function spawnRat(f) {
    var kind = f.cfg.boss ? 'boss' : (f.cfg.count > 5 && Math.random() < 0.3 ? 'brute' : 'runt');
    var hp = f.cfg.boss ? f.cfg.hp : Math.round(f.cfg.hp * (kind === 'brute' ? 1.6 : 1));
    f.rats.push({
      kind: kind, hp: hp, maxHp: hp,
      x: f.spawnX + Math.random() * 20,
      speed: (f.cfg.boss ? 30 : 46) * (1 - 0.5 * f.stats.slow > 0 ? 1 : 1),
      inMelee: false,
      burnT: 0, alive: true,
    });
  }

  function fightLoop(now) {
    if (!fight || phase !== 'fight') return;
    var f = fight;
    var dt = Math.min(0.05, (now - f.lastFrame) / 1000);
    f.lastFrame = now;
    f.t += dt;

    if (f.spawnQueue > 0) {
      f.spawnTimer -= dt;
      if (f.spawnTimer <= 0) { spawnRat(f); f.spawnQueue--; f.spawnTimer = f.cfg.boss ? 0 : 1.0; }
    }

    // move rats
    var contactDamage = 0;
    for (var i = 0; i < f.rats.length; i++) {
      var rat = f.rats[i];
      if (!rat.alive) continue;
      var slowMult = f.stats.slow > 0 ? Math.max(0.35, 1 - f.stats.slow) : 1;
      if (rat.x > f.meleeX) {
        rat.x -= rat.speed * slowMult * dt;
        rat.inMelee = false;
      } else {
        rat.inMelee = true;
        contactDamage += (rat.kind === 'boss' ? 6 : rat.kind === 'brute' ? 3 : 2) * dt;
      }
      if (rat.burnT > 0) {
        rat.burnT -= dt;
        rat.hp -= (f.stats.burn > 0 ? f.stats.damage * f.stats.burn * 0.5 : 0) * dt;
      }
    }
    if (contactDamage > 0) {
      f.frogHP -= contactDamage;
      if (f.frogHP <= 0) { f.frogHP = 0; endFight(false); return; }
    }

    // casting
    f.castTimer -= dt;
    if (f.castFlash > 0) f.castFlash -= dt;
    var target = nearestRat(f);
    if (target && f.castTimer <= 0) {
      f.castTimer = 1 / f.stats.rate;
      f.castFlash = 0.18;
      castAt(f, target);
    }

    // bolts
    for (var b = f.bolts.length - 1; b >= 0; b--) {
      var bolt = f.bolts[b];
      bolt.t += dt;
      var frac = Math.min(1, bolt.t / bolt.dur);
      if (frac >= 1) {
        applyHit(f, bolt.target);
        f.bolts.splice(b, 1);
      }
    }

    // damage numbers
    for (var d = f.dmgNumbers.length - 1; d >= 0; d--) {
      f.dmgNumbers[d].y -= 26 * dt;
      f.dmgNumbers[d].life -= dt;
      if (f.dmgNumbers[d].life <= 0) f.dmgNumbers.splice(d, 1);
    }

    // clear dead rats
    for (var rr = f.rats.length - 1; rr >= 0; rr--) {
      if (f.rats[rr].hp <= 0 && f.rats[rr].alive) {
        f.rats[rr].alive = false;
        onRatKilled(f, f.rats[rr]);
        f.rats.splice(rr, 1);
      }
    }

    drawFight(f);

    if (f.spawnQueue <= 0 && f.rats.length === 0 && !f.ended) {
      endFight(true);
      return;
    }
    requestAnimationFrame(fightLoop);
  }

  function nearestRat(f) {
    var best = null, bestX = Infinity;
    for (var i = 0; i < f.rats.length; i++) {
      if (f.rats[i].alive && f.rats[i].x < bestX) { bestX = f.rats[i].x; best = f.rats[i]; }
    }
    return best;
  }

  function castAt(f, rat) {
    var element = f.stats.bestElement || 'arcane';
    f.bolts.push({ from: { x: f.frogX + 34, y: f.groundY - (f.fightCanvasH || 0) }, target: rat, element: element, t: 0, dur: 0.18 });
  }

  function applyHit(f, rat) {
    if (!rat.alive) return;
    var dmg = f.stats.damage;
    rat.hp -= dmg;
    f.dmgNumbers.push({ x: rat.x, y: f.groundY - 60, text: '-' + Math.round(dmg), life: 0.7 });
    if (f.stats.burn > 0) rat.burnT = 2;
    if (f.stats.splash > 0) {
      for (var i = 0; i < f.rats.length; i++) {
        var other = f.rats[i];
        if (other !== rat && other.alive && Math.abs(other.x - rat.x) < 40) {
          other.hp -= dmg * f.stats.splash * 0.5;
        }
      }
    }
    if (f.stats.chain > 0) {
      var chained = 0;
      for (var j = 0; j < f.rats.length && chained < Math.round(f.stats.chain); j++) {
        var o2 = f.rats[j];
        if (o2 !== rat && o2.alive) { o2.hp -= dmg * 0.5; chained++; }
      }
    }
  }

  function onRatKilled(f, rat) {
    gold += rat.kind === 'boss' ? 50 : 1;
    if (f.stats.heal > 0) f.frogHP = Math.min(FROG_MAX_HP, f.frogHP + f.stats.heal);
    updateGoldHud();
  }

  // Between waves the bog stays on screen with the frog standing ready (Gun Hero keeps the arena visible).
  function drawIdle(stats) {
    var cw = el.fightCanvas.clientWidth || 390;
    drawFight({ t: (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000, frogX: cw * 0.24, stats: stats, castFlash: 0,
      rats: [], bolts: [], dmgNumbers: [], frogHP: FROG_MAX_HP, cfg: {} });
  }

  function drawFight(f) {
    var canvas = el.fightCanvas;
    var dpr = window.devicePixelRatio || 1;
    var cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
    }
    fctx.save();
    fctx.scale(dpr, dpr);
    Art.sceneryB(fctx, cw, ch, f.t, 1);
    var horizonY = ch * 0.55;
    var dirt = fctx.createLinearGradient(0, horizonY, 0, ch);
    dirt.addColorStop(0, '#5A4632');
    dirt.addColorStop(1, '#2E2013');
    fctx.fillStyle = dirt;
    fctx.fillRect(0, horizonY, cw, ch - horizonY);
    var groundY = horizonY;
    var frogS = ch * 0.34;
    Art.frogSide(fctx, f.frogX, groundY, frogS, Art.COLORS.skinLeaf, '#5B6CFF', f.stats.bestElement ? Art.COLORS[f.stats.bestElement] : Art.COLORS.gold, f.t, f.castFlash > 0);
    for (var i = 0; i < f.rats.length; i++) {
      var rat = f.rats[i];
      var s = ch * (rat.kind === 'boss' ? 0.40 : rat.kind === 'brute' ? 0.26 : 0.20);
      if (rat.kind === 'boss') {
        Art.boss(fctx, rat.x, groundY, s, f.cfg.name, f.t, true);
      } else {
        Art.ratSide(fctx, rat.x, groundY, s, rat.kind, f.t, { burnT: rat.burnT });
      }
      // hp bar
      var barW = s * 0.7, barX = rat.x - barW / 2, barY = groundY - s - 12;
      fctx.fillStyle = 'rgba(20,10,10,0.7)';
      fctx.fillRect(barX, barY, barW, 5);
      fctx.fillStyle = rat.hp / rat.maxHp > 0.4 ? '#54D63A' : '#FF4D63';
      fctx.fillRect(barX, barY, barW * Math.max(0, rat.hp / rat.maxHp), 5);
    }
    for (var b = 0; b < f.bolts.length; b++) {
      var bolt = f.bolts[b];
      var frac = Math.min(1, bolt.t / bolt.dur);
      var bx = f.frogX + 34 + (bolt.target.x - (f.frogX + 34)) * frac;
      var by = groundY - frogS * 0.62;
      Art.bolt(fctx, bx, by, 18, bolt.element, 0, f.t);
    }
    fctx.textAlign = 'center';
    fctx.font = '700 13px "Titan One", cursive';
    for (var d = 0; d < f.dmgNumbers.length; d++) {
      var num = f.dmgNumbers[d];
      fctx.globalAlpha = Math.max(0, num.life / 0.7);
      fctx.fillStyle = '#FF4D63';
      fctx.fillText(num.text, num.x, num.y);
      fctx.globalAlpha = 1;
    }
    // frog hp bar
    fctx.fillStyle = 'rgba(20,10,10,0.7)';
    fctx.fillRect(f.frogX - 26, groundY + 6, 52, 6);
    fctx.fillStyle = '#54D63A';
    fctx.fillRect(f.frogX - 26, groundY + 6, 52 * Math.max(0, f.frogHP / FROG_MAX_HP), 6);
    fctx.restore();
  }

  function endFight(won) {
    fight.ended = true;
    if (!won) {
      phase = 'lost';
      showEnd(false, 'The rats got past a build that could not keep up. Retry with a stronger staff.');
      return;
    }
    if (wave >= WAVE_COUNT) {
      phase = 'won';
      showEnd(true, 'The Rat King falls. The bog is safe, for now.');
      return;
    }
    gold += Meta.waveGold(wave);
    updateGoldHud();
    wave++;
    firstBreak = false;
    phase = 'break';
    el.build.classList.remove('locked');
    el.lockBadge.classList.remove('on');
    el.hudWave.textContent = 'WAVE ' + wave + ' / ' + WAVE_COUNT;
    rollShop();
    refresh();
  }

  function updateGoldHud() { el.hudGold.textContent = gold; }

  addTapHandler(el.btnPlay, function () {
    if (el.btnPlay.disabled) return;
    startFight();
  });

  // ---- boot ---------------------------------------------------------------

  function boot() {
    buildCellDom();
    rollShop();
    updateGoldHud();
    refresh();
    window.addEventListener('resize', function () { refresh(); });
  }

  boot();

  // exposed for the test harness only (read-only introspection, never mutates through here)
  window.__staffWorkshop = {
    // Test-only: top up gold so the harness can buy a matching pair after paid rerolls.
    addGold: function (n) { gold += n; updateGoldHud(); refresh(); },
    getState: function () {
      var g = [];
      for (var r = 0; r < ROWS; r++) {
        var row = [];
        for (var c = 0; c < COLS; c++) {
          var cell = grid[r][c];
          row.push(cell ? (cell.staff ? 'staff' : cell.type + cell.tier) : null);
        }
        g.push(row);
      }
      var b = [];
      for (var br = 0; br < BENCH_ROWS; br++) {
        var brow = [];
        for (var bc = 0; bc < BENCH_COLS; bc++) {
          var bcell = bench[br][bc];
          brow.push(bcell ? (bcell.type + bcell.tier) : null);
        }
        b.push(brow);
      }
      return {
        phase: phase, wave: wave, gold: gold,
        offers: offers.map(function (o) { return o && !o.sold ? { type: o.type, tier: o.tier, price: o.price } : null; }),
        grid: g, bench: b,
        fightDebug: fight ? { rats: fight.rats.map(function (r) { return { kind: r.kind, x: r.x, hp: r.hp }; }), frogHP: fight.frogHP, t: fight.t } : null,
      };
    },
  };
})();
