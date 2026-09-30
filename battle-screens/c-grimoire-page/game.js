/* Grimoire Page: battle screen prototype C. Shaped spell and ingredient pieces are
   packed and rotated on a spellbook page, Backpack Battles style. Pure canvas 2D,
   no build step. Uses Art (../../art.js) for the frog, rats, boss, bolts and
   ingredient icons, and Meta (../../meta.js) for spell/ingredient names, tiers and
   prices. Everything else (piece shapes, star tags, shop pricing tier, fight
   pacing) is this prototype's own tuning; it does not touch Art or Meta. */
(function () {
  'use strict';

  var W = 390, H = 844;
  var FIGHT_H = 354;               // top 42%
  var HEADER_Y = FIGHT_H + 18;
  var TRAY_Y = FIGHT_H + 30;
  var TRAY_SLOT = 38, TRAY_GAP = 8;
  var TRAY_COUNT = 3;
  var TRAY_W = TRAY_COUNT * TRAY_SLOT + (TRAY_COUNT - 1) * TRAY_GAP;
  var TRAY_X = Math.round((W - TRAY_W) / 2);
  var GRID_COLS = 7, GRID_ROWS = 6, CELL = 36;
  var GRID_W = GRID_COLS * CELL, GRID_H = GRID_ROWS * CELL;
  var GRID_X = Math.round((W - GRID_W) / 2);
  var GRID_Y = FIGHT_H + 82;
  var SHOP_Y = GRID_Y + GRID_H + 10;
  var SHOP_CARD_W = 100, SHOP_CARD_H = 78, SHOP_GAP = 8;
  var SHOP_W = 3 * SHOP_CARD_W + 2 * SHOP_GAP;
  var SHOP_X = Math.round((W - SHOP_W) / 2);
  var DRAG_THRESHOLD = 8;

  var C = Art.COLORS;

  // ---- piece shapes (this prototype's own tuning; see report) ----------------

  var ELEMENT = { ember: 'fire', frost: 'ice', shade: 'poison', blast: 'blast', storm: 'storm', moon: 'arcane', quick: 'arcane', dew: 'dew' };

  var SPELL_DEFS = {
    missile: { cells: [[0, 0]], stars: {} },
    ember:   { cells: [[0, 0], [0, 1], [1, 1]], stars: { '0,0': 'fire', '1,1': 'blast' } },
    frost:   { cells: [[0, 0], [0, 1], [0, 2]], stars: { '0,0': 'ice', '0,2': 'arcane' } },
    blast:   { cells: [[0, 0], [1, 0], [0, 1], [1, 1]], stars: { '0,0': 'blast', '1,1': 'storm' } },
    venom:   { cells: [[0, 0], [1, 0]], stars: { '1,0': 'poison' } },
    spark:   { cells: [[1, 0], [2, 0], [0, 1], [1, 1]], stars: { '2,0': 'storm', '0,1': 'arcane' } },
  };
  var ING_TWO_CELL = { shade: 1, storm: 1, quick: 1 };
  var ING_DEFS = {};
  Meta.INGREDIENT_TYPES.forEach(function (t) {
    ING_DEFS[t] = ING_TWO_CELL[t] ? { cells: [[0, 0], [1, 0]], stars: {} } : { cells: [[0, 0]], stars: {} };
  });

  function defFor(kind, type) { return kind === 'spell' ? SPELL_DEFS[type] : ING_DEFS[type]; }

  function rotateShape(cells, stars, times) {
    var c = cells.map(function (p) { return p.slice(); });
    var keys = Object.keys(stars);
    var pts = keys.map(function (k) { return k.split(',').map(Number); });
    for (var i = 0; i < times; i++) {
      c = c.map(function (p) { return [p[1], -p[0]]; });
      pts = pts.map(function (p) { return [p[1], -p[0]]; });
      var minx = Math.min.apply(null, c.map(function (p) { return p[0]; }));
      var miny = Math.min.apply(null, c.map(function (p) { return p[1]; }));
      c = c.map(function (p) { return [p[0] - minx, p[1] - miny]; });
      pts = pts.map(function (p) { return [p[0] - minx, p[1] - miny]; });
    }
    var newStars = {};
    pts.forEach(function (p, i) { newStars[p[0] + ',' + p[1]] = stars[keys[i]]; });
    return { cells: c, stars: newStars };
  }

  function shapeFor(piece) {
    var def = defFor(piece.kind, piece.type);
    return rotateShape(def.cells, def.stars, piece.rot % 4);
  }

  // ---- state -------------------------------------------------------------

  var nextUid = 1;
  var state = {
    gold: Meta.START_GOLD,
    wave: 1,
    level: Meta.LEVELS[0],
    phase: 'build',            // 'build' | 'fight' | 'lost' | 'won'
    firstBreak: true,
    pieces: {},                 // uid -> piece {uid,kind,type,tier,rot,col,row}
    grid: new Array(GRID_COLS * GRID_ROWS).fill(null),
    unlocked: new Array(GRID_COLS * GRID_ROWS).fill(false),
    lockedQueue: [],
    tray: [null, null, null],
    offers: [],                 // [{kind,type,tier,price,sold}]
    rerollN: 0,
    held: null,                 // {piece, from:'tray'|'grid', slot|col,row, mode:'tap'|'drag', px,py, rot}
    dragMoved: false,
    downX: 0, downY: 0,
    litStars: {},                // uid -> Set of 'x,y' currently lit, for sparkle-on-change
    sparkles: [],                // {x,y,t0}
    tearing: [],                 // {c,r,t0}
    toastT: 0,
    frogHp: 30, frogHpMax: 30,
    rats: [],
    bolts: [],
    dmgTexts: [],
    kills: 0,
  };

  for (var r = 0; r < GRID_ROWS; r++) {
    for (var c = 0; c < GRID_COLS; c++) {
      var unlocked = (c >= 1 && c <= 5 && r >= 1 && r <= 4);
      state.unlocked[r * GRID_COLS + c] = unlocked;
      if (!unlocked) state.lockedQueue.push([c, r]);
    }
  }

  function idx(c, r) { return r * GRID_COLS + c; }
  function inBounds(c, r) { return c >= 0 && c < GRID_COLS && r >= 0 && r < GRID_ROWS; }

  function revealCells(n) {
    for (var i = 0; i < n && state.lockedQueue.length; i++) {
      var cr = state.lockedQueue.shift();
      state.unlocked[idx(cr[0], cr[1])] = true;
      state.tearing.push({ c: cr[0], r: cr[1], t0: now() });
    }
  }

  function now() { return performance.now(); }

  // ---- shop ----------------------------------------------------------------

  var SHOP_POOL = Meta.SPELL_TYPES.map(function (t) { return { kind: 'spell', type: t }; })
    .concat(Meta.INGREDIENT_TYPES.map(function (t) { return { kind: 'ingredient', type: t }; }));

  function priceOf(kind, tier) { return kind === 'spell' ? Meta.SPELL_PRICE[tier] : Meta.ING_PRICE[tier]; }

  function makeOffers(fixed) {
    var picks;
    if (fixed) {
      // Deterministic first break: two Ember Salt (cheap, mergeable within the
      // 20 starting gold) plus one Magic Missile so a spell is visible too.
      picks = [{ kind: 'ingredient', type: 'ember' }, { kind: 'ingredient', type: 'ember' }, { kind: 'spell', type: 'missile' }];
    } else {
      var pool = SHOP_POOL.slice();
      for (var i = pool.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      picks = pool.slice(0, 3);
    }
    state.offers = picks.map(function (p) {
      return { kind: p.kind, type: p.type, tier: 1, price: priceOf(p.kind, 1), sold: false };
    });
  }
  makeOffers(true);

  function buyOffer(i) {
    var o = state.offers[i];
    if (!o || o.sold) return;
    if (state.gold < o.price) { toast('Not enough gold'); return; }
    var slot = state.tray.indexOf(null);
    if (slot === -1) { toast('The page tray is full'); return; }
    state.gold -= o.price;
    o.sold = true;
    state.tray[slot] = { uid: nextUid++, kind: o.kind, type: o.type, tier: 1, rot: 0, col: null, row: null };
    updateButtons();
  }

  function rerollCost() { return Meta.rerollCost(state.rerollN); }

  function doReroll() {
    if (state.phase !== 'build') return;
    var cost = rerollCost();
    if (state.gold < cost) { toast('Not enough gold to reroll'); return; }
    state.gold -= cost;
    state.rerollN++;
    makeOffers(false);
  }

  // ---- toast -----------------------------------------------------------------

  var toastEl = document.getElementById('toast');
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    state.toastT = now();
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { toastEl.classList.remove('on'); }, 1400);
  }

  // ---- placement legality ----------------------------------------------------

  function footprintAt(cells, col, row) {
    return cells.map(function (d) { return [col + d[0], row + d[1]]; });
  }

  function checkPlacement(piece, cells, col, row) {
    var fp = footprintAt(cells, col, row);
    for (var i = 0; i < fp.length; i++) {
      var c = fp[i][0], r = fp[i][1];
      if (!inBounds(c, r)) return { valid: false, reason: 'Off the edge of the page', fp: fp };
      if (!state.unlocked[idx(c, r)]) return { valid: false, reason: 'That part of the page is still torn shut', fp: fp };
    }
    var uids = {};
    fp.forEach(function (cr) { var u = state.grid[idx(cr[0], cr[1])]; if (u) uids[u] = true; });
    var occ = Object.keys(uids);
    if (occ.length === 0) return { valid: true, action: 'place', fp: fp };
    if (occ.length === 1) {
      var target = state.pieces[occ[0]];
      var targetShape = shapeFor(target);
      var targetFp = footprintAt(targetShape.cells, target.col, target.row);
      var sameSet = targetFp.length === fp.length && targetFp.every(function (cr) {
        return fp.some(function (cr2) { return cr2[0] === cr[0] && cr2[1] === cr[1]; });
      });
      if (sameSet && target.kind === piece.kind && target.type === piece.type && target.tier === piece.tier) {
        if (piece.tier >= 5) return { valid: false, reason: 'Already at the top tier', fp: fp };
        return { valid: true, action: 'merge', targetUid: target.uid, fp: fp };
      }
    }
    return { valid: false, reason: 'Something is already there', fp: fp };
  }

  // ---- placing / merging -----------------------------------------------------

  function clearFromBoard(piece) {
    var shape = shapeFor(piece);
    footprintAt(shape.cells, piece.col, piece.row).forEach(function (cr) {
      state.grid[idx(cr[0], cr[1])] = null;
    });
  }

  function placePieceAt(piece, col, row, fromTraySlot) {
    piece.col = col; piece.row = row;
    var shape = shapeFor(piece);
    footprintAt(shape.cells, col, row).forEach(function (cr) { state.grid[idx(cr[0], cr[1])] = piece.uid; });
    state.pieces[piece.uid] = piece;
    if (fromTraySlot !== undefined && fromTraySlot !== null) state.tray[fromTraySlot] = null;
    vibrate(15);
    bounce(piece.uid);
  }

  function mergeInto(piece, targetUid) {
    var target = state.pieces[targetUid];
    var col = target.col, row = target.row, rot = target.rot;
    clearFromBoard(target);
    delete state.pieces[targetUid];
    var merged = { uid: nextUid++, kind: target.kind, type: target.type, tier: target.tier + 1, rot: rot, col: null, row: null };
    placePieceAt(merged, col, row);
    vibrate([20, 30, 20]);
    flash(merged.uid);
    return merged;
  }

  function vibrate(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ } }

  var bounces = {};   // uid -> t0
  function bounce(uid) { bounces[uid] = now(); }
  var flashes = {};    // uid -> t0
  function flash(uid) { flashes[uid] = now(); }
  var starSparkle = {};  // 'uid:x,y' -> t0 of the moment it turned lit
  var prevLit = {};       // 'uid:x,y' -> was it lit last frame

  // ---- picking up / dropping ---------------------------------------------

  function pieceAtGrid(col, row) {
    var u = state.grid[idx(col, row)];
    return u ? state.pieces[u] : null;
  }

  function pickUp(piece, from, slotOrCR) {
    state.held = { piece: piece, from: from, slot: from === 'tray' ? slotOrCR : null, col: from === 'grid' ? slotOrCR[0] : null, row: from === 'grid' ? slotOrCR[1] : null };
    if (from === 'grid') clearFromBoard(piece);
    document.getElementById('btn-rotate').classList.remove('hidden');
  }

  function dropHeldAt(col, row) {
    var h = state.held;
    if (!h) return;
    var piece = h.piece;
    var shape = shapeFor(piece);
    var check = checkPlacement(piece, shape.cells, col, row);
    if (!check.valid) {
      toast(check.reason);
      returnHeld();
      return;
    }
    if (check.action === 'merge') {
      if (h.from === 'tray') state.tray[h.slot] = null;
      mergeInto(piece, check.targetUid);
    } else {
      placePieceAt(piece, col, row, h.from === 'tray' ? h.slot : null);
    }
    state.held = null;
    document.getElementById('btn-rotate').classList.add('hidden');
    updateButtons();
  }

  function returnHeld() {
    var h = state.held;
    if (!h) return;
    if (h.from === 'grid') placePieceAt(h.piece, h.col, h.row, null);
    state.held = null;
    document.getElementById('btn-rotate').classList.add('hidden');
  }

  function rotateHeld() {
    var h = state.held;
    if (!h) return;
    h.piece.rot = (h.piece.rot + 1) % 4;
    h.rotStartT = now();
  }

  // ---- fight -------------------------------------------------------------

  var BASELINE_DMG = 5, BASELINE_RATE = 1.2;   // the frog pokes with a stick even with an empty page
  var RAT_SPEED = 46;                          // px/s
  var FROG_X = 62, GROUND_Y = FIGHT_H - 46;
  var castCool = {};                            // uid (or 'base') -> seconds until next cast

  function waveRatCount(wave) { return 3 + wave; }

  function startFight() {
    state.phase = 'fight';
    state.rats = [];
    state.bolts = [];
    state.dmgTexts = [];
    state.kills = 0;
    castCool = { base: 1 / BASELINE_RATE };
    Object.keys(state.pieces).forEach(function (uid) {
      var p = state.pieces[uid];
      if (p.kind === 'spell') castCool[uid] = 1 / (Meta.SPELLS[p.type].rate);
    });
    var boss = state.level.bosses && state.level.bosses[state.wave];
    var n = boss ? 1 : waveRatCount(state.wave);
    for (var i = 0; i < n; i++) {
      state.rats.push({
        id: 'r' + i, boss: !!boss, name: boss || null,
        x: 400 + i * 70, hp: boss ? 90 : 16, hpMax: boss ? 90 : 16, dead: false, t: Math.random() * 10,
      });
    }
    updateButtons();
  }

  function ingredientBonusesFor(spellUid) {
    // an ingredient piece touching this spell piece's footprint buffs it (fight link).
    var spell = state.pieces[spellUid];
    var shape = shapeFor(spell);
    var fp = footprintAt(shape.cells, spell.col, spell.row);
    var bonus = 0;
    var seen = {};
    fp.forEach(function (cr) {
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var c = cr[0] + d[0], r = cr[1] + d[1];
        if (!inBounds(c, r)) return;
        var u = state.grid[idx(c, r)];
        if (!u || seen[u]) return;
        var pc = state.pieces[u];
        if (pc.kind !== 'ingredient') return;
        seen[u] = true;
        bonus += Meta.INGREDIENTS[pc.type].v[pc.tier] * 3;
      });
    });
    return bonus;
  }

  function litStarsFor(uid) {
    var piece = state.pieces[uid];
    var shape = shapeFor(piece);
    var lit = {};
    Object.keys(shape.stars).forEach(function (key) {
      var want = shape.stars[key];
      var parts = key.split(',').map(Number);
      var c = piece.col + parts[0], r = piece.row + parts[1];
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nc = c + d[0], nr = r + d[1];
        if (!inBounds(nc, nr)) return;
        var u = state.grid[idx(nc, nr)];
        if (!u) return;
        var pc = state.pieces[u];
        if (pc.kind === 'ingredient' && ELEMENT[pc.type] === want) lit[key] = true;
      });
    });
    return lit;
  }

  function nearestRat() {
    var best = null;
    state.rats.forEach(function (r) {
      if (r.dead) return;
      if (!best || r.x < best.x) best = r;
    });
    return best;
  }

  function damageRat(rat, dmg) {
    rat.hp -= dmg;
    state.dmgTexts.push({ x: rat.x, y: GROUND_Y - 70, t0: now(), text: Math.round(dmg) + '' });
    if (rat.hp <= 0 && !rat.dead) {
      rat.dead = true;
      state.kills++;
      state.gold += rat.boss ? Meta.GOLD_PER_KILL.boss : 1;
    }
  }

  function stepFight(dt) {
    // rats walk in
    state.rats.forEach(function (r) {
      if (r.dead) return;
      r.t += dt;
      r.x -= RAT_SPEED * dt;
      if (r.x <= FROG_X + 26) {
        r.x = FROG_X + 26;
        state.frogHp -= 6 * dt;
      }
    });
    // baseline poke
    castCool.base -= dt;
    if (castCool.base <= 0) {
      castCool.base += 1 / BASELINE_RATE;
      var target = nearestRat();
      if (target) fireBolt('arcane', target, BASELINE_DMG, FROG_X + 20, GROUND_Y - 60);
    }
    // spell pieces
    Object.keys(state.pieces).forEach(function (uid) {
      var p = state.pieces[uid];
      if (p.kind !== 'spell') return;
      if (castCool[uid] === undefined) castCool[uid] = 1 / Meta.SPELLS[p.type].rate;
      castCool[uid] -= dt;
      if (castCool[uid] > 0) return;
      castCool[uid] += 1 / Meta.SPELLS[p.type].rate;
      var t = nearestRat();
      if (!t) return;
      var lit = litStarsFor(Number(uid));
      var litN = Object.keys(lit).length;
      var dmg = Meta.SPELLS[p.type].dmg * Meta.TIER_MULT[p.tier] * (1 + 0.5 * litN) + ingredientBonusesFor(Number(uid));
      fireBolt(Meta.SPELLS[p.type].element, t, dmg, FROG_X + 20, GROUND_Y - 60);
    });
    // bolts travel
    state.bolts.forEach(function (b) {
      var dx = b.tx - b.x, dy = b.ty - b.y;
      var d = Math.hypot(dx, dy);
      var step = 420 * dt;
      if (step >= d) { b.hit = true; damageRat(b.rat, b.dmg); }
      else { b.x += dx / d * step; b.y += dy / d * step; }
    });
    state.bolts = state.bolts.filter(function (b) { return !b.hit; });
    state.rats = state.rats.filter(function (r) { return !(r.dead && now() - (r.deadT || (r.deadT = now())) > 400); });

    var aliveOrTravelling = state.rats.some(function (r) { return !r.dead; }) || state.bolts.length > 0;
    if (state.frogHp <= 0) { state.phase = 'lost'; updateButtons(); return; }
    if (!aliveOrTravelling) endFight();
  }

  function fireBolt(element, rat, dmg, fx, fy) {
    state.bolts.push({ x: fx, y: fy, tx: rat.x, ty: GROUND_Y - 20, rat: rat, dmg: dmg, element: element, hit: false, t0: now() });
  }

  function endFight() {
    var boss = state.level.bosses && state.level.bosses[state.wave];
    state.gold += 10;   // +10 gold per cleared wave (SPEC.md economy)
    if (boss || state.wave >= state.level.waves) {
      state.phase = 'won';
      updateButtons();
      return;
    }
    state.wave++;
    revealCells(3);
    state.rerollN = 0;
    makeOffers(false);
    state.phase = 'build';
    state.firstBreak = false;
    updateButtons();
  }

  // ---- DOM buttons -----------------------------------------------------------

  var btnPlay = document.getElementById('btn-play');
  var btnReroll = document.getElementById('btn-reroll');
  var btnRotate = document.getElementById('btn-rotate');
  var btnHelp = document.getElementById('btn-help');
  var btnRetry = document.getElementById('btn-retry');
  var howto = document.getElementById('howto');

  function anyPieceOnGrid() { return Object.keys(state.pieces).length > 0; }

  function updateButtons() {
    var canPlay = state.phase === 'build' && (!state.firstBreak || anyPieceOnGrid());
    btnPlay.disabled = !canPlay;
    btnReroll.disabled = state.phase !== 'build';
    btnReroll.textContent = 'Reroll' + (rerollCost() > 0 ? ' (' + rerollCost() + ')' : ' (free)');
    var over = state.phase === 'lost' || state.phase === 'won';
    btnRetry.classList.toggle('hidden', !over);
    btnPlay.classList.toggle('hidden', over);
    btnReroll.classList.toggle('hidden', over);
  }

  btnPlay.addEventListener('pointerup', function () { if (!btnPlay.disabled) startFight(); });
  btnReroll.addEventListener('pointerup', function () { if (!btnReroll.disabled) doReroll(); });
  btnRotate.addEventListener('pointerup', function (e) { e.stopPropagation(); rotateHeld(); });
  btnHelp.addEventListener('pointerup', function () { howto.classList.remove('hidden'); });
  document.getElementById('btn-howto-close').addEventListener('pointerup', function () { howto.classList.add('hidden'); });
  btnRetry.addEventListener('pointerup', function () { location.reload(); });

  // ---- pointer input on the canvas -------------------------------------------

  var canvas = document.getElementById('stage');

  function hitTray(x, y) {
    if (y < TRAY_Y || y > TRAY_Y + TRAY_SLOT) return -1;
    for (var i = 0; i < TRAY_COUNT; i++) {
      var sx = TRAY_X + i * (TRAY_SLOT + TRAY_GAP);
      if (x >= sx && x <= sx + TRAY_SLOT) return i;
    }
    return -1;
  }

  function hitGridCell(x, y) {
    if (x < GRID_X || y < GRID_Y || x >= GRID_X + GRID_W || y >= GRID_Y + GRID_H) return null;
    return [Math.floor((x - GRID_X) / CELL), Math.floor((y - GRID_Y) / CELL)];
  }

  function hitOffer(x, y) {
    if (y < SHOP_Y || y > SHOP_Y + SHOP_CARD_H) return -1;
    for (var i = 0; i < 3; i++) {
      var sx = SHOP_X + i * (SHOP_CARD_W + SHOP_GAP);
      if (x >= sx && x <= sx + SHOP_CARD_W) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (W / rect.width);
    var y = (e.clientY - rect.top) * (H / rect.height);
    state.downX = x; state.downY = y; state.dragMoved = false;

    if (state.phase !== 'build') return;

    if (!state.held) {
      var trayI = hitTray(x, y);
      if (trayI !== -1 && state.tray[trayI]) {
        state._downPick = { kind: 'tray', slot: trayI };
        return;
      }
      var cell = hitGridCell(x, y);
      if (cell) {
        var pc = pieceAtGrid(cell[0], cell[1]);
        if (pc) state._downPick = { kind: 'grid', col: pc.col, row: pc.row, piece: pc };
      }
      var offerI = hitOffer(x, y);
      if (offerI !== -1) state._downPick = { kind: 'offer', i: offerI };
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (W / rect.width);
    var y = (e.clientY - rect.top) * (H / rect.height);
    if (Math.hypot(x - state.downX, y - state.downY) > DRAG_THRESHOLD) {
      state.dragMoved = true;
      if (!state.held && state._downPick && state._downPick.kind !== 'offer') {
        var dp = state._downPick;
        if (dp.kind === 'tray') pickUp(state.tray[dp.slot], 'tray', dp.slot);
        else pickUp(dp.piece, 'grid', [dp.col, dp.row]);
        state._downPick = null;
      }
    }
    if (state.held) { state.held.px = x; state.held.py = y; }
  });

  canvas.addEventListener('pointerup', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (W / rect.width);
    var y = (e.clientY - rect.top) * (H / rect.height);

    if (state.phase !== 'build') { state._downPick = null; return; }

    if (state.held && state.dragMoved) {
      var cell = hitGridCell(x, y);
      if (cell) dropHeldAt(cell[0], cell[1]); else { toast('Off the edge of the page'); returnHeld(); }
      state._downPick = null;
      return;
    }

    // a tap (no drag past threshold)
    var dp = state._downPick;
    state._downPick = null;
    if (state.held) {
      var cell2 = hitGridCell(x, y);
      if (cell2) { dropHeldAt(cell2[0], cell2[1]); return; }
      // tapping the held piece itself (or anywhere else non-grid) rotates it
      rotateHeld();
      return;
    }
    if (!dp) return;
    if (dp.kind === 'offer') { buyOffer(dp.i); return; }
    if (dp.kind === 'tray') { pickUp(state.tray[dp.slot], 'tray', dp.slot); return; }
    if (dp.kind === 'grid') { pickUp(dp.piece, 'grid', [dp.col, dp.row]); return; }
  });

  // ---- drawing -----------------------------------------------------------

  var ctx = canvas.getContext('2d');

  function drawStar(x, y, r, lit, sparkleP) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rad = i % 2 === 0 ? r : r * 0.45;
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var px = Math.cos(a) * rad, py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = lit ? C.gold : '#4A4560';
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (lit && sparkleP > 0) {
      ctx.globalAlpha = 1 - sparkleP;
      ctx.beginPath();
      ctx.arc(0, 0, r * (1 + sparkleP * 1.8), 0, Math.PI * 2);
      ctx.strokeStyle = '#FFF3C4';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function shapeBounds(cells) {
    var maxx = Math.max.apply(null, cells.map(function (p) { return p[0]; }));
    var maxy = Math.max.apply(null, cells.map(function (p) { return p[1]; }));
    return { w: maxx + 1, h: maxy + 1 };
  }

  // Draws a piece's shape (footprint outline, fill, stars, icon) at pixel origin
  // (px,py) top-left, using cell size `cs`. `lit` is the star-lit map for this uid.
  function drawPieceShape(piece, shape, px, py, cs, lit, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var tierColor = Art.COLORS['tier' + piece.tier] || Art.COLORS.tier1;
    shape.cells.forEach(function (cell) {
      var cx = px + cell[0] * cs, cy = py + cell[1] * cs;
      ctx.fillStyle = tierColor;
      ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.9;
      ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2);
    });
    var b = shapeBounds(shape.cells);
    var midx = px + b.w * cs / 2, midy = py + b.h * cs / 2;
    if (piece.kind === 'spell') {
      Art.bolt(ctx, midx, midy, cs * 0.62, Meta.SPELLS[piece.type].element, 0, now() / 1000);
    } else {
      ctx.save();
      ctx.beginPath();
      shape.cells.forEach(function (cell) { ctx.rect(px + cell[0] * cs, py + cell[1] * cs, cs, cs); });
      ctx.clip();
      Art.ingredient(ctx, midx, midy, cs * 0.98, piece.type, piece.tier);
      ctx.restore();
    }
    Object.keys(shape.stars).forEach(function (key) {
      var parts = key.split(',').map(Number);
      var sx = px + (parts[0] + 0.5) * cs, sy = py + (parts[1] + 0.05) * cs;
      var isLit = !!(lit && lit[key]);
      var sparkleP = 0;
      var sp = starSparkle[piece.uid + ':' + key];
      if (sp) sparkleP = Math.min(1, (now() - sp) / 400);
      drawStar(sx, sy, cs * 0.16, isLit, isLit ? sparkleP : 0);
    });
    ctx.restore();
  }

  function drawFight(t, dt) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, FIGHT_H);
    ctx.clip();
    Art.sceneryB(ctx, W, FIGHT_H / 0.55, t, 1);
    ctx.restore();

    Art.frogSide(ctx, FROG_X, GROUND_Y, 90, C.skinLeaf, '#5B6CFF', C.gem, t, state.bolts.length > 0);

    state.rats.forEach(function (r) {
      if (r.boss) Art.boss(ctx, r.x, GROUND_Y, 100, r.name, t, false);
      else Art.ratSide(ctx, r.x, GROUND_Y, 46, 'runt', t, null);
      // health bar
      var hbw = r.boss ? 70 : 34;
      ctx.fillStyle = 'rgba(20,15,35,0.6)';
      ctx.fillRect(r.x - hbw / 2, GROUND_Y - (r.boss ? 108 : 66), hbw, 6);
      ctx.fillStyle = C.bad;
      ctx.fillRect(r.x - hbw / 2, GROUND_Y - (r.boss ? 108 : 66), hbw * Math.max(0, r.hp / r.hpMax), 6);
    });

    state.bolts.forEach(function (b) {
      var ang = Math.atan2(b.ty - b.y, b.tx - b.x);
      Art.bolt(ctx, b.x, b.y, 20, b.element, ang, t);
    });

    state.dmgTexts = state.dmgTexts.filter(function (d) { return now() - d.t0 < 700; });
    state.dmgTexts.forEach(function (d) {
      var p = (now() - d.t0) / 700;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#fff';
      ctx.font = '700 15px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('-' + d.text, d.x, d.y - p * 24);
      ctx.restore();
    });

    ctx.fillStyle = '#fff';
    ctx.font = '700 15px "Titan One", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WAVE ' + state.wave + ' / ' + state.level.waves, 12, 24);
    ctx.textAlign = 'right';
    ctx.fillStyle = C.coin;
    ctx.fillText(Math.round(state.gold) + 'g', W - 12, 24);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = '12px Kreon, Georgia, serif';
    ctx.fillText('frog ' + Math.max(0, Math.round(state.frogHp)) + '/' + state.frogHpMax, 12, 42);

    if (state.phase === 'lost' || state.phase === 'won') {
      ctx.save();
      ctx.fillStyle = 'rgba(20,15,35,0.45)';
      ctx.fillRect(0, 0, W, FIGHT_H);
      ctx.fillStyle = '#fff';
      ctx.font = '700 30px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.phase === 'lost' ? 'Defeated on wave ' + state.wave : 'Victory', W / 2, FIGHT_H / 2);
      ctx.restore();
    }
  }

  function drawBuild(t) {
    ctx.fillStyle = C.parchment;
    ctx.fillRect(0, FIGHT_H, W, H - FIGHT_H);
    ctx.strokeStyle = C.goldTrim;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, FIGHT_H); ctx.lineTo(W, FIGHT_H); ctx.stroke();

    ctx.fillStyle = C.ink;
    ctx.font = '700 15px Kreon, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('Grimoire Page', 14, HEADER_Y);
    if (state.phase !== 'build') {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#7A6A50';
      ctx.font = '13px Kreon, Georgia, serif';
      ctx.fillText('locked during the fight', W - 14, HEADER_Y);
    }

    // tray slots
    for (var i = 0; i < TRAY_COUNT; i++) {
      var sx = TRAY_X + i * (TRAY_SLOT + TRAY_GAP);
      ctx.fillStyle = 'rgba(36,27,58,0.10)';
      ctx.fillRect(sx, TRAY_Y, TRAY_SLOT, TRAY_SLOT);
      ctx.strokeStyle = '#B79A6B';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx, TRAY_Y, TRAY_SLOT, TRAY_SLOT);
      var tp = state.tray[i];
      if (tp && !(state.held && state.held.from === 'tray' && state.held.slot === i)) {
        var shape = shapeFor(tp);
        var b = shapeBounds(shape.cells);
        var cs = Math.min((TRAY_SLOT - 4) / b.w, (TRAY_SLOT - 4) / b.h);
        drawPieceShape(tp, shape, sx + 2, TRAY_Y + 2, cs, null, 1);
      }
    }

    // grid cells
    for (var r = 0; r < GRID_ROWS; r++) {
      for (var c = 0; c < GRID_COLS; c++) {
        var cx = GRID_X + c * CELL, cy = GRID_Y + r * CELL;
        var unlocked = state.unlocked[idx(c, r)];
        ctx.fillStyle = unlocked ? 'rgba(36,27,58,0.06)' : 'rgba(36,27,58,0.35)';
        ctx.fillRect(cx, cy, CELL, CELL);
        ctx.strokeStyle = unlocked ? '#B79A6B' : '#6E5F45';
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, CELL, CELL);
      }
    }
    // tearing flash on newly revealed cells
    state.tearing = state.tearing.filter(function (tr) { return now() - tr.t0 < 600; });
    state.tearing.forEach(function (tr) {
      var p = (now() - tr.t0) / 600;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#fff';
      ctx.fillRect(GRID_X + tr.c * CELL, GRID_Y + tr.r * CELL, CELL, CELL);
      ctx.restore();
    });

    // placed pieces
    Object.keys(state.pieces).forEach(function (uid) {
      if (state.held && state.held.piece.uid === Number(uid)) return;
      var p = state.pieces[uid];
      var shape = shapeFor(p);
      var px = GRID_X + p.col * CELL, py = GRID_Y + p.row * CELL;
      var lit = litStarsFor(p.uid);
      Object.keys(shape.stars).forEach(function (k) {
        var key = p.uid + ':' + k, isLit = !!lit[k];
        if (isLit && !prevLit[key]) starSparkle[key] = now();
        prevLit[key] = isLit;
      });
      var scale = 1;
      var bt = bounces[uid];
      if (bt !== undefined) {
        var bp = (now() - bt) / 220;
        if (bp >= 1) delete bounces[uid]; else scale = 1 + Math.sin(bp * Math.PI) * 0.12;
      }
      var fl = flashes[uid];
      ctx.save();
      if (scale !== 1) {
        var mx = px + shapeBounds(shape.cells).w * CELL / 2, my = py + shapeBounds(shape.cells).h * CELL / 2;
        ctx.translate(mx, my); ctx.scale(scale, scale); ctx.translate(-mx, -my);
      }
      drawPieceShape(p, shape, px, py, CELL, lit, 1);
      if (fl !== undefined) {
        var fp = (now() - fl) / 350;
        if (fp >= 1) delete flashes[uid];
        else {
          ctx.globalAlpha = 1 - fp;
          ctx.fillStyle = '#fff';
          shape.cells.forEach(function (cell) { ctx.fillRect(px + cell[0] * CELL, py + cell[1] * CELL, CELL, CELL); });
        }
      }
      ctx.restore();

      if (state.phase === 'fight' && p.kind === 'spell') {
        var cd = castCool[uid];
        var total = 1 / Meta.SPELLS[p.type].rate;
        var frac = cd !== undefined ? 1 - Math.max(0, cd) / total : 0;
        var b2 = shapeBounds(shape.cells);
        var ringx = px + b2.w * CELL / 2, ringy = py + b2.h * CELL / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(36,27,58,0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ringx, ringy, Math.min(b2.w, b2.h) * CELL / 2 - 3, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = C.gold;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(ringx, ringy, Math.min(b2.w, b2.h) * CELL / 2 - 3, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    });

    // held piece: lift, shadow, drag/tap position, footprint preview
    if (state.held) {
      var h = state.held;
      var shapeH = shapeFor(h.piece);
      var b3 = shapeBounds(shapeH.cells);
      var wpx = b3.w * CELL, hpx = b3.h * CELL;
      var px2, py2;
      if (state.dragMoved || h.px !== undefined) {
        px2 = (h.px !== undefined ? h.px : GRID_X) - wpx / 2;
        py2 = (h.py !== undefined ? h.py : GRID_Y) - hpx / 2;
      } else {
        px2 = GRID_X + (h.col !== null ? h.col : 0) * CELL;
        py2 = GRID_Y + (h.row !== null ? h.row : 0) * CELL;
      }
      var cellUnderX = h.px !== undefined ? h.px : px2 + wpx / 2;
      var cellUnderY = h.py !== undefined ? h.py : py2 + hpx / 2;
      var col0 = Math.round((cellUnderX - GRID_X - wpx / 2) / CELL);
      var row0 = Math.round((cellUnderY - GRID_Y - hpx / 2) / CELL);

      if (cellUnderX >= GRID_X && cellUnderX <= GRID_X + GRID_W && cellUnderY >= GRID_Y && cellUnderY <= GRID_Y + GRID_H) {
        var check = checkPlacement(h.piece, shapeH.cells, col0, row0);
        ctx.save();
        check.fp.forEach(function (cr) {
          if (!inBounds(cr[0], cr[1])) return;
          ctx.fillStyle = check.valid ? 'rgba(84,214,58,0.45)' : 'rgba(255,77,99,0.45)';
          ctx.fillRect(GRID_X + cr[0] * CELL, GRID_Y + cr[1] * CELL, CELL, CELL);
        });
        ctx.restore();
      }

      // shadow
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(px2 + wpx / 2, py2 + hpx + 5, wpx * 0.45, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.translate(px2 + wpx / 2, py2 + hpx / 2);
      ctx.scale(1.12, 1.12);
      var rotP = h.rotStartT !== undefined ? Math.min(1, (now() - h.rotStartT) / 150) : 1;
      if (rotP < 1) ctx.rotate((1 - rotP) * -Math.PI / 2);
      ctx.translate(-(px2 + wpx / 2), -(py2 + hpx / 2));
      drawPieceShape(h.piece, shapeH, px2, py2, CELL, {}, 1);
      ctx.restore();
    }

    // shop
    ctx.fillStyle = C.ink;
    ctx.font = '700 12px Kreon, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('Shop', SHOP_X, SHOP_Y - 4);
    state.offers.forEach(function (o, i) {
      var sx = SHOP_X + i * (SHOP_CARD_W + SHOP_GAP);
      var affordable = !o.sold && state.gold >= o.price;
      ctx.save();
      ctx.globalAlpha = o.sold ? 0.35 : (affordable ? 1 : 0.55);
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx, SHOP_Y, SHOP_CARD_W, SHOP_CARD_H);
      var tierColor = Art.COLORS['tier' + o.tier] || Art.COLORS.tier1;
      ctx.strokeStyle = tierColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx, SHOP_Y, SHOP_CARD_W, SHOP_CARD_H);
      var name = o.kind === 'spell' ? Meta.SPELLS[o.type].name : Meta.INGREDIENTS[o.type].name;
      var fakePiece = { kind: o.kind, type: o.type, tier: o.tier, rot: 0, uid: -1 };
      var shapeO = shapeFor(fakePiece);
      var bO = shapeBounds(shapeO.cells);
      var cs = Math.min((SHOP_CARD_W - 16) / bO.w, 34 / bO.h);
      drawPieceShape(fakePiece, shapeO, sx + (SHOP_CARD_W - bO.w * cs) / 2, SHOP_Y + 6, cs, null, 1);
      ctx.fillStyle = C.ink;
      ctx.font = '10px Kreon, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, sx + SHOP_CARD_W / 2, SHOP_Y + SHOP_CARD_H - 20);
      ctx.font = '700 13px "Titan One", sans-serif';
      ctx.fillStyle = o.sold ? '#7A6A50' : C.buyShade;
      ctx.fillText(o.sold ? 'SOLD' : o.price + 'g', sx + SHOP_CARD_W / 2, SHOP_Y + SHOP_CARD_H - 6);
      if (state.firstBreak && affordable && i === 0 && !anyPieceOnGrid() && Object.keys(state.pieces).length === 0 && state.tray.every(function (t) { return !t; })) {
        var pulse = 0.5 + 0.5 * Math.sin(now() / 220);
        ctx.strokeStyle = 'rgba(255,194,61,' + (0.4 + 0.5 * pulse) + ')';
        ctx.lineWidth = 4;
        ctx.strokeRect(sx - 2, SHOP_Y - 2, SHOP_CARD_W + 4, SHOP_CARD_H + 4);
      }
      ctx.restore();
    });
    if (state.firstBreak && state.phase === 'build' && !anyPieceOnGrid()) {
      ctx.fillStyle = C.ink;
      ctx.font = '12px Kreon, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('Buy a piece, then place it on the page to begin', W / 2, SHOP_Y + SHOP_CARD_H + 34);
    }

    if (state.phase === 'fight') {
      ctx.save();
      ctx.fillStyle = 'rgba(36,27,58,0.32)';
      ctx.fillRect(0, FIGHT_H, W, H - FIGHT_H);
      // small padlock, top right of the build panel
      var lx = W - 26, ly = HEADER_Y - 10;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(lx, ly - 3, 5, Math.PI, 0); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx - 7, ly - 4, 14, 10);
      ctx.restore();
    }
  }

  var lastT = now();
  function frame() {
    var t = now();
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    ctx.clearRect(0, 0, W, H);
    if (state.phase === 'fight') stepFight(dt);
    drawFight(t / 1000, dt);
    drawBuild(t / 1000);
    requestAnimationFrame(frame);
  }
  updateButtons();
  requestAnimationFrame(frame);

  // ---- responsive scale (phone frame on wide screens, edge to edge on narrow) --

  var phone = document.getElementById('phone');
  function layoutScale() {
    var vw = window.innerWidth, vh = window.innerHeight;
    var full = vw <= 500;
    phone.classList.toggle('fullscreen', full);
    var scale = Math.min(vw / W, vh / H, full ? 4 : 1);
    phone.style.transform = 'scale(' + scale + ')';
    if (full) {
      phone.style.position = 'fixed';
      phone.style.left = Math.round((vw - W * scale) / 2) + 'px';
      phone.style.top = Math.round((vh - H * scale) / 2) + 'px';
    } else {
      phone.style.position = 'relative';
      phone.style.left = '0'; phone.style.top = '0';
    }
  }
  window.addEventListener('resize', layoutScale);
  layoutScale();

  // ---- test hook ---------------------------------------------------------

  window.__grimoire = {
    state: state,
    layout: {
      W: W, H: H, FIGHT_H: FIGHT_H,
      GRID_X: GRID_X, GRID_Y: GRID_Y, CELL: CELL, GRID_COLS: GRID_COLS, GRID_ROWS: GRID_ROWS,
      TRAY_X: TRAY_X, TRAY_Y: TRAY_Y, TRAY_SLOT: TRAY_SLOT, TRAY_GAP: TRAY_GAP,
      SHOP_X: SHOP_X, SHOP_Y: SHOP_Y, SHOP_CARD_W: SHOP_CARD_W, SHOP_CARD_H: SHOP_CARD_H, SHOP_GAP: SHOP_GAP,
    },
    getSummary: function () {
      return {
        phase: state.phase, wave: state.wave, gold: state.gold,
        piecesOnGrid: Object.keys(state.pieces).length,
        maxTier: Object.keys(state.pieces).reduce(function (m, u) { return Math.max(m, state.pieces[u].tier); }, 0),
        trayCount: state.tray.filter(Boolean).length,
      };
    },
  };
})();
