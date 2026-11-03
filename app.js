import {
  analyzeKo,
  calculateDamage,
  calculateStat,
  defensiveStat,
  effectiveSpeed,
  findAbility,
  formatChance,
  ITEMS,
  normalizeKey,
  offensiveStat,
  stageMultiplier,
  STATUSES,
  statusBlockReason,
  STRUGGLE,
} from "./core.js";
import { Combobox } from "./combobox.js";
import { loadDataset } from "./data-source.js";

const TYPE_COLORS = {
  Normal: "#78716c", Fire: "#dc5a2b", Water: "#2f7fd6", Electric: "#b98a00", Grass: "#3f9142", Ice: "#2a9aa5",
  Fighting: "#b8432f", Poison: "#8d4bb0", Ground: "#a97f3c", Flying: "#5f7fd8", Psychic: "#d4487f", Bug: "#7c9414",
  Rock: "#8f7d45", Ghost: "#65559a", Dragon: "#5a4bd8", Dark: "#574f63", Steel: "#64788c", Fairy: "#c95f9d",
};
const STORAGE_KEY = "novalings.calculator";
const STAT_KEYS = ["hp", "attack", "defense", "speed"];
const STAT_LABELS = { hp: "HP", attack: "Attack", defense: "Defense", speed: "Speed" };
const STAT_SHORT = { attack: "Atk", defense: "Def", speed: "Spe" };
const DEFAULT_IV = 15;
const DEFAULT_LEVEL = 50;
const LEVEL_PRESETS = [5, 50, 100];
const INITIAL_SETUP = [
  { name: "Murkit", moves: ["Shade Claw", "Night Fang", "Body Slam", "Growl"] },
  { name: "Glintail", moves: ["Dream Crush", "Glimmer", "Lullaby", "Growl"] },
];

const app = document.querySelector("#app");
const sourceStatus = document.querySelector("#source-status");

