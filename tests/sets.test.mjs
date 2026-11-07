import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calculateDamage, calculateStat, normalizeAbility, normalizeMonster, normalizeMove } from "../core.js";
import { evRoom, evTotal, findSavedSet, formatSet, parseSet, readSavedSets, setsForSpecies, writeSavedSets } from "../sets.js";

const read = (path) => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
const typeChart = read("../data/type-chart.json");
const data = {
  monsters: read("../data/monsters.json").map(normalizeMonster),
  moves: read("../data/moves.json").map(normalizeMove),
  abilities: read("../data/abilities.json").map(normalizeAbility),
  types: Object.keys(typeChart).sort(),
};
const blank = { hp: null, attack: null, defense: null, speed: null };
const emptySlot = { id: "", power: null, type: null, crit: false };

function fakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function fullSet() {
  return {
    species: "Murkit",
    level: 37,
    ability: "Intimidate",
    item: "type-boost",
    typeBoost: "Dark",
    evs: { hp: 4, attack: 252, defense: 0, speed: 252 },
    ivs: { hp: 31, attack: 0, defense: null, speed: 20 },
    base: { hp: null, attack: 80, defense: null, speed: null },
    types: ["Dark", "Fire"],
    moves: [
      { id: "ShadeClaw", power: 90, type: "Fire", crit: false },
      { id: "NightFang", power: null, type: "", crit: false },
      { id: "Struggle", power: null, type: null, crit: false },
      emptySlot,
    ],
  };
}

test("EVs go inside the stat formula, not on top of the final stat", () => {
  assert.equal(calculateStat(100, 31, 100, false, 252) - calculateStat(100, 31, 100, false, 0), 63);
  assert.equal(calculateStat(100, 31, 50, false, 252) - calculateStat(100, 31, 50, false, 0), 32);
  assert.equal(calculateStat(100, 31, 100, true, 252), Math.floor(((200 + 31 + 63) * 100) / 100) + 110);
  assert.equal(calculateStat(100, 31, 100, false, 3), calculateStat(100, 31, 100, false, 0));
  assert.equal(calculateStat(100, 31, 100, false, 4), calculateStat(100, 31, 100, false, 0) + 1);
});

test("damage uses the attacker's Attack EVs and the defender's Defense and HP EVs", () => {
  const shared = {
    attacker: { type1: "Fire", attack: 100 },
    defender: { type1: "Normal", defense: 100, hp: 100 },
    move: { type: "Dark", category: "Damage", power: 80 },
    typeChart,
  };
  const plain = calculateDamage(shared);
  assert.ok(calculateDamage({ ...shared, attackerAttackEv: 252 }).max > plain.max);
  assert.ok(calculateDamage({ ...shared, defenderDefenseEv: 252 }).max < plain.max);
  assert.ok(calculateDamage({ ...shared, defenderHpEv: 252 }).defenderHp > plain.defenderHp);
});

test("EV room respects both the per-stat and the total limit", () => {
  assert.equal(evRoom({ hp: 0, attack: 0, defense: 0, speed: 0 }, "attack"), 252);
  assert.equal(evRoom({ hp: 252, attack: 200, defense: 0, speed: 0 }, "defense"), 58);
  assert.equal(evRoom({ hp: 252, attack: 252, defense: 6, speed: 0 }, "speed"), 0);
  assert.equal(evRoom({ hp: 252, attack: 252, defense: 6, speed: 0 }, "defense"), 6);
  assert.equal(evTotal({ hp: 252, attack: null, defense: 6, speed: 0 }), 258);
});

test("exports in Showdown's layout", () => {
  assert.equal(formatSet(fullSet(), data), [
    "Murkit @ Type Boost",
    "Ability: Intimidate",
    "Level: 37",
    "EVs: 4 HP / 252 Atk / 252 Spe",
    "IVs: 31 HP / 0 Atk / 20 Spe",
    "Boosted Type: Dark",
    "Base Stats: 80 Atk",
    "Types: Dark / Fire",
    "- Shade Claw [Power: 90, Type: Fire]",
    "- Night Fang [Type: Typeless]",
    "- Struggle",
  ].join("\n"));
});

