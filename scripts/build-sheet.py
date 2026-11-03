"""Builds the Google Sheets backend template from data/. Run: python3 scripts/build-sheet.py
Upload the result to Google Drive and open it as a Google Sheet."""
import json
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter as col
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
LAST_ROW = 500
BLUE, INK, GREY, LINE = "2563EB", "171A21", "6B7482", "E4E7EC"
FONT = "Arial"
HEADER_FILL = PatternFill("solid", fgColor=BLUE)
COMPUTED_FILL = PatternFill("solid", bgColor="F5F6F8", fgColor="F5F6F8")
GOOD = PatternFill("solid", bgColor="E6F6EE", fgColor="E6F6EE")
BAD = PatternFill("solid", bgColor="FDECEA", fgColor="FDECEA")
WARN = PatternFill("solid", bgColor="FDF5E3", fgColor="FDF5E3")
HAIRLINE = Border(bottom=Side(style="thin", color=LINE))
TYPES = ["Normal", "Fire", "Water", "Electric", "Grass", "Ice", "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug", "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"]


def load(name):
    return json.loads((ROOT / "data" / f"{name}.json").read_text())


def dropdown(sheet, cells, formula, strict=True, message=None):
    rule = DataValidation(type="list", formula1=formula, allow_blank=True, showErrorMessage=strict)
    if strict:
        rule.error, rule.errorTitle = message or "Pick a value from the list.", "Not in the list"
    sheet.add_data_validation(rule)
    rule.add(cells)


def whole_number(sheet, cells, low, high, label):
    rule = DataValidation(type="whole", operator="between", formula1=str(low), formula2=str(high), allow_blank=True, showErrorMessage=True)
    rule.error, rule.errorTitle = f"{label} must be a whole number from {low} to {high}.", "Check this number"
    sheet.add_data_validation(rule)
    rule.add(cells)


def table(sheet, headers, rows, widths, notes=None, tab=BLUE):
    sheet.sheet_properties.tabColor = tab
    sheet.freeze_panes = "A2"
    for index, header in enumerate(headers, 1):
        cell = sheet.cell(1, index, header)
        cell.font, cell.fill = Font(name=FONT, bold=True, color="FFFFFF", size=10), HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        sheet.column_dimensions[col(index)].width = widths[index - 1]
    sheet.row_dimensions[1].height = 28
    for row_index, row in enumerate(rows, 2):
        for column_index, value in enumerate(row, 1):
            sheet.cell(row_index, column_index, None if value == "" else value)
    for row_cells in sheet.iter_rows(min_row=2, max_row=LAST_ROW, max_col=len(headers)):
        for cell in row_cells:
            cell.font, cell.border = Font(name=FONT, size=10, color=INK), HAIRLINE
            cell.alignment = Alignment(vertical="center")
    sheet.auto_filter.ref = f"A1:{col(len(headers))}{LAST_ROW}"


def ready_rules(sheet, last_column, name_column="B"):
    area = f"A2:{last_column}{LAST_ROW}"
    dropdown(sheet, f"A2:A{LAST_ROW}", '"Yes,No"', message="Choose Yes when the row is complete, or No to keep it off the site.")
    sheet.conditional_formatting.add(f"A2:A{LAST_ROW}", CellIsRule(operator="equal", formula=['"Yes"'], fill=GOOD, font=Font(name=FONT, color="14774A", bold=True)))
    sheet.conditional_formatting.add(area, FormulaRule(formula=[f'AND(${name_column}2<>"",$A2<>"Yes")'], font=Font(name=FONT, color=GREY, italic=True)))
    sheet.conditional_formatting.add(f"{name_column}2:{name_column}{LAST_ROW}", FormulaRule(formula=[f'COUNTIF(${name_column}$2:${name_column}${LAST_ROW},{name_column}2)>1'], fill=BAD))