let dataset = null;
let source = { label: "", notice: "", warning: "" };
let state = null;
let panels = [];
let refs = {};
let mobileView = "0";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Blank or non-numeric text returns null so the caller can keep the last good value.
function parseWhole(text) {
  if (String(text).trim() === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function allMoves() {
  return [...dataset.moves, STRUGGLE];
}

function moveById(id) {
  return allMoves().find((move) => move.id === id) || null;
}

function monsterById(id) {
  return dataset.monsters.find((monster) => monster.id === id) || null;
}

function legalMoves(speciesId, level) {
  const levels = new Map();
  for (const entry of dataset.learnsets) {
    if (entry.monster === speciesId && (!levels.has(entry.move) || entry.level < levels.get(entry.move))) levels.set(entry.move, entry.level);
  }
  return dataset.moves.filter((move) => levels.has(move.id)).map((move) => ({ move, level: levels.get(move.id), learned: levels.get(move.id) <= level }));
}

// STAB attacks first, strongest first, then other attacks, then status moves.
function defaultMoveIds(monster, level) {
  const types = [monster.type1, monster.type2];
  const score = (move) => (move.category === "damage" ? 1000 + move.power + (types.includes(move.type) ? 500 : 0) : 0);
  return legalMoves(monster.id, level).filter((entry) => entry.learned).map((entry) => entry.move).sort((left, right) => score(right) - score(left)).slice(0, 4).map((move) => move.id);
}

function newMoveSlot(id = "") {
  return { id, power: null, type: null, crit: false };
}

function moveSlots(ids) {
  return Array.from({ length: 4 }, (_, index) => newMoveSlot(ids[index] || ""));
}

function newSide(speciesId, moveIds) {
  const monster = monsterById(speciesId);
  return {
    species: speciesId,
    level: DEFAULT_LEVEL,
    // Base stats, types and ability stay null until edited, so a Sheet update flows through.
    base: { hp: null, attack: null, defense: null, speed: null },
    types: null,
    ability: null,
    ivs: { hp: DEFAULT_IV, attack: DEFAULT_IV, defense: DEFAULT_IV, speed: DEFAULT_IV },
    boosts: { attack: 0, defense: 0, speed: 0 },
    item: "none",
    typeBoost: dataset.types[0] || "",
    status: "none",
    hp: null,
    entryActive: false,
    moves: moveSlots(moveIds || defaultMoveIds(monster, DEFAULT_LEVEL)),
  };
}

function initialState() {
  const sides = INITIAL_SETUP.map(({ name, moves }, index) => {
    const monster = dataset.monsters.find((entry) => entry.name === name) || dataset.monsters[index] || dataset.monsters[0];
    const ids = moves.map((moveName) => dataset.moves.find((move) => move.name === moveName)?.id).filter(Boolean);
    return newSide(monster.id, monster.name === name && ids.length ? ids : undefined);
  });
  return { sides, selected: { side: 0, slot: 0 } };
}

// Accepts whatever is in storage and keeps only what still fits the current data.
function restoreState(saved) {
  const fresh = initialState();
  if (!Array.isArray(saved?.sides) || saved.sides.length !== 2) return fresh;
  const number = (value, min, max, fallback) => (Number.isFinite(value) ? clamp(Math.floor(value), min, max) : fallback);
  const sides = saved.sides.map((side, index) => {
    if (!monsterById(side?.species)) return fresh.sides[index];
    const clean = newSide(side.species, []);
    clean.level = number(side.level, 1, 100, DEFAULT_LEVEL);
    for (const key of STAT_KEYS) {
      clean.base[key] = Number.isFinite(side.base?.[key]) ? clamp(side.base[key], 1, 255) : null;
      clean.ivs[key] = number(side.ivs?.[key], 0, 31, DEFAULT_IV);
      if (key !== "hp") clean.boosts[key] = number(side.boosts?.[key], -6, 6, 0);
    }
    if (Array.isArray(side.types) && dataset.types.includes(side.types[0])) clean.types = [side.types[0], dataset.types.includes(side.types[1]) ? side.types[1] : ""];
    if (dataset.abilities.some((ability) => ability.name === side.ability)) clean.ability = side.ability;
    if (ITEMS.some((item) => item.id === side.item)) clean.item = side.item;
    if (dataset.types.includes(side.typeBoost)) clean.typeBoost = side.typeBoost;
    if (STATUSES[side.status]) clean.status = side.status;
    clean.hp = Number.isFinite(side.hp) ? Math.max(1, Math.floor(side.hp)) : null;
    clean.entryActive = Boolean(side.entryActive);
    clean.moves = Array.from({ length: 4 }, (_, slot) => {
      const stored = side.moves?.[slot];
      // The Sheet identifies moves by name, the bundled data by Id, so a save may hold either.
      const move = stored && allMoves().find((candidate) => normalizeKey(candidate.id) === normalizeKey(stored.id));
      if (!move) return newMoveSlot();
      return {
        id: move.id,
        power: Number.isFinite(stored.power) ? clamp(stored.power, 0, 300) : null,
        type: dataset.types.includes(stored.type) || stored.type === "" ? stored.type : null,
        crit: Boolean(stored.crit),
      };
    });
    return clean;
  });
  const selected = saved.selected;
  return { sides, selected: { side: selected?.side === 1 ? 1 : 0, slot: number(selected?.slot, 0, 3, 0) } };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Saving is a convenience: the calculator still works without storage.
  }
}

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

// --- Reading a side -------------------------------------------------------------------------

function speciesOf(side) {
  return monsterById(side.species);
}

function typesOf(side) {
  const monster = speciesOf(side);
  return side.types || [monster.type1, monster.type2 || ""];
}

function baseStat(side, key) {
  return side.base[key] ?? speciesOf(side)[key];
}

function abilityNameOf(side) {
  return side.ability || speciesOf(side).ability;
}

function abilityOf(side) {
  return findAbility(dataset.abilities, abilityNameOf(side)) || null;
}

function abilityKind(side) {
  return normalizeKey(abilityOf(side)?.kind);
}

// The monster as the damage formula should see it, with every edit applied.
function battler(side) {
  const [type1, type2] = typesOf(side);
  return {
    ...speciesOf(side),
    type1,
    type2,
    ability: abilityNameOf(side),
    hp: baseStat(side, "hp"),
    attack: baseStat(side, "attack"),
    defense: baseStat(side, "defense"),
    speed: baseStat(side, "speed"),
  };
}

function maxHpOf(side) {
  return calculateStat(baseStat(side, "hp"), side.ivs.hp, side.level, true);
}

function currentHpOf(side) {
  return side.hp === null ? maxHpOf(side) : clamp(side.hp, 1, maxHpOf(side));
}

function rawStat(side, key) {
  return calculateStat(baseStat(side, key), side.ivs[key], side.level, key === "hp");
}

function effectiveStage(index, stat) {
  const side = state.sides[index];
  const foe = state.sides[1 - index];
  let stage = side.boosts[stat];
  if (stat === "attack" && foe.entryActive && abilityKind(foe) === "intimidate") stage -= 1;
  if (stat === "speed" && side.entryActive && abilityKind(side) === "quickfeet") stage += 1;
  return clamp(stage, -6, 6);
}

function effectiveValue(index, stat) {
  const side = state.sides[index];
  const raw = rawStat(side, stat);
  const stage = effectiveStage(index, stat);
  if (stat === "attack") return offensiveStat(raw, stage, side.item);
  if (stat === "defense") return defensiveStat(raw, stage, side.item, Boolean(speciesOf(side).evolvesTo));
  return effectiveSpeed(raw, { stage, paralysed: side.status === "paralysis", item: side.item });
}

function resolvedMove(slot) {
  const move = moveById(slot.id);
  if (!move) return null;
  return { ...move, power: slot.power ?? move.power, type: slot.type ?? move.type };
}

function compute(attackerIndex, slotIndex) {
  const attackerSide = state.sides[attackerIndex];
  const defenderSide = state.sides[1 - attackerIndex];
  const slot = attackerSide.moves[slotIndex];
  const move = resolvedMove(slot);
  if (!move) return null;
  const attackerStage = effectiveStage(attackerIndex, "attack");
  const defenderStage = effectiveStage(1 - attackerIndex, "defense");
  const result = calculateDamage({
    attacker: battler(attackerSide),
    defender: battler(defenderSide),
    move,
    abilities: dataset.abilities,
    typeChart: dataset.typeChart,
    attackerLevel: attackerSide.level,
    defenderLevel: defenderSide.level,
    attackerAttackIv: attackerSide.ivs.attack,
    attackerHpIv: attackerSide.ivs.hp,
    defenderDefenseIv: defenderSide.ivs.defense,
    defenderHpIv: defenderSide.ivs.hp,
    attackerStage,
    defenderStage,
    critical: slot.crit,
    attackerBurned: attackerSide.status === "burn",
    attackerLowHp: currentHpOf(attackerSide) * 3 <= maxHpOf(attackerSide),
    attackerItem: attackerSide.item,
    defenderItem: defenderSide.item,
    typeBoost: attackerSide.typeBoost,
  });
  const entry = { move, slot, result, attackerStage, defenderStage, attackerIndex };
  if (result.kind === "damage") {
    entry.ko = analyzeKo(result.rolls, {
      hp: currentHpOf(defenderSide),
      maxHp: maxHpOf(defenderSide),
      status: defenderSide.status,
      sturdy: abilityKind(defenderSide) === "sturdy",
    });
  }
  return entry;
}

function percent(damage, maxHp) {
  return Math.round((damage / maxHp) * 1000) / 10;
}

function signed(stage) {
  return stage > 0 ? `+${stage}` : `${stage}`;
}

function itemName(id) {
  return ITEMS.find((item) => item.id === id)?.name || "";
}

function calculationLine(entry) {
  const { move, slot, result, attackerStage, defenderStage, attackerIndex } = entry;
  const attackerSide = state.sides[attackerIndex];
  const defenderSide = state.sides[1 - attackerIndex];
  const attacker = speciesOf(attackerSide).name;
  const defender = speciesOf(defenderSide).name;
  if (result.kind !== "damage") return `${attacker} ${move.name} vs. ${defender}: no direct damage`;
  const usedAttack = result.ignoresAttackDrop ? 0 : attackerStage;
  const usedDefense = result.ignoresDefenseBoost ? 0 : defenderStage;
  const attackerParts = [
    usedAttack ? signed(usedAttack) : "",
    `Lv ${attackerSide.level}`,
    `${attackerSide.ivs.attack} IV Atk`,
    attackerSide.status === "burn" ? "burned" : "",
    result.itemMultiplier > 1 || attackerSide.item === "choice-attack" ? itemName(attackerSide.item) : "",
    result.surgeActive ? abilityOf(attackerSide).name : "",
    attacker,
    move.name,
  ].filter(Boolean).join(" ");
  const defenderItem = defenderSide.item === "vest" || (defenderSide.item === "eviolite" && speciesOf(defenderSide).evolvesTo) ? itemName(defenderSide.item) : "";
  const defenderParts = [
    usedDefense ? signed(usedDefense) : "",
    `Lv ${defenderSide.level}`,
    `${defenderSide.ivs.hp} IV HP / ${defenderSide.ivs.defense} IV Def`,
    defenderItem,
    defender,
  ].filter(Boolean).join(" ");
  const crit = slot.crit ? " on a critical hit" : "";
  if (result.typeMultiplier === 0) return `${attackerParts} vs. ${defenderParts}${crit}: 0 (0%) -- no effect`;
  const maxHp = maxHpOf(defenderSide);
  const hpNote = currentHpOf(defenderSide) < maxHp ? ` at ${currentHpOf(defenderSide)}/${maxHp} HP` : "";
  const koText = entry.ko.text ? ` -- ${entry.ko.text}` : "";
  return `${attackerParts} vs. ${defenderParts}${hpNote}${crit}: ${result.min}-${result.max} (${percent(result.min, maxHp)} - ${percent(result.max, maxHp)}%)${koText}`;
}

// --- Markup helpers -------------------------------------------------------------------------

function typeChip(type) {
  if (!type) return `<span class="type type-none">Typeless</span>`;
  return `<span class="type" style="--t:${TYPE_COLORS[type] || "#888"}">${escapeHtml(type)}</span>`;
}

function typeOptions(allowBlank, blankLabel) {
  const blank = allowBlank ? `<option value="">${blankLabel}</option>` : "";
  return blank + dataset.types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
}

function moveInfo(move) {
  if (!move) return "";
  const parts = [move.category === "damage" ? "Damage" : "Status", `Acc ${move.accuracy}`];
  if (move.pp) parts.push(`${move.pp} PP`);
  if (move.effect) parts.push(move.effect);
  return parts.join(" · ");
}

function speciesOptions() {
  return dataset.monsters.map((monster) => ({
    value: monster.id,
    label: monster.name,
    search: `${monster.type1} ${monster.type2} ${monster.ability} ${monster.rarity}`,
    html: `<span class="opt-main"><strong>${escapeHtml(monster.name)}</strong><small>${typeChip(monster.type1)}${monster.type2 ? typeChip(monster.type2) : ""}</small></span><span class="opt-stats">${STAT_KEYS.map((key) => `<span><small>${key === "hp" ? "HP" : STAT_SHORT[key]}</small>${monster[key]}</span>`).join("")}</span>`,
  }));
}

function abilityOptions() {
  return dataset.abilities.map((ability) => ({
    value: ability.name,
    label: ability.name,
    search: ability.text,
    html: `<span class="opt-main"><strong>${escapeHtml(ability.name)}</strong><small>${escapeHtml(ability.text)}</small></span>`,
  }));
}

function itemOptions() {
  return ITEMS.map((item) => ({
    value: item.id,
    label: item.name,
    search: item.text,
    html: `<span class="opt-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.text)}</small></span>`,
  }));
}

function moveOptions(side) {
  const learnset = legalMoves(side.species, side.level);
  const learnableIds = new Set(learnset.map((entry) => entry.move.id));
  const row = (move, section, note) => ({
    value: move.id,
    label: move.name,
    section,
    search: `${move.type} ${move.category === "damage" ? "damage" : "status"} ${move.effect}`,
    html: `<span class="opt-main"><strong>${escapeHtml(move.name)}</strong><small>${typeChip(move.type)} ${escapeHtml(moveInfo(move))}</small></span><span class="opt-power"><b>${move.category === "damage" ? move.power : "—"}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}</span>`,
  });
  return [
    { value: "", label: "(No move)", section: "", html: `<span class="opt-main muted">(No move)</span>` },
    ...learnset.sort((left, right) => left.level - right.level).map(({ move, level }) => row(move, "Learnset", `Lv ${level}`)),
    ...allMoves().filter((move) => !learnableIds.has(move.id)).map((move) => row(move, "All other moves", "")),
  ];
}

function panelTemplate(index) {
  const statRows = STAT_KEYS.map((key) => `
    <tr>
      <th scope="row" title="${STAT_LABELS[key]}">${STAT_LABELS[key]}</th>
      <td><input class="input num" type="number" inputmode="numeric" min="1" max="255" data-field="base.${key}" aria-label="${STAT_LABELS[key]} base stat" title="Base stat. Edit it to test a balance change; changing Novaling resets it." /></td>
      <td><input class="input num" type="number" inputmode="numeric" min="0" max="31" data-field="iv.${key}" aria-label="${STAT_LABELS[key]} IV" /></td>
      <td class="stat-value" data-out="stat.${key}"></td>
      <td>${key === "hp" ? "" : `<select class="input boost" data-field="boost.${key}" aria-label="${STAT_LABELS[key]} stage">${Array.from({ length: 13 }, (_, step) => `<option value="${6 - step}">${step === 6 ? "--" : signed(6 - step)}</option>`).join("")}</select>`}</td>
      <td class="stat-final" data-out="final.${key}"></td>
    </tr>`).join("");
  const moveRows = [0, 1, 2, 3].map((slot) => `
    <div class="move-row" data-move="${slot}">
      <div class="move-controls">
        <div data-mount="move.${slot}" class="move-pick"></div>
        <label class="move-field" title="Base power. Edit it to test a variable-power move or a balance change."><span>Pow</span><input class="input num" type="number" inputmode="numeric" min="0" max="300" data-field="move.${slot}.power" aria-label="Move ${slot + 1} power" /></label>
        <select class="input move-type" data-field="move.${slot}.type" aria-label="Move ${slot + 1} type">${typeOptions(true, "Typeless")}</select>
        <label class="check crit" title="Critical hit: ×1.5, and ignores lowered Attack and raised Defense."><input type="checkbox" data-field="move.${slot}.crit" /><span>Crit</span></label>
      </div>
      <div class="move-info" data-out="moveinfo.${slot}"></div>
    </div>`).join("");
  return `
    <header class="panel-head">
      <h2>Novaling ${index + 1}</h2>
      <span class="role" data-out="role"></span>
      <button type="button" class="btn btn-sm btn-ghost" data-action="reset-side" title="Reset this Novaling's settings">Reset</button>
    </header>
    <div class="panel-body">
      <div class="species-row">
        <div class="species-fields">
          <div data-mount="species"></div>
          <div class="species-meta">
            <span data-out="typechips" class="chips"></span>
            <span class="muted" data-out="evolution"></span>
          </div>
        </div>
      </div>
      <div class="row-3">
        <label class="field"><span>Type 1</span><select class="input" data-field="type1">${typeOptions(false)}</select></label>
        <label class="field"><span>Type 2</span><select class="input" data-field="type2">${typeOptions(true, "(none)")}</select></label>
        <label class="field"><span>Level</span><input class="input num" type="number" inputmode="numeric" min="1" max="100" data-field="level" /></label>
      </div>
      <table class="stats">
        <thead><tr><th></th><th>Base</th><th>IVs</th><th>Stat</th><th>Stage</th><th title="After stages, items and status">Final</th></tr></thead>
        <tbody>${statRows}</tbody>
      </table>
      <div class="total muted" data-out="total"></div>
      <div class="field"><span>Ability</span><div data-mount="ability"></div></div>
      <p class="hint" data-out="abilitytext"></p>
      <label class="check entry-toggle" data-out="entrywrap" hidden><input type="checkbox" data-field="entry" /><span data-out="entrytext"></span></label>
      <div class="field"><span>Item</span><div data-mount="item"></div></div>
      <label class="field" data-out="boostwrap" hidden><span>Boosted type</span><select class="input" data-field="typeBoost">${typeOptions(false)}</select></label>
      <p class="hint" data-out="itemtext"></p>
      <label class="field"><span>Status</span><select class="input" data-field="status">${Object.entries(STATUSES).map(([id, name]) => `<option value="${id}">${name}</option>`).join("")}</select></label>
      <p class="hint" data-out="statustext" hidden></p>
      <div class="field">
        <span>Current HP</span>
        <div class="hp-inputs">
          <input class="input num" type="number" inputmode="numeric" min="1" data-field="hp" aria-label="Current HP" />
          <span class="muted" data-out="hpmax"></span>
          <input class="input num" type="number" inputmode="numeric" min="1" max="100" data-field="hpPercent" aria-label="Current HP percent" />
          <span class="muted">%</span>
          <button type="button" class="btn btn-sm" data-action="hp-full">Full</button>
          <button type="button" class="btn btn-sm" data-action="hp-third" title="One third of max HP, where Surge abilities switch on">⅓</button>
        </div>
        <div class="hpbar" role="img" data-out="hpbarwrap"><i data-out="hpbar"></i></div>
        <p class="hint hint-accent" data-out="surgetext" hidden></p>
      </div>
      <h3 class="section-title">Moves</h3>
      <div class="moves">${moveRows}</div>
    </div>`;
}

// --- Rendering ------------------------------------------------------------------------------

function buildLayout() {
  app.innerHTML = `
    <section class="move-lists" aria-label="Move results">
      <div class="move-list" data-list="0"></div>
      <div class="move-list" data-list="1"></div>
    </section>
    <section class="result-sticky" aria-label="Selected move's damage">
      <div class="result-line-row">
        <p id="result-line" class="result-line" aria-live="polite"></p>
        <button type="button" id="copy-result" class="btn btn-sm">Copy</button>
      </div>
      <div id="damage-bar" class="damage-bar" role="img"></div>
    </section>
    <section id="result-details" class="result-details" aria-label="Damage details"></section>
    <div class="view-switch" role="tablist" aria-label="Show panel">
      <button type="button" role="tab" data-view="0"></button>
      <button type="button" role="tab" data-view="field">Field</button>
      <button type="button" role="tab" data-view="1"></button>
    </div>
    <div class="columns" data-view-active="0">
      <section class="panel side-panel" data-side="0" aria-label="Novaling 1">${panelTemplate(0)}</section>
      <section class="panel field-panel" data-side="field" aria-label="Field"></section>
      <section class="panel side-panel" data-side="1" aria-label="Novaling 2">${panelTemplate(1)}</section>
    </div>`;

  refs = {
    lists: [...app.querySelectorAll("[data-list]")],
    line: app.querySelector("#result-line"),
    bar: app.querySelector("#damage-bar"),
    details: app.querySelector("#result-details"),
    field: app.querySelector(".field-panel"),
    columns: app.querySelector(".columns"),
    viewButtons: [...app.querySelectorAll("[data-view]")],
  };
  panels = [0, 1].map((index) => buildPanel(index));

  app.querySelector("#copy-result").addEventListener("click", copyResult);
  refs.viewButtons.forEach((button) => button.addEventListener("click", () => {
    mobileView = button.dataset.view;
    renderViewSwitch();
  }));
  refs.lists.forEach((list, index) => list.addEventListener("click", (event) => {
    const row = event.target.closest("[data-slot]");
    if (!row || row.disabled) return;
    state.selected = { side: index, slot: Number(row.dataset.slot) };
    render();
  }));
}

function buildPanel(index) {
  const root = app.querySelector(`.side-panel[data-side="${index}"]`);
  const out = (name) => root.querySelector(`[data-out="${name}"]`);
  const panel = { root, out, species: null, ability: null, item: null, moves: [] };
  const mount = (name, combobox) => root.querySelector(`[data-mount="${name}"]`).append(combobox.root);

  panel.species = new Combobox({ label: `Novaling ${index + 1}`, placeholder: "Search by name, type or ability", onSelect: (value) => changeSpecies(index, value) });
  panel.ability = new Combobox({ label: `Novaling ${index + 1} ability`, onSelect: (value) => {
    const side = state.sides[index];
    side.ability = value === speciesOf(side).ability ? null : value;
    render();
  } });
  panel.item = new Combobox({ label: `Novaling ${index + 1} item`, onSelect: (value) => {
    state.sides[index].item = value;
    render();
  } });
  panel.species.setOptions(speciesOptions());
  panel.ability.setOptions(abilityOptions());
  panel.item.setOptions(itemOptions());
  mount("species", panel.species);
  mount("ability", panel.ability);
  mount("item", panel.item);
  for (let slot = 0; slot < 4; slot += 1) {
    const combobox = new Combobox({ label: `Novaling ${index + 1} move ${slot + 1}`, placeholder: "(No move)", onSelect: (value) => {
      const side = state.sides[index];
      side.moves[slot] = newMoveSlot(value);
      state.selected = { side: index, slot };
      render();
    } });
    panel.moves.push(combobox);
    mount(`move.${slot}`, combobox);
  }

  root.addEventListener("input", (event) => onFieldInput(index, event.target, false));
  root.addEventListener("change", (event) => onFieldInput(index, event.target, true));
  root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const side = state.sides[index];
    if (action === "reset-side") state.sides[index] = newSide(side.species);
    if (action === "hp-full") side.hp = null;
    if (action === "hp-third") side.hp = Math.max(1, Math.floor(maxHpOf(side) / 3));
    render();
  });
  return panel;
}