test("a plain set has no empty lines or default values", () => {
  const plain = { species: "Murkit", level: 50, ability: "", item: "none", typeBoost: "Dark", evs: blank, ivs: { ...blank, attack: 15 }, base: blank, types: null, moves: [emptySlot, emptySlot, emptySlot, emptySlot] };
  assert.equal(formatSet(plain, data), "Murkit\nLevel: 50");
});

test("anything exported imports back the same, with no warnings", () => {
  const text = formatSet(fullSet(), data);
  const { set, errors, warnings } = parseSet(text, data);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(set.evs.attack, 252);
  assert.equal(set.ivs.attack, 0);
  assert.deepEqual(set.moves[0], { id: "ShadeClaw", power: 90, type: "Fire", crit: false });
  assert.equal(set.moves[1].type, "");
  assert.equal(formatSet(set, data), text);
});

test("reads move names whether the data's ids are compact or plain names", () => {
  const sheetData = { ...data, moves: data.moves.map((move) => ({ ...move, id: move.name })) };
  const { set } = parseSet("Murkit\n- Shade Claw", sheetData);
  assert.equal(set.moves[0].id, "Shade Claw");
});

test("reads real Showdown exports, and says what Novalings don't have", () => {
  const { set, errors, warnings } = parseSet("Bitey (Murkit) (F) @ Vest  \r\nability: intimidate  \r\nShiny: Yes\r\nEVs: 252 Atk / 4 SpD / 252 Spe\r\nJolly Nature\r\nIVs: 0 Atk\r\n- shade claw\r\n- Hidden Power [Fire]\r\n", data);
  assert.deepEqual(errors, []);
  assert.equal(set.species, "Murkit");
  assert.equal(set.item, "vest");
  assert.equal(set.ability, "Intimidate");
  assert.equal(set.level, null);
  assert.deepEqual(set.evs, { hp: null, attack: 252, defense: null, speed: 252 });
  assert.equal(set.ivs.attack, 0);
  assert.equal(set.moves[0].id, "ShadeClaw");
  assert.equal(set.moves[1].id, "");
  for (const pattern of [/nicknames/, /Shiny/, /SpD/, /natures/, /Hidden Power/]) assert.ok(warnings.some((warning) => pattern.test(warning)), String(pattern));
});

