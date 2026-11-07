// Novaling sets as Pokémon Showdown-style text, and the browser's list of saved sets.
// Saved sets are kept as that same text. It holds names rather than ids, which differ between the Sheet and the bundled data.
import { DEFAULT_IV, ITEMS, MAX_IV, MAX_STAT_EV, MAX_TOTAL_EV, normalizeKey, STAT_KEYS, STAT_SHORT, STRUGGLE } from "./core.js";

const STORAGE_KEY = "novalings.savedSets.v1";
const STAT_ALIASES = { hp: "hp", atk: "attack", attack: "attack", def: "defense", defense: "defense", defence: "defense", spe: "speed", speed: "speed" };
const MISSING_STATS = { spa: "SpA", spatk: "SpA", satk: "SpA", specialattack: "SpA", spd: "SpD", spdef: "SpD", sdef: "SpD", specialdefense: "SpD", spc: "Spc" };
const SHOWDOWN_ONLY_LINES = ["shiny", "happiness", "gender", "pokeball", "hiddenpower", "dynamaxlevel", "gigantamax", "teratype"];
const MIN_BASE = 1;
const MAX_BASE = 255;
const MAX_POWER = 300;

// A part of the text that couldn't be read, as opposed to something valid that Novalings just don't have.
function noteUnread(report, message) {
  report.warnings.push(message);
  report.unread = true;
}

function blankStats() {
  return { hp: null, attack: null, defense: null, speed: null };
}

function findNamed(list, text) {
  const target = normalizeKey(text);
  return target ? list.find((entry) => normalizeKey(entry.id) === target || normalizeKey(entry.name) === target) || null : null;
}

function findType(types, text) {
  return types.find((type) => normalizeKey(type) === normalizeKey(text)) || null;
}

function closeNames(list, text) {
  const target = normalizeKey(text);
  return list.filter(({ name }) => {
    const key = normalizeKey(name);
    return key.includes(target) || target.includes(key) || key.startsWith(target.slice(0, 3));
  }).slice(0, 3).map(({ name }) => name);
}

function didYouMean(list, text) {
  const names = closeNames(list, text);
  return names.length ? ` Did you mean ${names.join(", ")}?` : "";
}

function formatStats(values, shouldShow) {
  return STAT_KEYS.filter((key) => shouldShow(values[key])).map((key) => `${values[key]} ${STAT_SHORT[key]}`).join(" / ");
}

function formatMove(slot, data) {
  const move = findNamed([...data.moves, STRUGGLE], slot.id);
  if (!move) return "";
  const edits = [
    slot.power === null || slot.power === undefined ? "" : `Power: ${slot.power}`,
    slot.type === null || slot.type === undefined ? "" : `Type: ${slot.type || "Typeless"}`,
  ].filter(Boolean);
  return `- ${move.name}${edits.length ? ` [${edits.join(", ")}]` : ""}`;
}

// Takes anything shaped like a calculator side. Status, current HP, stages and crit toggles describe a battle, not a build, so they aren't part of a set.
export function formatSet(set, data) {
  const monster = findNamed(data.monsters, set.species);
  if (!monster) return "";
  const item = ITEMS.find((entry) => entry.id === set.item);
  const ability = findNamed(data.abilities, set.ability);
  const evs = formatStats(set.evs, (value) => value > 0);
  const ivs = formatStats(set.ivs, (value) => value !== null && value !== DEFAULT_IV);
  const base = formatStats(set.base, (value) => value !== null);
  return [
    item && item.id !== "none" ? `${monster.name} @ ${item.name}` : monster.name,
    ability ? `Ability: ${ability.name}` : "",
    `Level: ${set.level}`,
    evs ? `EVs: ${evs}` : "",
    ivs ? `IVs: ${ivs}` : "",
    set.item === "type-boost" && set.typeBoost ? `Boosted Type: ${set.typeBoost}` : "",
    base ? `Base Stats: ${base}` : "",
    set.types ? `Types: ${set.types.filter(Boolean).join(" / ")}` : "",
    ...set.moves.map((slot) => formatMove(slot, data)),
  ].filter(Boolean).join("\n");
}

// Reads "252 Atk / 4 Def" into stats. Checking the numbers is left to the caller, as each list has its own limits.
function parseStats(text, label, report) {
  const values = blankStats();
  for (const part of text.split("/").map((entry) => entry.trim()).filter(Boolean)) {
    const match = part.match(/^(\d+)\s+(.+)$/);
    if (!match) {
      report.errors.push(`${label}: couldn't read "${part}". Use the form "252 Atk / 4 Def".`);
      continue;
    }
    const key = normalizeKey(match[2]);
    if (STAT_ALIASES[key]) values[STAT_ALIASES[key]] = Number(match[1]);
    else if (MISSING_STATS[key]) report.warnings.push(`${label}: Novalings have no ${MISSING_STATS[key]} stat, so "${part}" was ignored.`);
    else report.errors.push(`${label}: "${match[2]}" isn't a stat. Novalings have HP, Atk, Def and Spe.`);
  }
  return values;
}