function changeSpecies(index, value) {
  const side = state.sides[index];
  if (value === side.species || !monsterById(value)) return;
  const monster = monsterById(value);
  // Level, IVs, stages and item carry over, so comparing Novalings doesn't undo your setup.
  Object.assign(side, {
    species: value,
    base: { hp: null, attack: null, defense: null, speed: null },
    types: null,
    ability: null,
    hp: null,
    entryActive: false,
    status: "none",
    moves: moveSlots(defaultMoveIds(monster, side.level)),
  });
  render();
}

// Keeps a damaged Novaling at the same share of its HP when its max HP changes.
function withHpRatioKept(side, change) {
  const before = maxHpOf(side);
  const ratio = side.hp === null ? null : side.hp / before;
  change();
  if (ratio !== null) side.hp = Math.max(1, Math.floor(ratio * maxHpOf(side)));
}

function onFieldInput(index, target, committed) {
  const field = target.dataset?.field;
  if (!field) return;
  const side = state.sides[index];
  const isNumber = target.type === "number";
  const whole = isNumber ? parseWhole(target.value) : null;
  const min = Number(target.min);
  const max = Number(target.max || Infinity);

  if (isNumber) {
    const outOfRange = whole !== null && (whole < min || whole > max);
    target.classList.toggle("is-invalid", !committed && (whole === null || outOfRange));
    // While typing, a blank box keeps the last good value; on leaving the box the value is written back.
    if (whole === null) {
      if (committed) render({ forceInputs: true });
      return;
    }
  }
  const value = isNumber ? clamp(whole, min, max) : target.value;
  const [group, key, sub] = field.split(".");

  if (group === "level") withHpRatioKept(side, () => { side.level = value; });
  else if (group === "base") withHpRatioKept(side, () => { side.base[key] = value === speciesOf(side)[key] ? null : value; });
  else if (group === "iv") withHpRatioKept(side, () => { side.ivs[key] = value; });
  else if (group === "boost") side.boosts[key] = Number(value);
  else if (group === "type1" || group === "type2") {
    const [type1, type2] = typesOf(side);
    const next = group === "type1" ? [value, type2 === value ? "" : type2] : [type1, value === type1 ? "" : value];
    const monster = speciesOf(side);
    side.types = next[0] === monster.type1 && next[1] === (monster.type2 || "") ? null : next;
  } else if (group === "typeBoost") side.typeBoost = value;
  else if (group === "status") side.status = value;
  else if (group === "entry") side.entryActive = target.checked;
  else if (group === "hp") side.hp = value >= maxHpOf(side) ? null : value;
  else if (group === "hpPercent") side.hp = value >= 100 ? null : Math.max(1, Math.floor((maxHpOf(side) * value) / 100));
  else if (group === "move") {
    const slot = side.moves[Number(key)];
    if (sub === "power") slot.power = value === moveById(slot.id)?.power ? null : value;
    if (sub === "type") slot.type = value === moveById(slot.id)?.type ? null : value;
    if (sub === "crit") slot.crit = target.checked;
    state.selected = { side: index, slot: Number(key) };
  }
  render({ forceInputs: committed });
}

