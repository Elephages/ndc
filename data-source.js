// Loads balance data from the optional Google Sheet, falling back to the bundled data/ files.
import { isReady, normalizeAbility, normalizeLearnsetEntry, normalizeMonster, normalizeMove } from "./core.js";

const config = window.NOVALINGS_CONFIG || { googleSheetId: "", sheets: {} };
const sheetNames = {
  monsters: config.sheets?.monsters || "Monsters",
  moves: config.sheets?.moves || "Moves",
  abilities: config.sheets?.abilities || "Abilities",
  typeChart: config.sheets?.typeChart || "Type Chart",
  learnsets: config.sheets?.learnsets || "Learnsets",
};

async function readJson(name) {
  const response = await fetch(`./data/${name}.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not read data/${name}.json (HTTP ${response.status}).`);
  return response.json();
}

async function bundledLearnsets() {
  return (await readJson("learnsets")).map(normalizeLearnsetEntry);
}

async function bundledData() {
  const [monsters, moves, abilities, typeChart, learnsets] = await Promise.all([
    readJson("monsters"),
    readJson("moves"),
    readJson("abilities"),
    readJson("type-chart"),
    bundledLearnsets(),
  ]);
  return {
    monsters: monsters.map(normalizeMonster),
    moves: moves.map(normalizeMove),
    abilities: abilities.map(normalizeAbility),
    typeChart,
    learnsets,
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
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(config.googleSheetId)}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(sheetName)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not read the ${sheetName} tab.`);
  return gvizRows(await response.text());
}

function typeChartFromRows(rows) {
  if (!rows.length) return {};
  const attackColumn = Object.keys(rows[0])[0];
  return Object.fromEntries(rows.map((row) => [
    row[attackColumn],
    Object.fromEntries(Object.entries(row).filter(([header]) => header !== attackColumn).map(([header, value]) => [
      header,
      // A blank cell means neutral, not immune.
      value === "" ? 1 : Number(value),
    ])),
  ]));
}

async function googleSheetData() {
  const [monsterRows, moveRows, abilityRows, chartRows, learnsetRows] = await Promise.all([
    googleSheetRows(sheetNames.monsters),
    googleSheetRows(sheetNames.moves),
    googleSheetRows(sheetNames.abilities),
    googleSheetRows(sheetNames.typeChart),
    // Learnsets are optional in the Sheet, so a missing tab must not reject the whole Sheet.
    googleSheetRows(sheetNames.learnsets).catch(() => null),
  ]);
  const monsters = monsterRows.filter(isReady).map(normalizeMonster).filter((monster) => monster.id && monster.name);
  const moves = moveRows.filter(isReady).map(normalizeMove).filter((move) => move.id && move.name);
  if (!monsters.length || !moves.length) throw new Error("The Sheet has no monsters or no moves.");
  return {
    monsters,
    moves,
    abilities: abilityRows.map(normalizeAbility),
    typeChart: typeChartFromRows(chartRows),
    learnsets: learnsetRows ? learnsetRows.map(normalizeLearnsetEntry) : await bundledLearnsets(),
  };
}

function finish(raw, label, warning = "") {
  const dataset = {
    ...raw,
    monsters: [...raw.monsters].sort((left, right) => left.name.localeCompare(right.name)),
    moves: [...raw.moves].sort((left, right) => left.name.localeCompare(right.name)),
    types: Object.keys(raw.typeChart).sort(),
  };
  return { dataset, label: `${label} · ${dataset.monsters.length} Novalings · ${dataset.moves.length} moves`, warning };
}

// Rejects only if no data can be read at all.
export async function loadDataset() {
  if (config.googleSheetId) {
    try {
      return finish(await googleSheetData(), "Live Google Sheet");
    } catch {
      return finish(await bundledData(), "Bundled data", "The configured Google Sheet could not be read. Check that it is shared for public viewing, then reload. Bundled prototype data is shown instead.");
    }
  }
  return finish(await bundledData(), "Bundled data");
}
