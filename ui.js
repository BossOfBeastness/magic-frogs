/* Magic Frogs prototype: screens, navigation, save state, meta, overlays, ad mocks,
   the designer panel and shot mode. Global UI. Everything not inside #run is ours;
   #run itself is built and driven by RunB (mount/start/pause/resume/stop/shot). */
(function () {
  'use strict';

  var SAVE_KEY = 'mf-proto-v1';

  var CONFIG = {
    interstitial_first_run: 3,
    interstitial_min_gap_sec: 180,
    first_session_interstitials: 0,
    revive_ads_per_run: 1,
    revive_gem_cost: 40,
    reroll_free_per_brew: 1,
    rewarded_daily_cap: 12,
  };
  window.CONFIG = CONFIG;

  // ---------------------------------------------------------------------
  // Save state
  // ---------------------------------------------------------------------

  function defaultSave() {
    return {
      v: 1,
      core: 'b',
      visited: false,
      runsCompleted: 0,
      lastInterstitialAt: 0,
      rank: 0,
      rankXp: 0,
      coins: 0,
      gems: 40,
      bestWave: 0,
      lastPeak: 0,
      lastSpell: null,
      towers: { wizardTower: 1, nursery: 0, library: 0, alchemy: 0, herb: 0 },
      herbCollectedAt: Date.now(),
      spellbook: {},
      dailyDay: 0,
      dailyLastClaim: null,
      adsWatchedToday: 0,
      noAds: false,
      prerunExtra: null,
    };
  }

  var save = null;

  function loadSave() {
    if (save) return save;
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (raw) { save = Object.assign(defaultSave(), JSON.parse(raw)); return save; }
    } catch (e) { /* storage unavailable: fall through to defaults */ }
    save = defaultSave();
    return save;
  }

  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* fine without storage */ }
  }

  function resetSave() {
    save = defaultSave();
    persist();
  }

  // ---------------------------------------------------------------------
  // Data from game-design.md
  // ---------------------------------------------------------------------

  var RANKS = [
    { name: 'Novice', tier: 1, xp: 0, unlocks: 'Ember Salt, Frost Petal, Blast Powder, Moon Dust, Quicksilver, Frogspawn' },
    { name: 'Apprentice', tier: 1, xp: 600, unlocks: 'Nightshade, Storm Feather' },
    { name: 'Adept', tier: 2, xp: 1600, unlocks: 'Chapter 2' },
    { name: 'Mage', tier: 2, xp: 3600, unlocks: 'Chapter 3, a 13th cauldron slot' },
    { name: 'Archmage', tier: 3, xp: 7200, unlocks: 'Chapter 4' },
  ];

  var BUILDINGS = [
    { key: 'wizardTower', name: 'Wizard Tower', icon: 'i-tower', desc: 'Caps every other building\'s level', base: 300 },
    { key: 'nursery', name: 'Tadpole Nursery', icon: 'i-bag', desc: '+1 starting apprentice per level', base: 100 },
    { key: 'library', name: 'Library', icon: 'i-book', desc: '+5% spell power per level', base: 150 },
    { key: 'alchemy', name: 'Alchemy Lab', icon: 'i-power', desc: '+1 free reroll per brew at level 2; rank still sets the tier floor', base: 200 },
    { key: 'herb', name: 'Herb Garden', icon: 'i-chest', desc: 'Grows coins while you are away, up to a cap', base: 120 },
  ];

  var WIZARDS = [
    { id: 'pip', name: 'Pip', species: 'tree frog', rarity: 'Rare', skill: 'Spark Nova: every 12s zaps the 5 nearest rats', source: 'Start', free: true },
    { id: 'croak', name: 'Sergeant Croak', species: 'bullfrog', rarity: 'Rare', skill: 'Fire Rain: burns a lane for 3s', source: 'Daily reward, day 2', free: true },
    { id: 'lily', name: 'Duchess Lily', species: 'golden frog', rarity: 'Legendary', skill: 'Frost Ward: slows every rat 30% for 4s', source: 'Daily reward, day 7', free: true },
    { id: 'warts', name: 'Professor Warts', species: 'toad', rarity: 'Epic', skill: 'Recipe Scholar: named spells +10%', source: 'Chapter 2 boss', free: true },
    { id: 'dart', name: 'Dart', species: 'poison dart frog', rarity: 'Rare', skill: 'Lucky Leap: +15% coins', source: 'Shop, $4.99', free: false, price: '$4.99' },
    { id: 'morgana', name: 'Morgana', species: 'black and white frog', rarity: 'Legendary', skill: 'Hex: poison spreads twice as far', source: 'Season pass, tier 30', free: false, price: 'Season pass' },
  ];

  var SPELLS = [
    { name: 'Ember Bolt', elements: ['fire'] }, { name: 'Frost Shard', elements: ['ice'] }, { name: 'Venom Spit', elements: ['poison'] },
    { name: 'Blast Rune', elements: ['blast'] }, { name: 'Spark', elements: ['storm'] },
    { name: 'Steam Burst', elements: ['fire', 'ice'] }, { name: 'Hellbrew', elements: ['fire', 'poison'] }, { name: 'Fireball', elements: ['fire', 'blast'] }, { name: 'Sunfire', elements: ['fire', 'storm'] },
    { name: 'Frostbite', elements: ['ice', 'poison'] }, { name: 'Shatter', elements: ['ice', 'blast'] }, { name: 'Blizzard', elements: ['ice', 'storm'] },
    { name: 'Plague Bomb', elements: ['poison', 'blast'] }, { name: 'Acid Rain', elements: ['poison', 'storm'] },
    { name: 'Thunderclap', elements: ['blast', 'storm'] },
  ];

  var ELEM_COLOR = { fire: 'var(--fire)', ice: 'var(--ice)', poison: 'var(--poison)', blast: 'var(--blast)', storm: 'var(--storm)', arcane: 'var(--arcane)' };

  var DAILY_REWARDS = [
    { label: '200 coins', kind: 'coins', v: 200 },
    { label: 'Sergeant Croak', kind: 'wizard', v: 'croak' },
    { label: '30 gems', kind: 'gems', v: 30 },
    { label: 'A tier 2 ingredient crate', kind: 'ingredient', v: 2 },
    { label: '1,000 coins', kind: 'coins', v: 1000 },
    { label: '60 gems', kind: 'gems', v: 60 },
    { label: 'Duchess Lily', kind: 'wizard', v: 'lily', big: true },
  ];

  var SHOP_ITEMS = [
    { name: 'First purchase', price: '$0.99', desc: 'A big gem and coin bundle, once' },
    { name: 'Starter pack', price: '$1.99', desc: 'Gems, coins, a hat' },
    { name: 'No ads', price: '$4.99', desc: 'Removes the interstitial; rewarded ads stay optional' },
    { name: 'Monthly pass', price: '$4.99 / mo', desc: '50 gems a day, 1 free revive a day, double pass XP' },
    { name: 'Growth fund', price: '$9.99', desc: 'Pays gems out at each new rank' },
    { name: 'Gem pack, small', price: '$0.99', desc: '100 gems' },
    { name: 'Gem pack, medium', price: '$4.99', desc: '550 gems' },
    { name: 'Gem pack, large', price: '$19.99', desc: '3,000 gems' },
    { name: 'Wizard bundle: Dart', price: '$4.99', desc: 'A named wizard' },
  ];

  var AD_MAP = [
    { slot: 'A1', where: 'App open, returning players only', type: 'App Open' },
    { slot: 'A3', where: 'Daily chest; "claim x2" on the daily reward', type: 'Rewarded' },
    { slot: 'A4', where: 'Pre-run: start with 10 extra wizards', type: 'Rewarded' },
    { slot: 'A5', where: 'Revive, first per run', type: 'Rewarded' },
    { slot: 'A6', where: 'After results, from the third run, at least 3 minutes apart', type: 'Interstitial' },
    { slot: 'A7', where: 'Double coins on results', type: 'Rewarded' },
    { slot: 'extra', where: 'Brew reroll after the free one', type: 'Rewarded' },
  ];

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  function el(html) {
    var d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild;
  }
  function $(id) { return document.getElementById(id); }
  function fmt(n) {
    n = Math.round(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  }
  function icon(id, cls) { return '<svg class="' + (cls || '') + '"><use href="#' + id + '"></use></svg>'; }
  function todayStr(d) { d = d || new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); }

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------

  function toast(text) {
    var host = $('toast-host');
    if (!host) return;
    var t = el('<div class="toast"></div>');
    t.textContent = text;
    host.appendChild(t);
    setTimeout(function () {
      t.style.transition = 'opacity 0.3s';
      t.style.opacity = '0';
      setTimeout(function () { t.remove(); }, 300);
    }, 2200);
  }

  function moneyToast() { toast('Purchases are not live in the prototype'); }

  function spellFound(name) {
    if (!save.spellbook[name]) {
      save.spellbook[name] = true;
      persist();
      toast('New spell: ' + name + '!');
    }
  }

  function coins(delta) {
    save.coins = Math.max(0, save.coins + delta);
    persist();
    refreshTopbars();
  }

  function gems(delta) {
    save.gems = Math.max(0, save.gems + delta);
    persist();
    refreshTopbars();
  }

  function refreshTopbars() {
    document.querySelectorAll('[data-coins]').forEach(function (n) { n.textContent = fmt(save.coins); });
    document.querySelectorAll('[data-gems]').forEach(function (n) { n.textContent = fmt(save.gems); });
  }

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------

  var NAV_SCREENS = ['shop', 'tower', 'home', 'wizards', 'pass'];
  var current = null;

  function show(id) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('on'); });
    var target = $(id);
    if (target) target.classList.add('on');
    current = id;
    var navbar = $('navbar');
    if (NAV_SCREENS.indexOf(id) >= 0) { navbar.classList.add('on'); setActiveNav(id); }
    else navbar.classList.remove('on');
  }

  function setActiveNav(id) {
    document.querySelectorAll('.navbtn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.nav === id);
    });
  }

  function buildNav() {
    var navbar = $('navbar');
    navbar.innerHTML =
      navBtn('shop', 'i-shop', 'Shop') +
      navBtn('tower', 'i-tower', 'Tower') +
      navBtn('home', 'i-battle', 'Battle', true) +
      navBtn('wizards', 'i-hat', 'Wizards') +
      navBtn('pass', 'i-crown', 'Pass');
    navbar.querySelectorAll('.navbtn').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.nav); refreshScreen(b.dataset.nav); });
    });
  }
  function navBtn(id, iconId, label, raised) {
    return '<button type="button" class="navbtn' + (raised ? ' raised' : '') + '" data-nav="' + id + '">' + icon(iconId) + '<span>' + label + '</span></button>';
  }

  function refreshScreen(id) {
    if (id === 'home') buildHome();
    else if (id === 'tower') buildTower();
    else if (id === 'wizards') buildWizards();
    else if (id === 'shop') buildShop();
    else if (id === 'pass') buildPass();
  }

  // ---------------------------------------------------------------------
  // Title
  // ---------------------------------------------------------------------

  function buildTitle() {
    var s = $('title');
    s.innerHTML =
      '<div class="title-stage"><canvas id="title-canvas"></canvas><div class="scrim"></div></div>' +
      '<div class="title-logo titan"><span class="l1 stroke">MAGIC</span><span class="l2 stroke">FROGS</span></div>' +
      '<div class="title-core-btns">' +
      '<button type="button" class="btn-go core-btn" id="btn-play">PLAY</button>' +
      '</div>';
    $('btn-play').addEventListener('click', function () { chooseCore('b'); });
    startTitleAttract();
  }

  var titleAttract = null;
  function startTitleAttract() {
    if (titleAttract) { titleAttract.stop(); titleAttract = null; }
    var canvas = $('title-canvas');
    if (!canvas) return;
    var fit = fitCanvas(canvas);
    try {
      if (window.RunB && RunB.startAttract) titleAttract = RunB.startAttract(canvas);
    } catch (e) { /* attract mode is cosmetic */ }
  }
  function fitCanvas(canvas) {
    var r = canvas.parentElement.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    return r;
  }

  function chooseCore(core) {
    save.core = core;
    persist();
    if (!save.visited) {
      save.visited = true;
      persist();
      startRun({ fresh: true });
    } else {
      show('home'); buildHome();
    }
  }

  // ---------------------------------------------------------------------
  // Home
  // ---------------------------------------------------------------------

  function buildHome() {
    var s = $('home');
    var rank = RANKS[save.rank];
    var nextXp = RANKS[save.rank + 1] ? RANKS[save.rank + 1].xp : rank.xp + 1;
    var xpIntoRank = save.rankXp - rank.xp;
    var xpSpan = Math.max(1, nextXp - rank.xp);
    var pct = Math.max(0, Math.min(100, 100 * xpIntoRank / xpSpan));
    var dailyReady = isDailyReady();
    s.innerHTML =
      '<div class="topbar">' +
      '<div class="avatar"><canvas id="home-portrait"></canvas></div>' +
      '<div class="col" style="gap:2px">' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:14px">Novice Pip</div>' +
      '<div class="rankbar"><i style="width:' + pct + '%"></i></div>' +
      '</div>' +
      '<div class="currencies">' +
      currencyPill('i-power', 'Power', fmt(powerScore()), true, 'power') +
      currencyPill('i-coin', 'coins', fmt(save.coins), true, 'coins') +
      currencyPill('i-gem', 'gems', fmt(save.gems), true, 'gems') +
      '</div>' +
      '</div>' +
      '<div class="panel card chapter-card">' +
      '<div class="stage"><canvas id="chapter-still"></canvas></div>' +
      '<div style="font-family:\'Titan One\',sans-serif;margin-top:8px">Chapter 1: Bog Road</div>' +
      '<div style="font-size:13px">Best: wave ' + save.bestWave + ' / 15</div>' +
      '<div class="chests">' + [5, 10, 15].map(function (w) {
        return '<div class="col center" style="gap:2px"><svg class="chest-icon"><use href="#i-chest"></use></svg><span style="font-size:10px">' + w + '</span></div>';
      }).join('') + '</div>' +
      '</div>' +
      '<button type="button" class="btn-go play-big" id="home-play">PLAY</button>' +
      '<div class="home-cols">' +
      '<div class="col">' +
      homeMiniCard('daily', 'i-calendar', 'Daily', dailyReady) +
      homeMiniCard('freechest', 'i-chest', 'Free chest', false, true) +
      homeMiniCard('starter', 'i-bag', 'Starter pack $1.99', false) +
      '</div>' +
      '<div class="col">' +
      homeMiniCard('spellbook', 'i-book', 'Spell book', false) +
      homeMiniCard('dailybrew', 'i-swipe', 'Daily Brew', false) +
      '</div>' +
      '</div>';
    $('home-play').addEventListener('click', function () { buildPrerun(); show('prerun'); });
    s.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () { openHomeCard(b.dataset.open); });
    });
    s.querySelectorAll('.pill .add').forEach(function (b) {
      b.addEventListener('click', function () { show('shop'); buildShop(); });
    });
    var canvas = $('chapter-still');
    fitCanvas(canvas);
    try { if (window.RunB && RunB.renderStill) RunB.renderStill(canvas, null, 0); } catch (e) { /* RunB may not be ready in this build */ }
    drawPortrait('home-portrait', 'pip');
    refreshTopbars();
  }

  // A display-only score for the Power pill: rank progress plus what the towers add.
  // The design names a Power pill on Home but does not give its formula, so this is
  // an assumption: it should read as "getting bigger", not drive any run maths.
  function powerScore() {
    return Math.round(1000 * (1 + save.rankXp / 1000) * (1 + libraryPower()) + save.towers.nursery * 40 + save.towers.alchemy * 40);
  }

  function currencyPill(iconId, label, value, plus, addKind) {
    var dataAttr = (addKind === 'coins' || addKind === 'gems') ? ' data-' + addKind + '="1"' : '';
    return '<div class="pill">' + icon(iconId) + '<span class="tabular"' + dataAttr + '>' + value + '</span>' +
      (plus ? '<span class="add" data-add-' + addKind + '="1">+</span>' : '') + '</div>';
  }
  function homeMiniCard(open, iconId, label, dot, dimmed) {
    return '<div class="panel mini-card' + (dimmed ? '' : '') + '" data-open="' + open + '" style="position:relative">' +
      (dot ? '<span class="dot"></span>' : '') +
      icon(iconId) + '<div style="font-size:11px;margin-top:4px">' + label + '</div></div>';
  }

  function openHomeCard(what) {
    if (what === 'daily') { buildDaily(); show('daily'); }
    else if (what === 'spellbook') { buildSpellbook(); show('spellbook'); }
    else if (what === 'dailybrew') { buildDailyBrew(); show('dailybrew'); }
    else if (what === 'freechest') { showAd('rewarded', '30 coins', function () { coins(30); toast('Chest opened: 30 coins'); }); }
    else if (what === 'starter') { moneyToast(); }
  }

  function drawPortrait(canvasId, heroId) {
    var c = $(canvasId);
    if (!c) return;
    try {
      if (window.Art && Art.portrait) { Art.portrait(c, heroId); return; }
    } catch (e) { /* fall through to placeholder */ }
    var ctx = c.getContext('2d');
    c.width = c.clientWidth || 48; c.height = c.clientHeight || 48;
    ctx.fillStyle = '#6DD35A'; ctx.beginPath(); ctx.arc(c.width / 2, c.height / 2, c.width / 2 - 2, 0, 7); ctx.fill();
  }

  function libraryPower() { return save.towers.library * 0.05; }
  function nurseryStart() { return save.towers.nursery; }
  function alchemyFreeReroll() { return save.towers.alchemy >= 2 ? 1 : 0; }

  // ---------------------------------------------------------------------
  // Tower
  // ---------------------------------------------------------------------

  function buildingCost(b) { return Math.round(b.base * Math.pow(1.6, save.towers[b.key])); }
  function buildingCap() { return save.towers.wizardTower; }

  function buildTower() {
    var s = $('tower');
    var rank = RANKS[save.rank];
    var html = '<div class="topbar"><div style="font-family:\'Titan One\',sans-serif;font-size:20px">Wizard Tower</div>' +
      '<div class="currencies">' + currencyPill('i-coin', 'coins', fmt(save.coins), false) + '</div></div>' +
      '<div class="panel card">' +
      '<div class="rank-name">' + rank.name + ' (rank ' + (save.rank + 1) + ')</div>' +
      '<div style="font-size:12px;margin-top:4px">Raises the lowest ingredient tier on offer. Unlocks: ' + rank.unlocks + '</div>' +
      '<div style="font-size:12px;margin-top:4px">Lowest tier now: T' + rank.tier + '</div>' +
      '</div>';
    BUILDINGS.forEach(function (b) {
      var level = save.towers[b.key];
      var cap = b.key === 'wizardTower' ? 99 : buildingCap();
      var atCap = b.key !== 'wizardTower' && level >= cap;
      var cost = buildingCost(b);
      html += '<div class="panel card building-card">' +
        '<div class="head">' +
        '<div class="icon-box">' + icon(b.icon) + '</div>' +
        '<div class="grow"><div style="font-family:\'Titan One\',sans-serif;font-size:14px">' + b.name + ' <span style="font-size:11px">Lv ' + level + '</span></div>' +
        '<div style="font-size:11px">' + b.desc + '</div></div>' +
        '</div>' +
        '<div class="row between" style="margin-top:8px">' +
        (b.key === 'herb'
          ? '<button type="button" class="btn-go btn-small" data-collect="1">Collect</button>'
          : '<span></span>') +
        (atCap
          ? '<button type="button" class="btn-lock btn-small" disabled>Capped by Wizard Tower</button>'
          : '<button type="button" class="btn-go btn-small" data-upgrade="' + b.key + '">Upgrade: ' + fmt(cost) + ' coins</button>') +
        '</div></div>';
    });
    s.innerHTML = html;
    s.querySelectorAll('[data-upgrade]').forEach(function (btn) {
      btn.addEventListener('click', function () { upgradeBuilding(btn.dataset.upgrade); });
    });
    var collectBtn = s.querySelector('[data-collect]');
    if (collectBtn) collectBtn.addEventListener('click', collectHerb);
    refreshTopbars();
  }

  function upgradeBuilding(key) {
    var b = BUILDINGS.find(function (x) { return x.key === key; });
    var cost = buildingCost(b);
    if (key !== 'wizardTower' && save.towers[key] >= buildingCap()) return;
    if (save.coins < cost) { toast('Not enough coins'); return; }
    save.coins -= cost;
    save.towers[key]++;
    persist();
    buildTower();
  }

  function herbPending() {
    var lvl = save.towers.herb;
    if (lvl <= 0) return 0;
    var perSec = lvl * 0.5;
    var cap = lvl * 300;
    var elapsed = (Date.now() - save.herbCollectedAt) / 1000;
    return Math.min(cap, elapsed * perSec);
  }
  function collectHerb() {
    var amount = Math.round(herbPending());
    if (amount <= 0) { toast('Nothing to collect yet'); return; }
    coins(amount);
    save.herbCollectedAt = Date.now();
    persist();
    toast('Collected ' + amount + ' coins');
    buildTower();
  }

  // ---------------------------------------------------------------------
  // Wizards
  // ---------------------------------------------------------------------

  function buildWizards() {
    var s = $('wizards');
    var html = '<div class="topbar"><div style="font-family:\'Titan One\',sans-serif;font-size:20px">Wizards</div></div>' +
      '<div class="panel card"><div style="font-size:13px">Every wizard has a named way to get them. No random draws.</div></div>';
    WIZARDS.forEach(function (w) {
      html += '<div class="panel card wizard-card">' +
        '<div class="head">' +
        '<div class="icon-box"><canvas class="wizard-portrait" data-hero="' + w.id + '" width="40" height="40"></canvas></div>' +
        '<div class="grow"><div style="font-family:\'Titan One\',sans-serif;font-size:14px">' + w.name + ' <span style="font-size:10px">' + w.rarity + '</span></div>' +
        '<div style="font-size:11px">' + w.skill + '</div>' +
        '<div style="font-size:11px;font-style:italic">' + w.source + '</div></div>' +
        (w.free ? '' : '<button type="button" class="btn-buy btn-small" data-buy-wizard="1">' + w.price + '</button>') +
        '</div></div>';
    });
    s.innerHTML = html;
    s.querySelectorAll('.wizard-portrait').forEach(function (c) { drawPortrait2(c, c.dataset.hero); });
    s.querySelectorAll('[data-buy-wizard]').forEach(function (b) { b.addEventListener('click', moneyToast); });
  }
  function drawPortrait2(canvas, heroId) {
    try { if (window.Art && Art.portrait) { Art.portrait(canvas, heroId); return; } } catch (e) { /* fall back below */ }
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#8FDB54'; ctx.beginPath(); ctx.arc(20, 20, 18, 0, 7); ctx.fill();
  }

  // ---------------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------------

  function buildShop() {
    var s = $('shop');
    var html = '<div class="topbar"><div style="font-family:\'Titan One\',sans-serif;font-size:20px">Shop</div>' +
      '<div class="currencies">' + currencyPill('i-coin', 'coins', fmt(save.coins), false) + currencyPill('i-gem', 'gems', fmt(save.gems), false) + '</div></div>';
    SHOP_ITEMS.forEach(function (it) {
      html += '<div class="panel card shop-card row between">' +
        '<div class="col" style="gap:2px"><div style="font-family:\'Titan One\',sans-serif;font-size:13px">' + it.name + '</div><div style="font-size:11px">' + it.desc + '</div></div>' +
        '<button type="button" class="btn-buy btn-small" data-buy="1">' + it.price + '</button>' +
        '</div>';
    });
    s.innerHTML = html;
    s.querySelectorAll('[data-buy]').forEach(function (b) { b.addEventListener('click', moneyToast); });
    refreshTopbars();
  }

  // ---------------------------------------------------------------------
  // Pass (locked)
  // ---------------------------------------------------------------------

  function buildPass() {
    var s = $('pass');
    s.innerHTML = '<div class="topbar"><div style="font-family:\'Titan One\',sans-serif;font-size:20px">Pass</div></div>' +
      '<div class="locked-block">' + icon('i-lock') +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px">Seasons arrive after launch</div>' +
      '<div style="font-size:13px;margin-top:8px">A 4-week theme, a premium track and a new wizard (Morgana, tier 30).</div>' +
      '</div>';
  }

  // ---------------------------------------------------------------------
  // Spell book
  // ---------------------------------------------------------------------

  function buildSpellbook() {
    var s = $('spellbook');
    var found = Object.keys(save.spellbook).length;
    var html = '<div class="topbar"><button type="button" class="btn-ghost btn-small" data-back="home">Back</button>' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px;margin-left:8px">Spell book (' + found + ' / ' + SPELLS.length + ')</div></div>' +
      '<div class="spellbook-grid">';
    SPELLS.forEach(function (sp) {
      var known = !!save.spellbook[sp.name];
      html += '<div class="parchment spell-page' + (known ? '' : ' blank') + '">' +
        (known
          ? '<div class="name">' + sp.name + '</div><div>' + sp.elements.map(function (e) { return '<span class="elem-dot" style="background:' + ELEM_COLOR[e] + '"></span>'; }).join('') + '</div>'
          : '<div class="name">?</div>') +
        '</div>';
    });
    html += '</div>';
    s.innerHTML = html;
    s.querySelector('[data-back]').addEventListener('click', function () { show('home'); buildHome(); });
  }

  // ---------------------------------------------------------------------
  // Daily reward
  // ---------------------------------------------------------------------

  function isDailyReady() { return save.dailyLastClaim !== todayStr(); }

  function buildDaily() {
    var s = $('daily');
    var ready = isDailyReady();
    var html = '<div class="topbar"><button type="button" class="btn-ghost btn-small" data-back="home">Back</button>' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px;margin-left:8px">Daily reward</div></div>' +
      '<div class="daily-grid">';
    DAILY_REWARDS.forEach(function (r, i) {
      var claimed = i < save.dailyDay || (i === save.dailyDay && !ready);
      var today = i === save.dailyDay && ready;
      html += '<div class="parchment daily-day' + (claimed ? ' claimed' : '') + (today ? ' today' : '') + '">' +
        '<div>Day ' + (i + 1) + '</div>' +
        (r.kind === 'ingredient' ? '<canvas class="daily-ing-card" data-tier="' + r.v + '" width="60" height="60" style="width:36px;height:36px"></canvas>' : '') +
        '<div style="font-size:10px">' + r.label + '</div></div>';
    });
    html += '</div>' +
      '<div class="row" style="margin:0 16px 16px;gap:8px">' +
      '<button type="button" class="btn-go grow" id="daily-claim"' + (ready ? '' : ' disabled') + '>Claim</button>' +
      '<button type="button" class="btn-ad grow" id="daily-claim2"' + (ready ? '' : ' disabled') + '>' + icon('i-ad', 'icon-ad') + ' Claim x2</button>' +
      '</div>' +
      (ready ? '' : '<div class="panel card" id="daily-msg" style="text-align:center">Come back tomorrow for Sergeant Croak.</div>');
    s.innerHTML = html;
    s.querySelector('[data-back]').addEventListener('click', function () { show('home'); buildHome(); });
    var b1 = $('daily-claim'), b2 = $('daily-claim2');
    if (b1) b1.addEventListener('click', function () { claimDaily(1); });
    if (b2) b2.addEventListener('click', function () { showAd('rewarded', 'double the daily reward', function () { claimDaily(2); }); });
    s.querySelectorAll('.daily-ing-card').forEach(drawIngredientCard);
  }

  // A between-run ingredient card (Slay the Spire style): builder 2's Art.card, falling
  // back to a plain tier-coloured rounded square if art.js is not yet on the page.
  function drawIngredientCard(canvas) {
    var tier = Number(canvas.dataset.tier) || 1;
    var ctx = canvas.getContext('2d');
    try {
      if (window.Art && Art.card) { Art.card(ctx, canvas.width / 2, canvas.height, canvas.width, canvas.height, 'spawn', tier); return; }
    } catch (e) { /* fall back below */ }
    var tierColor = ['#D8DCE8', '#D8DCE8', '#6EE06A', '#4FA8FF', '#B266FF', '#FFC23D'][tier] || '#D8DCE8';
    ctx.fillStyle = tierColor;
    ctx.strokeStyle = '#241B3A'; ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(3, 3, canvas.width - 6, canvas.height - 6, 8);
    else ctx.rect(3, 3, canvas.width - 6, canvas.height - 6);
    ctx.fill(); ctx.stroke();
  }

  function claimDaily(mult) {
    var r = DAILY_REWARDS[save.dailyDay];
    if (r.kind === 'coins') coins(r.v * mult);
    else if (r.kind === 'gems') gems(r.v * mult);
    else toast('Received: ' + r.label + (mult > 1 ? ' x2' : ''));
    save.dailyDay = (save.dailyDay + 1) % DAILY_REWARDS.length;
    save.dailyLastClaim = todayStr();
    persist();
    buildDaily();
  }

  // ---------------------------------------------------------------------
  // Daily Brew
  // ---------------------------------------------------------------------

  function dailySeed() {
    var d = new Date();
    var s = '' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    return Number(s);
  }

  function buildDailyBrew() {
    var s = $('dailybrew');
    s.innerHTML = '<div class="topbar"><button type="button" class="btn-ghost btn-small" data-back="home">Back</button>' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px;margin-left:8px">Daily Brew</div></div>' +
      '<div class="panel card" style="text-align:center">' +
      '<div style="font-size:13px">One run, one seed, shared by everyone today.</div>' +
      '<button type="button" class="btn-go" id="dailybrew-start" style="margin-top:10px">Play today\'s brew</button>' +
      '</div>';
    s.querySelector('[data-back]').addEventListener('click', function () { show('home'); buildHome(); });
    $('dailybrew-start').addEventListener('click', function () { startRun({ seed: dailySeed(), dailyBrew: true }); });
  }

  function buildDailyBrewShare(run) {
    var s = $('dailybrew');
    var stats = run.stats || { spell: 'Ember Bolt', elements: [] };
    var count = run.apprentices != null ? run.apprentices : (run.count || 0);
    s.innerHTML = '<div class="topbar"><button type="button" class="btn-ghost btn-small" data-back="home">Back</button>' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px;margin-left:8px">Daily Brew</div></div>' +
      '<div class="panel card" style="text-align:center">' +
      '<canvas id="brew-share-canvas" width="300" height="220" style="width:100%;border-radius:10px;border:3px solid var(--ink)"></canvas>' +
      '<button type="button" class="btn-go btn-small" id="brew-copy" style="margin-top:10px">Copy text</button>' +
      '</div>';
    s.querySelector('[data-back]').addEventListener('click', function () { show('home'); buildHome(); });
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var d = new Date();
    var dateLabel = d.getDate() + ' ' + months[d.getMonth()];
    var shareText = 'Magic Frogs Daily Brew, ' + dateLabel + '\nWave ' + run.wave + ', ' + stats.spell + ', ' + fmt(count) + ' wizards';
    var canvas = $('brew-share-canvas');
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFF7E8'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#241B3A'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = '#241B3A'; ctx.font = '700 16px "Kreon", Georgia, serif';
    ctx.fillText('Magic Frogs Daily Brew, ' + dateLabel, 14, 32);
    ctx.font = '800 22px "Titan One", sans-serif';
    ctx.fillText('Wave ' + run.wave, 14, 70);
    ctx.font = '400 15px "Kreon", Georgia, serif';
    ctx.fillText(stats.spell || 'Ember Bolt', 14, 100);
    (stats.elements || []).forEach(function (e, i) {
      ctx.fillStyle = { fire: '#FF7A2F', ice: '#6FE3FF', poison: '#8CFF3F', blast: '#C35CFF', storm: '#FFE14A' }[e] || '#FF7BD5';
      ctx.beginPath(); ctx.arc(20 + i * 20, 120, 7, 0, 7); ctx.fill();
    });
    ctx.fillStyle = '#241B3A'; ctx.font = '400 15px "Kreon", Georgia, serif';
    ctx.fillText(fmt(count) + ' apprentices', 14, 150);
    $('brew-copy').addEventListener('click', function () {
      try {
        navigator.clipboard.writeText(shareText);
        toast('Copied');
      } catch (e) {
        try {
          var ta = document.createElement('textarea');
          ta.value = shareText; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); ta.remove();
          toast('Copied');
        } catch (e2) { toast('Copy failed'); }
      }
    });
  }

  // ---------------------------------------------------------------------
  // Pre-run
  // ---------------------------------------------------------------------

  function buildPrerun() {
    var s = $('prerun');
    var rank = RANKS[save.rank];
    s.innerHTML =
      '<div class="panel">' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:16px">Chapter 1: Bog Road</div>' +
      '<div style="font-size:13px;margin-top:4px">Rank: ' + rank.name + '. Lowest ingredient tier: ' + rank.tier + '</div>' +
      '<button type="button" class="btn-ad btn-block" style="margin-top:14px" id="pre-ad">' + icon('i-ad', 'icon-ad') + ' Start with 2 apprentices</button>' +
      '<div class="row" style="margin-top:10px;gap:10px">' +
      '<canvas id="pre-ing-card" width="60" height="60" style="width:36px;height:36px;flex:0 0 auto"></canvas>' +
      '<button type="button" class="btn-buy grow" id="pre-buy">Start with a tier 2 ingredient: 30 gems</button>' +
      '</div>' +
      '<button type="button" class="btn-go btn-block" style="margin-top:14px;font-size:22px" id="pre-start">START RUN</button>' +
      '</div>';
    save.prerunExtra = null;
    drawIngredientCard($('pre-ing-card'));
    $('pre-ad').addEventListener('click', function () {
      showAd('rewarded', '2 extra apprentices', function () { save.prerunExtra = { apprentices: 2 }; toast('Extra apprentices ready'); });
    });
    $('pre-buy').addEventListener('click', function () {
      if (save.gems < 30) { toast('Not enough gems'); return; }
      save.gems -= 30; persist(); refreshTopbars();
      save.prerunExtra = Object.assign({}, save.prerunExtra, { tier2: true });
      toast('Tier 2 ingredient ready');
    });
    $('pre-start').addEventListener('click', function () { startRun({}); });
  }

  // ---------------------------------------------------------------------
  // Meta -> run options
  // ---------------------------------------------------------------------

  function metaFromSave() {
    var rank = RANKS[save.rank];
    var extra = save.prerunExtra || {};
    return {
      apprenticeStart: 1 + nurseryStart() + (extra.apprentices || 0),
      minTier: extra.tier2 ? Math.max(rank.tier, 2) : rank.tier,
      unlocked: (window.Sim ? Sim.ING_TYPES.slice() : ['ember', 'frost', 'shade', 'blast', 'storm', 'moon', 'quick', 'spawn']),
      power: libraryPower(),
    };
  }

  // ---------------------------------------------------------------------
  // Run lifecycle
  // ---------------------------------------------------------------------

  var activeRun = null;
  var runIsDailyBrew = false;

  function startRun(opts) {
    opts = opts || {};
    var seed = opts.seed || Math.floor(Math.random() * 1000000) + 1;
    runIsDailyBrew = !!opts.dailyBrew;
    var run = SimB.createRun({ seed: seed, meta: metaFromSave() });
    activeRun = run;
    show('run');
    if (!$('run').dataset.mounted) {
      try { RunB.mount($('run')); $('run').dataset.mounted = '1'; } catch (e) { /* RunB not ready in this build */ }
    }
    try {
      RunB.start(run, {
        onDead: onRunDead,
        onEnd: onRunEnd,
        onSpell: spellFound,
        onCoins: function () { /* coins are read from run.coins at results time */ },
      });
    } catch (e) { /* RunB not ready in this build */ }
  }

  var revivesThisRun = 0;

  function onRunDead(run) {
    revivesThisRun = 0;
    showRevive(run);
  }

  function showRevive(run) {
    var s = $('revive');
    var step = revivesThisRun;
    var canAd = step < CONFIG.revive_ads_per_run;
    var canGem = step === CONFIG.revive_ads_per_run && save.gems >= CONFIG.revive_gem_cost;
    s.innerHTML = '<div class="panel">' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:16px">Pip fell on wave ' + run.wave + '</div>' +
      '<div style="font-size:12px;margin-top:4px">' + (run.stats ? run.stats.spell : '') + '</div>' +
      '<div class="cauldron-row">' + run.grid.map(function (p) { return '<div class="cell" style="' + (p ? 'background:var(--t' + p.tier + ')' : '') + '"></div>'; }).join('') + '</div>' +
      '<div style="font-size:12px">Apprentices: ' + (run.apprentices || 0) + '</div>' +
      (canAd ? '<button type="button" class="btn-ad btn-block" style="margin-top:12px" id="revive-ad">' + icon('i-ad', 'icon-ad') + ' Revive: refills health</button>' : '') +
      (!canAd && canGem ? '<button type="button" class="btn-buy btn-block" style="margin-top:12px" id="revive-gem">Revive: ' + CONFIG.revive_gem_cost + ' gems</button>' : '') +
      '<button type="button" class="btn-text" id="revive-end" style="margin-top:12px">End run and keep ' + fmt(run.coins) + ' coins</button>' +
      '<div style="font-size:11px;margin-top:4px">Coins from this run are kept either way.</div>' +
      '</div>';
    s.classList.add('on');
    var adBtn = $('revive-ad'), gemBtn = $('revive-gem'), endBtn = $('revive-end');
    if (adBtn) adBtn.addEventListener('click', function () {
      showAd('rewarded', 'a full revive', function () {
        revivesThisRun++;
        s.classList.remove('on');
        SimB.revive(run);
        try { RunB.resume(); } catch (e) { /* ignore */ }
      });
    });
    if (gemBtn) gemBtn.addEventListener('click', function () {
      save.gems -= CONFIG.revive_gem_cost; persist(); refreshTopbars();
      revivesThisRun++;
      s.classList.remove('on');
      SimB.revive(run);
      try { RunB.resume(); } catch (e) { /* ignore */ }
    });
    endBtn.addEventListener('click', function () {
      s.classList.remove('on');
      onRunEnd(run);
    });
  }

  function onRunEnd(run) {
    $('revive').classList.remove('on');
    try { RunB.stop(); } catch (e) { /* ignore */ }
    save.coins += run.coins || 0;
    save.rankXp += (run.wave || 1) * 15;
    while (RANKS[save.rank + 1] && save.rankXp >= RANKS[save.rank + 1].xp) save.rank++;
    save.bestWave = Math.max(save.bestWave, run.wave || 0);
    save.lastPeak = run.peak || run.apprentices || 0;
    save.lastSpell = run.stats ? run.stats.spell : null;
    save.runsCompleted++;
    save.prerunExtra = null;
    persist();
    if (runIsDailyBrew) { buildDailyBrewShare(run); show('dailybrew'); return; }
    buildResults(run);
    show('results');
  }

  function buildResults(run) {
    var s = $('results');
    save.bestWave = Math.max(save.bestWave, run.wave || 0);
    var cleared = run.wave >= 15 && run.state === 'won';
    s.innerHTML = '<div class="panel">' +
      '<div style="font-family:\'Titan One\',sans-serif;font-size:18px">' + (cleared ? 'Chapter cleared!' : 'Run over: wave ' + run.wave) + '</div>' +
      '<div class="stat-line"><span>Coins</span><span class="tabular">' + fmt(run.coins || 0) + '</span></div>' +
      '<div class="stat-line"><span>Rats splatted</span><span class="tabular">' + fmt(run.splatted || 0) + '</span></div>' +
      '<div class="stat-line"><span>Spell</span><span>' + (run.stats ? run.stats.spell : '') + '</span></div>' +
      '<div class="stat-line"><span>Best wave</span><span class="tabular">' + save.bestWave + '</span></div>' +
      '<button type="button" class="btn-ad btn-block" style="margin-top:12px" id="res-double">' + icon('i-ad', 'icon-ad') + ' Double coins: watch an ad</button>' +
      '<button type="button" class="btn-go btn-block" style="margin-top:10px" id="res-continue">Continue</button>' +
      '</div>';
    var doubled = false;
    $('res-double').addEventListener('click', function () {
      if (doubled) return;
      showAd('rewarded', 'double coins', function () { doubled = true; coins(run.coins || 0); toast('Coins doubled'); });
    });
    $('res-continue').addEventListener('click', function () { continueFromResults(); });
  }

  function continueFromResults() {
    var gap = (Date.now() - save.lastInterstitialAt) / 1000;
    var eligible = save.runsCompleted >= CONFIG.interstitial_first_run && gap >= CONFIG.interstitial_min_gap_sec && !save.noAds;
    if (eligible) {
      showAd('interstitial', null, function () { save.lastInterstitialAt = Date.now(); persist(); goHomeFromResults(); });
    } else goHomeFromResults();
  }
  function goHomeFromResults() { show('home'); buildHome(); }

  // ---------------------------------------------------------------------
  // Ad mocks
  // ---------------------------------------------------------------------

  function showAd(kind, rewardText, onDone) {
    var s = $('ad');
    var isRewarded = kind === 'rewarded';
    var label = kind === 'appopen' ? 'App Open' : kind === 'interstitial' ? 'Ad' : 'Ad';
    s.innerHTML = '<div class="panel ad-mock" style="position:relative">' +
      '<div style="font-family:\'Titan One\',sans-serif">' + label + '</div>' +
      '<div class="ad-video" id="ad-video">Advertiser video plays here</div>' +
      (isRewarded ? '<div id="ad-countdown">Reward in <span id="ad-secs">5</span></div>' : '') +
      '</div>';
    s.classList.add('on');
    var secs = isRewarded ? 5 : 5;
    var closeShown = false;
    function reveal() {
      if (closeShown) return;
      closeShown = true;
      var panel = s.querySelector('.panel');
      var cd = $('ad-countdown'); if (cd) cd.textContent = isRewarded ? 'Reward: ' + rewardText : '';
      var close = el('<button type="button" class="ad-close" aria-label="close">' + icon('i-close') + '</button>');
      panel.appendChild(close);
      close.addEventListener('click', function () {
        s.classList.remove('on');
        s.innerHTML = '';
        if (onDone) onDone();
      });
    }
    var timer = setInterval(function () {
      secs--;
      var el2 = $('ad-secs'); if (el2) el2.textContent = Math.max(0, secs);
      if (secs <= 0) { clearInterval(timer); reveal(); }
    }, 1000);
    s.dataset.timer = String(timer);
    s._reveal = reveal;
  }

  // ---------------------------------------------------------------------
  // Designer panel (Ad map)
  // ---------------------------------------------------------------------

  function buildAdMap() {
    var s = $('admap');
    var rows = AD_MAP.map(function (r) {
      return '<tr><td><span class="ad-tag">' + r.slot + '</span></td><td>' + r.where + '</td><td>' + r.type + '</td></tr>';
    }).join('');
    var cfgRows = Object.keys(CONFIG).map(function (k) { return '<tr><td>' + k + '</td><td>' + CONFIG[k] + '</td></tr>'; }).join('');
    s.innerHTML = '<div class="panel">' +
      '<div style="font-family:\'Titan One\',sans-serif">Ad map</div>' +
      '<table>' + rows + '</table>' +
      '<div style="font-family:\'Titan One\',sans-serif;margin-top:8px;font-size:13px">CONFIG</div>' +
      '<table>' + cfgRows + '</table>' +
      '<div class="col" style="gap:8px;margin-top:10px">' +
      '<button type="button" class="btn-ghost btn-small" id="dbg-appopen">Simulate a return visit</button>' +
      '<button type="button" class="btn-ghost btn-small" id="dbg-w12">Jump to wave 12</button>' +
      '<button type="button" class="btn-ghost btn-small" id="dbg-death">Force a death</button>' +
      '<button type="button" class="btn-ghost btn-small" id="dbg-reset">Reset save</button>' +
      '<button type="button" class="btn-go btn-small" id="dbg-close">Close</button>' +
      '</div></div>';
    $('dbg-appopen').addEventListener('click', function () { showAd('appopen', null, function () {}); });
    $('dbg-w12').addEventListener('click', function () { jumpToStrongBuild(); });
    $('dbg-death').addEventListener('click', function () {
      if (activeRun) { activeRun.frog ? (activeRun.frog.hp = 0) : null; activeRun.state = 'dead'; onRunDead(activeRun); }
      else toast('No run in progress');
    });
    $('dbg-reset').addEventListener('click', function () { resetSave(); toast('Save reset'); buildHome(); });
    $('dbg-close').addEventListener('click', function () { s.classList.remove('on'); });
  }

  // The strong build from the spec: tier 4 ember, tier 4 blast, tier 3 moon, tier 3 quick,
  // tier 3 storm, tier 2 shade; core B 12 apprentices.
  var STRONG_BUILD = [
    { type: 'ember', tier: 4 }, { type: 'blast', tier: 4 }, { type: 'moon', tier: 3 },
    { type: 'quick', tier: 3 }, { type: 'storm', tier: 3 }, { type: 'shade', tier: 2 },
  ];
  function jumpToStrongBuild() {
    startRun({ seed: 1 });
    if (activeRun) {
      activeRun.grid = STRONG_BUILD.slice();
      while (activeRun.grid.length < 12) activeRun.grid.push(null);
      activeRun.apprentices = 12;
      SimB.recalc(activeRun);
    }
  }

  var adMapOn = false;
  function toggleAdMap() {
    adMapOn = !adMapOn;
    var s = $('admap');
    if (adMapOn) { buildAdMap(); s.classList.add('on'); } else s.classList.remove('on');
    document.querySelectorAll('.ad-tag-host').forEach(function (n) { n.style.display = adMapOn ? '' : 'none'; });
  }

  // ---------------------------------------------------------------------
  // Icons: build the hidden sprite fallback so screens render even before art.js exists.
  // ---------------------------------------------------------------------

  function ensureFallbackIcons() {
    if (document.getElementById('i-coin')) return; // already provided by Art.ICON_SPRITE
    var ids = ['i-coin', 'i-gem', 'i-power', 'i-ad', 'i-lock', 'i-check', 'i-close', 'i-pause', 'i-star',
      'i-crown', 'i-chest', 'i-calendar', 'i-bag', 'i-book', 'i-tower', 'i-hat', 'i-shop', 'i-battle', 'i-swipe',
      'i-ember', 'i-frost', 'i-shade', 'i-blast', 'i-storm', 'i-moon', 'i-quick', 'i-spawn'];
    var svg = '<svg hidden xmlns="http://www.w3.org/2000/svg">' + ids.map(function (id) {
      return '<symbol id="' + id + '" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#FFC93C" stroke="#241B3A" stroke-width="2"/></symbol>';
    }).join('') + '</svg>';
    document.body.insertAdjacentHTML('afterbegin', svg);
  }

  // ---------------------------------------------------------------------
  // Shot mode
  // ---------------------------------------------------------------------

  function shotReady() {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { window.__shotReady = true; });
    else window.__shotReady = true;
  }

  var UI_TOKENS = ['title', 'home', 'tower', 'wizards', 'shop', 'spellbook', 'daily', 'dailybrew', 'prerun', 'results', 'ad-rewarded', 'ad-interstitial', 'admap'];

  function renderShot(token) {
    document.querySelectorAll('.overlay').forEach(function (o) { o.classList.remove('on'); });
    if (token.indexOf('b-') === 0) {
      show('run');
      var shotRun;
      try { RunB.mount($('run')); shotRun = RunB.shot(token); } catch (e) { /* RunB drives this token */ }
      if (token === 'b-revive' && shotRun) {
        showRevive(shotRun);
      }
      shotReady();
      return;
    }
    // Show the screen BEFORE building it: a canvas measures its box with
    // getBoundingClientRect, which is 0x0 while the .screen is still display:none.
    switch (token) {
      case 'title': show('title'); buildTitle(); break;
      case 'home': show('home'); buildHome(); break;
      case 'tower': show('tower'); buildTower(); break;
      case 'wizards': show('wizards'); buildWizards(); break;
      case 'shop': show('shop'); buildShop(); break;
      case 'spellbook': show('spellbook'); buildSpellbook(); break;
      case 'daily': show('daily'); buildDaily(); break;
      case 'dailybrew': show('dailybrew'); buildDailyBrew(); break;
      case 'prerun': show('prerun'); buildPrerun(); break;
      case 'results': {
        var fakeRun = { wave: 9, coins: 1230, splatted: 120, stats: { spell: 'Fireball' }, state: 'dead' };
        show('results'); buildResults(fakeRun); break;
      }
      case 'ad-rewarded': show('home'); buildHome(); showAd('rewarded', 'a full revive', function () {}); if ($('ad')._reveal) $('ad')._reveal(); break;
      case 'ad-interstitial': show('home'); buildHome(); showAd('interstitial', null, function () {}); if ($('ad')._reveal) $('ad')._reveal(); break;
      case 'admap': show('home'); buildHome(); buildAdMap(); $('admap').classList.add('on'); break;
      default: break;
    }
    shotReady();
  }

  function runTestFlowB() {
    try {
      var run = SimB.createRun({ seed: 1, meta: metaFromSave() });
      var guard = 0;
      while (run.state === 'run' || run.state === 'boss') {
        SimB.step(run, 1 / 60, SimB.autopilot(run));
        guard++;
        if (guard > 20000) throw new Error('wave 1 did not end in time');
      }
      if (run.state !== 'brew' && run.state !== 'won') throw new Error('expected brew or won after wave 1, got ' + run.state);
      if (run.state === 'brew') {
        if (!run.offers || run.offers.length !== 3) throw new Error('expected 3 offers');
        Sim.pick(run, 0);
        for (var a = 0; a < run.grid.length && !run._merged; a++) {
          for (var b = a + 1; b < run.grid.length; b++) {
            if (Sim.canMerge(run, a, b)) { Sim.merge(run, a, b); run._merged = true; break; }
          }
        }
        SimB.nextWave(run);
      }
      run.frog.hp = 0; run.state = 'dead';
      SimB.revive(run);
      if (run.frog.hp !== run.frog.maxHp) throw new Error('revive did not refill health');
      run.state = 'dead';
      buildResults(run);
      window.__testResult = 'ok';
    } catch (e) {
      window.__testResult = 'error: ' + (e && e.message ? e.message : String(e));
    }
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function boot() {
    loadSave();
    ensureFallbackIcons();
    buildNav();
    $('admap-toggle').addEventListener('click', toggleAdMap);

    var hash = location.hash || '';
    if (hash === '#test-flow-b') { runTestFlowB(); return; }
    if (hash.indexOf('#shot-') === 0) {
      var token = hash.slice(6);
      renderShot(token);
      return;
    }

    if (save.visited) { show('home'); buildHome(); }
    else { show('title'); buildTitle(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.UI = {
    showAd: showAd,
    toast: toast,
    spellFound: spellFound,
    coins: coins,
  };
})();
