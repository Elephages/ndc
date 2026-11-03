import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const outputDir = path.join(projectRoot, "data");

// The CSVs live in the balancer pack, outside this repo. Look in the likely places, and keep
// the committed data/ files when they are absent (for example on the GitHub Pages runner).
const candidates = [process.env.BALANCER_PACK_DIR, path.resolve(projectRoot, ".."), path.resolve(projectRoot, "../..")].filter(Boolean);
let sourceRoot = "";
for (const candidate of candidates) {
  try {
    await fs.access(path.join(candidate, "monsters.csv"));
    sourceRoot = candidate;
    break;
  } catch {
    // Try the next location.
  }
}
if (!sourceRoot) {
  console.log("No balancer pack CSVs found; keeping the committed data/ files. Set BALANCER_PACK_DIR to rebuild them.");
  process.exit(0);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += char;
  }
  if (row.length || field) { row.push(field); rows.push(row); }
  return rows;
}

async function readCsv(name) {
  const rows = parseCsv(await fs.readFile(path.join(sourceRoot, name), "utf8"));
  const headers = rows[0];
  const numeric = new Set(["HP", "Attack", "Defense", "Speed", "Total", "CatchRate", "EvolveLevel", "Power", "Accuracy", "PP", "Chance", "Level"]);
  return rows.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => {
    const value = row[index] ?? "";
    return [header, numeric.has(header) && value !== "" ? Number(value) : value];
  })));
}

const [monsters, moves, abilities, learnsets] = await Promise.all([
  readCsv("monsters.csv"), readCsv("moves.csv"), readCsv("abilities.csv"), readCsv("learnsets.csv"),
]);
const typeRows = parseCsv(await fs.readFile(path.join(sourceRoot, "type-chart-18.csv"), "utf8"));
const defendingTypes = typeRows[0].slice(1);
const typeChart = Object.fromEntries(typeRows.slice(1).map((row) => [
  row[0],
  Object.fromEntries(defendingTypes.map((type, index) => [type, Number(row[index + 1])])),
]));

await fs.mkdir(outputDir, { recursive: true });
await Promise.all([
  fs.writeFile(path.join(outputDir, "monsters.json"), JSON.stringify(monsters, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "moves.json"), JSON.stringify(moves, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "abilities.json"), JSON.stringify(abilities, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "learnsets.json"), JSON.stringify(learnsets, null, 2) + "\n"),
  fs.writeFile(path.join(outputDir, "type-chart.json"), JSON.stringify(typeChart, null, 2) + "\n"),
]);

console.log(`Built ${monsters.length} monsters, ${moves.length} moves, ${abilities.length} abilities, ${learnsets.length} learnset rows, and ${Object.keys(typeChart).length} type rows.`);
