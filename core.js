export function number(value, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCategory(value) {
  const category = String(value ?? "").trim().toLowerCase();
  if (["damage", "attack", "attacking", "offense", "offensive"].includes(category)) return "damage";
  if (["status", "support", "supporting", "utility"].includes(category)) return "status";
  return category || "status";
}

export function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A row counts once its Ready box is ticked, so half-finished rows stay off the site.
// Rows from a source with no Ready column (the bundled data) always count.
export function isReady(record) {
  if (!("Ready" in record)) return true;
  return record.Ready === true || ["true", "yes", "y", "x", "1"].includes(String(record.Ready).trim().toLowerCase());
}

export function normalizeMonster(record) {
  return {
    id: record.Id || record.id || record.Name || record.name || "",
    name: record.Name || record.name || record.Id || record.id || "Unnamed creature",
    type1: record.Type1 || record.type1 || record.Type || record.type || "Normal",
    type2: record.Type2 || record.type2 || "",
    hp: number(record.HP ?? record.hp),
    attack: number(record.Attack ?? record.attack),
    defense: number(record.Defense ?? record.defense),
    speed: number(record.Speed ?? record.speed),
    ability: record.Ability || record.ability || "",
    evolvesTo: record.EvolvesTo || record.evolvesTo || "",
    rarity: record.Rarity || record.rarity || "",
  };
}

export function normalizeMove(record) {
  return {
    id: record.Id || record.id || record.Name || record.name || "",
    name: record.Name || record.name || record.Id || record.id || "Unnamed move",
    type: record.Type || record.type || "Normal",
    category: normalizeCategory(record.Category ?? record.category),
    power: number(record.Power ?? record.power),
    accuracy: number(record.Accuracy ?? record.accuracy, 100),
    pp: number(record.PP ?? record.pp),
    effect: record.Effect || record.effect || "",
  };
}

export function normalizeAbility(record) {
  return {
    id: record.Id || record.id || record.Name || record.name || "",
    name: record.Name || record.name || record.Id || record.id || "",
    kind: record.Kind || record.kind || "",
    type: record.Type || record.type || "",
    status: record.Status || record.status || "",
    text: record.Text || record.text || "",
  };
}

export function normalizeLearnsetEntry(record) {
  return {
    monster: record.Monster || record.monster || "",
    level: number(record.Level ?? record.level, 1),
    move: record.MoveId || record.moveId || record.Move || record.move || "",
  };
}

// Held items from the balancer pack. The names describe the effect because real items aren't designed yet.
export const ITEMS = [
  { id: "none", name: "None", text: "No held item." },
  { id: "all-damage", name: "Damage Boost", text: "All damage moves ×1.2." },
  { id: "type-boost", name: "Type Boost", text: "Moves of one chosen type ×1.2." },
  { id: "life-orb", name: "Life-Orb Style", text: "Damage ×1.3. Loses 10% max HP per hit." },
  { id: "choice-attack", name: "Choice Attack", text: "Attack ×1.5. Locked into one move." },
  { id: "choice-speed", name: "Choice Speed", text: "Speed ×1.5. Locked into one move. No damage change." },
  { id: "speed-item", name: "Speed Item", text: "Speed ×1.2. No damage change." },
  { id: "vest", name: "Vest", text: "Defense ×1.5. Status moves can't be used." },
  { id: "eviolite", name: "Eviolite Style", text: "Defense ×1.5 while it can still evolve." },
];

export const STATUSES = { none: "None", burn: "Burned", paralysis: "Paralysed", poison: "Poisoned", sleep: "Asleep" };

const STATUS_TYPE_IMMUNITY = { burn: ["Fire"], paralysis: ["Electric"], poison: ["Poison", "Steel"], sleep: [] };

// Returns why a status can't apply, or "" if it can.
export function statusBlockReason(status, types, ability) {
  const blockingType = (STATUS_TYPE_IMMUNITY[status] || []).find((type) => types.includes(type));
  if (blockingType) return `${blockingType} types can't get this status`;
  if (ability && normalizeKey(ability.kind) === "immune" && normalizeKey(ability.status) === normalizeKey(status)) return `${ability.name} prevents this status`;
  return "";
}

// The pack gives Struggle no power, so 50 is an assumption; it can be edited per move slot.
export const STRUGGLE = { id: "Struggle", name: "Struggle", type: "", category: "damage", power: 50, accuracy: 100, pp: 0, effect: "Typeless, always hits for ×1. Used when every move is out of PP." };

export const STAT_KEYS = ["hp", "attack", "defense", "speed"];
export const STAT_SHORT = { hp: "HP", attack: "Atk", defense: "Def", speed: "Spe" };
export const DEFAULT_IV = 15;
export const MAX_IV = 31;
export const MAX_STAT_EV = 252;
export const MAX_TOTAL_EV = 510;

// The modern Pokémon stat formula with no nature term, because Novalings have no natures.
export function calculateStat(base, iv, level, isHp = false, ev = 0) {
  const core = Math.floor(((2 * number(base) + number(iv) + Math.floor(number(ev) / 4)) * number(level)) / 100);
  return core + (isHp ? number(level) + 10 : 5);
}

export function stageMultiplier(stage) {
  const currentStage = Math.max(-6, Math.min(6, number(stage)));
  return currentStage >= 0 ? (2 + currentStage) / 2 : 2 / (2 - currentStage);
}

function applyStage(stat, stage) {
  return Math.floor(number(stat) * stageMultiplier(stage));
}

function getTypeMultiplier(typeChart, attackType, defenderType1, defenderType2 = "") {
  const row = typeChart?.[attackType] || typeChart?.[String(attackType).trim()] || {};
  const first = number(row?.[defenderType1], 1);
  const second = defenderType2 ? number(row?.[defenderType2], 1) : 1;
  return first * second;
}

export function findAbility(abilities, abilityName) {
  const target = normalizeKey(abilityName);
  return abilities.find((ability) => normalizeKey(ability.id) === target || normalizeKey(ability.name) === target);
}

export function offensiveStat(attack, stage, item) {
  const staged = applyStage(attack, stage);
  return item === "choice-attack" ? Math.floor(staged * 1.5) : staged;
}

export function defensiveStat(defense, stage, item, canEvolve) {
  const staged = applyStage(defense, stage);
  return item === "vest" || (item === "eviolite" && canEvolve) ? Math.floor(staged * 1.5) : staged;
}

export function effectiveSpeed(speed, { stage = 0, paralysed = false, item = "none" } = {}) {
  let result = applyStage(speed, stage);
  if (item === "choice-speed") result = Math.floor(result * 1.5);
  if (item === "speed-item") result = Math.floor(result * 1.2);
  if (paralysed) result = Math.floor(result / 2);
  return result;
}

function endOfTurnDamage(status, maxHp) {
  if (status === "burn") return Math.max(1, Math.floor(maxHp / 16));
  if (status === "poison") return Math.max(1, Math.floor(maxHp / 8));
  return 0;
}

// Chance that exactly these rolls KO within `hits` hits, with end-of-turn damage between hits.
function koChance(damages, hp, eot, hits, sturdy, memo) {
  const key = `${hp}|${hits}|${sturdy}`;
  if (memo.has(key)) return memo.get(key);
  let total = 0;
  for (const damage of damages) {
    const survivesOnSturdy = sturdy && damage >= hp;
    if (hits === 1) total += damage >= hp && !survivesOnSturdy ? 1 : 0;
    else if (damage >= hp && !survivesOnSturdy) total += 1;
    else total += koChance(damages, (survivesOnSturdy ? 1 : hp - damage) - eot, eot, hits - 1, false, memo);
  }
  const chance = total / damages.length;
  memo.set(key, chance);
  return chance;
}

// Never rounds a real chance away to 0% or up to a false 100%.
export function formatChance(chance) {
  if (chance === 0 || chance === 1) return `${chance * 100}%`;
  if (chance < 0.001) return "<0.1%";
  if (chance > 0.999) return ">99.9%";
  return `${Math.round(chance * 1000) / 10}%`;
}

// Knockout odds using the same conventions as the Pokémon Showdown calculator: exact up to 4
// hits, then guaranteed/possible up to 9, and no OHKO text once a KO needs more than that.
export function analyzeKo(rolls, { hp, maxHp = hp, status = "none", sturdy = false } = {}) {
  const damages = rolls.map((roll) => (typeof roll === "number" ? roll : roll.damage));
  const min = Math.min(...damages);
  const max = Math.max(...damages);
  const eot = endOfTurnDamage(status, maxHp);
  const after = eot ? ` after ${status} damage` : "";
  const usesSturdy = sturdy && hp === maxHp;
  const table = [1, 2, 3, 4].map((hits) => ({ hits, chance: max > 0 && hp > 0 ? koChance(damages, hp, eot, hits, usesSturdy, new Map()) : 0 }));
  const label = (hits) => (hits === 1 ? "OHKO" : `${hits}HKO`);
  const sturdyNote = usesSturdy && max >= hp ? " (Sturdy survives the first hit)" : "";
  const base = { table, min, max, sturdyApplies: Boolean(sturdyNote) };
  if (max <= 0 || hp <= 0) return { ...base, hits: 0, chance: 0, text: "" };
  for (const { hits, chance } of table) {
    const suffix = (hits === 1 ? "" : after) + sturdyNote;
    if (chance === 1) return { ...base, hits, chance, text: `guaranteed ${label(hits)}${suffix}` };
    if (chance > 0) return { ...base, hits, chance, text: `${formatChance(chance)} chance to ${label(hits)}${suffix}` };
  }
  for (let hits = 5; hits <= 9; hits += 1) {
    if (min * hits + eot * hits >= hp) return { ...base, hits, chance: 1, text: `guaranteed ${hits}HKO${after}` };
    if (max * hits + eot * hits >= hp) return { ...base, hits, chance: 0, text: `possible ${hits}HKO${after}` };
  }
  return { ...base, hits: 0, chance: 0, text: "" };
}

function damageItemMultiplier(item, move, typeBoost) {
  if (item === "all-damage") return 1.2;
  if (item === "life-orb") return 1.3;
  if (item === "type-boost" && move.type === typeBoost) return 1.2;
  return 1;
}

export function calculateDamage(input) {
  const {
    attacker,
    defender,
    move,
    abilities = [],
    typeChart = {},
    attackerLevel = 50,
    defenderLevel = 50,
    attackerAttackIv = 15,
    defenderDefenseIv = 15,
    defenderHpIv = 15,
    attackerAttackEv = 0,
    defenderDefenseEv = 0,
    defenderHpEv = 0,
    attackerStage = 0,
    defenderStage = 0,
    critical = false,
    attackerBurned = false,
    attackerLowHp = false,
    attackerItem = "none",
    defenderItem = "none",
    typeBoost = "",
  } = input;

  if (!attacker || !defender || !move) return { kind: "missing" };
  if (normalizeCategory(move.category) !== "damage" || number(move.power) <= 0) {
    return { kind: "support", move };
  }

  const ability = findAbility(abilities, attacker.ability);
  const ignoresAttackDrop = critical && number(attackerStage) < 0;
  const ignoresDefenseBoost = critical && number(defenderStage) > 0;
  const usedAttackStage = ignoresAttackDrop ? 0 : number(attackerStage);
  const usedDefenseStage = ignoresDefenseBoost ? 0 : number(defenderStage);
  const rawAttack = calculateStat(attacker.attack, attackerAttackIv, attackerLevel, false, attackerAttackEv);
  const rawDefense = calculateStat(defender.defense, defenderDefenseIv, defenderLevel, false, defenderDefenseEv);
  const attack = offensiveStat(rawAttack, usedAttackStage, attackerItem);
  const defense = defensiveStat(rawDefense, usedDefenseStage, defenderItem, Boolean(defender.evolvesTo));

  const typeMultiplier = getTypeMultiplier(typeChart, move.type, defender.type1, defender.type2);
  // Struggle is typeless: a blank move type must not match a blank Type2.
  const hasStab = Boolean(move.type) && (move.type === attacker.type1 || move.type === attacker.type2);
  const surgeActive = Boolean(
    ability
      && normalizeKey(ability.kind) === "surge"
      && ability.type === move.type
      && attackerLowHp,
  );
  const itemMultiplier = damageItemMultiplier(attackerItem, move, typeBoost);
  // Rounded because 1.5 * 1.2 is 1.7999999999999998 in floating point, which would lose a point of damage.
  const boostMultiplier = Math.round((surgeActive ? 1.5 : 1) * itemMultiplier * 1000) / 1000;
  const defenderHp = calculateStat(defender.hp, defenderHpIv, defenderLevel, true, defenderHpEv);

  if (typeMultiplier === 0) {
    return {
      kind: "damage",
      rolls: Array.from({ length: 16 }, (_, index) => ({ random: 85 + index, damage: 0 })),
      min: 0,
      max: 0,
      typeMultiplier,
      hasStab,
      surgeActive,
      itemMultiplier,
      ignoresAttackDrop,
      ignoresDefenseBoost,
      defenderHp,
      attack,
      defense,
      trace: [
        ["Attack / Defense", `${attack} / ${defense}`],
        ["Type", `${move.type} has no effect on ${defender.type1}${defender.type2 ? ` / ${defender.type2}` : ""}.`],
      ],
    };
  }

  const levelFactor = Math.floor((2 * number(attackerLevel)) / 5) + 2;
  const preDivision = Math.floor((levelFactor * number(move.power) * attack) / Math.max(1, defense));
  const baseDamage = Math.floor(preDivision / 50) + 2;
  const rolls = [];
  for (let random = 85; random <= 100; random += 1) {
    let damage = critical ? Math.floor(baseDamage * 1.5) : baseDamage;
    damage = Math.floor((damage * random) / 100);
    if (hasStab) damage = Math.floor(damage * 1.5);
    damage = Math.floor(damage * typeMultiplier);
    if (attackerBurned) damage = Math.floor(damage * 0.5);
    damage = Math.floor(damage * boostMultiplier + 1e-9);
    rolls.push({ random, damage: Math.max(1, damage) });
  }
  const damages = rolls.map((roll) => roll.damage);
  const activeBoosts = [
    surgeActive ? "Surge ×1.5" : "",
    itemMultiplier > 1 ? `held item ×${itemMultiplier}` : "",
  ].filter(Boolean).join("; ") || "none";

  return {
    kind: "damage",
    rolls,
    min: Math.min(...damages),
    max: Math.max(...damages),
    typeMultiplier,
    hasStab,
    surgeActive,
    itemMultiplier,
    ignoresAttackDrop,
    ignoresDefenseBoost,
    defenderHp,
    attack,
    defense,
    trace: [
      ["Attack / Defense", `${attack} / ${defense}`],
      ["Base", `floor(floor(${levelFactor} × ${move.power} × ${attack} / ${defense}) / 50) + 2 = ${baseDamage}`],
      ["Critical hit", critical ? "×1.5 applied" : "not applied"],
      ["Random", "16 whole-number rolls from 85 to 100"],
      ["STAB", hasStab ? "×1.5 applied" : "not applied"],
      ["Type", `×${typeMultiplier}`],
      ["Burn", attackerBurned ? "×0.5 applied" : "not applied"],
      ["Boosts", activeBoosts],
    ],
  };
}
