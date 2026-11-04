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
import { loadDataset } from "./data-source.js";
import { Picker } from "./picker.js";

const TYPE_COLORS = {
  Normal: "#78716c", Fire: "#dc5a2b", Water: "#2f7fd6", Electric: "#b98a00", Grass: "#3f9142", Ice: "#2a9aa5",
  Fighting: "#b8432f", Poison: "#8d4bb0", Ground: "#a97f3c", Flying: "#5f7fd8", Psychic: "#d4487f", Bug: "#7c9414",
  Rock: "#8f7d45", Ghost: "#65559a", Dragon: "#5a4bd8", Dark: "#574f63", Steel: "#64788c", Fairy: "#c95f9d",
};
const STAT_KEYS = ["hp", "attack", "defense", "speed"];
const STAT_LABELS = { hp: "HP", attack: "Attack", defense: "Defense", speed: "Speed" };
const STAT_SHORT = { hp: "HP", attack: "Atk", defense: "Def", speed: "Spe" };
const STAGE_OPTIONS = Array.from({ length: 13 }, (_, step) => {
  const value = 6 - step;
  return { value: String(value), label: value === 0 ? "—" : value > 0 ? `+${value}` : `${value}`, empty: value === 0 };
});
const DEFAULT_IV = 15;
const DEFAULT_LEVEL = 50;
const LEVEL_PRESETS = [100, 50, 5];

const app = document.querySelector("#app");
const sourceStatus = document.querySelector("#source-status");

let dataset = null;
let source = { label: "", warning: "" };
let state = null;
let panels = [];
let refs = {};
let mobileView = "0";
let customLevelOpen = false;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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

function newMoveSlot(id = "") {
  return { id, power: null, type: null, crit: false };
}

// Everything starts blank except the level, which always shows a number as on Showdown.
// A blank IV counts as the default shown in its placeholder.
function newSide(level = DEFAULT_LEVEL) {
  return {
    species: "",
    level,
    base: { hp: null, attack: null, defense: null, speed: null },
    types: null,
    ability: "",
    ivs: { hp: null, attack: null, defense: null, speed: null },
    boosts: { attack: 0, defense: 0, speed: 0 },
    item: "none",
    typeBoost: "",
    status: "none",
    hp: null,
    entryActive: false,
    moves: [newMoveSlot(), newMoveSlot(), newMoveSlot(), newMoveSlot()],
  };
}

function initialState() {
  return { sides: [newSide(), newSide()], selected: { side: 0, slot: 0 }, defaultLevel: DEFAULT_LEVEL };
}

// --- Reading a side -------------------------------------------------------------------------

function speciesOf(side) {
  return monsterById(side.species);
}

function ivOf(side, key) {
  return side.ivs[key] ?? DEFAULT_IV;
}

function typesOf(side) {
  const monster = speciesOf(side);
  return side.types || (monster ? [monster.type1, monster.type2 || ""] : ["", ""]);
}

function baseStat(side, key) {
  return side.base[key] ?? speciesOf(side)?.[key] ?? 0;
}

function abilityOf(side) {
  return side.ability ? findAbility(dataset.abilities, side.ability) || null : null;
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
    ability: side.ability,
    hp: baseStat(side, "hp"),
    attack: baseStat(side, "attack"),
    defense: baseStat(side, "defense"),
    speed: baseStat(side, "speed"),
  };
}

function maxHpOf(side) {
  return calculateStat(baseStat(side, "hp"), ivOf(side, "hp"), side.level, true);
}

function currentHpOf(side) {
  return side.hp === null ? maxHpOf(side) : clamp(side.hp, 1, maxHpOf(side));
}