function parseEvs(text, report) {
  const values = parseStats(text, "EVs", report);
  for (const key of STAT_KEYS) {
    if (values[key] > MAX_STAT_EV) report.errors.push(`EVs: ${values[key]} ${STAT_SHORT[key]} is over the limit of ${MAX_STAT_EV} for one stat.`);
  }
  const total = evTotal(values);
  if (total > MAX_TOTAL_EV) report.errors.push(`EVs: these add up to ${total}, over the limit of ${MAX_TOTAL_EV}.`);
  return values;
}

function parseIvs(text, report) {
  const values = parseStats(text, "IVs", report);
  for (const key of STAT_KEYS) {
    if (values[key] > MAX_IV) report.errors.push(`IVs: ${values[key]} ${STAT_SHORT[key]} is over the limit of ${MAX_IV}.`);
  }
  return values;
}

function parseBase(text, monster, report) {
  const values = parseStats(text, "Base Stats", report);
  for (const key of STAT_KEYS) {
    if (values[key] !== null && (values[key] < MIN_BASE || values[key] > MAX_BASE)) report.errors.push(`Base Stats: ${values[key]} ${STAT_SHORT[key]} is outside ${MIN_BASE}–${MAX_BASE}.`);
    if (values[key] === monster[key]) values[key] = null;
  }
  return values;
}

function parseTypes(text, monster, data, report) {
  const [first, second, ...rest] = text.split("/").map((entry) => entry.trim());
  const type1 = findType(data.types, first);
  const type2 = second ? findType(data.types, second) : "";
  if (!type1 || type2 === null || rest.length) {
    noteUnread(report, `Types: couldn't read "${text}", so ${monster.name} keeps its usual types.`);
    return null;
  }
  const types = [type1, type2 === type1 ? "" : type2];
  return types[0] === monster.type1 && types[1] === (monster.type2 || "") ? null : types;
}

function parseMoveEdits(text, move, slot, data, report) {
  for (const part of text.split(",")) {
    const [rawKey, rawValue = ""] = part.split(":").map((entry) => entry.trim());
    const key = normalizeKey(rawKey);
    if (key === "power" && /^\d+$/.test(rawValue) && Number(rawValue) <= MAX_POWER) {
      slot.power = Number(rawValue) === move.power ? null : Number(rawValue);
    } else if (key === "type" && (normalizeKey(rawValue) === "typeless" || findType(data.types, rawValue))) {
      const type = normalizeKey(rawValue) === "typeless" ? "" : findType(data.types, rawValue);
      slot.type = type === move.type ? null : type;
    } else {
      noteUnread(report, `${move.name}: couldn't read "${part.trim()}", so that edit was ignored.`);
    }
  }
}

function parseMove(line, data, report) {
  const [, name, edits] = line.match(/^[-~]\s*(.*?)(?:\s*\[([^\]]*)\])?$/);
  const moves = [...data.moves, STRUGGLE];
  const move = findNamed(moves, name);
  if (!move) {
    noteUnread(report, `Move "${name}" isn't in the calculator, so it was left out.${didYouMean(moves, name)}`);
    return null;
  }
  const slot = { id: move.id, power: null, type: null, crit: false };
  if (edits) parseMoveEdits(edits, move, slot, data, report);
  return slot;
}

// Reads "Nickname (Species) (M) @ Item". A name that is itself a Novaling wins over any brackets in it.
function parseHeader(line, data, report) {
  const at = line.lastIndexOf(" @ ");
  const itemText = at >= 0 ? line.slice(at + 3).trim() : "";
  const nameText = (at >= 0 ? line.slice(0, at) : line).replace(/\s*@\s*$/, "").replace(/\s+\([MF]\)$/, "").trim();
  const bracketed = nameText.match(/^(.*\S)\s+\(([^()]+)\)$/);
  let monster = findNamed(data.monsters, nameText);
  if (!monster && bracketed) {
    monster = findNamed(data.monsters, bracketed[2]);
    if (monster) report.warnings.push(`Novalings have no nicknames, so "${bracketed[1]}" was dropped.`);
  }
  if (!monster) {
    const wanted = bracketed ? bracketed[2] : nameText;
    report.errors.push(`There's no Novaling called "${wanted}".${didYouMean(data.monsters, wanted)} The first line should be its name, such as "${data.monsters[0]?.name} @ ${ITEMS[1].name}".`);
    return {};
  }
  const item = itemText ? findNamed(ITEMS, itemText) : null;
  if (itemText && !item) noteUnread(report, `Item "${itemText}" isn't in the calculator, so ${monster.name} holds nothing.`);
  return { monster, item: item?.id || "none" };
}

function isAttributeLine(line) {
  return /^[-~]/.test(line) || line.includes(":") || /\sNature$/i.test(line);
}

