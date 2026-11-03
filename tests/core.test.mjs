import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  analyzeKo,
  formatChance,
  isReady,
  calculateDamage,
  calculateStat,
  defensiveStat,
  effectiveSpeed,
  normalizeAbility,
  normalizeCategory,
  normalizeMove,
  offensiveStat,
  statusBlockReason,
  STRUGGLE,
} from "../core.js";

const typeChart = {
  Dark: { Psychic: 2, Dark: 0.5 },
  Fire: { Grass: 2 },
};

const murkit = {
  name: "Murkit",
  type1: "Dark",
  hp: 44,
  attack: 56,
  defense: 42,
  ability: "",
};

const glintail = {
  name: "Glintail",
  type1: "Psychic",
  hp: 45,
  attack: 49,
  defense: 45,
};

test("uses the supplied four-stat calculation", () => {
  assert.equal(calculateStat(56, 15, 5), 11);
  assert.equal(calculateStat(44, 15, 5, true), 20);
});

test("calculates the supplied level-5 Murkit worked example", () => {
  const result = calculateDamage({
    attacker: murkit,
    defender: glintail,
    move: { name: "Shade Claw", type: "Dark", category: "Damage", power: 40 },
    typeChart,
    attackerLevel: 5,
    defenderLevel: 5,
    attackerAttackIv: 15,
    defenderDefenseIv: 15,
  });

  assert.equal(result.kind, "damage");
  assert.equal(result.rolls[7].random, 92);
  assert.equal(result.rolls[7].damage, 12);
  assert.equal(result.typeMultiplier, 2);
  assert.equal(result.hasStab, true);
});

test("recognizes user-friendly attack and support move aliases", () => {
  assert.equal(normalizeCategory("Attack"), "damage");
  assert.equal(normalizeCategory("Support"), "status");
  const result = calculateDamage({ attacker: murkit, defender: glintail, move: { category: "Support", power: 0 } });
  assert.equal(result.kind, "support");
});

test("applies a minimum of one damage after non-immune modifiers", () => {
  const result = calculateDamage({
    attacker: { ...murkit, attack: 1 },
    defender: { ...glintail, defense: 255 },
    move: { type: "Dark", category: "Attack", power: 1 },
    typeChart,
    attackerLevel: 1,
    defenderLevel: 100,
    attackerBurned: true,
  });
  assert.equal(result.min, 1);
  assert.equal(result.max, 3);
});

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const realChart = read("../data/type-chart.json");
const realAbilities = read("../data/abilities.json").map(normalizeAbility);

// Recorded from the official @smogon/calc engine at calc.pokemonshowdown.com (Gen 9, 0 EVs, neutral
// nature, Attack/Defense as the only relevant stats). Novalings uses the same formula for these modifiers.
test("matches 32 recorded Pokémon Showdown calculator results", () => {
  for (const [index, row] of read("./fixtures/showdown-reference.json").entries()) {
    const toMon = ({ b, t }) => ({ hp: b[0], attack: b[1], defense: b[2], speed: b[3], type1: t[0], type2: t[1] });
    const result = calculateDamage({
      attacker: toMon(row.a),
      defender: toMon(row.d),
      move: { type: row.mt, category: "Damage", power: row.p },
      typeChart: realChart,
      attackerLevel: row.a.l,
      defenderLevel: row.d.l,
      attackerAttackIv: row.a.iv,
      defenderDefenseIv: row.d.iv,
      defenderHpIv: row.d.hpiv,
      attackerStage: row.a.st,
      defenderStage: row.d.st,
      critical: row.crit,
      attackerBurned: row.a.brn,
    });
    assert.equal(result.defenderHp, row.max, `scenario ${index} HP`);
    const rolls = result.rolls.map((roll) => roll.damage);
    if (row.rolls.length === 1) assert.ok(rolls.every((damage) => damage === row.rolls[0]), `scenario ${index} immune`);
    else assert.deepEqual(rolls, row.rolls, `scenario ${index} rolls`);
    const status = { psn: "poison", brn: "burn" }[row.d.status] || "none";
    assert.equal(analyzeKo(result.rolls, { hp: row.cur, maxHp: row.max, status }).text, row.ko, `scenario ${index} KO text`);
  }
});

test("Surge plus a ×1.2 item doesn't lose damage to floating point", () => {
  const shared = {
    attacker: { type1: "Fire", attack: 100, ability: "ShadowVeil" },
    defender: { type1: "Normal", defense: 100, hp: 100 },
    move: { type: "Dark", category: "Damage", power: 40 },
    abilities: realAbilities,
    typeChart: realChart,
  };
  const plain = calculateDamage(shared);
  const boosted = calculateDamage({ ...shared, attackerLowHp: true, attackerItem: "all-damage" });
  boosted.rolls.forEach((roll, index) => assert.equal(roll.damage, Math.floor((plain.rolls[index].damage * 18) / 10)));
});