def build_guide(sheet):
    sheet.sheet_properties.tabColor = INK
    sheet.sheet_view.showGridLines = False
    sheet.column_dimensions["A"].width = 3
    sheet.column_dimensions["B"].width = 24
    sheet.column_dimensions["C"].width = 92
    sheet["B2"] = "Novalings Backend"
    sheet["B2"].font = Font(name=FONT, size=20, bold=True, color=INK)
    sheet["B3"] = "This Sheet is the calculator's data. Save a change here, refresh the site, and it's live."
    sheet["B3"].font = Font(name=FONT, size=11, color=GREY)
    sections = [
        ("Add a creature", None),
        ("1. Monsters tab", "Fill in the next empty row: name, types, four base stats and ability. Leave Ready on No while you work."),
        ("2. Learnsets tab", "Add one row per move it learns: the creature, the level, and the move. Optional, but the calculator suggests these moves first."),
        ("3. Finish", "Set Ready to Yes on its Monsters row. It appears on the site the next time the page is opened or refreshed."),
        ("Add a move", None),
        ("Moves tab", "Fill in the next empty row, then set Ready to Yes. Effect is optional: pick one from the list, or follow the same wording."),
        ("Change type matchups", None),
        ("Type Chart tab", "Attacking type is on the left, defending type along the top. Choose 0, 0.5, 1 or 2. Changes apply straight away, with no Ready step."),
        ("What the colors mean", None),
        ("Green Ready cell", "This row is live on the site."),
        ("Grey italic row", "Not ready: the site ignores this row."),
        ("Red name", "That name is used twice. Names must be unique."),
        ("Grey Total column", "Worked out for you. Don't type here."),
        ("Please don't", None),
        ("Rename tabs or headers", "The site finds its data by these exact names. Extra columns to the right of a table are fine, and sorting is fine."),
    ]
    row = 5
    for label, text in sections:
        if text is None:
            row += 1
            sheet.cell(row, 2, label).font = Font(name=FONT, size=12, bold=True, color=BLUE)
        else:
            sheet.cell(row, 2, label).font = Font(name=FONT, size=10, bold=True, color=INK)
            sheet.cell(row, 3, text).font = Font(name=FONT, size=10, color=INK)
            sheet.cell(row, 3).alignment = Alignment(wrap_text=True, vertical="top")
            sheet.cell(row, 2).alignment = Alignment(vertical="top")
        row += 1


