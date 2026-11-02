export function number(value, fallback = 0) {
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
    text: record.Text || record.text || "",
  };
}

export function calculateStat(base, iv, level, isHp = false) {
  const core = Math.floor(((2 * number(base) + number(iv)) * number(level)) / 100);
  return core + (isHp ? number(level) + 10 : 5);
}

export function stageMultiplier(stage) {
  const currentStage = Math.max(-6, Math.min(6, number(stage)));
  return currentStage >= 0 ? (2 + currentStage) / 2 : 2 / (2 - currentStage);
}

export function applyStage(stat, stage) {
  return Math.floor(number(stat) * stageMultiplier(stage));
}

export function getTypeMultiplier(typeChart, attackType, defenderType1, defenderType2 = "") {
  const row = typeChart?.[attackType] || typeChart?.[String(attackType).trim()] || {};
  const first = number(row?.[defenderType1], 1);
  const second = defenderType2 ? number(row?.[defenderType2], 1) : 1;
  return first * second;
}

export function findAbility(abilities, abilityName) {
  const target = normalizeKey(abilityName);
  return abilities.find((ability) => normalizeKey(ability.id) === target || normalizeKey(ability.name) === target);
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
    attackerHpIv = 15,
    defenderDefenseIv = 15,
    defenderHpIv = 15,
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
  const rawAttack = calculateStat(attacker.attack, attackerAttackIv, attackerLevel);
  const rawDefense = calculateStat(defender.defense, defenderDefenseIv, defenderLevel);
  let attack = applyStage(rawAttack, usedAttackStage);
  let defense = applyStage(rawDefense, usedDefenseStage);

  if (attackerItem === "choice-attack") attack = Math.floor(attack * 1.5);
  if (defenderItem === "vest") defense = Math.floor(defense * 1.5);
  if (defenderItem === "eviolite" && defender.evolvesTo) defense = Math.floor(defense * 1.5);

  const typeMultiplier = getTypeMultiplier(typeChart, move.type, defender.type1, defender.type2);
  const hasStab = move.type === attacker.type1 || move.type === attacker.type2;
  const surgeActive = Boolean(
    ability
      && normalizeKey(ability.kind) === "surge"
      && ability.type === move.type
      && attackerLowHp,
  );
  const itemMultiplier = damageItemMultiplier(attackerItem, move, typeBoost);
  const boostMultiplier = (surgeActive ? 1.5 : 1) * itemMultiplier;
  const defenderHp = calculateStat(defender.hp, defenderHpIv, defenderLevel, true);

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
    damage = Math.floor(damage * boostMultiplier);
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