function setInput(element, value, force) {
  if (!force && document.activeElement === element) return;
  if (element.type === "checkbox") element.checked = value;
  else element.value = value;
  element.classList.remove("is-invalid");
}

function renderPanel(index, forceInputs) {
  const side = state.sides[index];
  const panel = panels[index];
  const { root, out } = panel;
  const field = (name) => root.querySelector(`[data-field="${name}"]`);
  const monster = speciesOf(side);
  const types = typesOf(side);
  const ability = abilityOf(side);
  const kind = abilityKind(side);
  const maxHp = maxHpOf(side);
  const currentHp = currentHpOf(side);

  out("role").textContent = state.selected.side === index ? "Attacking" : "Defending";
  out("role").classList.toggle("role-attacking", state.selected.side === index);
  panel.species.setValue(side.species);
  out("typechips").innerHTML = types.filter(Boolean).map(typeChip).join("");
  out("evolution").textContent = monster.evolvesTo ? `Can evolve${monster.evolveLevel ? ` at Lv ${monster.evolveLevel}` : ""}` : "Final stage";
  setInput(field("type1"), types[0], forceInputs);
  setInput(field("type2"), types[1] || "", forceInputs);
  setInput(field("level"), side.level, forceInputs);

  for (const key of STAT_KEYS) {
    const base = field(`base.${key}`);
    setInput(base, baseStat(side, key), forceInputs);
    base.classList.toggle("is-edited", side.base[key] !== null);
    setInput(field(`iv.${key}`), side.ivs[key], forceInputs);
    out(`stat.${key}`).textContent = rawStat(side, key);
    if (key === "hp") {
      out("final.hp").textContent = "";
      continue;
    }
    setInput(field(`boost.${key}`), side.boosts[key], forceInputs);
    const final = effectiveValue(index, key);
    const finalOut = out(`final.${key}`);
    finalOut.textContent = final;
    finalOut.classList.toggle("is-up", final > rawStat(side, key));
    finalOut.classList.toggle("is-down", final < rawStat(side, key));
  }
  out("total").textContent = `Base stat total ${STAT_KEYS.reduce((sum, key) => sum + baseStat(side, key), 0)}`;

  panel.ability.setValue(abilityNameOf(side));
  out("abilitytext").textContent = ability ? ability.text : "This ability isn't in the data.";
  const entryLabel = { intimidate: "Intimidate triggered: foe's Attack −1", quickfeet: "Entry boost triggered: own Speed +1" }[kind];
  out("entrywrap").hidden = !entryLabel;
  out("entrytext").textContent = entryLabel || "";
  setInput(field("entry"), side.entryActive, forceInputs);

  panel.item.setValue(side.item);
  out("itemtext").textContent = ITEMS.find((item) => item.id === side.item)?.text || "";
  out("boostwrap").hidden = side.item !== "type-boost";
  setInput(field("typeBoost"), side.typeBoost, forceInputs);

  // A status this Novaling can't have is offered but disabled, with the reason beside it.
  const statusSelect = field("status");
  const reasons = [];
  for (const option of statusSelect.options) {
    const reason = option.value === "none" ? "" : statusBlockReason(option.value, types.filter(Boolean), ability);
    option.disabled = Boolean(reason);
    if (reason) reasons.push(`${STATUSES[option.value]} unavailable: ${reason}.`);
  }
  if (side.status !== "none" && statusBlockReason(side.status, types.filter(Boolean), ability)) side.status = "none";
  setInput(statusSelect, side.status, forceInputs);
  out("statustext").hidden = !reasons.length;
  out("statustext").textContent = reasons.join(" ");

  setInput(field("hp"), currentHp, forceInputs);
  field("hp").max = maxHp;
  out("hpmax").textContent = `/ ${maxHp}`;
  const hpPercent = Math.max(1, Math.round((currentHp / maxHp) * 100));
  setInput(field("hpPercent"), hpPercent, forceInputs);
  out("hpbar").style.width = `${(currentHp / maxHp) * 100}%`;
  out("hpbar").dataset.level = hpPercent > 50 ? "good" : hpPercent > 20 ? "mid" : "low";
  out("hpbarwrap").setAttribute("aria-label", `${hpPercent}% HP`);
  const surge = kind === "surge" && currentHp * 3 <= maxHp;
  out("surgetext").hidden = !surge;
  out("surgetext").textContent = surge ? `${ability.name} active: ${ability.type} moves ×1.5.` : "";

  side.moves.forEach((slot, slotIndex) => {
    const combobox = panel.moves[slotIndex];
    combobox.setOptions(moveOptions(side));
    combobox.setValue(slot.id);
    const move = resolvedMove(slot);
    const powerInput = field(`move.${slotIndex}.power`);
    const typeSelect = field(`move.${slotIndex}.type`);
    const critBox = field(`move.${slotIndex}.crit`);
    const canHit = Boolean(move) && move.category === "damage";
    powerInput.disabled = !canHit;
    typeSelect.disabled = !move;
    critBox.disabled = !canHit;
    setInput(powerInput, move ? move.power : "", forceInputs);
    powerInput.classList.toggle("is-edited", slot.power !== null);
    setInput(typeSelect, move ? move.type : "", forceInputs);
    typeSelect.classList.toggle("is-edited", slot.type !== null);
    setInput(critBox, slot.crit, forceInputs);
    const rowInfo = out(`moveinfo.${slotIndex}`);
    if (!move) rowInfo.textContent = "";
    else {
      const blocked = side.item === "vest" && !canHit ? " · Blocked by Vest in battle" : "";
      const learnset = legalMoves(side.species, side.level).find((entry) => entry.move.id === move.id);
      const legality = move.id === STRUGGLE.id ? "" : !learnset ? " · Not in learnset" : !learnset.learned ? ` · Learned at Lv ${learnset.level}` : "";
      rowInfo.textContent = `${moveInfo(move)}${blocked}${legality}`;
    }
    root.querySelector(`[data-move="${slotIndex}"]`).classList.toggle("is-selected", state.selected.side === index && state.selected.slot === slotIndex);
  });
}

