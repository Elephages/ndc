# Novalings Damage Calculator

A static, GitHub Pages-ready damage calculator for the current Novalings prototype rules, laid out like the [Pokémon Showdown damage calculator](https://calc.pokemonshowdown.com/). It reads its data live from a Google Sheet, and falls back to the `data/` files in this repo.

This is a calculator only. It doesn't simulate battles.

## What it calculates

- Four-stat formula: HP, Attack, Defense and Speed
- Per-stat IVs and EVs, levels and Attack / Defense / Speed stages
- Critical hits, per move, including the stage exceptions
- All sixteen random damage rolls from 85 through 100
- STAB, dual-type effectiveness, immunity, burn, Surge and held-item modifiers
- Damage as a percentage of the defender's max HP, and what the defender is left on
- Exact 1HKO to 4HKO chances from the defender's current HP, then guaranteed/possible KOs up to 9 hits
- Burn and poison damage between hits, and Sturdy on a full-HP defender
- Who moves first, after stages, Speed items and paralysis

The calculator treats `Damage` and `Attack` as damage-move categories, and `Status` and `Support` as support-move categories. Support moves stay selectable but deal no direct damage.

### Starting state

Everything starts blank each time the page opens: no Novalings, and abilities, items, status and moves all set to None. A blank IV counts as 15 and a blank EV as 0, as their placeholders show.

Levels work as on the Pokémon Showdown calculator. **Level 100**, **Level 50** and **Level 5** set both Novalings at once. Each Novaling also has its own Level box that can be edited at any time, even before a Novaling is chosen. The default is Level 100. Choosing a Novaling doesn't fill anything in, and changing Novaling puts its moves, ability and item back to None. Its usual ability is marked in the Ability dropdown for you to pick.

### Editing values for balance testing

Base stats, types, abilities, and each move's power and type can all be changed in place. Edited base stats and move power are shown in bold. They go back to the data's values when you change Novaling, clear the box, or type the original number.

### EVs

EVs use the modern Pokémon formula with no nature term: `floor((2 × base + IV + floor(EV / 4)) × level / 100)`, plus `level + 10` for HP or `5` for the other stats. A stat holds up to 252 EVs and a Novaling up to 510. An EV box won't go past either limit, and changing Novaling puts EVs back to 0.

EVs come from this calculator, not from the prototype rulebook, which has IVs only. With every EV at 0, results match the rulebook exactly.

### Saved sets

**Save Set** at the bottom of a panel names the current build and stores it in this browser's local storage. Nothing is uploaded, and clearing the browser's site data removes the sets. The **Set** dropdown under the Novaling's name lists that Novaling's saved sets, each with Load, Share and Delete. A set's name can only be used once per Novaling, so saving never overwrites anything. **Blank set** clears the build but keeps the Novaling and its level.

A set holds the Novaling, level, ability, item, EVs, IVs, moves and any balance edits. Status, current HP, stages and the critical hit and entry-ability toggles describe a battle rather than a build, so they aren't saved, and loading a set resets them.

### Import and export

The **Import Set** section in the middle takes a pasted set, asks for a name and saves it. It then appears in the Set dropdown on both sides whenever that Novaling is chosen. **Export**, next to Save Set on each panel, shows that panel's current build as text, saved or not. The text follows the Pokémon Showdown format:

```
Murkit @ Type Boost
Ability: Intimidate
Level: 50
EVs: 252 Atk / 4 Def / 252 Spe
IVs: 31 Atk
Boosted Type: Dark
Base Stats: 80 Atk
Types: Dark / Fire
- Shade Claw [Power: 90, Type: Fire]
- Night Fang
```

The differences from Showdown come from the Novalings rules:

- **Level** is always written. A set with no Level line imports at Level 100, as on Showdown.
- **IVs** are left out at 15, not 31, because 15 is the Novaling default.
- **Boosted Type**, **Base Stats**, **Types** and the `[Power: …, Type: …]` move notes only appear for the Type Boost item and for balance edits.

Valid Showdown text that Novalings have no use for, such as natures, SpA and SpD EVs, nicknames or shininess, is ignored. Anything else that can't be read shows **Formatting error** and nothing is saved: an unknown Novaling, item, ability or move, an invalid number such as more than 510 EVs, an unrecognised line, more than four moves, or more than one set at a time. Either way the box empties and the message clears after two seconds, ready for the next set.

### What is deliberately not here

The Novalings rulebook has one ruleset with four stats. Natures, Special Attack and Defense, generations, Mega Evolution, Z-Moves, Dynamax, Terastallization, weather, terrain and screens don't exist in it, so the calculator doesn't offer them. If any of those are added to the game's rules, they need adding to `calculateDamage` in `core.js` as well as to the interface.

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
| `sets.js` | Showdown-format set text, and saved sets in local storage |
| `app.js` | Calculator state and rendering |
| `picker.js` | The dropdown with its own search bar |
| `data-source.js` | Loads bundled data or the Google Sheet |
| `styles.css` | Design system and layout |

## Google Sheets backend

The Sheet is the calculator's data. The site reads it each time the page is opened, so there's nothing to redeploy and no commit to make: save a change in the Sheet, refresh the site, and it's live. The repo's `data/` files are only a fallback for when the Sheet can't be read.

To connect a Sheet, share it as **Anyone with the link → Viewer**, then copy the ID from its URL into `googleSheetId` in `config.js`.

The **Start Here** tab explains day-to-day use. In short, add a row, and set **Ready** to **Yes** when it's complete. Rows that aren't ready stay off the site. Tabs and headers must keep their names:

- `Monsters`: `Ready`, `Name`, `Type1`, `Type2`, `HP`, `Attack`, `Defense`, `Speed`, `Ability`, `EvolvesTo`, `EvolveLevel`, `Rarity`
- `Moves`: `Ready`, `Name`, `Type`, `Category`, `Power`, `Accuracy`, `PP`, `Effect`
- `Abilities`: `Name`, `Kind`, `Type`, `Status`, `Text`
- `Type Chart`: attack types as the first column and defending types as the remaining headers. A blank cell counts as neutral.
- `Learnsets`: `Monster`, `Level`, `Move`. If this tab is missing, the bundled learnsets are used.

If the Sheet can't be read, the calculator shows a warning and uses the bundled data.

## GitHub Pages

The site is published from the `main` branch of this repo (**Settings → Pages → Deploy from a branch**). Pushing to `main` updates it within a minute or two.

Run `npm test` before pushing. Sheet IDs are public identifiers, not credentials, but anything in the Sheet is publicly readable.

This repo has no server and no secrets. Do not use it for private balancing data unless you add an authenticated backend.