test("stops with a clear error when the numbers can't be trusted", () => {
  const cases = [
    ["", /Paste a set/],
    ["   \n  ", /Paste a set/],
    ["Garchomp @ Choice Attack", /no Novaling called "Garchomp"/],
    ["- Shade Claw", /first line/],
    ["Ability: Intimidate", /first line/],
    ["Murkit\nLevel: 101", /Level/],
    ["Murkit\nLevel: abc", /Level/],
    ["Murkit\nEVs: 300 Atk", /over the limit of 252/],
    ["Murkit\nEVs: 252 HP / 252 Atk / 252 Spe", /add up to 756/],
    ["Murkit\nEVs: lots", /couldn't read/],
    ["Murkit\nEVs: -4 Atk", /couldn't read/],
    ["Murkit\nEVs: 4 Luck", /isn't a stat/],
    ["Murkit\nIVs: 32 Atk", /over the limit of 31/],
    ["Murkit\nBase Stats: 0 Atk", /outside/],
  ];
  for (const [text, pattern] of cases) {
    const { set, errors } = parseSet(text, data);
    assert.equal(set, null, text);
    assert.match(errors.join(" "), pattern, text);
  }
});

test("suggests a close name for a mistyped Novaling", () => {
  assert.match(parseSet("Murkitt", data).errors[0], /Did you mean Murkit/);
});

test("unknown names leave a blank in place of breaking the set", () => {
  const { set, errors, warnings } = parseSet("Murkit @ Leftovers\nAbility: Levitate\nTypes: Cosmic\n- Shade Claw [Power: lots]\n- A\n- B\n- C\n- D", data);
  assert.deepEqual(errors, []);
  assert.equal(set.item, "none");
  assert.equal(set.ability, "");
  assert.equal(set.types, null);
  assert.equal(set.moves[0].power, null);
  assert.equal(warnings.length, 8);
});

test("flags text it couldn't read, but not valid Showdown text Novalings have no use for", () => {
  assert.ok(!parseSet("Bitey (Murkit) (F) @ Vest\nShiny: Yes\nTera Type: Fire\nEVs: 4 SpD\nJolly Nature\n- Shade Claw", data).unread);
  const unreadable = [
    "Murkit @ Leftovers",
    "Murkit\nAbility: Levitate",
    "Murkit\n- Shade Clawz",
    "Murkit\n- Shade Claw [Power: lots]",
    "Murkit\nTypes: Cosmic",
    "Murkit\nhello there",
    "Murkit\nFoo: Bar",
    "Murkit\n\nGlintail",
    "Murkit\n- Shade Claw\n- Night Fang\n- Tackle\n- Struggle\n- Glimmer",
  ];
  for (const text of unreadable) assert.equal(parseSet(text, data).unread, true, text);
});

test("more than four moves keeps the first four", () => {
  const { set, warnings } = parseSet("Murkit\n- Shade Claw\n- Night Fang\n- Tackle\n- Struggle\n- Glimmer", data);
  assert.deepEqual(set.moves.map((slot) => slot.id), ["ShadeClaw", "NightFang", "Tackle", "Struggle"]);
  assert.ok(warnings.some((warning) => /first four/.test(warning)));
});

test("a pasted team imports its first set and says so", () => {
  const { set, warnings } = parseSet("=== [gen9] Team ===\n\nMurkit\nLevel: 20\n- Shade Claw\n\nGlintail\nLevel: 30\n- Tackle", data);
  assert.equal(set.species, "Murkit");
  assert.equal(set.level, 20);
  assert.ok(warnings.some((warning) => /first set/.test(warning)));
});

test("edits matching the data's own values aren't kept as edits", () => {
  const { set } = parseSet("Murkit\nBase Stats: 56 Atk\nTypes: Dark\n- Shade Claw [Type: Dark]", data);
  assert.equal(set.base.attack, null);
  assert.equal(set.types, null);
  assert.equal(set.moves[0].type, null);
});

test("Type Boost without a type falls back like the panel does", () => {
  const { set, warnings } = parseSet("Murkit @ Type Boost", data);
  assert.equal(set.typeBoost, data.types[0]);
  assert.equal(warnings.length, 1);
});

test("saved sets persist per Novaling, and bad storage reads as empty", () => {
  const storage = fakeStorage();
  assert.deepEqual(readSavedSets(storage), []);
  const sets = [{ species: "Murkit", name: "Fast", text: "Murkit" }, { species: "Murkit", name: "Bulky", text: "Murkit" }, { species: "Glintail", name: "Fast", text: "Glintail" }];
  writeSavedSets(storage, sets);
  assert.deepEqual(readSavedSets(storage), sets);
  assert.equal(setsForSpecies(readSavedSets(storage), "Murkit").length, 2);
  assert.equal(findSavedSet(sets, "Glintail", " fast ").text, "Glintail");
  assert.equal(findSavedSet(sets, "Glintail", "Bulky"), null);
  assert.deepEqual(readSavedSets(fakeStorage({ "novalings.savedSets.v1": "{not json" })), []);
  assert.deepEqual(readSavedSets(fakeStorage({ "novalings.savedSets.v1": '[{"name":"no species"}, null]' })), []);
  assert.deepEqual(readSavedSets(null), []);
});