function rawStat(side, key) {
  return calculateStat(baseStat(side, key), ivOf(side, key), side.level, key === "hp");
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
  if (stat === "defense") return defensiveStat(raw, stage, side.item, Boolean(speciesOf(side)?.evolvesTo));
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
  if (!move || !speciesOf(attackerSide) || !speciesOf(defenderSide)) return null;
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
    attackerAttackIv: ivOf(attackerSide, "attack"),
    defenderDefenseIv: ivOf(defenderSide, "defense"),
    defenderHpIv: ivOf(defenderSide, "hp"),
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

function legalMoves(speciesId, level) {
  const levels = new Map();
  for (const entry of dataset.learnsets) {
    if (entry.monster === speciesId && (!levels.has(entry.move) || entry.level < levels.get(entry.move))) levels.set(entry.move, entry.level);
  }
  return dataset.moves.filter((move) => levels.has(move.id)).map((move) => ({ move, level: levels.get(move.id), learned: levels.get(move.id) <= level }));
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
    `${ivOf(attackerSide, "attack")} IV Atk`,
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
    `${ivOf(defenderSide, "hp")} IV HP / ${ivOf(defenderSide, "defense")} IV Def`,
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
  if (!type) return `<span class="type" style="--t:#78716c">Typeless</span>`;
  return `<span class="type" style="--t:${TYPE_COLORS[type] || "#78716c"}">${escapeHtml(type)}</span>`;
}

function typeOptions(blankLabel) {
  const blank = blankLabel ? [{ value: "", label: blankLabel, empty: true }] : [];
  return [...blank, ...dataset.types.map((type) => ({ value: type, label: type, html: typeChip(type) }))];
}

function moveInfo(move) {
  if (!move) return "";
  const parts = [move.category === "damage" ? "Damage" : "Status", `Acc ${move.accuracy}`];
  if (move.pp) parts.push(`${move.pp} PP`);
  if (move.effect) parts.push(move.effect);
  return parts.join(" · ");
}

function speciesOptions() {
  return [
    { value: "", label: "Choose a Novaling", empty: true, html: `<span class="opt-main muted">None</span>` },
    ...dataset.monsters.map((monster) => ({
      value: monster.id,
      label: monster.name,
      search: `${monster.type1} ${monster.type2} ${monster.ability} ${monster.rarity}`,
      html: `<span class="opt-main"><strong>${escapeHtml(monster.name)}</strong><small>${typeChip(monster.type1)}${monster.type2 ? typeChip(monster.type2) : ""}</small></span><span class="opt-stats">${STAT_KEYS.map((key) => `<span><small>${STAT_SHORT[key]}</small>${monster[key]}</span>`).join("")}</span>`,
    })),
  ];
}

function abilityOptions(side) {
  const usual = speciesOf(side)?.ability;
  return [
    { value: "", label: "None", empty: true, html: `<span class="opt-main muted">None</span>` },
    ...dataset.abilities.map((ability) => ({
      value: ability.name,
      label: ability.name,
      search: ability.text,
      html: `<span class="opt-main"><strong>${escapeHtml(ability.name)}${usual && normalizeKey(usual) === normalizeKey(ability.name) ? ` <em>Usual</em>` : ""}</strong><small>${escapeHtml(ability.text)}</small></span>`,
    })),
  ];
}

function itemOptions() {
  return ITEMS.map((item) => ({
    value: item.id,
    label: item.name,
    empty: item.id === "none",
    search: item.text,
    html: item.id === "none" ? `<span class="opt-main muted">None</span>` : `<span class="opt-main"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.text)}</small></span>`,
  }));
}

function statusOptions(side) {
  const types = typesOf(side).filter(Boolean);
  const ability = abilityOf(side);
  return Object.entries(STATUSES).map(([value, label]) => {
    const reason = value === "none" ? "" : statusBlockReason(value, types, ability);
    return {
      value,
      label,
      empty: value === "none",
      disabled: Boolean(reason),
      html: reason ? `<span class="opt-main"><strong>${label}</strong><small>${escapeHtml(reason)}</small></span>` : `<span class="opt-main"><strong>${label}</strong></span>`,
    };
  });
}

function moveOptions(side) {
  const learnset = side.species ? legalMoves(side.species, side.level) : [];
  const learnableIds = new Set(learnset.map((entry) => entry.move.id));
  const row = (move, section, note) => ({
    value: move.id,
    label: move.name,
    section,
    search: `${move.type} ${move.category === "damage" ? "damage" : "status"} ${move.effect}`,
    html: `<span class="opt-main"><strong>${escapeHtml(move.name)}</strong><small>${typeChip(move.type)} ${escapeHtml(moveInfo(move))}</small></span><span class="opt-power"><b>${move.category === "damage" ? move.power : "—"}</b>${note ? `<small>${escapeHtml(note)}</small>` : ""}</span>`,
  });
  return [
    { value: "", label: "None", empty: true, html: `<span class="opt-main muted">None</span>` },
    ...learnset.sort((left, right) => left.level - right.level).map(({ move, level }) => row(move, "Learnset", `Lv ${level}`)),
    ...allMoves().filter((move) => !learnableIds.has(move.id)).map((move) => row(move, learnset.length ? "All other moves" : "", "")),
  ];
}

function panelTemplate(index) {
  const statRows = STAT_KEYS.map((key) => `
    <tr>
      <th scope="row">${STAT_LABELS[key]}</th>
      <td><input class="input num" type="number" inputmode="numeric" min="1" max="255" data-field="base.${key}" aria-label="${STAT_LABELS[key]} base stat" title="Base stat. Edit it to test a balance change." /></td>
      <td><input class="input num" type="number" inputmode="numeric" min="0" max="31" data-field="iv.${key}" placeholder="${DEFAULT_IV}" aria-label="${STAT_LABELS[key]} IV" /></td>
      <td>${key === "hp" ? "" : `<div data-mount="boost.${key}"></div>`}</td>
      <td class="stat-value" data-out="stat.${key}"></td>
    </tr>`).join("");
  const moveRows = [0, 1, 2, 3].map((slot) => `
    <div class="move" data-move="${slot}">
      <div class="move-main">
        <div data-mount="move.${slot}" class="move-pick"></div>
        <button type="button" class="move-result" data-select="${slot}" hidden>
          <span class="move-range"></span>
          <span class="move-ko"></span>
        </button>
      </div>
      <div class="move-extra" hidden>
        <label class="inline-field"><span>Power</span><input class="input num" type="number" inputmode="numeric" min="0" max="300" data-field="move.${slot}.power" aria-label="Move ${slot + 1} power" /></label>
        <div class="inline-field"><span>Type</span><div data-mount="movetype.${slot}"></div></div>
        <label class="check"><input type="checkbox" data-field="move.${slot}.crit" /><span>Critical hit</span></label>
        <p class="move-info"></p>
      </div>
    </div>`).join("");
  return `
    <header class="card-head">
      <h2>Novaling ${index + 1}</h2>
      <span class="role" data-out="role"></span>
      <button type="button" class="link-btn" data-action="reset-side">Clear</button>
    </header>
    <div data-mount="species" class="species-pick"></div>
    <div class="species-meta" data-out="metawrap" hidden>
      <span data-out="typechips" class="chips"></span>
      <details class="edit-types">
        <summary>Edit types</summary>
        <div class="row-2">
          <div class="field"><span>Type 1</span><div data-mount="type1"></div></div>
          <div class="field"><span>Type 2</span><div data-mount="type2"></div></div>
        </div>
      </details>
    </div>

    <h3 class="section-title">Moves</h3>
    <div class="moves">${moveRows}</div>

    <h3 class="section-title">Stats</h3>
    <div class="level-row">
      <label class="inline-field"><span>Level</span><input class="input num" type="number" inputmode="numeric" min="1" max="100" data-field="level" aria-label="Novaling ${index + 1} level" /></label>
    </div>
    <table class="stats">
      <thead><tr><th></th><th>Base</th><th>IV</th><th>Stage</th><th>Stat</th></tr></thead>
      <tbody>${statRows}</tbody>
    </table>

    <h3 class="section-title">Setup</h3>
    <div class="row-3">
      <div class="field"><span>Ability</span><div data-mount="ability"></div></div>
      <div class="field"><span>Item</span><div data-mount="item"></div></div>
      <div class="field"><span>Status</span><div data-mount="status"></div></div>
    </div>
    <p class="hint" data-out="abilitytext" hidden></p>
    <label class="check" data-out="entrywrap" hidden><input type="checkbox" data-field="entry" /><span data-out="entrytext"></span></label>
    <div class="field" data-out="boostwrap" hidden><span>Boosted type</span><div data-mount="typeBoost"></div></div>
    <p class="hint" data-out="itemtext" hidden></p>

    <div class="hp-block">
      <div class="hp-row">
        <span class="field-label">Current HP</span>
        <input class="input num" type="number" inputmode="numeric" min="1" data-field="hp" aria-label="Current HP" />
        <span class="muted" data-out="hpmax"></span>
        <input class="input num" type="number" inputmode="numeric" min="1" max="100" data-field="hpPercent" placeholder="100" aria-label="Current HP percent" />
        <span class="muted">%</span>
        <button type="button" class="link-btn" data-action="hp-third" title="One third of max HP, where Surge abilities switch on">Set to ⅓</button>
      </div>
      <div class="bar" role="img" data-out="hpbarwrap"><i data-out="hpbar"></i></div>
      <p class="hint" data-out="surgetext" hidden></p>
    </div>`;
}

// --- Layout ---------------------------------------------------------------------------------

function buildLayout() {
  app.innerHTML = `
    <div id="warning" class="banner" role="alert" hidden></div>
    <section class="hero" aria-label="Damage result">
      <div id="hero-body" aria-live="polite"></div>
    </section>
    <section id="details" class="details" aria-label="Damage details" hidden></section>
    <div class="toolbar" id="toolbar">
      <div class="toolbar-group">
        <div class="seg">${LEVEL_PRESETS.map((level) => `<button type="button" class="seg-btn" data-level="${level}" title="Set both Novalings to level ${level}">Level ${level}</button>`).join("")}<button type="button" class="seg-btn" data-custom-level title="Set both Novalings to any level">Custom</button></div>
        <input class="input num custom-level" id="custom-level" type="number" inputmode="numeric" min="1" max="100" placeholder="1–100" aria-label="Level for both Novalings" hidden />
      </div>
      <span class="toolbar-speed" hidden></span>
      <div class="toolbar-actions">
        <button type="button" class="link-btn" data-toolbar="swap">Swap sides</button>
        <button type="button" class="link-btn" data-toolbar="clear-boosts">Clear stages</button>
        <button type="button" class="link-btn" data-toolbar="reload" id="reload-data">Reload data</button>
        <button type="button" class="link-btn" data-toolbar="reset">Clear everything</button>
      </div>
    </div>
    <div class="view-switch" role="tablist" aria-label="Show Novaling">
      <button type="button" role="tab" data-view="0"></button>
      <button type="button" role="tab" data-view="1"></button>
    </div>
    <div class="cards" data-view-active="0">
      <section class="card" data-side="0" aria-label="Novaling 1">${panelTemplate(0)}</section>
      <section class="card" data-side="1" aria-label="Novaling 2">${panelTemplate(1)}</section>
    </div>`;
  refs = {
    hero: app.querySelector("#hero-body"),
    details: app.querySelector("#details"),
    toolbar: app.querySelector("#toolbar"),
    warning: app.querySelector("#warning"),
    cards: app.querySelector(".cards"),
    viewButtons: [...app.querySelectorAll("[data-view]")],
  };
  panels = [0, 1].map(buildPanel);
  refs.viewButtons.forEach((button) => button.addEventListener("click", () => {
    mobileView = button.dataset.view;
    renderViewSwitch();
  }));
  refs.toolbar.addEventListener("click", onToolbarClick);
  const customInput = refs.toolbar.querySelector("#custom-level");
  customInput.addEventListener("input", () => setBothLevelsFromBox(customInput, false));
  customInput.addEventListener("change", () => setBothLevelsFromBox(customInput, true));
  customInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") customInput.blur();
  });
  refs.hero.addEventListener("click", onCopyClick);
}