// Returns { set, errors, warnings, unread }. Anything that would change the numbers without saying so is an error,
// and set is null if there are any. Things the game doesn't have become warnings, and the rest of the set still works.
// unread is true if a warning means part of the text couldn't be read, rather than being valid Showdown text Novalings have no use for.
export function parseSet(text, data) {
  const report = { errors: [], warnings: [] };
  const lines = String(text ?? "").split(/\r?\n/).map((line) => line.trim());
  const start = lines.findIndex((line) => line && !line.startsWith("==="));
  if (start < 0) return { set: null, errors: ["Paste a set first. The first line should be the Novaling's name."], warnings: [] };
  const first = lines[start];
  if (isAttributeLine(first) && !findNamed(data.monsters, first)) {
    return { set: null, errors: [`The first line should be the Novaling's name, but it reads "${first}".`], warnings: [] };
  }
  const { monster, item } = parseHeader(first, data, report);
  if (!monster) return { set: null, ...report };

  const set = { species: monster.id, level: null, ability: "", item, typeBoost: "", evs: blankStats(), ivs: blankStats(), base: blankStats(), types: null };
  const moves = [];
  let afterBlank = false;
  for (const line of lines.slice(start + 1)) {
    if (!line) {
      afterBlank = true;
      continue;
    }
    if (afterBlank && !isAttributeLine(line)) {
      noteUnread(report, `Only the first set (${monster.name}) was imported. Paste the others one at a time.`);
      break;
    }
    afterBlank = false;
    if (/^[-~]/.test(line)) {
      moves.push(parseMove(line, data, report));
      continue;
    }
    if (/\sNature$/i.test(line)) {
      report.warnings.push(`Novalings have no natures, so "${line}" was ignored.`);
      continue;
    }
    const colon = line.indexOf(":");
    const key = colon < 0 ? "" : normalizeKey(line.slice(0, colon));
    const value = colon < 0 ? "" : line.slice(colon + 1).trim();
    if (key === "ability") {
      const ability = findNamed(data.abilities, value);
      if (ability) set.ability = ability.name;
      else noteUnread(report, `Ability "${value}" isn't in the calculator, so it was left as None.`);
    } else if (key === "level") {
      if (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100) set.level = Number(value);
      else report.errors.push(`Level: "${value}" isn't a whole number from 1 to 100.`);
    } else if (key === "evs") set.evs = parseEvs(value, report);
    else if (key === "ivs") set.ivs = parseIvs(value, report);
    else if (key === "basestats") set.base = parseBase(value, monster, report);
    else if (key === "types") set.types = parseTypes(value, monster, data, report);
    else if (key === "boostedtype") {
      set.typeBoost = findType(data.types, value) || "";
      if (!set.typeBoost) noteUnread(report, `Boosted Type: "${value}" isn't a type.`);
    } else if (SHOWDOWN_ONLY_LINES.includes(key)) report.warnings.push(`Novalings have no use for "${line}", so it was ignored.`);
    else noteUnread(report, `"${line}" isn't part of a Novaling set, so it was ignored.`);
  }
  if (set.item === "type-boost" && !set.typeBoost) {
    set.typeBoost = data.types[0] || "";
    report.warnings.push(`No boosted type was given for ${ITEMS.find((entry) => entry.id === "type-boost").name}, so it boosts ${set.typeBoost}.`);
  }
  const kept = moves.filter(Boolean);
  if (kept.length > 4) noteUnread(report, `A Novaling has four move slots, so only the first four moves were kept.`);
  set.moves = Array.from({ length: 4 }, (_, slot) => kept[slot] || { id: "", power: null, type: null, crit: false });
  return report.errors.length ? { set: null, ...report } : { set, ...report };
}

export function evTotal(evs) {
  return STAT_KEYS.reduce((sum, key) => sum + (evs[key] || 0), 0);
}

// How many more EVs a stat can take, given the per-stat limit and what the others already use.
export function evRoom(evs, key) {
  return Math.min(MAX_STAT_EV, MAX_TOTAL_EV - (evTotal(evs) - (evs[key] || 0)));
}

// --- Saved sets -----------------------------------------------------------------------------
// Each entry is { species, name, text }. They live only in this browser's storage, apart from the game data.

export function readSavedSets(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry && entry.species && entry.name && entry.text) : [];
  } catch {
    return [];
  }
}

export function writeSavedSets(storage, sets) {
  storage.setItem(STORAGE_KEY, JSON.stringify(sets));
}

export function isSavedSetsKey(key) {
  return key === STORAGE_KEY || key === null;
}

export function setsForSpecies(sets, speciesName) {
  return sets.filter((entry) => normalizeKey(entry.species) === normalizeKey(speciesName));
}

export function findSavedSet(sets, speciesName, name) {
  const target = name.trim().toLowerCase();
  return setsForSpecies(sets, speciesName).find((entry) => entry.name.toLowerCase() === target) || null;
}
