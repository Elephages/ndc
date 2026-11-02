import {
  calculateDamage,
  calculateStat,
  normalizeAbility,
  normalizeMonster,
  normalizeMove,
} from "./core.js";

const config = window.NOVALINGS_CONFIG || { googleSheetId: "", sheets: {} };
const sheetNames = {
  monsters: config.sheets?.monsters || "Monsters",
  moves: config.sheets?.moves || "Moves",
  abilities: config.sheets?.abilities || "Abilities",
  typeChart: config.sheets?.typeChart || "Type Chart",
};

const elements = {
  sourceStatus: document.querySelector("#source-status"),
  notice: document.querySelector("#data-notice"),
  attackerResultRows: document.querySelector("#attacker-result-rows"),
  defenderResultRows: document.querySelector("#defender-result-rows"),
  reload: document.querySelector("#reload-data"),
  attacker: document.querySelector("#attacker-select"),
  defender: document.querySelector("#defender-select"),
  move: document.querySelector("#move-select"),
  attackerPreview: document.querySelector("#attacker-preview"),
  defenderPreview: document.querySelector("#defender-preview"),
  movePreview: document.querySelector("#move-preview"),
  attackerLevel: document.querySelector("#attacker-level"),
  defenderLevel: document.querySelector("#defender-level"),
  attackerAttackIv: document.querySelector("#attacker-attack-iv"),
  attackerHpIv: document.querySelector("#attacker-hp-iv"),
  defenderDefenseIv: document.querySelector("#defender-defense-iv"),
  defenderHpIv: document.querySelector("#defender-hp-iv"),
  attackerStage: document.querySelector("#attacker-stage"),
  defenderStage: document.querySelector("#defender-stage"),
  attackerHpState: document.querySelector("#attacker-hp-state"),
  attackerStatus: document.querySelector("#attacker-status"),
  attackerItem: document.querySelector("#attacker-item"),
  defenderItem: document.querySelector("#defender-item"),
  typeBoost: document.querySelector("#attacker-type-boost"),
  typeBoostWrap: document.querySelector("#attacker-type-boost-wrap"),
  critical: document.querySelector("#critical-hit"),
  supportMessage: document.querySelector("#support-message"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  damageRange: document.querySelector("#damage-range"),
  damagePercent: document.querySelector("#damage-percent"),
  typeMultiplier: document.querySelector("#type-multiplier"),
  stabState: document.querySelector("#stab-state"),
  accuracy: document.querySelector("#accuracy"),
  abilityState: document.querySelector("#ability-state"),
  rolls: document.querySelector("#damage-rolls"),
  trace: document.querySelector("#calculation-trace"),
  attackerMoveSlots: [...document.querySelectorAll(".attacker-move")],
  defenderMoveSlots: [...document.querySelectorAll(".defender-move")],
};

let dataset = { monsters: [], moves: [], abilities: [], typeChart: {} };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function setSelectOptions(select, records, selectedId, label) {
  select.innerHTML = records.map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(label(record))}</option>`).join("");
  if (selectedId && records.some((record) => record.id === selectedId)) select.value = selectedId;
}

function selected(records, select) {
  return records.find((record) => record.id === select.value) || records[0];
}

function fillStages() {
  const values = Array.from({ length: 13 }, (_, index) => index - 6);
  for (const select of [elements.attackerStage, elements.defenderStage]) {
    setSelectOptions(select, values.map((value) => ({ id: String(value), value })), "0", (option) => `${option.value > 0 ? "+" : ""}${option.value}`);
  }
}

function fillItems() {
  setSelectOptions(elements.attackerItem, [
    ["none", "None"],
    ["all-damage", "All damage moves ×1.2"],
    ["type-boost", "One move type ×1.2"],
    ["life-orb", "Life-orb style ×1.3"],
    ["choice-attack", "Choice Attack ×1.5"],
    ["choice-speed", "Choice Speed ×1.5 (no damage change)"],
    ["speed-item", "Speed item ×1.2 (no damage change)"],
  ].map(([id, name]) => ({ id, name })), "none", (item) => item.name);
  setSelectOptions(elements.defenderItem, [
    ["none", "None"],
    ["vest", "Vest: Defense ×1.5"],
    ["eviolite", "Eviolite style: Defense ×1.5 if it evolves"],
  ].map(([id, name]) => ({ id, name })), "none", (item) => item.name);
}

function typeText(monster) {
  return [monster.type1, monster.type2].filter(Boolean).join(" / ");
}

function renderPreviews(attacker, defender, move) {
  const attackerHp = calculateStat(attacker.hp, clamp(elements.attackerHpIv.value, 0, 31, 15), clamp(elements.attackerLevel.value, 1, 100, 50), true);
  const attackerAttack = calculateStat(attacker.attack, clamp(elements.attackerAttackIv.value, 0, 31, 15), clamp(elements.attackerLevel.value, 1, 100, 50));
  const defenderHp = calculateStat(defender.hp, clamp(elements.defenderHpIv.value, 0, 31, 15), clamp(elements.defenderLevel.value, 1, 100, 50), true);
  const defenderDefense = calculateStat(defender.defense, clamp(elements.defenderDefenseIv.value, 0, 31, 15), clamp(elements.defenderLevel.value, 1, 100, 50));
  elements.attackerPreview.innerHTML = `<strong>${escapeHtml(typeText(attacker))}</strong><br>Base: ${attacker.hp} HP · ${attacker.attack} Atk · ${attacker.defense} Def · ${attacker.speed} Spe<br>At this level: ${attackerHp} HP · ${attackerAttack} Atk`;
  elements.defenderPreview.innerHTML = `<strong>${escapeHtml(typeText(defender))}</strong><br>Base: ${defender.hp} HP · ${defender.attack} Atk · ${defender.defense} Def · ${defender.speed} Spe<br>At this level: ${defenderHp} HP · ${defenderDefense} Def`;
  elements.movePreview.innerHTML = `<strong>${escapeHtml(move.type)} · ${escapeHtml(move.category === "damage" ? "Damage" : "Support")}</strong><br>${move.category === "damage" ? `${move.power} power · ${move.accuracy} accuracy · ${move.pp} PP` : `${move.accuracy} accuracy · ${move.pp} PP`}${move.effect ? `<br>${escapeHtml(move.effect)}` : ""}`;
}

function renderTrace(trace) {
  elements.trace.innerHTML = `<ul class="trace-list">${trace.map(([label, value]) => `<li><b>${escapeHtml(label)}</b><span>${escapeHtml(value)}</span></li>`).join("")}</ul>`;
}

function moveLabel(move) {
  return move.category === "damage" ? `${move.type} · ${move.power} BP` : `${move.type} · Status`;
}

function renderMoveSlots() {
  const renderMeta = (slot, side) => {
    const move = selected(dataset.moves, slot);
    const target = document.querySelector(`#${side}-move-meta-${slot.dataset.slot}`);
    if (target) target.textContent = move ? moveLabel(move) : "—";
    return move;
  };
  const renderRows = (slots, side, target) => {
    const moves = slots.map((slot) => renderMeta(slot, side));
    target.innerHTML = moves.map((move, index) => `<div class="result-row"><b>${index + 1}. ${escapeHtml(move?.name || "—")}</b><span>${escapeHtml(move ? moveLabel(move) : "—")}</span></div>`).join("");
  };
  renderRows(elements.attackerMoveSlots, "attacker", elements.attackerResultRows);
  renderRows(elements.defenderMoveSlots, "defender", elements.defenderResultRows);
}