function buildPanel(index) {
  const root = app.querySelector(`.card[data-side="${index}"]`);
  const out = (name) => root.querySelector(`[data-out="${name}"]`);
  const panel = { root, out, pickers: {}, moves: [], moveTypes: [], boosts: {} };
  const side = () => state.sides[index];
  const mount = (name, options) => {
    const picker = new Picker(options);
    root.querySelector(`[data-mount="${name}"]`).append(picker.button);
    return picker;
  };

  panel.pickers.species = mount("species", { label: `Novaling ${index + 1}`, placeholder: "Choose a Novaling", onSelect: (value) => changeSpecies(index, value) });
  panel.pickers.ability = mount("ability", { label: "Ability", onSelect: (value) => { side().ability = value; side().entryActive = false; render(); } });
  panel.pickers.item = mount("item", { label: "Item", onSelect: (value) => {
    side().item = value;
    if (value === "type-boost" && !side().typeBoost) side().typeBoost = dataset.types[0] || "";
    render();
  } });
  panel.pickers.status = mount("status", { label: "Status", searchable: false, onSelect: (value) => { side().status = value; render(); } });
  panel.pickers.typeBoost = mount("typeBoost", { label: "Boosted type", onSelect: (value) => { side().typeBoost = value; render(); } });
  panel.pickers.type1 = mount("type1", { label: "Type 1", onSelect: (value) => setType(index, 0, value) });
  panel.pickers.type2 = mount("type2", { label: "Type 2", onSelect: (value) => setType(index, 1, value) });
  panel.pickers.item.setOptions(itemOptions());
  for (const stat of ["attack", "defense", "speed"]) {
    panel.boosts[stat] = mount(`boost.${stat}`, { label: `${STAT_LABELS[stat]} stage`, placeholder: "—", searchable: false, onSelect: (value) => { side().boosts[stat] = Number(value); render(); } });
    panel.boosts[stat].setOptions(STAGE_OPTIONS);
  }
  for (let slot = 0; slot < 4; slot += 1) {
    panel.moves.push(mount(`move.${slot}`, { label: `Move ${slot + 1}`, onSelect: (value) => {
      side().moves[slot] = newMoveSlot(value);
      if (value) state.selected = { side: index, slot };
      render({ forceInputs: true });
    } }));
    panel.moveTypes.push(mount(`movetype.${slot}`, { label: `Move ${slot + 1} type`, onSelect: (value) => {
      const move = side().moves[slot];
      move.type = value === moveById(move.id)?.type ? null : value;
      render();
    } }));
    panel.moveTypes[slot].setOptions(typeOptions("Typeless"));
  }

  root.addEventListener("input", (event) => onFieldInput(index, event.target, false));
  root.addEventListener("change", (event) => onFieldInput(index, event.target, true));
  root.addEventListener("click", (event) => {
    const select = event.target.closest("[data-select]");
    if (select) {
      state.selected = { side: index, slot: Number(select.dataset.select) };
      render();
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "reset-side") state.sides[index] = newSide(state.defaultLevel);
    else if (action === "hp-third" && speciesOf(side())) side().hp = Math.max(1, Math.floor(maxHpOf(side()) / 3));
    else return;
    render({ forceInputs: true });
  });
  return panel;
}

