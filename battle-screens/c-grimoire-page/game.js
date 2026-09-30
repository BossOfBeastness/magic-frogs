/* Grimoire Page: battle screen prototype C, version 2. Shaped spell and
   ingredient pieces are packed and rotated on a spellbook page, Backpack
   Battles style. Pure canvas 2D, no build step. Uses Art (../../art.js) for
   the frog, rats, boss, bolts and ingredient icons, and Meta (../../meta.js)
   for spell/ingredient names, tiers and prices. Everything else (piece
   shapes, fuse/absorb rules, combo list, fight pacing, panel slide) is this
   prototype's own tuning; it does not touch Art or Meta.

   Version 2 changes (SPEC.md "C version 2: the winner, refined"): stars are
   gone. Merge stays. Fusing (drop a spell on a different spell) and
   absorbing (drop an ingredient on a spell) are new. Spells cast in reading
   order each round, with a numbered ribbon and gold combo arrows on the
   page, and combo names popping up over rats in the fight. The grimoire
   page and shop tray slide as in Gun Hero: the shop is fully hidden during
   a wave and slides up from underneath the page between waves. */
(function () {
  'use strict';

  var W = 390, H = 844;
  var FIGHT_H = 354;               // fight canvas height (top of the phone)

  // ---- the grimoire page canvas (local coordinates, 0,0 at its own top-left) --
  var PAGE_H = 298;
  var HEADER_Y = 18;
  var TRAY_Y = 30;
  var TRAY_SLOT = 38, TRAY_GAP = 8;
  var TRAY_COUNT = 3;
  var TRAY_W = TRAY_COUNT * TRAY_SLOT + (TRAY_COUNT - 1) * TRAY_GAP;
  var TRAY_X = Math.round((W - TRAY_W) / 2);
  var GRID_COLS = 7, GRID_ROWS = 6, CELL = 36;
  var GRID_W = GRID_COLS * CELL, GRID_H = GRID_ROWS * CELL;
  var GRID_X = Math.round((W - GRID_W) / 2);
  var GRID_Y = 82;

  // ---- the shop tray canvas (local coordinates) -------------------------------
  var SHOP_H = 164;
  var SHOP_LABEL_Y = 14;
  var SHOP_Y = 22;
  var SHOP_CARD_W = 100, SHOP_CARD_H = 78, SHOP_GAP = 8;
  var SHOP_W = 3 * SHOP_CARD_W + 2 * SHOP_GAP;
  var SHOP_X = Math.round((W - SHOP_W) / 2);

  var DRAG_THRESHOLD = 8;

  var C = Art.COLORS;

  // ---- piece shapes (this prototype's own tuning; see report) ----------------

  var SPELL_DEFS = {
    missile: { cells: [[0, 0]] },
    ember:   { cells: [[0, 0], [0, 1], [1, 1]] },
    frost:   { cells: [[0, 0], [0, 1], [0, 2]] },
    blast:   { cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    venom:   { cells: [[0, 0], [1, 0]] },
    spark:   { cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  };
  var ING_TWO_CELL = { shade: 1, storm: 1, quick: 1 };
  var ING_DEFS = {};
  Meta.INGREDIENT_TYPES.forEach(function (t) {
    ING_DEFS[t] = ING_TWO_CELL[t] ? { cells: [[0, 0], [1, 0]] } : { cells: [[0, 0]] };
  });

  function defFor(kind, type) { return kind === 'spell' ? SPELL_DEFS[type] : ING_DEFS[type]; }

  function rotateCells(cells, times) {
    var c = cells.map(function (p) { return p.slice(); });
    for (var i = 0; i < times; i++) {
      c = c.map(function (p) { return [p[1], -p[0]]; });
      var minx = Math.min.apply(null, c.map(function (p) { return p[0]; }));
      var miny = Math.min.apply(null, c.map(function (p) { return p[1]; }));
      c = c.map(function (p) { return [p[0] - minx, p[1] - miny]; });
    }
    return c;
  }

  // A fused piece stores its own canonical (rot 0) cell list on the piece
  // itself (piece.fusedCells), since its shape does not come from SPELL_DEFS.
  function baseCellsFor(piece) {
    if (piece.type === 'fusion') return piece.fusedCells;
    return defFor(piece.kind, piece.type).cells;
  }

  function shapeFor(piece) {
    return { cells: rotateCells(baseCellsFor(piece), piece.rot % 4) };
  }

  // ---- spell stats: base spells, and fused/absorbed pieces --------------------

  // Combos (SPEC.md "Fusing and order, first numbers", agreed 2026-09-30):
  // a status a rat is already carrying, met by the trigger element of the
  // spell now hitting it.
  var STATUS_ELEMENT = { fire: 'burning', ice: 'frozen', poison: 'poisoned' };
  var TRIGGER_ELEMENTS = { blast: true, storm: true };
  var COMBOS = [
    { status: 'frozen', trigger: 'blast', name: 'Shatter', color: C.ice },
    { status: 'poisoned', trigger: 'fire', name: 'Ignite', color: C.fire },
    { status: 'frozen', trigger: 'storm', name: 'Conduct', color: C.storm },
    { status: 'burning', trigger: 'storm', name: 'Overload', color: C.fire },
    { status: 'poisoned', trigger: 'blast', name: 'Plague Cloud', color: C.poison },
  ];
  var STATUS_DUR = 4.0;    // seconds a status stays live for combo purposes

  // Damage/rate/effects for one spell instance, before absorbed ingredients.
  function baseProfile(piece) {
    if (piece.type === 'fusion') {
      var f = piece.fusion;
      return { name: f.name, dmg: f.dmg * Meta.TIER_MULT[piece.tier], rate: f.rate, elements: [f.elementA, f.elementB], effects: f.effects };
    }
    var s = Meta.SPELLS[piece.type];
    var eff = [];
    if (s.burn) eff.push({ stat: 'burn', value: s.burn });
    if (s.slow) eff.push({ stat: 'slow', value: s.slow });
    if (s.poison) eff.push({ stat: 'poison', value: s.poison });
    if (s.splash) eff.push({ stat: 'splash', value: s.splash });
    if (s.chain) eff.push({ stat: 'chain', value: s.chain });
    return { name: s.name, dmg: s.dmg * Meta.TIER_MULT[piece.tier], rate: s.rate, elements: [s.element], effects: eff };
  }

  // What this spell's up-to-2 absorbed ingredients add, keyed by stat.
  function gainsFor(piece) {
    var g = {};
    (piece.absorbed || []).forEach(function (a) { g[a.stat] = (g[a.stat] || 0) + a.value; });
    return g;
  }

  // The statuses this piece can apply on hit (its own element, plus any
  // status absorbed from an ingredient of a different element).
  function statusesOf(piece) {
    var prof = baseProfile(piece), g = gainsFor(piece), set = {};
    prof.elements.forEach(function (el) { if (STATUS_ELEMENT[el]) set[STATUS_ELEMENT[el]] = true; });
    if (g.burn) set.burning = true;
    if (g.slow) set.frozen = true;
    if (g.poison) set.poisoned = true;
    return set;
  }
  function triggersOf(piece) {
    var prof = baseProfile(piece), set = {};
    prof.elements.forEach(function (el) { if (TRIGGER_ELEMENTS[el]) set[el] = true; });
    return set;
  }
  // Does casting `b` right after `a` (in reading order) combo? Used for the
  // build-time gold-arrow hint between two placed spells.
  function comboBetween(a, b) {
    var sA = statusesOf(a), tB = triggersOf(b);
    for (var i = 0; i < COMBOS.length; i++) {
      var c = COMBOS[i];
      if (sA[c.status] && tB[c.trigger]) return c;
    }
    return null;
  }

  function firstWord(name) { return name.split(' ')[0]; }

  function fusedNameFor(typeA, typeB) {
    var evoA = (Meta.EVOLUTIONS[typeA] || []).filter(function (e) { return e.with === typeB; })[0];
    if (evoA) return evoA.name;
    var evoB = (Meta.EVOLUTIONS[typeB] || []).filter(function (e) { return e.with === typeA; })[0];
    if (evoB) return evoB.name;
    return firstWord(Meta.SPELLS[typeA].name) + ' ' + firstWord(Meta.SPELLS[typeB].name);
  }

  // ---- state -------------------------------------------------------------

  var nextUid = 1;
  var state = {
    gold: Meta.START_GOLD,
    wave: 1,
    level: Meta.LEVELS[0],
    phase: 'build',            // 'build' | 'fight' | 'lost' | 'won'
    firstBreak: true,
    pieces: {},                 // uid -> piece {uid,kind,type,tier,rot,col,row,absorbed[,fusion,fusedCells]}
    grid: new Array(GRID_COLS * GRID_ROWS).fill(null),
    unlocked: new Array(GRID_COLS * GRID_ROWS).fill(false),
    lockedQueue: [],
    tray: [null, null, null],
    offers: [],                 // [{kind,type,tier,price,sold}]
    rerollN: 0,
    held: null,                 // {piece, from:'tray'|'grid', slot|col,row, mode:'tap'|'drag', px,py, rot}
    dragMoved: false,
    downX: 0, downY: 0,
    freedFlash: [],              // {c,r,t0} cells vacated by an absorb, brief white flash
    tearing: [],                 // {c,r,t0}
    toastT: 0,
    frogHp: 30, frogHpMax: 30,
    rats: [],
    bolts: [],
    dmgTexts: [],
    combos: [],                  // {x,y,t0,name,color} popup text over a rat
    kills: 0,
    mergedEver: false, fusedEver: false, orderedEver: false,
    comboCounts: {},
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

  function makeOffers(mode) {
    var picks;
    if (mode === 'break1') {
      // Deterministic first break: two Ember Bolts (merge) and Magic Missile,
      // per SPEC.md "the first two breaks must teach the new ideas".
      picks = [{ kind: 'spell', type: 'ember' }, { kind: 'spell', type: 'ember' }, { kind: 'spell', type: 'missile' }];
    } else if (mode === 'break2') {
      // Blast Rune and Frost Shard (fuse, and ice-before-blast order), plus a
      // Frost Petal so absorbing is on the table too (this prototype's own
      // tuning; SPEC.md only names the first two).
      picks = [{ kind: 'spell', type: 'blast' }, { kind: 'spell', type: 'frost' }, { kind: 'ingredient', type: 'frost' }];
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
  makeOffers('break1');

  function buyOffer(i) {
    var o = state.offers[i];
    if (!o || o.sold) return;
    if (state.gold < o.price) { toast('Not enough gold'); return; }
    var slot = state.tray.indexOf(null);
    if (slot === -1) { toast('The page tray is full'); return; }
    state.gold -= o.price;
    o.sold = true;
    state.tray[slot] = { uid: nextUid++, kind: o.kind, type: o.type, tier: 1, rot: 0, col: null, row: null, absorbed: [] };
    updateButtons();
    maybeHint();
  }

  function rerollCost() { return Meta.rerollCost(state.rerollN); }

  function doReroll() {
    if (state.phase !== 'build') return;
    var cost = rerollCost();
    if (state.gold < cost) { toast('Not enough gold to reroll'); return; }
    state.gold -= cost;
    state.rerollN++;
    makeOffers('random');
  }

  // ---- toast -----------------------------------------------------------------

  var toastEl = document.getElementById('toast');
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('on');
    state.toastT = now();
    clearTimeout(toast._h);
    toast._h = setTimeout(function () { toastEl.classList.remove('on'); }, ms || 1400);
  }
  function hideToast() { clearTimeout(toast._h); toastEl.classList.remove('on'); }

  // ---- one-line help the first time each idea is possible ---------------------

  function allPieces() {
    var list = [];
    Object.keys(state.pieces).forEach(function (u) { list.push(state.pieces[u]); });
    state.tray.forEach(function (p) { if (p) list.push(p); });
    return list;
  }

  function maybeHint() {
    if (state.phase !== 'build') return;
    var pieces = allPieces();
    var spells = pieces.filter(function (p) { return p.kind === 'spell'; });
    if (!state.mergedEver) {
      var embers = spells.filter(function (p) { return p.type === 'ember'; });
      if (embers.length >= 2) { toast('Drop Ember Bolt on the other Ember Bolt to merge', 3000); return; }
    }
    if (!state.fusedEver) {
      var types = {};
      spells.forEach(function (p) { types[p.type] = true; });
      if (Object.keys(types).length >= 2) { toast('Drop a spell on a different spell to fuse', 3000); return; }
    }
    if (!state.orderedEver) {
      var hasFrost = spells.some(function (p) { return p.type === 'frost'; });
      var hasBlast = spells.some(function (p) { return p.type === 'blast'; });
      if (hasFrost && hasBlast) { toast('Spells cast left to right: put Frost Shard before Blast Rune', 3000); state.orderedEver = true; return; }
    }
  }

  // ---- placement legality ----------------------------------------------------

  function footprintAt(cells, col, row) {
    return cells.map(function (d) { return [col + d[0], row + d[1]]; });
  }

  function sameFusionPair(f1, f2) {
    return (f1.aType === f2.aType && f1.bType === f2.bType) || (f1.aType === f2.bType && f1.bType === f2.aType);
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
    if (occ.length !== 1) return { valid: false, reason: 'Something is already there', fp: fp };

    var target = state.pieces[occ[0]];
    var targetShape = shapeFor(target);
    var targetFp = footprintAt(targetShape.cells, target.col, target.row);
    var sameSet = targetFp.length === fp.length && targetFp.every(function (cr) {
      return fp.some(function (cr2) { return cr2[0] === cr[0] && cr2[1] === cr[1]; });
    });
    var identical = sameSet && target.kind === piece.kind && target.type === piece.type && target.tier === piece.tier;
    if (identical && piece.type === 'fusion' && !sameFusionPair(target.fusion, piece.fusion)) identical = false;
    if (identical) {
      if (piece.tier >= 5) return { valid: false, reason: 'Already at the top tier', fp: fp };
      return { valid: true, action: 'merge', targetUid: target.uid, fp: fp };
    }
    if (piece.kind === 'ingredient' && target.kind === 'spell') {
      if ((target.absorbed || []).length >= 2) return { valid: false, reason: 'Already holds two ingredients', fp: fp };
      return { valid: true, action: 'absorb', targetUid: target.uid, fp: fp };
    }
    if (piece.kind === 'spell' && target.kind === 'spell') {
      if (piece.type === 'fusion' || target.type === 'fusion') return { valid: false, reason: 'A fused spell cannot fuse again', fp: fp };
      return { valid: true, action: 'fuse', targetUid: target.uid, fp: fp };
    }
    return { valid: false, reason: 'Something is already there', fp: fp };
  }

  // ---- placing / merging / fusing / absorbing --------------------------------

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
    bounce(piece.uid, 1);
  }

  function mergeInto(piece, targetUid) {
    var target = state.pieces[targetUid];
    var col = target.col, row = target.row, rot = target.rot;
    clearFromBoard(target);
    delete state.pieces[targetUid];
    var merged = { uid: nextUid++, kind: target.kind, type: target.type, tier: target.tier + 1, rot: rot, col: null, row: null, absorbed: [] };
    if (target.type === 'fusion') { merged.fusion = target.fusion; merged.fusedCells = target.fusedCells; }
    placePieceAt(merged, col, row);
    vibrate([20, 30, 20]);
    flash(merged.uid);
    if (!state.mergedEver) hideToast();
    state.mergedEver = true;
    return merged;
  }

  // Fuses `piece` onto `target`: works out the larger shape, tries the
  // target's rotations at the target's position, and only replaces the two
  // pieces once a fit is found. Returns the new piece, or null (refused).
  function tryFuse(piece, target) {
    var defA = defFor(piece.kind, piece.type), defB = defFor(target.kind, target.type);
    var bigCells = defA.cells.length >= defB.cells.length ? defA.cells : defB.cells;
    for (var rot = 0; rot < 4; rot++) {
      var cells = rotateCells(bigCells, rot);
      var fp = footprintAt(cells, target.col, target.row);
      var ok = fp.every(function (cr) {
        if (!inBounds(cr[0], cr[1]) || !state.unlocked[idx(cr[0], cr[1])]) return false;
        var u = state.grid[idx(cr[0], cr[1])];
        return !u || u === piece.uid || u === target.uid;
      });
      if (ok) return { cells: bigCells, rot: rot, col: target.col, row: target.row };
    }
    return null;
  }

  function fuseInto(piece, targetUid, fromTraySlot) {
    var target = state.pieces[targetUid];
    var fit = tryFuse(piece, target);
    if (!fit) { toast('No room here for the fused spell'); return null; }
    var dmgA = baseProfile(piece).dmg, dmgB = baseProfile(target).dmg;
    var elA = Meta.SPELLS[piece.type] ? Meta.SPELLS[piece.type].element : piece.fusion.elementA;
    var elB = Meta.SPELLS[target.type] ? Meta.SPELLS[target.type].element : target.fusion.elementA;
    var name = fusedNameFor(piece.type, target.type);
    var effects = baseProfile(piece).effects.concat(baseProfile(target).effects);
    clearFromBoard(target);
    delete state.pieces[target.uid];
    var fused = {
      uid: nextUid++, kind: 'spell', type: 'fusion', tier: 1, rot: fit.rot, col: null, row: null,
      absorbed: [], fusedCells: fit.cells,
      fusion: {
        aType: piece.type, bType: target.type,
        dmg: 0.8 * (dmgA + dmgB), rate: (baseProfile(piece).rate + baseProfile(target).rate) / 2,
        elementA: elA, elementB: elB, name: name, effects: effects,
      },
    };
    if (fromTraySlot !== undefined && fromTraySlot !== null) state.tray[fromTraySlot] = null;
    fused.col = fit.col; fused.row = fit.row;
    footprintAt(fit.cells, fit.col, fit.row).forEach(function (cr) { state.grid[idx(cr[0], cr[1])] = fused.uid; });
    state.pieces[fused.uid] = fused;
    vibrate([20, 40, 20]);
    bounce(fused.uid, 1.6);
    flash(fused.uid);
    swirl(fused.uid, elA, elB);
    if (!state.fusedEver) hideToast();
    state.fusedEver = true;
    return fused;
  }

  function absorbInto(piece, targetUid, fromTraySlot) {
    var target = state.pieces[targetUid];
    var ing = Meta.INGREDIENTS[piece.type];
    target.absorbed = target.absorbed || [];
    target.absorbed.push({ type: piece.type, tier: piece.tier, stat: ing.stat, value: ing.v[piece.tier] * 0.8 });
    if (fromTraySlot !== undefined && fromTraySlot !== null) state.tray[fromTraySlot] = null;
    // the ingredient's cells free up: a brief flash so the player sees the
    // space they gained, per SPEC.md.
    var shape = shapeFor(target);
    var freed = piece.col !== null ? footprintAt(shapeFor(piece).cells, piece.col, piece.row) : [];
    freed.forEach(function (cr) { state.freedFlash.push({ c: cr[0], r: cr[1], t0: now() }); });
    bounce(target.uid, 1.2);
    flash(target.uid);
    vibrate(25);
  }

  function vibrate(pattern) { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ } }

  var bounces = {};   // uid -> {t0, mag}
  function bounce(uid, mag) { bounces[uid] = { t0: now(), mag: mag || 1 }; }
  var flashes = {};    // uid -> t0
  function flash(uid) { flashes[uid] = now(); }
  var swirls = {};      // uid -> {t0, colorA, colorB}
  function swirl(uid, colorA, colorB) { swirls[uid] = { t0: now(), colorA: C[colorA] || colorA, colorB: C[colorB] || colorB }; }

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
    var traySlot = h.from === 'tray' ? h.slot : null;
    // A piece dragged off the grid still has a (stale) state.pieces entry
    // until it lands somewhere; merge/fuse/absorb consume it into a
    // different piece (or make it vanish), so drop that stale entry now,
    // or it would keep drawing as a ghost at its old cells.
    if (h.from === 'grid' && check.action !== 'place') delete state.pieces[piece.uid];
    if (check.action === 'merge') {
      mergeInto(piece, check.targetUid);
      if (traySlot !== null) state.tray[traySlot] = null;
    } else if (check.action === 'fuse') {
      var fused = fuseInto(piece, check.targetUid, traySlot);
      if (!fused) { returnHeld(); return; }
    } else if (check.action === 'absorb') {
      absorbInto(piece, check.targetUid, traySlot);
    } else {
      placePieceAt(piece, col, row, traySlot);
    }
    state.held = null;
    document.getElementById('btn-rotate').classList.add('hidden');
    updateButtons();
    maybeHint();
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
  var ROUND_GAP = 0.4;                         // seconds between casts in reading order (this prototype's tuning)
  var FROG_X = 62, GROUND_Y = FIGHT_H - 46;
  var castCool = {};                            // 'base' -> seconds until next baseline poke

  function waveRatCount(wave) { return 3 + wave; }

  function spellsInOrder() {
    var list = [];
    Object.keys(state.pieces).forEach(function (u) { var p = state.pieces[u]; if (p.kind === 'spell') list.push(p); });
    list.sort(function (a, b) { return (a.row - b.row) || (a.col - b.col); });
    return list;
  }

  function startFight() {
    // The page and shop slide back down (CSS transition on updateButtons'
    // class toggle) while the fight, already drawn underneath, is revealed.
    hideToast();
    state.phase = 'fight';
    state.rats = [];
    state.bolts = [];
    state.dmgTexts = [];
    state.combos = [];
    state.kills = 0;
    castCool = { base: 1 / BASELINE_RATE };
    state.castOrder = spellsInOrder().map(function (p) { return p.uid; });
    state.roundPos = 0;
    state.roundTimer = 0;
    var boss = state.level.bosses && state.level.bosses[state.wave];
    var n = boss ? 1 : waveRatCount(state.wave);
    for (var i = 0; i < n; i++) {
      state.rats.push({
        id: 'r' + i, boss: !!boss, name: boss || null,
        x: 400 + i * 70, hp: boss ? 90 : 26, hpMax: boss ? 90 : 26, dead: false, t: Math.random() * 10,
      });
    }
    updateButtons();
  }

  function nearestRat() {
    var best = null;
    state.rats.forEach(function (r) {
      if (r.dead) return;
      if (!best || r.x < best.x) best = r;
    });
    return best;
  }

  function otherAliveRats(exclude, n) {
    return state.rats.filter(function (r) { return !r.dead && r !== exclude; })
      .sort(function (a, b) { return a.x - b.x; }).slice(0, n);
  }

  function damageRat(rat, dmg, healPerKill) {
    rat.hp -= dmg;
    state.dmgTexts.push({ x: rat.x, y: GROUND_Y - 70, t0: now(), text: Math.round(dmg) + '' });
    if (rat.hp <= 0 && !rat.dead) {
      rat.dead = true;
      state.kills++;
      state.gold += rat.boss ? Meta.GOLD_PER_KILL.boss : 1;
      if (healPerKill) state.frogHp = Math.min(state.frogHpMax, state.frogHp + healPerKill);
    }
  }

  function castSpellPiece(piece) {
    var t = nearestRat();
    if (!t) return;
    var prof = baseProfile(piece), g = gainsFor(piece);
    var dmg = prof.dmg * (1 + (g.power || 0));
    var effects = prof.effects.slice();
    if (g.burn) effects.push({ stat: 'burn', value: g.burn });
    if (g.slow) effects.push({ stat: 'slow', value: g.slow });
    if (g.poison) effects.push({ stat: 'poison', value: g.poison });
    var el = prof.elements[0];
    fireBolt(el, t, dmg, FROG_X + 20, GROUND_Y - 60, prof.elements, effects, g.heal || 0);
    if (g.rate) fireBolt(el, t, dmg, FROG_X + 20, GROUND_Y - 60, prof.elements, effects, g.heal || 0);   // Quicksilver: a bonus bolt
  }

  function stepFight(dt) {
    // rats walk in, slowed while frozen
    state.rats.forEach(function (r) {
      if (r.dead) return;
      r.t += dt;
      var slowed = r.frozenT && now() - r.frozenT < STATUS_DUR * 1000;
      r.x -= RAT_SPEED * (slowed ? 0.4 : 1) * dt;
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
      if (target) fireBolt('arcane', target, BASELINE_DMG, FROG_X + 20, GROUND_Y - 60, ['arcane'], [], 0);
    }
    // spells cast down the page in reading order, one per round-gap
    if (state.castOrder && state.castOrder.length) {
      state.roundTimer -= dt;
      if (state.roundTimer <= 0) {
        var uid = state.castOrder[state.roundPos % state.castOrder.length];
        var p = state.pieces[uid];
        if (p) castSpellPiece(p);
        state.roundPos = (state.roundPos + 1) % state.castOrder.length;
        state.roundTimer += ROUND_GAP;
      }
    }
    // bolts travel
    state.bolts.forEach(function (b) {
      var dx = b.tx - b.x, dy = b.ty - b.y;
      var d = Math.hypot(dx, dy);
      var step = 420 * dt;
      if (step >= d) { b.hit = true; resolveHit(b); }
      else { b.x += dx / d * step; b.y += dy / d * step; }
    });
    state.bolts = state.bolts.filter(function (b) { return !b.hit; });
    state.rats = state.rats.filter(function (r) { return !(r.dead && now() - (r.deadT || (r.deadT = now())) > 400); });

    var aliveOrTravelling = state.rats.some(function (r) { return !r.dead; }) || state.bolts.length > 0;
    if (state.frogHp <= 0) { state.phase = 'lost'; updateButtons(); return; }
    if (!aliveOrTravelling) endFight();
  }

  function resolveHit(bolt) {
    var rat = bolt.rat, nowT = now();
    var triggerSet = {};
    bolt.elements.forEach(function (el) { if (TRIGGER_ELEMENTS[el]) triggerSet[el] = true; });
    var matched = null;
    for (var i = 0; i < COMBOS.length; i++) {
      var c = COMBOS[i];
      var tAt = rat[c.status + 'T'];
      if (triggerSet[c.trigger] && tAt && (nowT - tAt) / 1000 < STATUS_DUR) { matched = c; break; }
    }
    var dmg = bolt.dmg;
    if (matched) {
      if (matched.name === 'Shatter') dmg *= 2;
      if (matched.name === 'Overload') dmg *= 1.5;
      state.combos.push({ x: rat.x, y: GROUND_Y - 96, t0: nowT, name: matched.name, color: matched.color });
      state.comboCounts[matched.name] = (state.comboCounts[matched.name] || 0) + 1;
      if (matched.name === 'Conduct') otherAliveRats(rat, 2).forEach(function (r2) { damageRat(r2, dmg * 0.6); });
      if (matched.name === 'Plague Cloud') otherAliveRats(rat, 3).forEach(function (r2) { if (Math.abs(r2.x - rat.x) < 70) r2.poisonedT = nowT; });
      if (matched.name === 'Ignite') otherAliveRats(rat, 3).forEach(function (r2) { if (Math.abs(r2.x - rat.x) < 70) r2.burningT = nowT; });
    }
    damageRat(rat, dmg, bolt.healPerKill);
    bolt.effects.forEach(function (e) {
      if (e.stat === 'burn') rat.burningT = nowT;
      if (e.stat === 'slow') rat.frozenT = nowT;
      if (e.stat === 'poison') rat.poisonedT = nowT;
    });
  }

  function fireBolt(element, rat, dmg, fx, fy, elements, effects, healPerKill) {
    state.bolts.push({
      x: fx, y: fy, tx: rat.x, ty: GROUND_Y - 20, rat: rat, dmg: dmg, element: element, hit: false, t0: now(),
      elements: elements || [element], effects: effects || [], healPerKill: healPerKill || 0,
    });
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
    makeOffers(state.wave === 2 ? 'break2' : 'random');
    state.phase = 'build';
    state.firstBreak = false;
    updateButtons();
    maybeHint();
  }

  // ---- DOM buttons -----------------------------------------------------------

  var btnPlay = document.getElementById('btn-play');
  var btnReroll = document.getElementById('btn-reroll');
  var btnRotate = document.getElementById('btn-rotate');
  var btnHelp = document.getElementById('btn-help');
  var btnRetry = document.getElementById('btn-retry');
  var howto = document.getElementById('howto');
  var pagePanel = document.getElementById('page-panel');
  var shopTray = document.getElementById('shop-tray');

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
    // The grimoire page and shop tray are up only between waves (build);
    // during a wave, and on defeat/victory, they slide back down/away so the
    // fight (or the end-of-run message on it) is what shows.
    pagePanel.classList.toggle('up', state.phase === 'build');
    shopTray.classList.toggle('up', state.phase === 'build');
  }

  btnPlay.addEventListener('pointerup', function () { if (!btnPlay.disabled) startFight(); });
  btnReroll.addEventListener('pointerup', function () { if (!btnReroll.disabled) doReroll(); });
  btnRotate.addEventListener('pointerup', function (e) { e.stopPropagation(); rotateHeld(); });
  btnHelp.addEventListener('pointerup', function () { howto.classList.remove('hidden'); });
  document.getElementById('btn-howto-close').addEventListener('pointerup', function () { howto.classList.add('hidden'); });
  btnRetry.addEventListener('pointerup', function () { location.reload(); });

  // ---- pointer input -----------------------------------------------------

  var pageCanvas = document.getElementById('stage-page');
  var shopCanvas = document.getElementById('stage-shop');

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

  function pageXY(e) {
    var rect = pageCanvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (PAGE_H / rect.height) };
  }
  function shopXY(e) {
    var rect = shopCanvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (SHOP_H / rect.height) };
  }

  pageCanvas.addEventListener('pointerdown', function (e) {
    var p = pageXY(e);
    state.downX = p.x; state.downY = p.y; state.dragMoved = false;
    if (state.phase !== 'build') return;
    if (!state.held) {
      var trayI = hitTray(p.x, p.y);
      if (trayI !== -1 && state.tray[trayI]) { state._downPick = { kind: 'tray', slot: trayI }; return; }
      var cell = hitGridCell(p.x, p.y);
      if (cell) {
        var pc = pieceAtGrid(cell[0], cell[1]);
        if (pc) state._downPick = { kind: 'grid', col: pc.col, row: pc.row, piece: pc };
      }
    }
  });

  pageCanvas.addEventListener('pointermove', function (e) {
    var p = pageXY(e);
    if (Math.hypot(p.x - state.downX, p.y - state.downY) > DRAG_THRESHOLD) {
      state.dragMoved = true;
      if (!state.held && state._downPick) {
        var dp = state._downPick;
        if (dp.kind === 'tray') pickUp(state.tray[dp.slot], 'tray', dp.slot);
        else pickUp(dp.piece, 'grid', [dp.col, dp.row]);
        state._downPick = null;
      }
    }
    if (state.held) { state.held.px = p.x; state.held.py = p.y; }
  });

  pageCanvas.addEventListener('pointerup', function (e) {
    var p = pageXY(e);
    if (state.phase !== 'build') { state._downPick = null; return; }
    if (state.held && state.dragMoved) {
      var cell = hitGridCell(p.x, p.y);
      if (cell) dropHeldAt(cell[0], cell[1]); else { toast('Off the edge of the page'); returnHeld(); }
      state._downPick = null;
      return;
    }
    var dp = state._downPick;
    state._downPick = null;
    if (state.held) {
      var cell2 = hitGridCell(p.x, p.y);
      if (cell2) { dropHeldAt(cell2[0], cell2[1]); return; }
      rotateHeld();
      return;
    }
    if (!dp) return;
    if (dp.kind === 'tray') { pickUp(state.tray[dp.slot], 'tray', dp.slot); return; }
    if (dp.kind === 'grid') { pickUp(dp.piece, 'grid', [dp.col, dp.row]); return; }
  });

  shopCanvas.addEventListener('pointerdown', function (e) {
    if (state.phase !== 'build') return;
    var p = shopXY(e);
    var offerI = hitOffer(p.x, p.y);
    if (offerI !== -1) state._downShop = offerI;
  });
  shopCanvas.addEventListener('pointerup', function (e) {
    if (state.phase !== 'build') { state._downShop = null; return; }
    var p = shopXY(e);
    var offerI = hitOffer(p.x, p.y);
    if (offerI !== -1 && offerI === state._downShop) buyOffer(offerI);
    state._downShop = null;
  });

  // ---- drawing -----------------------------------------------------------

  var ctxFight = document.getElementById('stage-fight').getContext('2d');
  var ctxPage = pageCanvas.getContext('2d');
  var ctxShop = shopCanvas.getContext('2d');

  function shapeBounds(cells) {
    var maxx = Math.max.apply(null, cells.map(function (p) { return p[0]; }));
    var maxy = Math.max.apply(null, cells.map(function (p) { return p[1]; }));
    return { w: maxx + 1, h: maxy + 1 };
  }

  // Draws a piece's shape (footprint outline, fill, icon) at pixel origin
  // (px,py) top-left, using cell size `cs`. A fused piece gets a diagonal
  // split of its two element colours instead of a flat tier colour.
  function drawPieceShape(ctx, piece, shape, px, py, cs, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var tierColor = Art.COLORS['tier' + piece.tier] || Art.COLORS.tier1;
    var sw = piece.type === 'fusion' ? swirls[piece.uid] : null;
    var colorA = piece.type === 'fusion' ? (C[piece.fusion.elementA] || tierColor) : tierColor;
    var colorB = piece.type === 'fusion' ? (C[piece.fusion.elementB] || tierColor) : tierColor;
    shape.cells.forEach(function (cell) {
      var cx = px + cell[0] * cs, cy = py + cell[1] * cs;
      if (piece.type === 'fusion') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx + 1, cy + 1, cs - 2, cs - 2);
        ctx.clip();
        ctx.fillStyle = colorA;
        ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.9;
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
        ctx.beginPath();
        ctx.moveTo(cx + cs, cy);
        ctx.lineTo(cx + cs, cy + cs);
        ctx.lineTo(cx, cy + cs);
        ctx.closePath();
        ctx.fillStyle = colorB;
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = tierColor;
        ctx.globalAlpha = (alpha === undefined ? 1 : alpha) * 0.9;
        ctx.fillRect(cx + 1, cy + 1, cs - 2, cs - 2);
      }
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx + 1, cy + 1, cs - 2, cs - 2);
    });
    var b = shapeBounds(shape.cells);
    var midx = px + b.w * cs / 2, midy = py + b.h * cs / 2;
    if (piece.kind === 'spell') {
      Art.bolt(ctx, midx, midy, cs * 0.62, piece.type === 'fusion' ? piece.fusion.elementA : Meta.SPELLS[piece.type].element, 0, now() / 1000);
    } else {
      ctx.save();
      ctx.beginPath();
      shape.cells.forEach(function (cell) { ctx.rect(px + cell[0] * cs, py + cell[1] * cs, cs, cs); });
      ctx.clip();
      Art.ingredient(ctx, midx, midy, cs * 0.98, piece.type, piece.tier);
      ctx.restore();
    }
    // absorbed-ingredient badges, up to 2, small dots at the piece's top-left corner
    if (piece.absorbed && piece.absorbed.length) {
      piece.absorbed.forEach(function (a, i) {
        var bx = px + 7 + i * 13, by = py + 7;
        ctx.beginPath();
        ctx.arc(bx, by, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = C[Meta.INGREDIENTS[a.type].stat === 'poison' ? 'poison' : (a.type === 'ember' ? 'fire' : a.type === 'frost' ? 'ice' : a.type === 'blast' ? 'blast' : a.type === 'storm' ? 'storm' : '#D8DCE8')] || '#D8DCE8';
        ctx.fill();
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  // A small numbered ribbon at a spell piece's top-left corner (build-time
  // reading-order display).
  function drawRibbon(ctx, px, py, n) {
    ctx.save();
    ctx.fillStyle = C.gold;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - 2, py - 2);
    ctx.lineTo(px + 15, py - 2);
    ctx.lineTo(px + 15, py + 13);
    ctx.lineTo(px + 6.5, py + 8);
    ctx.lineTo(px - 2, py + 13);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.font = '700 10px "Titan One", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('' + n, px + 6.5, py + 7);
    ctx.restore();
  }

  function pieceCenterPx(piece) {
    var shape = shapeFor(piece);
    var b = shapeBounds(shape.cells);
    return { x: GRID_X + piece.col * CELL + b.w * CELL / 2, y: GRID_Y + piece.row * CELL + b.h * CELL / 2 };
  }

  function drawCombosAndArrows() {
    var order = spellsInOrder();
    // numbered ribbons
    order.forEach(function (p, i) {
      drawRibbon(ctxPage, GRID_X + p.col * CELL + 2, GRID_Y + p.row * CELL + 2, i + 1);
    });
    // gold arrows between consecutive spells whose statuses combo
    for (var i = 0; i < order.length - 1; i++) {
      var combo = comboBetween(order[i], order[i + 1]);
      if (!combo) continue;
      var a = pieceCenterPx(order[i]), b = pieceCenterPx(order[i + 1]);
      ctxPage.save();
      ctxPage.globalAlpha = 0.75;
      ctxPage.strokeStyle = C.gold;
      ctxPage.lineWidth = 2.5;
      ctxPage.beginPath();
      ctxPage.moveTo(a.x, a.y);
      ctxPage.lineTo(b.x, b.y);
      ctxPage.stroke();
      var ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctxPage.translate(b.x, b.y);
      ctxPage.rotate(ang);
      ctxPage.beginPath();
      ctxPage.moveTo(-8, -5);
      ctxPage.lineTo(0, 0);
      ctxPage.lineTo(-8, 5);
      ctxPage.stroke();
      ctxPage.restore();
    }
  }

  function drawFight(t, dt) {
    var ctx = ctxFight;
    ctx.clearRect(0, 0, W, FIGHT_H);
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

    // combo names, popping up over the rat they fired on
    state.combos = state.combos.filter(function (cb) { return now() - cb.t0 < 900; });
    state.combos.forEach(function (cb) {
      var p = (now() - cb.t0) / 900;
      var pop = p < 0.25 ? (p / 0.25) : 1;
      ctx.save();
      ctx.globalAlpha = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
      // Clamp so the label never runs off the fight canvas, even when the
      // rat it fired on is right at the edge (a common spot for a kill).
      var clampedX = Math.max(75, Math.min(W - 75, cb.x));
      ctx.translate(clampedX, cb.y - p * 30);
      ctx.scale(0.7 + pop * 0.5, 0.7 + pop * 0.5);
      ctx.fillStyle = cb.color;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 3;
      ctx.font = '700 16px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(cb.name, 0, 0);
      ctx.fillText(cb.name, 0, 0);
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
      ctx.font = '700 26px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.phase === 'lost' ? 'Defeated on wave ' + state.wave : 'Victory', W / 2, FIGHT_H / 2);
      ctx.restore();
    }
  }

  function drawPage(t) {
    var ctx = ctxPage;
    ctx.clearRect(0, 0, W, PAGE_H);
    ctx.fillStyle = C.parchment;
    ctx.fillRect(0, 0, W, PAGE_H);

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
        drawPieceShape(ctx, tp, shape, sx + 2, TRAY_Y + 2, cs, 1);
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
    // freed-cell flash after an absorb
    state.freedFlash = state.freedFlash.filter(function (fr) { return now() - fr.t0 < 380; });
    state.freedFlash.forEach(function (fr) {
      var p = (now() - fr.t0) / 380;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.9;
      ctx.fillStyle = '#fff';
      ctx.fillRect(GRID_X + fr.c * CELL, GRID_Y + fr.r * CELL, CELL, CELL);
      ctx.restore();
    });

    // placed pieces
    Object.keys(state.pieces).forEach(function (uid) {
      if (state.held && state.held.piece.uid === Number(uid)) return;
      var p = state.pieces[uid];
      var shape = shapeFor(p);
      var px = GRID_X + p.col * CELL, py = GRID_Y + p.row * CELL;
      var scale = 1;
      var bt = bounces[uid];
      if (bt !== undefined) {
        var bp = (now() - bt.t0) / 220;
        if (bp >= 1) delete bounces[uid]; else scale = 1 + Math.sin(bp * Math.PI) * 0.12 * bt.mag;
      }
      var fl = flashes[uid];
      var sw = swirls[uid];
      ctx.save();
      if (scale !== 1) {
        var mx = px + shapeBounds(shape.cells).w * CELL / 2, my = py + shapeBounds(shape.cells).h * CELL / 2;
        ctx.translate(mx, my); ctx.scale(scale, scale); ctx.translate(-mx, -my);
      }
      drawPieceShape(ctx, p, shape, px, py, CELL, 1);
      if (sw !== undefined) {
        var swp = (now() - sw.t0) / 500;
        if (swp >= 1) delete swirls[uid];
        else {
          var b2 = shapeBounds(shape.cells);
          var cx2 = px + b2.w * CELL / 2, cy2 = py + b2.h * CELL / 2;
          ctx.save();
          ctx.globalAlpha = 1 - swp;
          ctx.strokeStyle = sw.colorA;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(cx2, cy2, (b2.w * CELL / 2) * (0.5 + swp * 1.1), swp * 8, swp * 8 + Math.PI * 1.4);
          ctx.stroke();
          ctx.strokeStyle = sw.colorB;
          ctx.beginPath();
          ctx.arc(cx2, cy2, (b2.w * CELL / 2) * (0.5 + swp * 1.1), swp * 8 + Math.PI, swp * 8 + Math.PI * 2.4);
          ctx.stroke();
          ctx.restore();
        }
      }
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
    });

    drawCombosAndArrows();

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
      drawPieceShape(ctx, h.piece, shapeH, px2, py2, CELL, 1);
      ctx.restore();
    }
  }

  function drawShop(t) {
    var ctx = ctxShop;
    ctx.clearRect(0, 0, W, SHOP_H);
    ctx.fillStyle = C.ink;
    ctx.font = '700 12px Kreon, Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('Shop', SHOP_X, SHOP_LABEL_Y);
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
      var fakePiece = { kind: o.kind, type: o.type, tier: o.tier, rot: 0, uid: -1, absorbed: [] };
      var shapeO = shapeFor(fakePiece);
      var bO = shapeBounds(shapeO.cells);
      var cs = Math.min((SHOP_CARD_W - 16) / bO.w, 34 / bO.h);
      drawPieceShape(ctx, fakePiece, shapeO, sx + (SHOP_CARD_W - bO.w * cs) / 2, SHOP_Y + 6, cs, 1);
      ctx.fillStyle = C.ink;
      ctx.font = '10px Kreon, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, sx + SHOP_CARD_W / 2, SHOP_Y + SHOP_CARD_H - 20);
      ctx.font = '700 13px "Titan One", sans-serif';
      ctx.fillStyle = o.sold ? '#7A6A50' : C.buyShade;
      ctx.fillText(o.sold ? 'SOLD' : o.price + 'g', sx + SHOP_CARD_W / 2, SHOP_Y + SHOP_CARD_H - 6);
      if (state.firstBreak && affordable && i === 0 && !anyPieceOnGrid() && Object.keys(state.pieces).length === 0 && state.tray.every(function (t2) { return !t2; })) {
        var pulse = 0.5 + 0.5 * Math.sin(now() / 220);
        ctx.strokeStyle = 'rgba(255,194,61,' + (0.4 + 0.5 * pulse) + ')';
        ctx.lineWidth = 4;
        ctx.strokeRect(sx - 2, SHOP_Y - 2, SHOP_CARD_W + 4, SHOP_CARD_H + 4);
      }
      ctx.restore();
    });
  }

  var lastT = now();
  function frame() {
    var t = now();
    var dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    if (state.phase === 'fight') stepFight(dt);
    drawFight(t / 1000, dt);
    drawPage(t / 1000);
    drawShop(t / 1000);
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
      page: { id: 'stage-page', W: W, H: PAGE_H, GRID_X: GRID_X, GRID_Y: GRID_Y, CELL: CELL, GRID_COLS: GRID_COLS, GRID_ROWS: GRID_ROWS, TRAY_X: TRAY_X, TRAY_Y: TRAY_Y, TRAY_SLOT: TRAY_SLOT, TRAY_GAP: TRAY_GAP },
      shop: { id: 'stage-shop', W: W, H: SHOP_H, SHOP_X: SHOP_X, SHOP_Y: SHOP_Y, SHOP_CARD_W: SHOP_CARD_W, SHOP_CARD_H: SHOP_CARD_H, SHOP_GAP: SHOP_GAP },
    },
    getSummary: function () {
      return {
        phase: state.phase, wave: state.wave, gold: state.gold,
        piecesOnGrid: Object.keys(state.pieces).length,
        occupiedCells: state.grid.reduce(function (n, v) { return n + (v ? 1 : 0); }, 0),
        maxTier: Object.keys(state.pieces).reduce(function (m, u) { return Math.max(m, state.pieces[u].tier); }, 0),
        trayCount: state.tray.filter(Boolean).length,
        pageUp: pagePanel.classList.contains('up'),
        shopUp: shopTray.classList.contains('up'),
        hasFusion: Object.keys(state.pieces).some(function (u) { return state.pieces[u].type === 'fusion'; }),
        combos: state.comboCounts,
        ratsAlive: state.rats.filter(function (r) { return !r.dead; }).length,
      };
    },
  };
})();
