/* Magic Frogs prototype: the shared data tables for the run model agreed on 2026-09-29 (evening).
   One frog; spells found in the run (merge by tier); ingredients buff one spell each via the
   Alchemist pot; Spell Book levels and frog gear carry between runs. Global `Meta` (browser)
   or module.exports (Node). Pure data plus small helpers, no DOM. */
(function (root) {
  'use strict';

  // Spells. dmg is damage per cast at tier 1, level 1; rate is casts per second.
  const SPELLS = {
    missile: { name: 'Magic Missile', element: 'arcane', dmg: 10, rate: 2.0, unlock: 'start', text: 'Fast single shots' },
    ember:   { name: 'Ember Bolt',    element: 'fire',   dmg: 8,  rate: 1.6, burn: 0.6, unlock: 'start', text: 'Sets rats on fire' },
    frost:   { name: 'Frost Shard',   element: 'ice',    dmg: 7,  rate: 1.6, slow: 0.3, unlock: 'start', text: 'Slows what it hits' },
    blast:   { name: 'Blast Rune',    element: 'blast',  dmg: 9,  rate: 1.0, splash: 0.7, splashR: 1.2, unlock: 'start', text: 'Explodes on impact' },
    venom:   { name: 'Venom Spit',    element: 'poison', dmg: 5,  rate: 1.4, poison: 1.0, unlock: 'apprentice', text: 'Poison that spreads on death' },
    spark:   { name: 'Spark',         element: 'storm',  dmg: 6,  rate: 1.5, chain: 2, unlock: 'apprentice', text: 'Lightning jumps between rats' },
  };
  const SPELL_TYPES = Object.keys(SPELLS);
  // The nine two-element spells: shown locked in the Spell Book as future unlocks.
  const LOCKED_SPELLS = ['Fireball', 'Blizzard', 'Plague Bomb', 'Sunfire', 'Frostbite', 'Steam Burst', 'Acid Rain', 'Shatter', 'Thunderclap'];

  const TIER_MULT = [0, 1, 1.8, 3.2, 5.6, 9.5];      // in-run tier from merging identical spells
  const MAX_SPELLS = 4;
  const SPELL_SLOTS = 2;                              // ingredient slots per spell
  const POT_SLOTS = 4;

  // Spell Book levels: +10% power per level above 1. Levels 2 to 5 cost coins only;
  // levels 6 to 10 cost coins and gems (design, "Changes after version 1").
  const MAX_LEVEL = 10;
  const levelBonus = level => 0.1 * (level - 1);
  const levelCost = level => ({            // cost to go from `level` to `level + 1`
    coins: 100 * Math.pow(2, level - 1),
    gems: level >= 5 ? 10 * (level - 4) : 0,
  });

  // Ingredients: dropped on one spell. v[t] is the effect at tier t (1-5).
  const INGREDIENTS = {
    ember: { name: 'Ember Salt',    stat: 'burn',   v: [0, 0.3, 0.55, 0.9, 1.4, 2.1],    text: t => `Burn +${pct(INGREDIENTS.ember.v[t])}` },
    frost: { name: 'Frost Petal',   stat: 'slow',   v: [0, 0.15, 0.25, 0.35, 0.45, 0.55], text: t => `Slow +${pct(INGREDIENTS.frost.v[t])}` },
    shade: { name: 'Nightshade',    stat: 'poison', v: [0, 0.35, 0.6, 1.0, 1.6, 2.4],    text: t => `Poison +${pct(INGREDIENTS.shade.v[t])}` },
    blast: { name: 'Blast Powder',  stat: 'splash', v: [0, 0.25, 0.4, 0.6, 0.85, 1.2],   text: t => `Splash +${pct(INGREDIENTS.blast.v[t])}` },
    storm: { name: 'Storm Feather', stat: 'chain',  v: [0, 1, 2, 3, 4, 6],               text: t => `Chain +${INGREDIENTS.storm.v[t]}` },
    moon:  { name: 'Moon Dust',     stat: 'power',  v: [0, 0.3, 0.7, 1.3, 2.3, 4.0],     text: t => `Power +${pct(INGREDIENTS.moon.v[t])}` },
    quick: { name: 'Quicksilver',   stat: 'rate',   v: [0, 0.25, 0.55, 1.0, 1.7, 2.8],   text: t => `Cast speed +${pct(INGREDIENTS.quick.v[t])}` },
    dew:   { name: 'Lily Dew',      stat: 'heal',   v: [0, 1, 2, 3, 5, 8],               text: t => `Heal ${INGREDIENTS.dew.v[t]} per kill` },
  };
  const INGREDIENT_TYPES = Object.keys(INGREDIENTS);
  function pct(x) { return Math.round(x * 100) + '%'; }

  // Gear, as in Gun Hero's Gear tab: 4 slots, 4 rarities, 3 sets.
  const GEAR_SLOTS = ['hat', 'robe', 'staff', 'amulet'];
  const RARITIES = [
    { id: 'common', name: 'Common', color: '#D8DCE8', mult: 1 },
    { id: 'rare', name: 'Rare', color: '#4FA8FF', mult: 1.6 },
    { id: 'epic', name: 'Epic', color: '#B266FF', mult: 2.5 },
    { id: 'legendary', name: 'Legendary', color: '#FFC23D', mult: 4 },
  ];
  const SLOT_BASE = {                      // what each slot gives at common, level 1
    hat:    { power: 0.05 },
    robe:   { hp: 15 },
    staff:  { power: 0.08 },
    amulet: { rate: 0.05 },
  };
  const SETS = {
    bogwitch: { name: 'Bog Witch',    color: '#5FA88E', two: { hp: 20 },   four: { poison: 0.3 }, twoText: '+20 health', fourText: 'Every spell poisons +30%' },
    storm:    { name: 'Storm Caller', color: '#FFE14A', two: { rate: 0.1 }, four: { chain: 1 },   twoText: '+10% cast speed', fourText: 'Every spell chains to 1 more rat' },
    lily:     { name: 'Lily Knight',  color: '#F7A8C8', two: { hp: 30 },   four: { heal: 2 },     twoText: '+30 health', fourText: 'Heal 2 per kill' },
  };
  const SET_IDS = Object.keys(SETS);
  // Every piece: one per set per slot, e.g. "bogwitch-hat".
  const GEAR = {};
  for (const set of SET_IDS) for (const slot of GEAR_SLOTS) {
    GEAR[set + '-' + slot] = { id: set + '-' + slot, set, slot, name: SETS[set].name + ' ' + slot[0].toUpperCase() + slot.slice(1) };
  }
  const GEAR_MAX_LEVEL = 10;
  const gearLevelCost = level => ({ coins: 50 * level, gems: 0 });
  const FUSE_COUNT = 3;                    // three identical pieces make one of the next rarity

  // Totals for the equipped gear: { hp, power, rate, poison, chain, heal }.
  // equipped: { hat: {id, rarity, level} | null, ... }
  function gearStats(equipped) {
    const s = { hp: 0, power: 0, rate: 0, poison: 0, chain: 0, heal: 0 };
    const setCount = {};
    for (const slot of GEAR_SLOTS) {
      const g = equipped && equipped[slot];
      if (!g) continue;
      const piece = GEAR[g.id], r = RARITIES.find(x => x.id === g.rarity) || RARITIES[0];
      const scale = r.mult * (1 + 0.08 * ((g.level || 1) - 1));
      for (const [k, v] of Object.entries(SLOT_BASE[slot])) s[k] += v * scale;
      setCount[piece.set] = (setCount[piece.set] || 0) + 1;
    }
    for (const [set, n] of Object.entries(setCount)) {
      const def = SETS[set];
      if (n >= 2) for (const [k, v] of Object.entries(def.two)) s[k] += v;
      if (n >= 4) for (const [k, v] of Object.entries(def.four)) s[k] += v;
    }
    s.hp = Math.round(s.hp);
    return s;
  }

  // Rank (design 7.1) decides which spells and ingredients can be offered and the lowest tier.
  const RANKS = ['Novice', 'Apprentice', 'Adept', 'Mage', 'Archmage'];
  function rankUnlocks(rank) {           // rank is 1-based
    const spells = SPELL_TYPES.filter(t => SPELLS[t].unlock === 'start' || (SPELLS[t].unlock === 'apprentice' && rank >= 2));
    const ingredients = rank >= 2 ? INGREDIENT_TYPES.slice() : INGREDIENT_TYPES.filter(t => t !== 'shade' && t !== 'storm');
    const minTier = rank >= 5 ? 3 : rank >= 3 ? 2 : 1;
    return { spells, ingredients, minTier };
  }

  // A fresh save for the meta layer.
  function newMetaSave() {
    const spells = {};
    for (const t of SPELL_TYPES) spells[t] = { unlocked: SPELLS[t].unlock === 'start', level: 1 };
    return {
      spells,
      gear: {
        inventory: [
          { id: 'bogwitch-hat', rarity: 'common', level: 1 },
          { id: 'bogwitch-staff', rarity: 'common', level: 1 },
          { id: 'lily-robe', rarity: 'common', level: 1 },
        ],
        equipped: { hat: 0, robe: 2, staff: 1, amulet: null },   // indexes into inventory
      },
    };
  }

  // What SimB.createRun needs from the save: opts.meta = Meta.runMeta(save, rank).
  function runMeta(metaSave, rank) {
    const equipped = {};
    for (const slot of GEAR_SLOTS) {
      const i = metaSave.gear.equipped[slot];
      equipped[slot] = i === null || i === undefined ? null : metaSave.gear.inventory[i];
    }
    const levels = {};
    for (const t of SPELL_TYPES) levels[t] = metaSave.spells[t].level;
    const u = rankUnlocks(rank || 1);
    return { spellLevels: levels, gear: gearStats(equipped), unlockedSpells: u.spells, unlockedIngredients: u.ingredients, minTier: u.minTier };
  }


  // Evolutions (decided 2026-09-30, after Gun Hero): each base spell unlocks up to two
  // two-element forms by Spell Book level; merging that spell to tier 3 in a run lets the
  // player pick one. An evolved spell keeps its own effect, gains the partner element's
  // base effect (from the spell of that element), and does EVO_MULT times the damage.
  const EVOLUTIONS = {
    ember: [{ id: 'fireball', name: 'Fireball', with: 'blast', unlockLevel: 3 }, { id: 'steamburst', name: 'Steam Burst', with: 'frost', unlockLevel: 6 }],
    frost: [{ id: 'blizzard', name: 'Blizzard', with: 'spark', unlockLevel: 3 }, { id: 'shatter', name: 'Shatter', with: 'blast', unlockLevel: 6 }],
    venom: [{ id: 'frostbite', name: 'Frostbite', with: 'frost', unlockLevel: 3 }, { id: 'acidrain', name: 'Acid Rain', with: 'spark', unlockLevel: 6 }],
    blast: [{ id: 'plaguebomb', name: 'Plague Bomb', with: 'venom', unlockLevel: 3 }, { id: 'thunderclap', name: 'Thunderclap', with: 'spark', unlockLevel: 6 }],
    spark: [{ id: 'sunfire', name: 'Sunfire', with: 'ember', unlockLevel: 3 }],
    missile: [],
  };
  const EVO_MULT = 1.5;
  const EVOLVE_AT_TIER = 3;
  function evolutionsFor(type, level) { return (EVOLUTIONS[type] || []).filter(e => level >= e.unlockLevel); }

  // Run gold (decided 2026-09-30): rats drop gold during a wave; the Magic Book's cards cost gold.
  const GOLD_PER_KILL = { runt: 1, brute: 4, tank: 15, boss: 50 };
  const START_GOLD = 20;                          // enough to buy one card in the first book
  const waveGold = wave => 5 + 2 * wave;          // bonus for clearing a wave
  const SPELL_PRICE = [0, 12, 30, 70, 150, 320];  // by tier
  const ING_PRICE = [0, 8, 20, 50, 110, 240];
  const rerollCost = n => (n === 0 ? 0 : 5 * Math.pow(2, n - 1));   // n rerolls already made this book

  // Levels (decided 2026-09-30): level 1 is 5 waves ending with the Rat King; then 15-wave levels.
  const LEVELS = [
    { id: 1, chapter: 1, name: 'Bog Road 1', waves: 5, bosses: { 5: 'Rat King' } },
    { id: 2, chapter: 1, name: 'Bog Road 2', waves: 15, bosses: { 5: 'Rat King', 10: 'Sewer Queen', 15: 'Plague Lord' } },
    { id: 3, chapter: 1, name: 'Bog Road 3', waves: 15, bosses: { 5: 'Rat King', 10: 'Sewer Queen', 15: 'Plague Lord' }, hpScale: 1.3 },
  ];

  const Meta = {
    SPELLS, SPELL_TYPES, LOCKED_SPELLS, TIER_MULT, MAX_SPELLS, SPELL_SLOTS, POT_SLOTS,
    MAX_LEVEL, levelBonus, levelCost,
    INGREDIENTS, INGREDIENT_TYPES,
    GEAR_SLOTS, RARITIES, SLOT_BASE, SETS, SET_IDS, GEAR, GEAR_MAX_LEVEL, gearLevelCost, FUSE_COUNT, gearStats,
    RANKS, rankUnlocks, newMetaSave, runMeta,
    EVOLUTIONS, EVO_MULT, EVOLVE_AT_TIER, evolutionsFor,
    GOLD_PER_KILL, START_GOLD, waveGold, SPELL_PRICE, ING_PRICE, rerollCost, LEVELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Meta;
  else root.Meta = Meta;
})(typeof window !== 'undefined' ? window : globalThis);