// --- Editing --------------------------------------------------------------------------------

function changeSpecies(index, value) {
  const side = state.sides[index];
  if (value === side.species) return;
  // A new Novaling starts with moves, ability and item at None. Level, IVs and stages stay.
  Object.assign(side, {
    species: value,
    base: { hp: null, attack: null, defense: null, speed: null },
    types: null,
    ability: "",
    item: "none",
    typeBoost: "",
    hp: null,
    entryActive: false,
    status: "none",
    moves: [newMoveSlot(), newMoveSlot(), newMoveSlot(), newMoveSlot()],
  });
  render({ forceInputs: true });
}

function setType(index, position, value) {
  const side = state.sides[index];
  const [type1, type2] = typesOf(side);
  const next = position === 0 ? [value, type2 === value ? "" : type2] : [type1, value === type1 ? "" : value];
  const monster = speciesOf(side);
  side.types = monster && next[0] === monster.type1 && next[1] === (monster.type2 || "") ? null : next;
  render();
}

// Keeps a damaged Novaling at the same share of its HP when its max HP changes.
function withHpRatioKept(side, change) {
  if (!speciesOf(side) || side.hp === null) {
    change();
    return;
  }
  const ratio = side.hp / maxHpOf(side);
  change();
  side.hp = Math.max(1, Math.floor(ratio * maxHpOf(side)));
}