test("Struggle is typeless: no STAB and always ×1", () => {
  const result = calculateDamage({
    attacker: { type1: "Dark", type2: "", attack: 50 },
    defender: { type1: "Normal", type2: "", defense: 50, hp: 50 },
    move: STRUGGLE,
    typeChart: realChart,
  });
  assert.equal(result.hasStab, false);
  assert.equal(result.typeMultiplier, 1);
});

test("critical hits ignore lowered Attack and raised Defense only", () => {
  const shared = { attacker: murkit, defender: glintail, move: { type: "Dark", category: "Damage", power: 40 }, typeChart, critical: true };
  const neutral = calculateDamage(shared);
  assert.deepEqual(calculateDamage({ ...shared, attackerStage: -3, defenderStage: 3 }).rolls, neutral.rolls);
  assert.ok(calculateDamage({ ...shared, attackerStage: 2 }).max > neutral.max);
  assert.ok(calculateDamage({ ...shared, defenderStage: -2 }).max > neutral.max);
});

test("held items change the right stat", () => {
  assert.equal(offensiveStat(100, 1, "choice-attack"), 225);
  assert.equal(defensiveStat(100, 0, "vest", false), 150);
  assert.equal(defensiveStat(100, 0, "eviolite", true), 150);
  assert.equal(defensiveStat(100, 0, "eviolite", false), 100);
  assert.equal(effectiveSpeed(100, { item: "choice-speed" }), 150);
  assert.equal(effectiveSpeed(100, { item: "speed-item", stage: 1 }), 180);
  assert.equal(effectiveSpeed(100, { paralysed: true }), 50);
  const shared = { attacker: murkit, defender: glintail, move: { type: "Psychic", category: "Damage", power: 80 }, typeChart };
  assert.equal(calculateDamage({ ...shared, attackerItem: "life-orb" }).itemMultiplier, 1.3);
  assert.equal(calculateDamage({ ...shared, attackerItem: "type-boost", typeBoost: "Psychic" }).itemMultiplier, 1.2);
  assert.equal(calculateDamage({ ...shared, attackerItem: "type-boost", typeBoost: "Fire" }).itemMultiplier, 1);
});

test("status immunity follows the pack's type table and abilities", () => {
  assert.match(statusBlockReason("burn", ["Fire"], null), /Fire/);
  assert.match(statusBlockReason("poison", ["Rock", "Steel"], null), /Steel/);
  assert.match(statusBlockReason("paralysis", ["Grass"], realAbilities.find((ability) => ability.name === "Limber")), /Limber/);
  assert.equal(statusBlockReason("sleep", ["Electric"], null), "");
});

test("KO analysis: table, partial HP and Sturdy", () => {
  assert.equal(analyzeKo([50, 100], { hp: 100 }).text, "50% chance to OHKO");
  assert.deepEqual(analyzeKo([50, 100], { hp: 100 }).table.map((row) => row.chance), [0.5, 1, 1, 1]);
  assert.equal(analyzeKo([0], { hp: 100 }).text, "");
  assert.equal(analyzeKo([120], { hp: 100, sturdy: true }).text, "guaranteed 2HKO (Sturdy survives the first hit)");
  assert.equal(analyzeKo([120], { hp: 99, maxHp: 100, sturdy: true }).text, "guaranteed OHKO");
});

test("KO chances never round to a false 0% or 100%", () => {
  assert.equal(formatChance(1 / 65536), "<0.1%");
  assert.equal(formatChance(1 - 1 / 65536), ">99.9%");
  assert.equal(formatChance(0.0987), "9.9%");
  assert.equal(formatChance(0), "0%");
  assert.equal(formatChance(1), "100%");
  assert.equal(analyzeKo([28, 23], { hp: 112 }).text, "6.3% chance to 4HKO");
});

test("only ticked rows count, and sources without a Ready column always count", () => {
  assert.equal(isReady({ Name: "A" }), true);
  assert.equal(isReady({ Ready: true }), true);
  assert.equal(isReady({ Ready: "TRUE" }), true);
  assert.equal(isReady({ Ready: false }), false);
  assert.equal(isReady({ Ready: "" }), false);
});

test("a blank accuracy falls back to 100", () => {
  assert.equal(normalizeMove({ Name: "X", Accuracy: "" }).accuracy, 100);
});

test("support moves resolve from any accepted category label", () => {
  assert.equal(normalizeMove({ Name: "X", Category: "Support" }).category, "status");
  assert.equal(calculateDamage({ attacker: murkit, defender: glintail, move: normalizeMove({ Category: "Status", Power: 0 }) }).kind, "support");
});
