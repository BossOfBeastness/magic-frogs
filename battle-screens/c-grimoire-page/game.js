/* Grimoire Page: battle screen prototype C, version 3 (with the same-day
   amendment). Shaped spell and ingredient pieces are packed and rotated on a
   spellbook page, Backpack Battles style. Pure canvas 2D, no build step.
   Uses Art (../../art.js) for the frog, rats, boss, bolts and ingredient
   icons, and Meta (../../meta.js) for spell/ingredient names, tiers, prices
   and the named two-element discoveries. Everything else (piece shapes,
   combining rules, combo list, turn-based fight pacing, panel slide) is this
   prototype's own tuning; it does not touch Art or Meta.

   Version 3 (SPEC.md "C version 3: rules with a reason") gave spells element
   shapes, moved ingredients beside spells (buffing everything they touch,
   never absorbed), and kept merge/fuse. The SAME-DAY AMENDMENT
   ("C version 3, amended the same day") replaced the merge/fuse rule and the
   fight:
   - Combining is by OVERLAP. Dragging a piece over another shows a live gold
     preview of the union outline. Full overlap of an identical piece merges
     (tier + 1, same shape). Any overlap of a different spell of the same
     tier fuses: the new piece's footprint is exactly the union of the two as
     placed, elements are the union (3 at most, then a crown), damage is 80%
     of the two combined, and the nine named pairs in Meta.EVOLUTIONS still
     get their name, a +25% signature bonus and a first-time discovery
     banner (localStorage). Refusals spring back with their reason.
   - Fights are TURN BASED on a 7-space row (space 0 at the frog, space 6 at
     the right edge). Frog turn: every spell fires in reading order, about
     0.35s apart, ribbon lit as it fires. Rats' turn: every rat steps one
     space closer (frozen rats skip a step and thaw), a rat at space 0
     bites, spitters park at space 4 and spit, poison and burn tick. */