function onFieldInput(index, target, committed) {
  const field = target.dataset?.field;
  if (!field) return;
  const side = state.sides[index];
  const [group, key, sub] = field.split(".");
  if (target.type === "checkbox") {
    if (group === "entry") side.entryActive = target.checked;
    if (group === "move" && sub === "crit") side.moves[Number(key)].crit = target.checked;
    render();
    return;
  }
  const whole = parseWhole(target.value);
  const min = Number(target.min);
  const max = Number(target.max || Infinity);
  const blank = String(target.value).trim() === "";
  target.classList.toggle("is-invalid", !committed && !blank && (whole === null || whole < min || whole > max));
  // Blank clears the field back to its default. Out-of-range values clamp, and are written back on leaving the box.
  const value = blank || whole === null ? null : clamp(whole, min, max);

  // A blank level box keeps the last level, and shows it again on leaving the box.
  if (group === "level") withHpRatioKept(side, () => { if (value !== null) side.level = value; });
  else if (group === "base") withHpRatioKept(side, () => { side.base[key] = value === speciesOf(side)?.[key] ? null : value; });
  else if (group === "iv") withHpRatioKept(side, () => { side.ivs[key] = value; });
  else if (group === "hp") side.hp = value === null || value >= maxHpOf(side) ? null : value;
  else if (group === "hpPercent") side.hp = value === null || value >= 100 ? null : Math.max(1, Math.floor((maxHpOf(side) * value) / 100));
  else if (group === "move" && sub === "power") {
    const slot = side.moves[Number(key)];
    slot.power = value === moveById(slot.id)?.power ? null : value;
  }
  render({ forceInputs: committed });
}

function setInput(element, value, force) {
  if (!force && document.activeElement === element) return;
  if (element.type === "checkbox") element.checked = value;
  else element.value = value ?? "";
  element.classList.remove("is-invalid");
}

// --- Rendering ------------------------------------------------------------------------------

function koClass(entry) {
  if (!entry?.ko || entry.result.typeMultiplier === 0 || entry.ko.hits === 0) return "ko-none";
  const { hits, chance } = entry.ko;
  if (hits === 1) return chance === 1 ? "ko-sure" : "ko-chance";
  if (hits === 2) return "ko-two";
  return "ko-far";
}