function koClass(entry) {
  if (!entry?.ko || entry.result.typeMultiplier === 0 || entry.ko.hits === 0) return "ko-none";
  const { hits, chance } = entry.ko;
  if (hits === 1) return chance === 1 ? "ko-sure" : "ko-chance";
  if (hits === 2) return "ko-two";
  return "ko-far";
}

function renderMoveList(index, computed) {
  const side = state.sides[index];
  const foe = state.sides[1 - index];
  refs.lists[index].innerHTML = `
    <h2 class="list-title">${escapeHtml(speciesOf(side).name)}'s moves <span>vs. ${escapeHtml(speciesOf(foe).name)}</span></h2>
    ${side.moves.map((slot, slotIndex) => {
      const entry = computed[index][slotIndex];
      if (!entry) return `<button type="button" class="result-row is-empty" data-slot="${slotIndex}" disabled><span class="row-name muted">(No move)</span></button>`;
      const selected = state.selected.side === index && state.selected.slot === slotIndex;
      let range = "Status";
      let note = "No direct damage";
      let fill = 0;
      if (entry.result.kind === "damage") {
        const maxHp = maxHpOf(foe);
        range = entry.result.typeMultiplier === 0 ? "0%" : `${percent(entry.result.min, maxHp)} - ${percent(entry.result.max, maxHp)}%`;
        note = entry.result.typeMultiplier === 0 ? "No effect" : entry.ko.text || "Can't KO within 9 hits";
        fill = Math.min(100, (entry.result.max / maxHp) * 100);
      }
      return `<button type="button" class="result-row ${selected ? "is-selected" : ""} ${koClass(entry)}" data-slot="${slotIndex}" aria-pressed="${selected}">
        <span class="row-name">${escapeHtml(entry.move.name)}${entry.slot.crit ? ` <span class="crit-tag">Crit</span>` : ""}</span>
        <span class="row-range">${range}</span>
        <span class="row-ko">${escapeHtml(note)}</span>
        <span class="row-meter"><i style="width:${fill}%"></i></span>
      </button>`;
    }).join("")}`;
}