function renderCalculation() {
  const attacker = selected(dataset.monsters, elements.attacker);
  const defender = selected(dataset.monsters, elements.defender);
  const move = selected(dataset.moves, elements.move);
  if (!attacker || !defender || !move) return;

  renderPreviews(attacker, defender, move);
  renderMoveSlots();
  elements.typeBoostWrap.hidden = elements.attackerItem.value !== "type-boost";
  const result = calculateDamage({
    attacker,
    defender,
    move,
    abilities: dataset.abilities,
    typeChart: dataset.typeChart,
    attackerLevel: clamp(elements.attackerLevel.value, 1, 100, 50),
    defenderLevel: clamp(elements.defenderLevel.value, 1, 100, 50),
    attackerAttackIv: clamp(elements.attackerAttackIv.value, 0, 31, 15),
    attackerHpIv: clamp(elements.attackerHpIv.value, 0, 31, 15),
    defenderDefenseIv: clamp(elements.defenderDefenseIv.value, 0, 31, 15),
    defenderHpIv: clamp(elements.defenderHpIv.value, 0, 31, 15),
    attackerStage: Number(elements.attackerStage.value),
    defenderStage: Number(elements.defenderStage.value),
    critical: elements.critical.checked,
    attackerBurned: elements.attackerStatus.value === "burn",
    attackerLowHp: elements.attackerHpState.value === "low",
    attackerItem: elements.attackerItem.value,
    defenderItem: elements.defenderItem.value,
    typeBoost: elements.typeBoost.value,
  });

  const isSupport = result.kind === "support";
  elements.supportMessage.hidden = !isSupport;
  if (isSupport) {
    elements.resultTitle.textContent = `${move.name} is a support move`;
    elements.resultSummary.textContent = "It is kept in the editable move library, but the supplied prototype does not give support moves direct damage.";
    elements.damageRange.textContent = "—";
    elements.damagePercent.textContent = "No direct damage";
    elements.typeMultiplier.textContent = "—";
    elements.stabState.textContent = "Not applicable";
    elements.accuracy.textContent = `${move.accuracy}`;
    elements.abilityState.textContent = "Accuracy threshold";
    elements.rolls.innerHTML = "";
    renderTrace([["Move category", "Support / Status"], ["Effect", move.effect || "No effect note supplied"]]);
    return;
  }

  const lowPercent = result.defenderHp ? ((result.min / result.defenderHp) * 100).toFixed(1) : "0.0";
  const highPercent = result.defenderHp ? ((result.max / result.defenderHp) * 100).toFixed(1) : "0.0";
  elements.resultTitle.textContent = `${attacker.name} → ${defender.name}`;
  elements.resultSummary.textContent = `${move.name} has ${result.rolls.length} possible random rolls under the current settings.`;
  elements.damageRange.textContent = `${result.min}–${result.max}`;
  elements.damagePercent.textContent = `${lowPercent}–${highPercent}% of ${result.defenderHp} HP`;
  elements.typeMultiplier.textContent = `×${result.typeMultiplier}`;
  elements.stabState.textContent = result.hasStab ? "STAB ×1.5 active" : "No STAB";
  elements.accuracy.textContent = `${move.accuracy}`;
  elements.abilityState.textContent = `${result.surgeActive ? "Surge ×1.5" : "No ability boost"}${result.itemMultiplier > 1 ? ` · item ×${result.itemMultiplier}` : ""}`;
  elements.rolls.innerHTML = result.rolls.map(({ random, damage }) => `<div class="roll"><span>${random}</span>${damage}</div>`).join("");
  renderTrace(result.trace);
}