function renderPanel(index, forceInputs, computed) {
  const side = state.sides[index];
  const foe = state.sides[1 - index];
  const panel = panels[index];
  const { root, out, pickers } = panel;
  const field = (name) => root.querySelector(`[data-field="${name}"]`);
  const monster = speciesOf(side);
  const hasSpecies = Boolean(monster);
  const types = typesOf(side);
  const ability = abilityOf(side);
  const kind = abilityKind(side);

  const attacking = state.selected.side === index && Boolean(computed[index][state.selected.slot]);
  const defending = state.selected.side !== index && Boolean(computed[1 - index][state.selected.slot]);
  out("role").textContent = attacking ? "Attacking" : defending ? "Defending" : "";
  out("role").hidden = !attacking && !defending;
  out("role").classList.toggle("role-attacking", attacking);

  pickers.species.setValue(side.species);
  out("metawrap").hidden = !hasSpecies;
  out("typechips").innerHTML = types.filter(Boolean).map(typeChip).join("");
  pickers.type1.setValue(types[0]);
  pickers.type2.setValue(types[1] || "");

  setInput(field("level"), side.level, forceInputs);
  for (const key of STAT_KEYS) {
    const base = field(`base.${key}`);
    base.disabled = !hasSpecies;
    setInput(base, hasSpecies ? baseStat(side, key) : "", forceInputs);
    base.classList.toggle("is-edited", side.base[key] !== null);
    const iv = field(`iv.${key}`);
    iv.disabled = !hasSpecies;
    setInput(iv, side.ivs[key], forceInputs);
    const valueOut = out(`stat.${key}`);
    if (!hasSpecies) {
      valueOut.textContent = "—";
      valueOut.className = "stat-value muted";
    } else if (key === "hp") {
      valueOut.textContent = maxHpOf(side);
      valueOut.className = "stat-value";
    } else {
      const final = effectiveValue(index, key);
      const raw = rawStat(side, key);
      valueOut.textContent = final;
      valueOut.className = `stat-value${final > raw ? " is-up" : final < raw ? " is-down" : ""}`;
    }
    if (key !== "hp") {
      panel.boosts[key].setValue(String(side.boosts[key]));
      panel.boosts[key].setDisabled(!hasSpecies);
    }
  }

  pickers.ability.setOptions(abilityOptions(side));
  pickers.ability.setValue(side.ability);
  pickers.ability.setDisabled(!hasSpecies);
  out("abilitytext").hidden = !ability;
  out("abilitytext").textContent = ability ? `${ability.name}: ${ability.text}` : "";
  const entryLabel = { intimidate: "Intimidate triggered: foe's Attack −1", quickfeet: "Entry boost triggered: own Speed +1" }[kind];
  out("entrywrap").hidden = !entryLabel;
  out("entrytext").textContent = entryLabel || "";
  setInput(field("entry"), side.entryActive, forceInputs);

  pickers.item.setValue(side.item);
  pickers.item.setDisabled(!hasSpecies);
  out("itemtext").hidden = side.item === "none";
  out("itemtext").textContent = side.item === "none" ? "" : `${itemName(side.item)}: ${ITEMS.find((item) => item.id === side.item)?.text}`;
  out("boostwrap").hidden = side.item !== "type-boost";
  pickers.typeBoost.setValue(side.typeBoost);

  const statuses = statusOptions(side);
  if (statuses.find((entry) => entry.value === side.status)?.disabled) side.status = "none";
  pickers.status.setOptions(statuses);
  pickers.status.setValue(side.status);
  pickers.status.setDisabled(!hasSpecies);

  const hpInput = field("hp");
  const hpPercentInput = field("hpPercent");
  hpInput.disabled = !hasSpecies;
  hpPercentInput.disabled = !hasSpecies;
  if (hasSpecies) {
    const maxHp = maxHpOf(side);
    const currentHp = currentHpOf(side);
    const hpPercent = Math.max(1, Math.round((currentHp / maxHp) * 100));
    hpInput.max = maxHp;
    hpInput.placeholder = maxHp;
    setInput(hpInput, side.hp === null ? "" : currentHp, forceInputs);
    setInput(hpPercentInput, side.hp === null ? "" : hpPercent, forceInputs);
    out("hpmax").textContent = `/ ${maxHp}`;
    out("hpbar").style.width = `${(currentHp / maxHp) * 100}%`;
    out("hpbar").dataset.level = hpPercent > 50 ? "good" : hpPercent > 20 ? "mid" : "low";
    out("hpbarwrap").setAttribute("aria-label", `${hpPercent}% HP`);
  } else {
    hpInput.placeholder = "";
    setInput(hpInput, "", true);
    setInput(hpPercentInput, "", true);
    out("hpmax").textContent = "/ —";
    out("hpbar").style.width = "0";
  }
  const surge = hasSpecies && kind === "surge" && currentHpOf(side) * 3 <= maxHpOf(side);
  out("surgetext").hidden = !surge;
  out("surgetext").textContent = surge ? `${ability.name} active: ${ability.type} moves ×1.5.` : "";

  const options = moveOptions(side);
  side.moves.forEach((slot, slotIndex) => {
    panel.moves[slotIndex].setOptions(options);
    panel.moves[slotIndex].setValue(slot.id);
    const row = root.querySelector(`[data-move="${slotIndex}"]`);
    const move = resolvedMove(slot);
    const entry = computed[index][slotIndex];
    const selected = state.selected.side === index && state.selected.slot === slotIndex && Boolean(move);
    row.classList.toggle("is-selected", selected);

    const resultButton = row.querySelector(".move-result");
    resultButton.hidden = !entry;
    resultButton.className = `move-result ${koClass(entry)}`;
    resultButton.setAttribute("aria-pressed", String(selected));
    if (entry) {
      let range = "Status";
      let note = "No direct damage";
      if (entry.result.kind === "damage") {
        const foeMax = maxHpOf(foe);
        range = entry.result.typeMultiplier === 0 ? "0%" : `${percent(entry.result.min, foeMax)}–${percent(entry.result.max, foeMax)}%`;
        note = entry.result.typeMultiplier === 0 ? "No effect" : entry.ko.text || "Can't KO within 9 hits";
      }
      resultButton.querySelector(".move-range").textContent = range;
      resultButton.querySelector(".move-ko").textContent = note;
    }

    const extra = row.querySelector(".move-extra");
    extra.hidden = !selected;
    if (selected) {
      const canHit = move.category === "damage";
      const powerInput = field(`move.${slotIndex}.power`);
      powerInput.disabled = !canHit;
      setInput(powerInput, move.power, forceInputs);
      powerInput.classList.toggle("is-edited", slot.power !== null);
      panel.moveTypes[slotIndex].setValue(move.type);
      const critBox = field(`move.${slotIndex}.crit`);
      critBox.disabled = !canHit;
      setInput(critBox, slot.crit, forceInputs);
      const learnset = side.species ? legalMoves(side.species, side.level).find((learned) => learned.move.id === move.id) : null;
      const legality = !side.species || move.id === STRUGGLE.id ? "" : !learnset ? " · Not in learnset" : !learnset.learned ? ` · Learned at Lv ${learnset.level}` : "";
      const blocked = side.item === "vest" && !canHit ? " · Blocked by Vest in battle" : "";
      row.querySelector(".move-info").textContent = `${moveInfo(move)}${blocked}${legality}`;
    }
  });
}

