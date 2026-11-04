// A dropdown: a button that opens a list with its own search bar, so the field itself can't be typed in.
// Option markup comes only from this app's templates, with data values already escaped by the caller.
let nextId = 0;
let openPicker = null;

function rank(option, query) {
  const name = option.label.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return option.search?.toLowerCase().includes(query) ? 2 : -1;
}

document.addEventListener("pointerdown", (event) => {
  if (openPicker && !openPicker.panel.contains(event.target) && !openPicker.button.contains(event.target)) openPicker.close();
});

export class Picker {
  constructor({ label, placeholder = "None", searchable = true, onSelect }) {
    this.onSelect = onSelect;
    this.placeholder = placeholder;
    this.searchable = searchable;
    this.options = [];
    this.value = "";
    this.visible = [];
    this.activeIndex = -1;
    const id = `picker-${(nextId += 1)}`;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "picker";
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-label", label);
    this.button.innerHTML = `<span class="picker-value"></span><span class="picker-chevron" aria-hidden="true"></span>`;
    this.valueEl = this.button.querySelector(".picker-value");
    this.root = this.button;

    this.panel = document.createElement("div");
    this.panel.className = "picker-panel";
    this.panel.hidden = true;
    this.panel.innerHTML = `${searchable ? `<div class="picker-search"><input type="search" placeholder="Search…" aria-label="Search ${label}" autocomplete="off" spellcheck="false" /></div>` : ""}<div class="picker-list" id="${id}" role="listbox" aria-label="${label}" tabindex="-1"></div>`;
    this.search = this.panel.querySelector("input");
    this.list = this.panel.querySelector(".picker-list");
    document.body.append(this.panel);

    this.button.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.open();
      }
    });
    this.panel.addEventListener("keydown", (event) => this.onKey(event));
    this.search?.addEventListener("input", () => this.filter(this.search.value));
    this.list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-index]");
      if (row) this.choose(this.visible[Number(row.dataset.index)]);
    });
    this.reposition = (event) => {
      if (!this.panel.contains(event?.target)) this.place();
    };
  }

  get isOpen() {
    return !this.panel.hidden;
  }

  setOptions(options) {
    this.options = options;
    this.syncLabel();
    if (this.isOpen) this.filter(this.search?.value || "");
  }

  setValue(value) {
    this.value = value;
    this.syncLabel();
  }

  setDisabled(disabled) {
    this.button.disabled = disabled;
    if (disabled) this.close();
  }

  syncLabel() {
    const option = this.options.find((entry) => entry.value === this.value);
    this.valueEl.textContent = option?.label ?? this.placeholder;
    this.button.classList.toggle("is-empty", !option || option.empty === true);
  }

  open() {
    if (this.isOpen || this.button.disabled) return;
    openPicker?.close();
    openPicker = this;
    this.button.setAttribute("aria-expanded", "true");
    this.panel.hidden = false;
    if (this.search) this.search.value = "";
    this.filter("");
    addEventListener("scroll", this.reposition, true);
    addEventListener("resize", this.reposition);
    (this.search || this.list).focus();
  }

  close({ refocus = false } = {}) {
    if (!this.isOpen) return;
    this.panel.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (openPicker === this) openPicker = null;
    removeEventListener("scroll", this.reposition, true);
    removeEventListener("resize", this.reposition);
    if (refocus) this.button.focus();
  }

  filter(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    const matches = query
      ? this.options.map((option) => ({ option, score: rank(option, query) })).filter((entry) => entry.score >= 0).sort((left, right) => left.score - right.score).map((entry) => entry.option)
      : this.options;
    this.visible = matches;
    const current = matches.findIndex((option) => option.value === this.value && !option.disabled);
    this.activeIndex = query ? matches.findIndex((option) => !option.disabled) : current;
    let lastSection = null;
    const rows = [];
    matches.forEach((option, index) => {
      if (!query && option.section && option.section !== lastSection) rows.push(`<div class="picker-section" role="presentation">${option.section}</div>`);
      lastSection = option.section;
      const classes = ["picker-option", option.value === this.value ? "is-current" : "", option.disabled ? "is-disabled" : ""].filter(Boolean).join(" ");
      rows.push(`<div class="${classes}" role="option" id="${this.list.id}-${index}" ${option.disabled ? "" : `data-index="${index}"`} aria-selected="${option.value === this.value}" aria-disabled="${Boolean(option.disabled)}">${option.html || option.label}</div>`);
    });
    this.list.innerHTML = rows.join("") || `<div class="picker-none">No matches</div>`;
    this.place();
    this.highlight();
  }

  highlight() {
    this.list.querySelector(".is-active")?.classList.remove("is-active");
    const row = this.activeIndex >= 0 ? this.list.querySelector(`[data-index="${this.activeIndex}"]`) : null;
    row?.classList.add("is-active");
    row?.scrollIntoView({ block: "nearest" });
    const target = this.search || this.list;
    if (row) target.setAttribute("aria-activedescendant", row.id);
    else target.removeAttribute("aria-activedescendant");
  }

  place() {
    const rect = this.button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), innerWidth - 16);
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 240 && above > below;
    this.panel.style.width = `${width}px`;
    this.panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    this.panel.style.maxHeight = `${Math.min(380, openUp ? above : below)}px`;
    this.panel.style.top = openUp ? "" : `${rect.bottom + 4}px`;
    this.panel.style.bottom = openUp ? `${innerHeight - rect.top + 4}px` : "";
  }

  choose(option) {
    if (!option || option.disabled) return;
    this.value = option.value;
    this.syncLabel();
    this.close({ refocus: true });
    this.onSelect(option.value);
  }

  step(direction) {
    const size = this.visible.length;
    let index = this.activeIndex;
    for (let tries = 0; tries < size; tries += 1) {
      index = index < 0 ? (direction > 0 ? 0 : size - 1) : (index + direction + size) % size;
      if (!this.visible[index].disabled) {
        this.activeIndex = index;
        this.highlight();
        return;
      }
    }
  }

  onKey(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      this.step(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      this.choose(this.visible[this.activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.close({ refocus: true });
    } else if (event.key === "Tab") {
      this.close({ refocus: true });
    }
  }
}
