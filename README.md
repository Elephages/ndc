# Novalings Damage Calculator

A static, GitHub Pages-ready damage calculator for the current Novalings prototype rules, laid out like the [Pokémon Showdown damage calculator](https://calc.pokemonshowdown.com/). It reads its data live from a Google Sheet, and falls back to the `data/` files in this repo.

This is a calculator only. It doesn't simulate battles.

## What it calculates

- Four-stat formula: HP, Attack, Defense and Speed
- Per-stat IVs, levels and Attack / Defense / Speed stages
- Critical hits, per move, including the stage exceptions
- All sixteen random damage rolls from 85 through 100
- STAB, dual-type effectiveness, immunity, burn, Surge and held-item modifiers
- Damage as a percentage of the defender's max HP, and what the defender is left on
- Exact 1HKO to 4HKO chances from the defender's current HP, then guaranteed/possible KOs up to 9 hits
- Burn and poison damage between hits, and Sturdy on a full-HP defender
- Who moves first, after stages, Speed items and paralysis

The calculator treats `Damage` and `Attack` as damage-move categories, and `Status` and `Support` as support-move categories. Support moves stay selectable but deal no direct damage.

### Starting state

Everything starts blank each time the page opens: no Novalings, and abilities, items, status and moves all set to None. A blank IV counts as 15, as its placeholder shows.

Levels work as on the Pokémon Showdown calculator. **Level 100**, **Level 50** and **Level 5** set both Novalings at once, and **Custom** does the same for any level from 1 to 100. Each Novaling also has its own Level box that can be edited at any time, even before a Novaling is chosen. The default is Level 50. Choosing a Novaling doesn't fill anything in, and changing Novaling puts its moves, ability and item back to None. Its usual ability is marked in the Ability dropdown for you to pick.

### Editing values for balance testing

Base stats, types, abilities, and each move's power and type can all be changed in place. Edited base stats and move power are shown in bold. They go back to the data's values when you change Novaling, clear the box, or type the original number.

### What is deliberately not here

The Novalings rulebook has one ruleset with four stats and IVs only. Natures, EVs, Special Attack and Defense, generations, Mega Evolution, Z-Moves, Dynamax, Terastallization, weather, terrain and screens don't exist in it, so the calculator doesn't offer them. If any of those are added to the game's rules, they need adding to `calculateDamage` in `core.js` as well as to the interface.

### Assumptions where the rules are silent

- **Struggle's power** is 50. The pack says it's typeless and always ×1, but gives no power. It can be edited per move slot.
- **Regrow's healing** isn't counted in KO chances, because the pack only says it heals "a little". The calculator says so when it applies.
- **Items** use descriptive names, such as "Damage Boost", because real item names aren't designed yet.

## Accuracy

`tests/fixtures/showdown-reference.json` holds 32 seeded scenarios recorded from the official `@smogon/calc` engine (Gen 9, 0 EVs, neutral nature). The test suite checks that every damage roll, max HP and KO text matches them. They cover levels, IVs, stages, crits, burn, STAB, dual types, immunity, the minimum of 1 damage, partial HP, and burn or poison between hits.

Those scenarios don't cover the ×1.2 and ×1.3 held items. The Novalings rules floor after every step, while main-series games use different rounding for such modifiers, so expect small differences from Pokémon results there. Novalings' own written rules are the reference for those items.

## Local use

```bash
npm test
python3 -m http.server 8080
```

Open `http://localhost:8080`. Opening `index.html` directly won't work, because browsers block JavaScript modules on `file://` pages.

To rebuild `data/` after the balancer pack's CSVs change, run the following. It looks for the CSVs one and two folders above the project, or in `BALANCER_PACK_DIR`. If it finds none, it keeps the committed files.

```bash
npm run build:data
```

## Project layout

| File | What it does |
|---|---|
| `core.js` | The rules: stats, damage formula, KO analysis, items, status immunity |
| `app.js` | Calculator state and rendering |
| `picker.js` | The dropdown with its own search bar |
| `data-source.js` | Loads bundled data or the Google Sheet |
| `styles.css` | Design system and layout |

## Google Sheets backend

The Sheet is the calculator's data. The site reads it each time the page is opened, so there's nothing to redeploy and no commit to make: save a change in the Sheet, refresh the site, and it's live. The repo's `data/` files are only a fallback for when the Sheet can't be read.

To set it up:

1. Upload `sheet/Novalings Backend.xlsx` to Google Drive and open it with Google Sheets, then choose **File → Save as Google Sheets**.
2. Choose **Share → General access → Anyone with the link → Viewer**. The site can't read the Sheet otherwise. Only people you add as editors can change it.
3. Copy the ID from the Sheet's URL into `googleSheetId` in `config.js`, then push.

The **Start Here** tab explains day-to-day use. In short, add a row, and set **Ready** to **Yes** when it's complete. Rows that aren't ready stay off the site. Tabs and headers must keep their names:

- `Monsters`: `Ready`, `Name`, `Type1`, `Type2`, `HP`, `Attack`, `Defense`, `Speed`, `Ability`, `EvolvesTo`, `EvolveLevel`, `Rarity`
- `Moves`: `Ready`, `Name`, `Type`, `Category`, `Power`, `Accuracy`, `PP`, `Effect`
- `Abilities`: `Name`, `Kind`, `Type`, `Status`, `Text`
- `Type Chart`: attack types as the first column and defending types as the remaining headers. A blank cell counts as neutral.
- `Learnsets`: `Monster`, `Level`, `Move`. If this tab is missing, the bundled learnsets are used.

If the Sheet can't be read, the calculator shows a warning and uses the bundled data. To rebuild the template from `data/`, run `python3 scripts/build-sheet.py` (needs `openpyxl`).

## GitHub Pages

The site is published from the `main` branch of this repo (**Settings → Pages → Deploy from a branch**). Pushing to `main` updates it within a minute or two.

Run `npm test` before pushing. Sheet IDs are public identifiers, not credentials, but anything in the Sheet is publicly readable.

This repo has no server and no secrets. Do not use it for private balancing data unless you add an authenticated backend.