function effectivenessLabel(multiplier) {
  if (multiplier === 0) return ["No effect", "eff-zero"];
  if (multiplier > 1) return [`Super effective ×${multiplier}`, "eff-good"];
  if (multiplier < 1) return [`Resisted ×${multiplier}`, "eff-bad"];
  return ["Neutral ×1", ""];
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
  if (defenderSide.item === "eviolite") chips.push(speciesOf(defenderSide).evolvesTo ? "Eviolite Style: Defense ×1.5" : "Eviolite Style: no effect, can't evolve");
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

function emptyMessage() {
  const chosen = state.sides.filter((side) => speciesOf(side)).length;
  if (chosen < 2) return ["Choose two Novalings", "Then pick a move to see how much damage it does."];
  return ["Choose a move", "Damage appears as soon as either Novaling has a move."];
}

function renderResult(entry) {
  if (!entry) {
    const [title, text] = emptyMessage();
    refs.hero.innerHTML = `<div class="hero-empty"><strong>${title}</strong><span>${text}</span></div>`;
    refs.details.hidden = true;
    refs.details.innerHTML = "";
    return;
  }
  const defenderSide = state.sides[1 - entry.attackerIndex];
  const defender = speciesOf(defenderSide).name;
  const attacker = speciesOf(state.sides[entry.attackerIndex]).name;
  const line = escapeHtml(calculationLine(entry));
  const { result, move } = entry;

  if (result.kind !== "damage") {
    refs.hero.innerHTML = `
      <div class="hero-top"><div class="hero-figure"><span class="hero-number">—</span><span class="hero-sub">${escapeHtml(attacker)}'s ${escapeHtml(move.name)} deals no direct damage</span></div></div>
      <p class="hero-line">${typeChip(move.type)} ${escapeHtml(moveInfo(move))}</p>`;
    refs.details.hidden = true;
    refs.details.innerHTML = "";
    return;
  }

  const maxHp = maxHpOf(defenderSide);
  const currentHp = currentHpOf(defenderSide);
  const immune = result.typeMultiplier === 0;
  const remainingMax = Math.max(0, currentHp - result.min);
  const remainingMin = Math.max(0, currentHp - result.max);
  const segment = (value) => (value / maxHp) * 100;
  const koText = immune ? "No effect" : entry.ko.text || "Can't KO within 9 hits";
  refs.hero.innerHTML = `
    <div class="hero-top">
      <div class="hero-figure">
        <span class="hero-number">${immune ? "0" : `${result.min}–${result.max}`}</span>
        <span class="hero-sub">${immune ? "0" : `${percent(result.min, maxHp)}–${percent(result.max, maxHp)}`}% of ${escapeHtml(defender)}'s HP</span>
      </div>
      <span class="ko-pill ${koClass(entry)}">${escapeHtml(koText)}</span>
      <button type="button" class="btn" id="copy-result">Copy</button>
    </div>
    <div class="bar bar-damage" role="img" aria-label="${escapeHtml(defender)} would be left with ${remainingMin} to ${remainingMax} of ${maxHp} HP">
      <i class="bar-safe" style="width:${segment(remainingMin)}%"></i><i class="bar-variable" style="width:${segment(remainingMax - remainingMin)}%"></i>
    </div>
    <p class="hero-line" id="result-line">${line}</p>`;

  const [effectText, effectClass] = effectivenessLabel(result.typeMultiplier);
  const distinct = [...new Set(result.rolls.map((roll) => roll.damage))];
  const koCells = entry.ko.table.map(({ hits, chance }) => `<div class="ko-cell ${chance === 1 ? "is-sure" : chance > 0 ? "is-possible" : ""}"><small>${hits === 1 ? "OHKO" : `${hits}HKO`}</small><strong>${formatChance(chance)}</strong></div>`).join("");
  const notes = [];
  const attackerSide = state.sides[entry.attackerIndex];
  if (attackerSide.item === "life-orb") notes.push(`${attacker} loses ${Math.floor(maxHpOf(attackerSide) / 10)} HP per hit from its item.`);
  if (abilityKind(defenderSide) === "regrow") notes.push("Regrow's healing isn't counted: the rules don't define how much it heals.");
  if (move.accuracy < 100 && move.id !== STRUGGLE.id) notes.push(`KO odds assume every hit lands. ${move.name} has ${move.accuracy} accuracy.`);
  if (defenderSide.status === "burn" || defenderSide.status === "poison") notes.push(`KO odds include ${defenderSide.status} damage between hits.`);
  const rollsOpen = refs.details.querySelector(".more")?.open ? "open" : "";

  refs.details.hidden = false;
  refs.details.innerHTML = `
    <div class="details-grid">
      <div>
        <h3 class="section-title">Knockout chance</h3>
        ${immune ? `<p class="hint">It can't damage ${escapeHtml(defender)}.</p>` : `<div class="ko-table">${koCells}</div>`}
      </div>
      <div>
        <h3 class="section-title">Modifiers</h3>
        <div class="chips"><span class="chip ${effectClass}">${effectText}</span>${modifierChips(entry).map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")}</div>
        <p class="hint">Attack ${result.attack} vs. Defense ${result.defense}. ${escapeHtml(defender)} left on ${remainingMin === remainingMax ? remainingMin : `${remainingMin}–${remainingMax}`} of ${maxHp} HP.</p>
      </div>
    </div>
    ${notes.map((note) => `<p class="hint">${escapeHtml(note)}</p>`).join("")}
    <details class="more" ${rollsOpen}>
      <summary>All damage rolls and the calculation</summary>
      <div class="rolls">${result.rolls.map(({ random, damage }) => `<div class="roll ${damage >= currentHp && damage > 0 ? "is-ko" : ""}"><small>${random}</small><span>${damage}</span></div>`).join("")}</div>
      <p class="hint">Possible damage amounts: (${distinct.join(", ")})</p>
      <ul class="trace">${result.trace.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></li>`).join("")}</ul>
    </details>`;
}

function renderToolbar() {
  // As on Showdown, the chosen button stays lit even if one side's level is then edited by hand.
  refs.toolbar.querySelectorAll("[data-level]").forEach((button) => {
    const active = !customLevelOpen && state.defaultLevel === Number(button.dataset.level);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const customButton = refs.toolbar.querySelector("[data-custom-level]");
  customButton.classList.toggle("is-active", customLevelOpen);
  customButton.setAttribute("aria-pressed", String(customLevelOpen));
  const customInput = refs.toolbar.querySelector("#custom-level");
  customInput.hidden = !customLevelOpen;
  if (document.activeElement !== customInput) {
    customInput.value = LEVEL_PRESETS.includes(state.defaultLevel) ? "" : state.defaultLevel;
    customInput.classList.remove("is-invalid");
  }

  const speedOut = refs.toolbar.querySelector(".toolbar-speed");
  const ready = state.sides.every((side) => speciesOf(side));
  speedOut.hidden = !ready;
  if (ready) {
    const speeds = [effectiveValue(0, "speed"), effectiveValue(1, "speed")];
    const names = state.sides.map((side) => speciesOf(side).name);
    const verdict = speeds[0] === speeds[1] ? "Speed tie" : `${escapeHtml(names[speeds[0] > speeds[1] ? 0 : 1])} moves first`;
    speedOut.innerHTML = `<strong>${verdict}</strong> <span class="muted">${speeds[0]} vs. ${speeds[1]} Speed</span>`;
  }
}

function renderViewSwitch() {
  refs.cards.dataset.viewActive = mobileView;
  refs.viewButtons.forEach((button) => {
    const active = button.dataset.view === mobileView;
    const index = Number(button.dataset.view);
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.textContent = speciesOf(state.sides[index])?.name || `Novaling ${index + 1}`;
  });
}

function render({ forceInputs = false } = {}) {
  const computed = [0, 1].map((index) => state.sides[index].moves.map((_, slot) => compute(index, slot)));
  const entry = selectedEntry(computed);
  panels.forEach((_, index) => renderPanel(index, forceInputs, computed));
  renderResult(entry);
  renderToolbar();
  renderViewSwitch();
  refs.warning.hidden = !source.warning;
  refs.warning.textContent = source.warning;
}

function onCopyClick(event) {
  const button = event.target.closest("#copy-result");
  if (!button) return;
  const finish = (label) => {
    button.textContent = label;
    setTimeout(() => { button.textContent = "Copy"; }, 1400);
  };
  navigator.clipboard.writeText(refs.hero.querySelector("#result-line").textContent).then(() => finish("Copied"), () => finish("Copy failed"));
}

function setBothLevels(level) {
  state.defaultLevel = level;
  for (const side of state.sides) withHpRatioKept(side, () => { side.level = level; });
}

// While typing, a blank or partial value waits; on leaving the box an out-of-range value is clamped to 1-100.
function setBothLevelsFromBox(input, committed) {
  const whole = parseWhole(input.value);
  input.classList.toggle("is-invalid", !committed && input.value !== "" && (whole === null || whole < 1 || whole > 100));
  if (whole === null) return;
  const level = clamp(whole, 1, 100);
  setBothLevels(level);
  if (committed) input.value = level;
  render({ forceInputs: true });
}

function onToolbarClick(event) {
  if (event.target.closest("[data-custom-level]")) {
    customLevelOpen = true;
    render();
    refs.toolbar.querySelector("#custom-level").focus();
    return;
  }
  const levelButton = event.target.closest("[data-level]");
  if (levelButton) {
    customLevelOpen = false;
    setBothLevels(Number(levelButton.dataset.level));
    render({ forceInputs: true });
    return;
  }
  const action = event.target.closest("[data-toolbar]")?.dataset.toolbar;
  if (action === "swap") {
    state.sides.reverse();
    state.selected = { ...state.selected, side: 1 - state.selected.side };
  } else if (action === "clear-boosts") {
    for (const side of state.sides) side.boosts = { attack: 0, defense: 0, speed: 0 };
  } else if (action === "reset") {
    state = initialState();
    customLevelOpen = false;
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

// Selections survive a data reload; anything the new data no longer has goes back to blank.
function keepValidSelections() {
  for (const side of state.sides) {
    if (side.species && !monsterById(side.species)) Object.assign(side, newSide(state.defaultLevel));
    if (side.ability && !findAbility(dataset.abilities, side.ability)) side.ability = "";
    side.moves = side.moves.map((slot) => (moveById(slot.id) ? slot : newMoveSlot()));
  }
}

async function load() {
  const firstLoad = !dataset;
  sourceStatus.textContent = "Loading…";
  const reloadButton = document.querySelector("#reload-data");
  if (reloadButton) {
    reloadButton.disabled = true;
    reloadButton.textContent = "Loading…";
  }
  try {
    const loaded = await loadDataset();
    dataset = loaded.dataset;
    source = { label: loaded.label, warning: loaded.warning };
  } catch (error) {
    if (firstLoad) {
      showLoadError(error);
      return;
    }
    source = { ...source, warning: `Reload failed: ${error.message} The data already loaded is still in use.` };
    sourceStatus.textContent = source.label;
    render();
    restoreReloadButton();
    return;
  }
  if (!state) state = initialState();
  keepValidSelections();
  if (!document.querySelector(".cards")) buildLayout();
  panels.forEach((panel) => {
    panel.pickers.species.setOptions(speciesOptions());
    panel.pickers.typeBoost.setOptions(typeOptions());
    panel.pickers.type1.setOptions(typeOptions());
    panel.pickers.type2.setOptions(typeOptions("None"));
  });
  sourceStatus.textContent = source.label;
  render({ forceInputs: true });
  restoreReloadButton();
}

function restoreReloadButton() {
  const button = document.querySelector("#reload-data");
  if (button) {
    button.disabled = false;
    button.textContent = "Reload data";
  }
}

load();