function effectivenessLabel(multiplier) {
  if (multiplier === 0) return ["No effect (immune)", "eff-zero"];
  if (multiplier > 1) return [`Super effective ×${multiplier}`, "eff-good"];
  if (multiplier < 1) return [`Resisted ×${multiplier}`, "eff-bad"];
  return ["Neutral ×1", "eff-even"];
}

function modifierChips(entry) {
  const { result, slot } = entry;
  const attackerSide = state.sides[entry.attackerIndex];
  const defenderSide = state.sides[1 - entry.attackerIndex];
  const chips = [];
  if (result.hasStab) chips.push("STAB ×1.5");
  if (slot.crit) chips.push("Critical hit ×1.5");
  if (result.ignoresAttackDrop) chips.push("Crit ignored Attack drop");
  if (result.ignoresDefenseBoost) chips.push("Crit ignored Defense boost");
  if (attackerSide.status === "burn") chips.push("Burn ×0.5");
  if (result.surgeActive) chips.push(`${abilityOf(attackerSide).name} ×1.5`);
  if (result.itemMultiplier > 1) chips.push(`${itemName(attackerSide.item)} ×${result.itemMultiplier}`);
  if (attackerSide.item === "choice-attack") chips.push("Choice Attack: Attack ×1.5");
  if (entry.attackerStage && !result.ignoresAttackDrop) chips.push(`Attack ${signed(entry.attackerStage)} (×${Math.round(stageMultiplier(entry.attackerStage) * 100) / 100})`);
  if (entry.defenderStage && !result.ignoresDefenseBoost) chips.push(`Defense ${signed(entry.defenderStage)} (×${Math.round(stageMultiplier(entry.defenderStage) * 100) / 100})`);
  if (defenderSide.item === "vest") chips.push("Vest: Defense ×1.5");
  if (defenderSide.item === "eviolite" && speciesOf(defenderSide).evolvesTo) chips.push("Eviolite Style: Defense ×1.5");
  if (defenderSide.item === "eviolite" && !speciesOf(defenderSide).evolvesTo) chips.push("Eviolite Style: no effect, can't evolve");
  return chips;
}