async function bundledData() {
  const readJson = (name) => fetch(`./${name}.json`).then((response) => {
    if (response.ok) return response.json();
    return fetch(`./data/${name}.json`).then((fallback) => fallback.json());
  });
  const [monsters, moves, abilities, typeChart] = await Promise.all([
    readJson("monsters"),
    readJson("moves"),
    readJson("abilities"),
    readJson("type-chart"),
  ]);
  return {
    monsters: monsters.map(normalizeMonster),
    moves: moves.map(normalizeMove),
    abilities: abilities.map(normalizeAbility),
    typeChart,
  };
}

function gvizRows(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("Google Sheets returned an unexpected response.");
  const table = JSON.parse(text.slice(start, end + 1)).table;
  const headers = table.cols.map((column, index) => column.label || `Column ${index + 1}`);
  return table.rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row.c[index]?.v ?? ""])));
}

async function googleSheetRows(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.googleSheetId)}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the ${sheetName} tab.`);
  return gvizRows(await response.text());
}

function typeChartFromRows(rows) {
  if (!rows.length) return {};
  const attackColumn = Object.keys(rows[0])[0];
  return Object.fromEntries(rows.map((row) => [
    row[attackColumn],
    Object.fromEntries(Object.entries(row).filter(([header]) => header !== attackColumn).map(([header, value]) => [header, Number(value)])),
  ]));
}

async function googleSheetData() {
  const [monsterRows, moveRows, abilityRows, chartRows] = await Promise.all([
    googleSheetRows(sheetNames.monsters),
    googleSheetRows(sheetNames.moves),
    googleSheetRows(sheetNames.abilities),
    googleSheetRows(sheetNames.typeChart),
  ]);
  return {
    monsters: monsterRows.map(normalizeMonster).filter((monster) => monster.id && monster.name),
    moves: moveRows.map(normalizeMove).filter((move) => move.id && move.name),
    abilities: abilityRows.map(normalizeAbility),
    typeChart: typeChartFromRows(chartRows),
  };
}

function setDataset(nextDataset, sourceLabel, notice = "") {
  dataset = {
    ...nextDataset,
    monsters: [...nextDataset.monsters].sort((left, right) => left.name.localeCompare(right.name)),
    moves: [...nextDataset.moves].sort((left, right) => left.name.localeCompare(right.name)),
  };
  const types = Object.keys(dataset.typeChart).sort();
  setSelectOptions(elements.attacker, dataset.monsters, dataset.monsters.find((monster) => monster.name === "Murkit")?.id || dataset.monsters[0]?.id, (monster) => `${monster.name} · ${typeText(monster)}`);
  setSelectOptions(elements.defender, dataset.monsters, dataset.monsters.find((monster) => monster.name === "Glintail")?.id || dataset.monsters[1]?.id, (monster) => `${monster.name} · ${typeText(monster)}`);
  setSelectOptions(elements.move, dataset.moves, dataset.moves.find((move) => move.name === "Shade Claw")?.id || dataset.moves.find((move) => move.category === "damage")?.id, (move) => `${move.name} · ${move.type} · ${move.category === "damage" ? `${move.power} power` : "Support"}`);
  const moveDefaults = ["Shade Claw", "Night Fang", "Body Slam", "Growl"];
  for (const [index, slot] of elements.attackerMoveSlots.entries()) {
    setSelectOptions(slot, dataset.moves, dataset.moves.find((move) => move.name === moveDefaults[index])?.id || dataset.moves[index]?.id, (move) => move.name);
  }
  for (const [index, slot] of elements.defenderMoveSlots.entries()) {
    setSelectOptions(slot, dataset.moves, dataset.moves.find((move) => move.name === ["Dream Crush", "Glimmer", "Lullaby", "Growl"][index])?.id || dataset.moves[index]?.id, (move) => move.name);
  }
  if (elements.attackerMoveSlots[0]) elements.move.value = elements.attackerMoveSlots[0].value;
  setSelectOptions(elements.typeBoost, types.map((type) => ({ id: type, name: type })), types[0], (type) => type.name);
  elements.sourceStatus.textContent = sourceLabel;
  elements.notice.hidden = !notice;
  elements.notice.textContent = notice;
  renderCalculation();
}

async function loadData() {
  elements.sourceStatus.textContent = "Loading battle data…";
  try {
    if (config.googleSheetId) {
      const remote = await googleSheetData();
      setDataset(remote, `Live Google Sheet · ${remote.monsters.length} creatures · ${remote.moves.length} moves`);
      return;
    }
  } catch (error) {
    const fallback = await bundledData();
    setDataset(fallback, `Bundled prototype data · ${fallback.monsters.length} creatures · ${fallback.moves.length} moves`, "The configured Google Sheet could not be read. Check that it is shared for public viewing, then reload. Bundled prototype data is shown instead.");
    return;
  }
  const fallback = await bundledData();
  setDataset(fallback, `Bundled prototype data · ${fallback.monsters.length} creatures · ${fallback.moves.length} moves`, "Using the bundled prototype data. To make your Google Sheet the live backend, add its Sheet ID to config.js.");
}

function listen() {
  fillStages();
  fillItems();
  document.querySelectorAll("select, input").forEach((element) => {
    if (!element.classList.contains("move-slot")) element.addEventListener("input", renderCalculation);
  });
  elements.attackerMoveSlots.forEach((slot) => slot.addEventListener("input", () => {
    elements.move.value = slot.value;
    renderCalculation();
  }));
  elements.defenderMoveSlots.forEach((slot) => slot.addEventListener("input", renderCalculation));
  elements.reload.addEventListener("click", loadData);
}

listen();
loadData();