(function () {
  'use strict';

  var W = 390, H = 844;
  var FIGHT_H = 354;               // fight canvas height (top of the phone)

  // ---- the grimoire page canvas (local coordinates, 0,0 at its own top-left) --
  var PAGE_H = H - FIGHT_H;
  var HEADER_Y = 22;
  var TRAY_Y = 44;
  var TRAY_SLOT = 50, TRAY_GAP = 10;
  var TRAY_COUNT = 3;
  var TRAY_W = TRAY_COUNT * TRAY_SLOT + (TRAY_COUNT - 1) * TRAY_GAP;
  var TRAY_X = Math.round((W - TRAY_W) / 2);
  var GRID_COLS = 7, GRID_ROWS = 6, CELL = 50;
  var GRID_W = GRID_COLS * CELL, GRID_H = GRID_ROWS * CELL;
  var GRID_X = Math.round((W - GRID_W) / 2);
  var GRID_Y = 114;

  // ---- the shop tray canvas (local coordinates) -------------------------------
  var SHOP_H = H - 554;
  var SHOP_LABEL_Y = 18;
  var SHOP_Y = 36;
  var SHOP_CARD_W = 110, SHOP_CARD_H = 140, SHOP_GAP = 14;
  var SHOP_W = 3 * SHOP_CARD_W + 2 * SHOP_GAP;
  var SHOP_X = Math.round((W - SHOP_W) / 2);

  var DRAG_THRESHOLD = 8;

  var C = Art.COLORS;

  // ---- the 7-space fight row (amendment: turn based, like Gun Hero) ----------
  var SPACE_COUNT = 7;
  var SPACE0_X = 128, SPACE_STEP = 40;   // space 0 near the frog, space 6 at the right edge
  var SPITTER_SPACE = 4;
  var FROG_X = 62, GROUND_Y = FIGHT_H - 46;
  var SPELL_GAP = 0.35;             // seconds between spell casts in reading order
  var TURN_DELAY = 0.5;             // banner/settle pause before a turn's actions begin
  var RAT_STEP_ANIM = 0.28;         // seconds a rat's own step animates over
  var BANNER_DUR = 0.9;
  var DISCOVERY_DUR = 2.2;
  var FROZEN_SKIP_TURNS = 1;
  var STATUS_TICK_TURNS = 3;        // poison/burn keep ticking for this many rats' turns
  var POISON_TICK = 3, BURN_TICK = 3;
  var BITE_DMG = 3, SPIT_DMG = 3;
  var BASELINE_DMG = 5;             // the frog pokes with a stick if the page is empty

  // ---- piece shapes (this prototype's own tuning; SPEC.md "Shapes by element") --

  var SPELL_DEFS = {
    missile: { cells: [[0, 0]] },                                   // arcane, 1 cell
    ember:   { cells: [[0, 0], [0, 1], [1, 1]] },                    // fire, L of 3
    frost:   { cells: [[0, 0], [0, 1], [0, 2]] },                    // ice, line of 3
    blast:   { cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },            // blast, 2x2 square
    venom:   { cells: [[0, 0], [1, 0]] },                            // poison, drop of 2
    spark:   { cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },            // storm, zigzag of 4
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
  // itself (piece.fusedCells): its shape is the union outline, not a
  // SPELL_DEFS shape. A fused piece never rotates (its footprint was built
  // exactly where the player dropped it).
  function baseCellsFor(piece) {
    if (piece.type === 'fusion') return piece.fusedCells;
    return defFor(piece.kind, piece.type).cells;
  }

  function shapeFor(piece) {
    if (piece.type === 'fusion') return { cells: piece.fusedCells };
    return { cells: rotateCells(baseCellsFor(piece), piece.rot % 4) };
  }

  // The element(s) a piece carries: one for a base spell, 2 or 3 for a fused
  // spell (union of the pieces that made it, amendment "elements are the
  // union, 3 at most").
  function elementsOf(piece) {
    return piece.type === 'fusion' ? piece.fusion.elements.slice() : [Meta.SPELLS[piece.type].element];
  }
  function uniqueList(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { if (!seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }

  // ---- spell stats: base spells, and fused pieces -----------------------------

  var STATUS_ELEMENT = { fire: 'burning', ice: 'frozen', poison: 'poisoned' };
  var TRIGGER_ELEMENTS = { blast: true, storm: true };
  var COMBOS = [
    { status: 'frozen', trigger: 'blast', name: 'Shatter', color: C.ice },
    { status: 'poisoned', trigger: 'fire', name: 'Ignite', color: C.fire },
    { status: 'frozen', trigger: 'storm', name: 'Conduct', color: C.storm },
    { status: 'burning', trigger: 'storm', name: 'Overload', color: C.fire },
    { status: 'poisoned', trigger: 'blast', name: 'Plague Cloud', color: C.poison },
  ];
  var STATUS_FIELD = { frozen: 'frozenUntilTurn', burning: 'burnUntilTurn', poisoned: 'poisonUntilTurn' };

  // Damage/rate/effects for one spell instance, before ingredient buffs.
  function baseProfile(piece) {
    if (piece.type === 'fusion') {
      var f = piece.fusion;
      return { name: f.name, dmg: f.dmg, rate: f.rate, elements: f.elements, effects: f.effects };
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

  // ---- ingredients beside, not on top (amendment keeps this from version 3) --
  // An ingredient buffs every spell it touches edge to edge; it is never
  // consumed, so this is read live off the board each time it matters.

  function footprintSet(fp) {
    var set = {};
    fp.forEach(function (c) { set[c[0] + ',' + c[1]] = true; });
    return set;
  }
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function edgeNeighbors(fp) {
    var set = footprintSet(fp), out = [];
    fp.forEach(function (c) {
      DIRS.forEach(function (d) {
        var k = (c[0] + d[0]) + ',' + (c[1] + d[1]);
        if (!set[k]) out.push([c[0] + d[0], c[1] + d[1]]);
      });
    });
    return out;
  }
  function touchingIngredients(spellPiece) {
    var fp = footprintAt(shapeFor(spellPiece).cells, spellPiece.col, spellPiece.row);
    var seen = {}, list = [];
    edgeNeighbors(fp).forEach(function (cr) {
      if (!inBounds(cr[0], cr[1])) return;
      var u = state.grid[idx(cr[0], cr[1])];
      if (!u || seen[u]) return;
      var p = state.pieces[u];
      if (p && p.kind === 'ingredient') { seen[u] = true; list.push(p); }
    });
    return list;
  }
  // What this spell's touching ingredients add, keyed by stat.
  function gainsFor(piece) {
    if (piece.kind !== 'spell') return {};
    var g = {};
    touchingIngredients(piece).forEach(function (ing) {
      var def = Meta.INGREDIENTS[ing.type];
      g[def.stat] = (g[def.stat] || 0) + def.v[ing.tier];
    });
    return g;
  }

  // The statuses this piece can apply on hit (its own element's status, plus
  // any status stat gained from a touching ingredient).
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

  var SPELL_SHORT = { missile: 'Missile', ember: 'Ember', frost: 'Frost', blast: 'Blast', venom: 'Venom', spark: 'Spark' };
  var ING_SHORT = { ember: 'Salt', frost: 'Petal', shade: 'Shade', blast: 'Powder', storm: 'Feather', moon: 'Moon', quick: 'Quick', dew: 'Dew' };
  function pieceShortName(piece) {
    if (piece.type === 'fusion') return firstWord(piece.fusion.name);
    if (piece.kind === 'spell') return SPELL_SHORT[piece.type] || firstWord(Meta.SPELLS[piece.type].name);
    return ING_SHORT[piece.type] || firstWord(Meta.INGREDIENTS[piece.type].name);
  }

  // ---- named discoveries (Meta.EVOLUTIONS), persisted per save --------------

  var DISCOVERY_KEY = 'magicfrogs_discoveries';
  function loadDiscoveries() { try { return JSON.parse(localStorage.getItem(DISCOVERY_KEY) || '{}'); } catch (e) { return {}; } }
  function isDiscovered(id) { try { return !!loadDiscoveries()[id]; } catch (e) { return false; } }
  function saveDiscovery(id) { try { var d = loadDiscoveries(); d[id] = true; localStorage.setItem(DISCOVERY_KEY, JSON.stringify(d)); } catch (e) { /* unsupported */ } }

  function namedPairFor(typeA, typeB) {
    var evoA = (Meta.EVOLUTIONS[typeA] || []).filter(function (e) { return e.with === typeB; })[0];
    if (evoA) return evoA;
    var evoB = (Meta.EVOLUTIONS[typeB] || []).filter(function (e) { return e.with === typeA; })[0];
    if (evoB) return evoB;
    return null;
  }

  // Works out the fused spell's name (and whether it is a named discovery)
  // from the two pieces being combined. Two base spells of different
  // elements may hit one of the nine named pairs; anything involving an
  // already-fused piece (2 elements becoming 3) gets a generated name with
  // the newly added spell's word first, e.g. "Storm Fireball".
  function describeFusionResult(pieceA, pieceB, elements) {
    if (elements.length === 2 && pieceA.type !== 'fusion' && pieceB.type !== 'fusion') {
      var evo = namedPairFor(pieceA.type, pieceB.type);
      if (evo) return { name: evo.name, id: evo.id, named: true };
      return { name: firstWord(Meta.SPELLS[pieceA.type].name) + ' ' + firstWord(Meta.SPELLS[pieceB.type].name), id: null, named: false };
    }
    var wordFor = function (p) { return p.type === 'fusion' ? p.fusion.name : firstWord(Meta.SPELLS[p.type].name); };
    if (pieceA.type === 'fusion' && pieceB.type !== 'fusion') return { name: wordFor(pieceB) + ' ' + wordFor(pieceA), id: null, named: false };
    if (pieceB.type === 'fusion' && pieceA.type !== 'fusion') return { name: wordFor(pieceA) + ' ' + wordFor(pieceB), id: null, named: false };
    return { name: wordFor(pieceA) + ' ' + wordFor(pieceB), id: null, named: false };
  }

  // ---- state -------------------------------------------------------------

  var nextUid = 1;
  var state = {
    gold: Meta.START_GOLD,
    wave: 1,
    level: Meta.LEVELS[0],
    phase: 'build',            // 'build' | 'fight' | 'lost' | 'won'
    firstBreak: true,
    pieces: {},                 // uid -> piece {uid,kind,type,tier,rot,col,row[,fusion,fusedCells]}
    grid: new Array(GRID_COLS * GRID_ROWS).fill(null),
    unlocked: new Array(GRID_COLS * GRID_ROWS).fill(false),
    lockedQueue: [],
    tray: [null, null, null],
    offers: [],                 // [{kind,type,tier,price,sold}]
    rerollN: 0,
    held: null,                 // {piece, from:'tray'|'grid', slot|col,row, mode:'tap'|'drag', px,py, rot}
    dragMoved: false,
    downX: 0, downY: 0,
    freedFlash: [],
    tearing: [],
    toastT: 0,
    frogHp: 30, frogHpMax: 30,
    rats: [],
    bolts: [],
    dmgTexts: [],
    combos: [],                  // {x,y,t0,name,color} popup text over a rat
    kills: 0,
    mergedEver: false, fusedEver: false, orderedEver: false,
    comboCounts: {},
    // turn-based fight (amendment)
    turn: null,                  // 'frog' | 'rats' | null (not in a fight)
    turnT: 0,
    castOrder: [],
    castIdx: 0,
    turnCount: 0,
    waveQueue: [],
    activeSpellUid: null, activeSpellT0: 0,
    bannerText: '', bannerT0: 0,
    discoveryText: '', discoveryT0: 0,
    lastDiscovery: null,
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
      // Deterministic first break: two Ember Bolts (merge) and Magic Missile.
      picks = [{ kind: 'spell', type: 'ember' }, { kind: 'spell', type: 'ember' }, { kind: 'spell', type: 'missile' }];
    } else if (mode === 'break2') {
      // Blast Rune and Frost Shard (fuse, and ice-before-blast order), plus a
      // Frost Petal so ingredients-beside-spells is on the table too.
      picks = [{ kind: 'spell', type: 'blast' }, { kind: 'spell', type: 'frost' }, { kind: 'ingredient', type: 'frost' }];
    } else if (mode === 'break3') {
      // Guarantees a second Blast Rune, per SPEC.md, so a fire-and-blast
      // fuse into Fireball is possible.
      picks = [{ kind: 'spell', type: 'blast' }, { kind: 'spell', type: 'ember' }, { kind: 'spell', type: 'spark' }];
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
    state.tray[slot] = { uid: nextUid++, kind: o.kind, type: o.type, tier: 1, rot: 0, col: null, row: null };
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

  function showBanner(text) { state.bannerText = text; state.bannerT0 = now(); }
  function showDiscoveryBanner(text) { state.discoveryText = text; state.discoveryT0 = now(); state.lastDiscovery = text; }

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
      if (embers.length >= 2) { toast('Drop Ember Bolt fully onto the other Ember Bolt to merge', 3000); return; }
    }
    if (!state.fusedEver) {
      var types = {};
      spells.forEach(function (p) { types[p.type] = true; });
      if (Object.keys(types).length >= 2) { toast('Drop a spell so it overlaps a different spell to fuse', 3000); return; }
    }
    if (!state.orderedEver) {
      var hasFrost = spells.some(function (p) { return p.type === 'frost'; });
      var hasBlast = spells.some(function (p) { return p.type === 'blast'; });
      if (hasFrost && hasBlast) { toast('Spells cast in reading order: put Frost Shard before Blast Rune', 3000); state.orderedEver = true; return; }
    }
  }

  // ---- placement legality: combining is by overlap (the amendment) -----------

  function footprintAt(cells, col, row) {
    return cells.map(function (d) { return [col + d[0], row + d[1]]; });
  }

  function sameElementSet(a, b) {
    if (a.length !== b.length) return false;
    var sa = a.slice().sort(), sb = b.slice().sort();
    return sa.every(function (v, i) { return v === sb[i]; });
  }
  function sameFusionPair(f1, f2) { return sameElementSet(f1.elements, f2.elements); }

  function unionCells(fpA, fpB) {
    var seen = {}, out = [];
    fpA.concat(fpB).forEach(function (cr) {
      var k = cr[0] + ',' + cr[1];
      if (!seen[k]) { seen[k] = true; out.push(cr); }
    });
    return out;
  }

  // Checks dropping `piece` (its cells at rot) at (col,row). Combining is by
  // overlap: a cell shared with an already-placed piece is an "overlap"
  // cell, everything else in the dragged footprint must land free and
  // unlocked. Full overlap of an identical piece merges; any overlap of a
  // different same-tier spell fuses into the union of both footprints.
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
    if (occ.length > 1) return { valid: false, reason: 'The union would cover a third piece', fp: fp };

    var target = state.pieces[occ[0]];
    var targetShape = shapeFor(target);
    var targetFp = footprintAt(targetShape.cells, target.col, target.row);
    var fpSet = footprintSet(fp);
    var overlap = targetFp.filter(function (cr) { return fpSet[cr[0] + ',' + cr[1]]; });
    var fullOverlap = overlap.length === fp.length && overlap.length === targetFp.length;
    var union = unionCells(fp, targetFp);

    var identical = fullOverlap && target.kind === piece.kind && target.type === piece.type && target.tier === piece.tier;
    if (identical && piece.type === 'fusion' && !sameFusionPair(target.fusion, piece.fusion)) identical = false;

    if (identical) {
      if (piece.tier >= 5) return { valid: false, reason: 'Already at the top tier', fp: fp, overlap: overlap, unionCells: union };
      return { valid: true, action: 'merge', targetUid: target.uid, fp: fp, overlap: overlap, unionCells: union };
    }
    if (piece.kind === 'ingredient' || target.kind === 'ingredient') {
      return { valid: false, reason: 'Ingredients buff from beside, not on top', fp: fp, overlap: overlap, unionCells: union };
    }
    if (target.tier !== piece.tier) {
      return { valid: false, reason: 'Fuse spells of the same tier', fp: fp, overlap: overlap, unionCells: union };
    }
    var elA = elementsOf(piece), elB = elementsOf(target);
    if (elA.length === 3 || elB.length === 3) {
      return { valid: false, reason: 'A three-element spell can only merge with an identical twin', fp: fp, overlap: overlap, unionCells: union };
    }
    var unionElements = uniqueList(elA.concat(elB));
    if (unionElements.length > 3) {
      return { valid: false, reason: 'A spell can hold 3 elements at most', fp: fp, overlap: overlap, unionCells: union };
    }
    return { valid: true, action: 'fuse', targetUid: target.uid, fp: fp, overlap: overlap, unionCells: union };
  }

  // ---- placing / merging / fusing -------------------------------------------

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
    var merged = { uid: nextUid++, kind: target.kind, type: target.type, tier: target.tier + 1, rot: rot, col: null, row: null };
    if (target.type === 'fusion') { merged.fusion = target.fusion; merged.fusedCells = target.fusedCells; }
    placePieceAt(merged, col, row);
    vibrate([20, 30, 20]);
    flash(merged.uid);
    if (!state.mergedEver) hideToast();
    state.mergedEver = true;
    return merged;
  }

  // Fuses `piece` onto `target` using a placement check already computed
  // (`check.unionCells` is the union footprint, grid coordinates).
  function fuseInto(piece, check, fromTraySlot) {
    var target = state.pieces[check.targetUid];
    var union = check.unionCells;
    var minC = Math.min.apply(null, union.map(function (c) { return c[0]; }));
    var minR = Math.min.apply(null, union.map(function (c) { return c[1]; }));
    var cells = union.map(function (c) { return [c[0] - minC, c[1] - minR]; });
    var elements = uniqueList(elementsOf(piece).concat(elementsOf(target))).slice(0, 3);
    var profA = baseProfile(piece), profB = baseProfile(target);
    var desc = describeFusionResult(piece, target, elements);
    var bonus = desc.named ? 1.25 : 1;
    var dmg = 0.8 * (profA.dmg + profB.dmg) * bonus;
    var effects = profA.effects.concat(profB.effects);
    var rate = (profA.rate + profB.rate) / 2;

    clearFromBoard(target);
    delete state.pieces[target.uid];
    var fused = {
      uid: nextUid++, kind: 'spell', type: 'fusion', tier: 1, rot: 0, col: minC, row: minR,
      fusedCells: cells,
      fusion: { elements: elements, dmg: dmg, rate: rate, name: desc.name, effects: effects },
    };
    if (fromTraySlot !== undefined && fromTraySlot !== null) state.tray[fromTraySlot] = null;
    footprintAt(cells, minC, minR).forEach(function (cr) { state.grid[idx(cr[0], cr[1])] = fused.uid; });
    state.pieces[fused.uid] = fused;
    vibrate([20, 40, 20]);
    bounce(fused.uid, 1.6);
    flash(fused.uid);
    swirl(fused.uid, elements[0], elements[elements.length - 1]);
    if (!state.fusedEver) hideToast();
    state.fusedEver = true;
    if (desc.named && desc.id && !isDiscovered(desc.id)) {
      saveDiscovery(desc.id);
      showDiscoveryBanner(desc.name + '! New discovery');
    }
    return fused;
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
    if (h.from === 'grid' && check.action !== 'place') delete state.pieces[piece.uid];
    if (check.action === 'merge') {
      mergeInto(piece, check.targetUid);
      if (traySlot !== null) state.tray[traySlot] = null;
    } else if (check.action === 'fuse') {
      fuseInto(piece, check, traySlot);
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
    if (h.piece.type === 'fusion') return;   // a fused piece keeps the shape it was built as
    h.piece.rot = (h.piece.rot + 1) % 4;
    h.rotStartT = now();
  }

  // ---- fight: turn based, on a 7-space row (the amendment) --------------------

  function spaceToPx(space) { return SPACE0_X + space * SPACE_STEP; }

  function ratPx(r) {
    if (r.animT0 !== undefined && now() - r.animT0 < RAT_STEP_ANIM * 1000) {
      var p = (now() - r.animT0) / (RAT_STEP_ANIM * 1000);
      return spaceToPx(r.animFrom) + (spaceToPx(r.space) - spaceToPx(r.animFrom)) * p;
    }
    return spaceToPx(r.space);
  }

  function waveRatCount(wave) { return 3 + wave; }

  function buildWaveQueue(wave, bossName) {
    if (bossName) return [{ boss: true, name: bossName }];
    var n = waveRatCount(wave), specs = [];
    for (var i = 0; i < n; i++) specs.push({ spitter: wave >= 2 && i % 3 === 2 });
    return specs;
  }

  function spawnRat(spec) {
    state.rats.push({
      id: 'r' + nextUid++, boss: !!spec.boss, name: spec.name || null, spitter: !!spec.spitter,
      space: SPACE_COUNT - 1, hp: spec.boss ? 90 : 26, hpMax: spec.boss ? 90 : 26, dead: false,
      t: Math.random() * 10, animT0: undefined, animFrom: SPACE_COUNT - 1,
    });
  }

  function spellsInOrder() {
    var list = [];
    Object.keys(state.pieces).forEach(function (u) { var p = state.pieces[u]; if (p.kind === 'spell') list.push(p); });
    list.sort(function (a, b) { return (a.row - b.row) || (a.col - b.col); });
    return list;
  }

  function startFight() {
    hideToast();
    state.phase = 'fight';
    state.rats = [];
    state.bolts = [];
    state.dmgTexts = [];
    state.combos = [];
    state.kills = 0;
    state.turnCount = 0;
    state.activeSpellUid = null;
    state.castOrder = spellsInOrder().map(function (p) { return p.uid; });
    state.castIdx = 0;
    var boss = state.level.bosses && state.level.bosses[state.wave];
    state.waveQueue = buildWaveQueue(state.wave, boss);
    if (state.waveQueue.length) spawnRat(state.waveQueue.shift());
    state.turn = 'frog';
    state.turnT = TURN_DELAY;
    showBanner('Frog turn');
    updateButtons();
  }

  function nearestRat() {
    var best = null;
    state.rats.forEach(function (r) {
      if (r.dead) return;
      if (!best || r.space < best.space) best = r;
    });
    return best;
  }

  function otherAliveRats(exclude, n) {
    return state.rats.filter(function (r) { return !r.dead && r !== exclude; })
      .sort(function (a, b) { return a.space - b.space; }).slice(0, n);
  }

  function damageRat(rat, dmg, healPerKill) {
    rat.hp -= dmg;
    state.dmgTexts.push({ x: ratPx(rat), y: GROUND_Y - 70, t0: now(), text: Math.round(dmg) + '' });
    if (rat.hp <= 0 && !rat.dead) {
      rat.dead = true;
      state.kills++;
      state.gold += rat.boss ? Meta.GOLD_PER_KILL.boss : 1;
      if (healPerKill) state.frogHp = Math.min(state.frogHpMax, state.frogHp + healPerKill);
    }
  }

  function hasActiveStatus(rat, name) {
    var f = STATUS_FIELD[name];
    return !!rat[f] && state.turnCount < rat[f];
  }

  function castSpellPiece(piece) {
    var t = nearestRat();
    if (!t) return;
    state.activeSpellUid = piece.uid;
    state.activeSpellT0 = now();
    var prof = baseProfile(piece), g = gainsFor(piece);
    var dmg = prof.dmg * (1 + (g.power || 0));
    var effects = prof.effects.slice();
    if (g.burn) effects.push({ stat: 'burn', value: g.burn });
    if (g.slow) effects.push({ stat: 'slow', value: g.slow });
    if (g.poison) effects.push({ stat: 'poison', value: g.poison });
    var el = prof.elements[0];
    fireBolt(el, t, dmg, FROG_X + 20, GROUND_Y - 60, prof.elements, effects, g.heal || 0);
    if (g.rate) fireBolt(el, t, dmg, FROG_X + 20, GROUND_Y - 60, prof.elements, effects, g.heal || 0);
  }

  function castBaseline() {
    var t = nearestRat();
    if (!t) return;
    fireBolt('arcane', t, BASELINE_DMG, FROG_X + 20, GROUND_Y - 60, ['arcane'], [], 0);
  }

  // Every rat steps one space closer, nearest first so a freed space is
  // usable the same turn (a line shifting forward together). A frozen rat
  // skips its step and thaws; a rat at space 0 bites; a spitter parked at
  // space 4 spits instead of stepping further.
  function performRatsStep() {
    state.rats.forEach(function (r) {
      if (r.dead) return;
      if (r.poisonUntilTurn && state.turnCount < r.poisonUntilTurn) damageRat(r, POISON_TICK);
      if (r.burnUntilTurn && state.turnCount < r.burnUntilTurn) damageRat(r, BURN_TICK);
    });
    var occ = {};
    state.rats.forEach(function (r) { if (!r.dead) occ[r.space] = true; });
    var order = state.rats.filter(function (r) { return !r.dead; }).sort(function (a, b) { return a.space - b.space; });
    order.forEach(function (r) {
      if (r.frozenUntilTurn && state.turnCount < r.frozenUntilTurn) { r.frozenUntilTurn = 0; return; }
      if (r.spitter && r.space === SPITTER_SPACE) { fireSpitBolt(r); return; }
      if (r.space === 0) { state.frogHp -= BITE_DMG; return; }
      var target = r.space - 1;
      if (!occ[target]) { delete occ[r.space]; r.animFrom = r.space; r.space = target; r.animT0 = now(); occ[target] = true; }
    });
    if (!occ[SPACE_COUNT - 1] && state.waveQueue.length) spawnRat(state.waveQueue.shift());
    state.turnCount++;
  }

  function resolveHit(bolt) {
    var rat = bolt.rat, nowT = now();
    var triggerSet = {};
    bolt.elements.forEach(function (el) { if (TRIGGER_ELEMENTS[el]) triggerSet[el] = true; });
    var matched = null;
    for (var i = 0; i < COMBOS.length; i++) {
      var cb = COMBOS[i];
      if (triggerSet[cb.trigger] && hasActiveStatus(rat, cb.status)) { matched = cb; break; }
    }
    var dmg = bolt.dmg;
    if (matched) {
      if (matched.name === 'Shatter') dmg *= 2;
      if (matched.name === 'Overload') dmg *= 1.5;
      state.combos.push({ x: ratPx(rat), y: GROUND_Y - 96, t0: nowT, name: matched.name, color: matched.color });
      state.comboCounts[matched.name] = (state.comboCounts[matched.name] || 0) + 1;
      if (matched.name === 'Conduct') otherAliveRats(rat, 2).forEach(function (r2) { damageRat(r2, dmg * 0.6); });
      if (matched.name === 'Plague Cloud') otherAliveRats(rat, 3).forEach(function (r2) { if (Math.abs(r2.space - rat.space) <= 1) r2.poisonUntilTurn = state.turnCount + STATUS_TICK_TURNS; });
      if (matched.name === 'Ignite') otherAliveRats(rat, 3).forEach(function (r2) { if (Math.abs(r2.space - rat.space) <= 1) r2.burnUntilTurn = state.turnCount + STATUS_TICK_TURNS; });
    }
    damageRat(rat, dmg, bolt.healPerKill);
    bolt.effects.forEach(function (e) {
      if (e.stat === 'burn') rat.burnUntilTurn = state.turnCount + STATUS_TICK_TURNS;
      if (e.stat === 'slow') rat.frozenUntilTurn = state.turnCount + FROZEN_SKIP_TURNS;
      if (e.stat === 'poison') rat.poisonUntilTurn = state.turnCount + STATUS_TICK_TURNS;
    });
  }

  function fireBolt(element, rat, dmg, fx, fy, elements, effects, healPerKill) {
    state.bolts.push({
      x: fx, y: fy, tx: ratPx(rat), ty: GROUND_Y - 20, rat: rat, dmg: dmg, element: element, hit: false, t0: now(), toFrog: false,
      elements: elements || [element], effects: effects || [], healPerKill: healPerKill || 0,
    });
  }

  function fireSpitBolt(rat) {
    state.bolts.push({
      x: ratPx(rat), y: GROUND_Y - 40, tx: FROG_X + 10, ty: GROUND_Y - 40, rat: rat, dmg: SPIT_DMG,
      element: 'poison', hit: false, t0: now(), toFrog: true, elements: ['poison'], effects: [], healPerKill: 0,
    });
  }

  function stepFight(dt) {
    if (state.frogHp <= 0) { state.phase = 'lost'; updateButtons(); return; }

    // bolts travel (continuous, independent of the turn scheduler)
    state.bolts.forEach(function (b) {
      var dx = b.tx - b.x, dy = b.ty - b.y;
      var d = Math.hypot(dx, dy);
      var step = 420 * dt;
      if (step >= d) {
        b.hit = true;
        if (b.toFrog) state.frogHp -= b.dmg; else resolveHit(b);
      } else { b.x += dx / d * step; b.y += dy / d * step; }
    });
    state.bolts = state.bolts.filter(function (b) { return !b.hit; });
    state.rats = state.rats.filter(function (r) { return !(r.dead && now() - (r.deadT || (r.deadT = now())) > 400); });

    state.turnT -= dt;
    if (state.turnT > 0) return;

    if (state.turn === 'frog') {
      if (state.castOrder.length === 0) {
        castBaseline();
        state.turn = 'rats'; state.turnT = TURN_DELAY; showBanner("Rats' turn");
        return;
      }
      if (state.castIdx < state.castOrder.length) {
        var p = state.pieces[state.castOrder[state.castIdx]];
        if (p) castSpellPiece(p);
        state.castIdx++;
        state.turnT = SPELL_GAP;
        return;
      }
      state.activeSpellUid = null;
      state.turn = 'rats'; state.turnT = TURN_DELAY; showBanner("Rats' turn");
      return;
    }

    if (state.turn === 'rats') {
      performRatsStep();
      if (state.frogHp <= 0) { state.phase = 'lost'; updateButtons(); return; }
      var anyLeft = state.rats.some(function (r) { return !r.dead; }) || state.waveQueue.length > 0;
      if (!anyLeft) { endFight(); return; }
      state.castIdx = 0;
      state.turn = 'frog'; state.turnT = TURN_DELAY; showBanner('Frog turn');
    }
  }

  function endFight() {
    var boss = state.level.bosses && state.level.bosses[state.wave];
    state.gold += 10;
    if (boss || state.wave >= state.level.waves) {
      state.phase = 'won';
      state.turn = null;
      updateButtons();
      return;
    }
    state.wave++;
    revealCells(3);
    state.rerollN = 0;
    makeOffers(state.wave === 2 ? 'break2' : state.wave === 3 ? 'break3' : 'random');
    state.phase = 'build';
    state.turn = null;
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

  function extremeCell(cells, rowSign, colSign) {
    return cells.reduce(function (best, c) {
      var rowBetter = rowSign < 0 ? c[1] < best[1] : c[1] > best[1];
      var rowSame = c[1] === best[1];
      var colBetter = colSign < 0 ? c[0] < best[0] : c[0] > best[0];
      return (rowBetter || (rowSame && colBetter)) ? c : best;
    });
  }

  // Traces the outer boundary of a set of unit cells into a single closed
  // clockwise polygon, in cell-grid units.
  function outlinePolygon(cells) {
    var set = {};
    cells.forEach(function (c) { set[c[0] + ',' + c[1]] = true; });
    var edges = [];
    cells.forEach(function (c) {
      var x = c[0], y = c[1];
      if (!set[x + ',' + (y - 1)]) edges.push([x, y, x + 1, y]);
      if (!set[(x + 1) + ',' + y]) edges.push([x + 1, y, x + 1, y + 1]);
      if (!set[x + ',' + (y + 1)]) edges.push([x + 1, y + 1, x, y + 1]);
      if (!set[(x - 1) + ',' + y]) edges.push([x, y + 1, x, y]);
    });
    var byStart = {};
    edges.forEach(function (e, i) { byStart[e[0] + ',' + e[1]] = i; });
    var poly = [], used = {}, cur = 0, guard = 0;
    while (cur !== undefined && !used[cur] && guard++ <= edges.length) {
      used[cur] = true;
      poly.push([edges[cur][0], edges[cur][1]]);
      cur = byStart[edges[cur][2] + ',' + edges[cur][3]];
    }
    return poly;
  }

  function roundedPolyPath(ctx, pts, r) {
    var n = pts.length;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var p1 = pts[i % n], p2 = pts[(i + 1) % n];
      if (i === 0) ctx.moveTo(p1[0], p1[1]);
      ctx.arcTo(p1[0], p1[1], p2[0], p2[1], r);
    }
    ctx.closePath();
  }

  function drawCrown(ctx, x, y, w) {
    ctx.save();
    ctx.fillStyle = C.gold;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + w * 0.55);
    ctx.lineTo(x, y);
    ctx.lineTo(x + w * 0.25, y + w * 0.32);
    ctx.lineTo(x + w * 0.5, y - w * 0.12);
    ctx.lineTo(x + w * 0.75, y + w * 0.32);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + w * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Draws a piece as one rounded shape (its cell union's outline, not a
  // square per cell) filled in its element colour(s), with its spell bolt or
  // ingredient icon large in the middle, its short name in Kreon, tier pips
  // and (for a fused piece with 3 elements) a small crown.
  function drawPieceShape(ctx, piece, shape, px, py, cs, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    var tierColor = Art.COLORS['tier' + piece.tier] || Art.COLORS.tier1;
    var colors = piece.type === 'fusion' ? piece.fusion.elements.map(function (el) { return C[el] || tierColor; }) : [tierColor];
    var b = shapeBounds(shape.cells);
    var polyCell = outlinePolygon(shape.cells);
    var polyPx = polyCell.map(function (p) { return [px + p[0] * cs, py + p[1] * cs]; });
    var r = Math.min(10, cs * 0.22);

    ctx.save();
    roundedPolyPath(ctx, polyPx, r);
    ctx.clip();
    var stripeW = (b.w * cs) / colors.length;
    colors.forEach(function (col, i) {
      ctx.fillStyle = col;
      ctx.fillRect(px + i * stripeW, py, stripeW + 1, b.h * cs);
    });
    ctx.restore();

    roundedPolyPath(ctx, polyPx, r);
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 2;
    ctx.stroke();

    var midx = px + b.w * cs / 2, midy = py + b.h * cs / 2;
    var minDimPx = Math.min(b.w, b.h) * cs;
    if (piece.kind === 'spell') {
      Art.bolt(ctx, midx, midy - cs * 0.08, minDimPx * 0.56, piece.type === 'fusion' ? piece.fusion.elements[0] : Meta.SPELLS[piece.type].element, 0, now() / 1000);
    } else {
      ctx.save();
      roundedPolyPath(ctx, polyPx, r);
      ctx.clip();
      Art.ingredient(ctx, midx, midy - cs * 0.08, minDimPx * 0.86, piece.type, piece.tier);
      ctx.restore();
    }

    // short name, in Kreon, across the bottom of the shape
    ctx.save();
    ctx.font = '700 ' + Math.max(9, Math.min(12, cs * 0.24)) + 'px Kreon, Georgia, serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = C.ink;
    ctx.fillStyle = '#fff';
    var labelY = py + b.h * cs - 6;
    var label = pieceShortName(piece);
    ctx.strokeText(label, midx, labelY);
    ctx.fillText(label, midx, labelY);
    ctx.restore();

    // tier pips, top-right-most occupied cell
    var tierCell = extremeCell(shape.cells, -1, 1);
    var tcx = px + tierCell[0] * cs, tcy = py + tierCell[1] * cs;
    for (var i = 0; i < piece.tier; i++) {
      ctx.beginPath();
      ctx.arc(tcx + cs - 9 - i * 8, tcy + 9, 2.8, 0, Math.PI * 2);
      ctx.fillStyle = tierColor;
      ctx.fill();
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // a small crown for a finished (3-element) fused spell
    if (piece.type === 'fusion' && piece.fusion.elements.length >= 3) {
      var crownCell = extremeCell(shape.cells, -1, -1);
      drawCrown(ctx, px + crownCell[0] * cs + 3, py + crownCell[1] * cs + 4, Math.min(16, cs * 0.32));
    }
    ctx.restore();
  }

  // A small numbered ribbon at a spell piece's top-left corner (build-time
  // reading-order display); glows gold while it is the spell currently
  // firing in a frog turn.
  function drawRibbon(ctx, px, py, n, active) {
    ctx.save();
    if (active) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = C.gold;
      ctx.beginPath();
      ctx.arc(px + 6.5, py + 5, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = active ? '#FFE9A8' : C.gold;
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
    order.forEach(function (p, i) {
      var active = state.phase === 'fight' && state.turn === 'frog' && p.uid === state.activeSpellUid && (now() - state.activeSpellT0) < SPELL_GAP * 1000;
      drawRibbon(ctxPage, GRID_X + p.col * CELL + 2, GRID_Y + p.row * CELL + 2, i + 1, active);
    });
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

  // Ingredients sit beside spells: a glowing line on every edge they share
  // with a spell they are buffing.
  function edgeSegPx(cell, dir) {
    var c = cell[0], r = cell[1];
    if (dir[0] === 1) return [GRID_X + (c + 1) * CELL, GRID_Y + r * CELL, GRID_X + (c + 1) * CELL, GRID_Y + (r + 1) * CELL];
    if (dir[0] === -1) return [GRID_X + c * CELL, GRID_Y + r * CELL, GRID_X + c * CELL, GRID_Y + (r + 1) * CELL];
    if (dir[1] === 1) return [GRID_X + c * CELL, GRID_Y + (r + 1) * CELL, GRID_X + (c + 1) * CELL, GRID_Y + (r + 1) * CELL];
    return [GRID_X + c * CELL, GRID_Y + r * CELL, GRID_X + (c + 1) * CELL, GRID_Y + r * CELL];
  }
  var ING_GLOW_COLOR = { ember: 'fire', frost: 'ice', blast: 'blast', storm: 'storm', shade: 'poison' };
  function drawIngredientGlows(ctx) {
    var pieces = Object.keys(state.pieces).map(function (u) { return state.pieces[u]; });
    var spells = pieces.filter(function (p) { return p.kind === 'spell'; });
    spells.forEach(function (sp) {
      var spFp = footprintAt(shapeFor(sp).cells, sp.col, sp.row);
      touchingIngredients(sp).forEach(function (ing) {
        var glowColor = C[ING_GLOW_COLOR[ing.type]] || C.gold;
        spFp.forEach(function (c) {
          DIRS.forEach(function (d) {
            var nc = c[0] + d[0], nr = c[1] + d[1];
            var u = inBounds(nc, nr) ? state.grid[idx(nc, nr)] : null;
            if (u !== ing.uid) return;
            var seg = edgeSegPx(c, d);
            ctx.save();
            ctx.globalAlpha = 0.55 + 0.3 * Math.sin(now() / 220);
            ctx.strokeStyle = glowColor;
            ctx.lineWidth = 4;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(seg[0], seg[1]);
            ctx.lineTo(seg[2], seg[3]);
            ctx.stroke();
            ctx.restore();
          });
        });
      });
    });
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
      var x = ratPx(r);
      var status = {
        burnT: hasActiveStatus(r, 'burning') ? 1 : 0,
        slowT: hasActiveStatus(r, 'frozen') ? 1 : 0,
        poisT: hasActiveStatus(r, 'poisoned') ? 1 : 0,
        spitter: r.spitter,
      };
      if (r.boss) Art.boss(ctx, x, GROUND_Y, 100, r.name, t, false);
      else Art.ratSide(ctx, x, GROUND_Y, 46, 'runt', t, status);
      var hbw = r.boss ? 70 : 34;
      ctx.fillStyle = 'rgba(20,15,35,0.6)';
      ctx.fillRect(x - hbw / 2, GROUND_Y - (r.boss ? 108 : 66), hbw, 6);
      ctx.fillStyle = C.bad;
      ctx.fillRect(x - hbw / 2, GROUND_Y - (r.boss ? 108 : 66), hbw * Math.max(0, r.hp / r.hpMax), 6);
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

    var COMBO_DUR = 800;
    state.combos = state.combos.filter(function (cb) { return now() - cb.t0 < COMBO_DUR; });
    state.combos.forEach(function (cb) {
      var p = (now() - cb.t0) / COMBO_DUR;
      var pop = p < 0.25 ? (p / 0.25) : 1;
      ctx.save();
      ctx.globalAlpha = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      var clampedX = Math.max(95, Math.min(W - 95, cb.x));
      ctx.translate(clampedX, cb.y - p * 42);
      ctx.scale(0.7 + pop * 0.5, 0.7 + pop * 0.5);
      ctx.fillStyle = cb.color;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 4.5;
      ctx.lineJoin = 'round';
      ctx.font = '700 22px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeText(cb.name, 0, 0);
      ctx.fillText(cb.name, 0, 0);
      ctx.restore();
    });

    // "Frog turn" / "Rats' turn" banner
    if (state.bannerText && now() - state.bannerT0 < BANNER_DUR * 1000) {
      var bp = (now() - state.bannerT0) / (BANNER_DUR * 1000);
      var bAlpha = bp < 0.15 ? bp / 0.15 : (bp > 0.75 ? 1 - (bp - 0.75) / 0.25 : 1);
      ctx.save();
      ctx.globalAlpha = bAlpha;
      ctx.fillStyle = 'rgba(20,15,35,0.55)';
      ctx.fillRect(0, 56, W, 30);
      ctx.fillStyle = C.gold;
      ctx.font = '700 17px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.bannerText, W / 2, 78);
      ctx.restore();
    }

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
    state.tearing = state.tearing.filter(function (tr) { return now() - tr.t0 < 600; });
    state.tearing.forEach(function (tr) {
      var p = (now() - tr.t0) / 600;
      ctx.save();
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = '#fff';
      ctx.fillRect(GRID_X + tr.c * CELL, GRID_Y + tr.r * CELL, CELL, CELL);
      ctx.restore();
    });
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

    drawIngredientGlows(ctx);
    drawCombosAndArrows();

    // held piece: lift, shadow, drag/tap position, overlap/footprint preview
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
        var overlapSet = {};
        (check.overlap || []).forEach(function (cr) { overlapSet[cr[0] + ',' + cr[1]] = true; });
        check.fp.forEach(function (cr) {
          if (!inBounds(cr[0], cr[1])) return;
          var isOverlap = overlapSet[cr[0] + ',' + cr[1]];
          ctx.fillStyle = isOverlap ? 'rgba(255,194,61,0.55)' : (check.valid ? 'rgba(84,214,58,0.45)' : 'rgba(255,77,99,0.45)');
          ctx.fillRect(GRID_X + cr[0] * CELL, GRID_Y + cr[1] * CELL, CELL, CELL);
        });
        // the live gold preview of the union outline, whenever the drag is
        // overlapping exactly one other piece (the amendment)
        if (check.unionCells && check.unionCells.length) {
          var unionPoly = outlinePolygon(check.unionCells);
          var unionMinC = Math.min.apply(null, check.unionCells.map(function (u) { return u[0]; }));
          var unionMinR = Math.min.apply(null, check.unionCells.map(function (u) { return u[1]; }));
          var unionPx = unionPoly.map(function (pt) { return [GRID_X + (pt[0]) * CELL, GRID_Y + (pt[1]) * CELL]; });
          ctx.save();
          ctx.strokeStyle = C.gold;
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 4]);
          roundedPolyPath(ctx, unionPx, 8);
          ctx.stroke();
          ctx.restore();
        }
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

    // discovery banner: a named pair's first-time fuse
    if (state.discoveryText && now() - state.discoveryT0 < DISCOVERY_DUR * 1000) {
      var dp = (now() - state.discoveryT0) / (DISCOVERY_DUR * 1000);
      var dAlpha = dp < 0.1 ? dp / 0.1 : (dp > 0.8 ? 1 - (dp - 0.8) / 0.2 : 1);
      ctx.save();
      ctx.globalAlpha = dAlpha;
      ctx.fillStyle = C.gold;
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2;
      ctx.fillRect(W / 2 - 130, 30, 260, 34);
      ctx.strokeRect(W / 2 - 130, 30, 260, 34);
      ctx.fillStyle = C.ink;
      ctx.font = '700 15px "Titan One", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.discoveryText, W / 2, 53);
      ctx.restore();
    }
  }

  function drawShop(t) {
    var ctx = ctxShop;
    ctx.clearRect(0, 0, W, SHOP_H);
    ctx.fillStyle = C.ink;
    ctx.font = '700 15px Kreon, Georgia, serif';
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
      var fakePiece = { kind: o.kind, type: o.type, tier: o.tier, rot: 0, uid: -1 };
      var shapeO = shapeFor(fakePiece);
      var bO = shapeBounds(shapeO.cells);
      var cs = Math.min((SHOP_CARD_W - 16) / bO.w, 82 / bO.h);
      drawPieceShape(ctx, fakePiece, shapeO, sx + (SHOP_CARD_W - bO.w * cs) / 2, SHOP_Y + 8, cs, 1);
      ctx.fillStyle = C.ink;
      ctx.font = '700 13px Kreon, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(name, sx + SHOP_CARD_W / 2, SHOP_Y + SHOP_CARD_H - 24);
      ctx.font = '700 17px "Titan One", sans-serif';
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
    // The grimoire page is up in build, and also during a frog turn (so the
    // player sees the reading order play out via the ribbons); the shop
    // tray is only up between waves.
    pagePanel.classList.toggle('up', state.phase === 'build' || (state.phase === 'fight' && state.turn === 'frog'));
    shopTray.classList.toggle('up', state.phase === 'build');
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
    // Test-only: places a piece directly on the grid, bypassing the shop,
    // so a scenario's starting layout can be set up deterministically.
    testAdd: function (kind, type, tier, col, row) {
      var p = { uid: nextUid++, kind: kind, type: type, tier: tier || 1, rot: 0, col: null, row: null };
      placePieceAt(p, col, row);
      return p.uid;
    },
    // Test-only: clears every piece off the board (tray and grid) between
    // scripted scenarios, keeping gold/wave/unlocks as they are.
    testClear: function () {
      Object.keys(state.pieces).forEach(function (u) { clearFromBoard(state.pieces[u]); delete state.pieces[u]; });
      state.tray = [null, null, null];
    },
    gainsFor: function (uid) { return gainsFor(state.pieces[uid]); },
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
        turn: state.turn,
        turnCount: state.turnCount,
        lastDiscovery: state.lastDiscovery,
        toast: toastEl.textContent,
      };
    },
  };
})();