function selectedEntry(computed) {
  const { side, slot } = state.selected;
  if (computed[side][slot]) return computed[side][slot];
  for (const index of [side, 1 - side]) {
    const found = computed[index].findIndex(Boolean);
    if (found >= 0) {
      state.selected = { side: index, slot: found };
      return computed[index][found];
    }
  }
  return null;
}

function renderResult(entry) {
  if (!entry) {
    refs.line.textContent = "Choose a move to see its damage.";
    refs.bar.innerHTML = "";
    refs.details.innerHTML = "";
    return;
  }
  refs.line.textContent = calculationLine(entry);
  const defenderSide = state.sides[1 - entry.attackerIndex];
  const defender = speciesOf(defenderSide).name;
  const maxHp = maxHpOf(defenderSide);
  const currentHp = currentHpOf(defenderSide);
  const { result, move } = entry;

  if (result.kind !== "damage") {
    refs.bar.innerHTML = "";
    refs.bar.removeAttribute("aria-label");
    const attackerSide = state.sides[entry.attackerIndex];
    const reason = move.category === "damage" ? "This move's power is 0, so it deals no damage." : "Status moves deal no direct damage.";
    refs.details.innerHTML = `
      <div class="detail-row">${typeChip(move.type)}<span class="chip">${escapeHtml(moveInfo(move))}</span></div>
      <p class="hint">${reason}${attackerSide.item === "vest" ? " Its holder's Vest also stops it being used in battle." : ""}</p>`;
    return;
  }

  const remainingMax = Math.max(0, currentHp - result.min);
  const remainingMin = Math.max(0, currentHp - result.max);
  const segment = (value) => (value / maxHp) * 100;
  const safe = segment(remainingMin);
  const variable = segment(remainingMax - remainingMin);
  const dealt = segment(currentHp - remainingMax);
  const missing = segment(maxHp - currentHp);
  refs.bar.setAttribute("aria-label", `${defender} would be left with ${remainingMin} to ${remainingMax} of ${maxHp} HP`);
  refs.bar.innerHTML = `
    <span class="bar-track">
      <i class="bar-safe" style="width:${safe}%"></i><i class="bar-variable" style="width:${variable}%"></i><i class="bar-dealt" style="width:${dealt}%"></i><i class="bar-missing" style="width:${missing}%"></i>
    </span>
    <span class="bar-text">${escapeHtml(defender)} left on ${remainingMin === remainingMax ? remainingMin : `${remainingMin}–${remainingMax}`} / ${maxHp} HP</span>`;

  const [effectText, effectClass] = effectivenessLabel(result.typeMultiplier);
  const chips = modifierChips(entry);
  const distinct = [...new Set(result.rolls.map((roll) => roll.damage))];
  const koRows = entry.ko.table.map(({ hits, chance }) => {
    const label = hits === 1 ? "OHKO" : `${hits}HKO`;
    return `<div class="ko-cell ${chance === 1 ? "is-sure" : chance > 0 ? "is-possible" : ""}"><small>${label}</small><strong>${formatChance(chance)}</strong></div>`;
  }).join("");
  const eot = defenderSide.status === "burn" || defenderSide.status === "poison";
  const notes = [];
  if (state.sides[entry.attackerIndex].item === "life-orb") notes.push(`${speciesOf(state.sides[entry.attackerIndex]).name} loses ${Math.floor(maxHpOf(state.sides[entry.attackerIndex]) / 10)} HP per hit from its item.`);
  if (abilityKind(defenderSide) === "regrow") notes.push("Regrow's healing isn't counted: the rules don't define how much it heals.");
  if (move.accuracy < 100 && move.id !== STRUGGLE.id) notes.push(`KO odds assume every hit lands. ${move.name} has ${move.accuracy} accuracy.`);
  if (eot) notes.push(`KO odds include ${defenderSide.status} damage between hits.`);

  refs.details.innerHTML = `
    <div class="detail-grid">
      <div class="detail-block">
        <h3 class="section-title">Knockout chance</h3>
        <div class="ko-table">${result.typeMultiplier === 0 ? `<p class="hint">It can't damage ${escapeHtml(defender)}.</p>` : koRows}</div>
      </div>
      <div class="detail-block">
        <h3 class="section-title">Modifiers</h3>
        <div class="chips"><span class="chip ${effectClass}">${effectText}</span>${chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>
        <p class="stat-compare">Attack ${result.attack} vs. Defense ${result.defense}</p>
      </div>
      <div class="detail-block">
        <h3 class="section-title">All 16 damage rolls</h3>
        <div class="rolls">${result.rolls.map(({ random, damage }) => `<div class="roll ${damage >= currentHp && damage > 0 ? "is-ko" : ""}"><small>${random}</small><span>${damage}</span></div>`).join("")}</div>
      </div>
    </div>
    <p class="possible">Possible damage amounts: (${distinct.join(", ")})</p>
    ${notes.map((note) => `<p class="hint">${escapeHtml(note)}</p>`).join("")}
    <details class="trace" ${refs.details.querySelector("details[open]") ? "open" : ""}>
      <summary>Calculation details</summary>
      <ul>${result.trace.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></li>`).join("")}</ul>
    </details>`;
}

function renderField() {
  const speeds = [effectiveValue(0, "speed"), effectiveValue(1, "speed")];
  const names = state.sides.map((side) => speciesOf(side).name);
  const fasterIndex = speeds[0] === speeds[1] ? -1 : speeds[0] > speeds[1] ? 0 : 1;
  const sameLevel = state.sides[0].level === state.sides[1].level ? state.sides[0].level : null;
  refs.field.innerHTML = `
    <header class="panel-head"><h2>Field</h2></header>
    <div class="panel-body">
      <div class="field">
        <span>Set both levels</span>
        <div class="seg">${LEVEL_PRESETS.map((level) => `<button type="button" class="seg-btn ${sameLevel === level ? "is-active" : ""}" data-level="${level}" aria-pressed="${sameLevel === level}">Level ${level}</button>`).join("")}</div>
      </div>
      <div class="field">
        <span>Speed check</span>
        <div class="speed-box">
          ${[0, 1].map((index) => `<div class="speed-row ${fasterIndex === index ? "is-faster" : ""}"><span>${escapeHtml(names[index])}</span><strong>${speeds[index]}</strong></div>`).join("")}
          <p>${fasterIndex < 0 ? "Speed tie: 50/50" : `${escapeHtml(names[fasterIndex])} moves first`}</p>
        </div>
      </div>
      <div class="field-actions">
        <button type="button" class="btn" data-field-action="swap">⇄ Swap sides</button>
        <button type="button" class="btn" data-field-action="clear-boosts">Clear stages</button>
        <button type="button" class="btn" data-field-action="reset">Reset all</button>
      </div>
      <div class="field">
        <span>Rules in use</span>
        <p class="hint">The Novalings rulebook has one ruleset with four stats and IVs only. Natures, EVs, Special stats, generations, weather, terrain and screens don't exist in it, so they aren't offered here.</p>
      </div>
      <div class="field">
        <span>Balance data</span>
        <p class="hint">${escapeHtml(source.label)}${source.notice ? ` ${escapeHtml(source.notice)}` : ""}</p>
        ${source.warning ? `<p class="hint hint-warn">${escapeHtml(source.warning)}</p>` : ""}
        <button type="button" class="btn" data-field-action="reload" id="reload-data">↻ Reload data</button>
      </div>
    </div>`;
}

function renderViewSwitch() {
  refs.columns.dataset.viewActive = mobileView;
  refs.viewButtons.forEach((button) => {
    const active = button.dataset.view === mobileView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    if (button.dataset.view !== "field") button.textContent = speciesOf(state.sides[Number(button.dataset.view)]).name;
  });
}

function render({ forceInputs = false } = {}) {
  panels.forEach((_, index) => renderPanel(index, forceInputs));
  const computed = [0, 1].map((index) => state.sides[index].moves.map((_, slot) => compute(index, slot)));
  const entry = selectedEntry(computed);
  // Selecting a fallback move can change which panel is attacking, so roles are refreshed here.
  panels.forEach((panel, index) => {
    panel.out("role").textContent = state.selected.side === index ? "Attacking" : "Defending";
    panel.out("role").classList.toggle("role-attacking", state.selected.side === index);
  });
  renderMoveList(0, computed);
  renderMoveList(1, computed);
  renderResult(entry);
  renderField();
  renderViewSwitch();
  persist();
}

async function copyResult(event) {
  const button = event.currentTarget;
  const text = refs.line.textContent;
  const finish = (label) => {
    button.textContent = label;
    setTimeout(() => { button.textContent = "Copy"; }, 1400);
  };
  try {
    await navigator.clipboard.writeText(text);
    finish("Copied");
  } catch {
    finish("Copy failed");
  }
}

function onFieldPanelClick(event) {
  const levelButton = event.target.closest("[data-level]");
  if (levelButton) {
    for (const side of state.sides) withHpRatioKept(side, () => { side.level = Number(levelButton.dataset.level); });
    render({ forceInputs: true });
    return;
  }
  const action = event.target.closest("[data-field-action]")?.dataset.fieldAction;
  if (action === "swap") {
    state.sides.reverse();
    state.selected = { ...state.selected, side: 1 - state.selected.side };
  } else if (action === "clear-boosts") {
    for (const side of state.sides) side.boosts = { attack: 0, defense: 0, speed: 0 };
  } else if (action === "reset") {
    state = initialState();
  } else if (action === "reload") {
    load();
    return;
  } else return;
  render({ forceInputs: true });
}

function showLoadError(error) {
  sourceStatus.textContent = "Data unavailable";
  app.innerHTML = `
    <div class="load-error" role="alert">
      <h2>Battle data couldn't be loaded</h2>
      <p>${escapeHtml(error.message)}</p>
      <p class="hint">If you opened index.html directly, serve the folder instead: <code>python3 -m http.server 8080</code></p>
      <button type="button" class="btn btn-primary" id="retry-load">Try again</button>
    </div>`;
  app.querySelector("#retry-load").addEventListener("click", load);
}

async function load() {
  const firstLoad = !dataset;
  sourceStatus.textContent = "Loading battle data…";
  const reloadButton = document.querySelector("#reload-data");
  if (reloadButton) {
    reloadButton.disabled = true;
    reloadButton.textContent = "Loading…";
  }
  try {
    const loaded = await loadDataset();
    dataset = loaded.dataset;
    source = { label: loaded.label, notice: loaded.notice, warning: loaded.warning };
  } catch (error) {
    if (firstLoad) {
      showLoadError(error);
      return;
    }
    // A failed reload keeps the data already on screen.
    source = { ...source, warning: `Reload failed: ${error.message} The data already loaded is still in use.` };
    render();
    sourceStatus.textContent = source.label;
    return;
  }
  // Selections survive a reload; only what the new data no longer has falls back.
  state = restoreState(state || loadSaved());
  if (!document.querySelector(".columns")) {
    buildLayout();
    refs.field.addEventListener("click", onFieldPanelClick);
  } else {
    for (const panel of panels) {
      panel.species.setOptions(speciesOptions());
      panel.ability.setOptions(abilityOptions());
      panel.item.setOptions(itemOptions());
    }
  }
  sourceStatus.textContent = source.label;
  render({ forceInputs: true });
}

load();