def main():
    monsters, moves, abilities, chart, learnsets = (load(name) for name in ["monsters", "moves", "abilities", "type-chart", "learnsets"])
    book = Workbook()
    build_guide(book.active)
    book.active.title = "Start Here"
    move_names = {move["Id"]: move["Name"] for move in moves}
    monster_ids = {monster["Id"]: monster["Name"] for monster in monsters}
    type_list = "'Type Chart'!$A$2:$A$19"

    sheet = book.create_sheet("Monsters")
    headers = ["Ready", "Name", "Type1", "Type2", "HP", "Attack", "Defense", "Speed", "Total", "Ability", "EvolvesTo", "EvolveLevel", "Rarity"]
    table(sheet, headers, [["Yes", m["Name"], m["Type1"], m["Type2"], m["HP"], m["Attack"], m["Defense"], m["Speed"], "", m["Ability"], m["EvolvesTo"], m["EvolveLevel"], m["Rarity"]] for m in monsters], [8, 18, 11, 11, 7, 7, 8, 7, 7, 16, 16, 10, 11])
    for row in range(2, LAST_ROW + 1):
        cell = sheet.cell(row, 9, f'=IF(B{row}="","",SUM(E{row}:H{row}))')
        cell.fill, cell.font, cell.alignment = COMPUTED_FILL, Font(name=FONT, size=10, color=GREY), Alignment(horizontal="center")
    ready_rules(sheet, "M")
    dropdown(sheet, f"C2:D{LAST_ROW}", f"={type_list}", message="Pick a type from the Type Chart tab.")
    whole_number(sheet, f"E2:H{LAST_ROW}", 1, 255, "A base stat")
    whole_number(sheet, f"L2:L{LAST_ROW}", 1, 100, "Evolve level")
    dropdown(sheet, f"J2:J{LAST_ROW}", f"=Abilities!$A$2:$A${LAST_ROW}", message="Pick an ability from the Abilities tab, or add it there first.")
    dropdown(sheet, f"M2:M{LAST_ROW}", '"Starter,Common,Uncommon,Rare,Warden"', strict=False)

    sheet = book.create_sheet("Moves")
    table(sheet, ["Ready", "Name", "Type", "Category", "Power", "Accuracy", "PP", "Effect"], [["Yes", m["Name"], m["Type"], m["Category"], m["Power"], m["Accuracy"], m["PP"], m["Effect"]] for m in sorted(moves, key=lambda m: (m["Type"], m["Power"]))], [8, 20, 11, 11, 8, 10, 7, 22])
    ready_rules(sheet, "H")
    dropdown(sheet, f"C2:C{LAST_ROW}", f"={type_list}", message="Pick a type from the Type Chart tab.")
    dropdown(sheet, f"D2:D{LAST_ROW}", '"Damage,Status"')
    whole_number(sheet, f"E2:E{LAST_ROW}", 0, 300, "Power")
    whole_number(sheet, f"F2:F{LAST_ROW}", 1, 100, "Accuracy")
    whole_number(sheet, f"G2:G{LAST_ROW}", 1, 99, "PP")
    effects = sorted({m["Effect"] for m in moves if m["Effect"]})
    sheet.column_dimensions["J"].width = 24
    sheet["J1"] = "Effect wording"
    sheet["J1"].font, sheet["J1"].fill = Font(name=FONT, bold=True, color="FFFFFF", size=10), PatternFill("solid", fgColor=GREY)
    for index, effect in enumerate(effects, 2):
        sheet.cell(index, 10, effect).font = Font(name=FONT, size=10, color=GREY)
    dropdown(sheet, f"H2:H{LAST_ROW}", f"=$J$2:$J${len(effects) + 1}", strict=False)

    sheet = book.create_sheet("Abilities")
    table(sheet, ["Name", "Kind", "Type", "Status", "Chance", "Text"], [[a["Name"], a["Kind"], a["Type"], a["Status"], a["Chance"], a["Text"]] for a in abilities], [18, 13, 11, 11, 8, 54])
    dropdown(sheet, f"B2:B{LAST_ROW}", '"Surge,Counter,Immune,Intimidate,QuickFeet,Regrow,Sturdy"', message="The calculator only understands these kinds of ability.")
    dropdown(sheet, f"C2:C{LAST_ROW}", f"={type_list}")
    dropdown(sheet, f"D2:D{LAST_ROW}", '"Burn,Paralysis,Poison,Sleep"')

    sheet = book.create_sheet("Learnsets")
    entries = sorted(((monster_ids[e["Monster"]], e["Level"], move_names[e["MoveId"]]) for e in learnsets if e["Monster"] in monster_ids), key=lambda e: (e[0], e[1]))
    table(sheet, ["Monster", "Level", "Move"], [list(entry) for entry in entries], [20, 8, 22])
    dropdown(sheet, f"A2:A{LAST_ROW}", f"=Monsters!$B$2:$B${LAST_ROW}", message="Pick a creature from the Monsters tab.")
    whole_number(sheet, f"B2:B{LAST_ROW}", 1, 100, "Level")
    dropdown(sheet, f"C2:C{LAST_ROW}", f"=Moves!$B$2:$B${LAST_ROW}", message="Pick a move from the Moves tab.")

    sheet = book.create_sheet("Type Chart")
    sheet.sheet_properties.tabColor = BLUE
    sheet.freeze_panes = "B2"
    sheet.column_dimensions["A"].width = 13
    for index, header in enumerate(["Attack type", *TYPES], 1):
        cell = sheet.cell(1, index, header)
        cell.font, cell.fill = Font(name=FONT, bold=True, color="FFFFFF", size=9), HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", text_rotation=0 if index == 1 else 60)
        if index > 1:
            sheet.column_dimensions[col(index)].width = 6
    sheet.row_dimensions[1].height = 54
    for row, attack in enumerate(TYPES, 2):
        cell = sheet.cell(row, 1, attack)
        cell.font, cell.fill = Font(name=FONT, bold=True, color="FFFFFF", size=10), HEADER_FILL
        for column, defend in enumerate(TYPES, 2):
            cell = sheet.cell(row, column, chart[attack][defend])
            cell.font, cell.alignment, cell.border = Font(name=FONT, size=10, color=INK), Alignment(horizontal="center"), HAIRLINE
    grid = "B2:S19"
    dropdown(sheet, grid, '"0,0.5,1,2"', message="Choose 0, 0.5, 1 or 2.")
    sheet.conditional_formatting.add(grid, CellIsRule(operator="equal", formula=["2"], fill=GOOD, font=Font(name=FONT, color="14774A", bold=True)))
    sheet.conditional_formatting.add(grid, CellIsRule(operator="equal", formula=["0.5"], fill=BAD, font=Font(name=FONT, color="AD2E27", bold=True)))
    sheet.conditional_formatting.add(grid, CellIsRule(operator="equal", formula=["0"], fill=PatternFill("solid", bgColor=INK, fgColor=INK), font=Font(name=FONT, color="FFFFFF", bold=True)))
    sheet.conditional_formatting.add(grid, CellIsRule(operator="equal", formula=["1"], font=Font(name=FONT, color="B4BBC6")))

    out = ROOT / "sheet" / "Novalings Backend.xlsx"
    book.save(out)
    print(f"Wrote {out}: {len(monsters)} monsters, {len(moves)} moves, {len(abilities)} abilities, {len(entries)} learnset rows")


main()
