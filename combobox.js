// A searchable dropdown: type part of a name, or open and browse. Option markup comes only from
// this app's own templates, with data values already escaped by the caller.
let nextId = 0;

function rank(option, query) {
  const name = option.label.toLowerCase();
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  return option.search?.toLowerCase().includes(query) ? 2 : -1;
}

export class Combobox {
  constructor({ label, placeholder = "", onSelect }) {
    this.onSelect = onSelect;
    this.options = [];
    this.value = "";
    this.isOpen = false;
    this.activeIndex = -1;
    this.visible = [];
    const id = `cb-${(nextId += 1)}`;

    this.root = document.createElement("div");
    this.root.className = "cb";
    this.input = document.createElement("input");
    Object.assign(this.input, { type: "text", className: "input cb-input", placeholder, autocomplete: "off", spellcheck: false });
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-label", label);
    this.input.setAttribute("aria-autocomplete", "list");
    this.input.setAttribute("aria-expanded", "false");
    this.input.setAttribute("aria-controls", id);
    this.root.append(this.input);

    this.list = document.createElement("div");
    this.list.className = "cb-list";
    this.list.id = id;
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", label);
    this.list.hidden = true;
    document.body.append(this.list);

    this.input.addEventListener("focus", () => {
      this.input.select();
      this.open();
    });
    this.input.addEventListener("click", () => {
      if (!this.isOpen) this.open();
    });
    this.input.addEventListener("input", () => {
      this.open();
      this.filter(this.input.value);
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    this.input.addEventListener("blur", () => this.close());
    // Keep focus in the input while using the list; touch scrolling still works.
    this.list.addEventListener("mousedown", (event) => event.preventDefault());
    this.list.addEventListener("click", (event) => {
      const row = event.target.closest("[data-index]");
      if (row) this.choose(this.visible[Number(row.dataset.index)]);
    });
    this.reposition = (event) => {
      if (this.isOpen && !this.list.contains(event?.target)) this.place();
    };
  }

  setOptions(options) {
    this.options = options;
    this.syncLabel();
  }

  setValue(value) {
    this.value = value;
    this.syncLabel();
  }

  syncLabel() {
    if (document.activeElement !== this.input || !this.isOpen) {
      this.input.value = this.options.find((option) => option.value === this.value)?.label ?? "";
    }
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.input.setAttribute("aria-expanded", "true");
    this.list.hidden = false;
    this.filter("");
    addEventListener("scroll", this.reposition, true);
    addEventListener("resize", this.reposition);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.setAttribute("aria-expanded", "false");
    this.input.removeAttribute("aria-activedescendant");
    this.list.hidden = true;
    removeEventListener("scroll", this.reposition, true);
    removeEventListener("resize", this.reposition);
    this.input.value = this.options.find((option) => option.value === this.value)?.label ?? "";
  }

  filter(rawQuery) {
    const query = rawQuery.trim().toLowerCase();
    const matches = query
      ? this.options.map((option) => ({ option, score: rank(option, query) })).filter((entry) => entry.score >= 0).sort((left, right) => left.score - right.score).map((entry) => entry.option)
      : this.options;
    this.visible = matches;
    this.activeIndex = query ? (matches.length ? 0 : -1) : matches.findIndex((option) => option.value === this.value);
    let lastSection = null;
    const rows = [];
    matches.forEach((option, index) => {
      if (!query && option.section && option.section !== lastSection) rows.push(`<div class="cb-section" role="presentation">${option.section}</div>`);
      lastSection = option.section;
      rows.push(`<div class="cb-option${option.value === this.value ? " is-current" : ""}" role="option" id="${this.list.id}-${index}" data-index="${index}" aria-selected="${option.value === this.value}">${option.html || option.label}</div>`);
    });
    this.list.innerHTML = rows.join("") || `<div class="cb-empty">No matches. Try part of the name.</div>`;
    this.place();
    this.highlight();
  }

  highlight() {
    this.list.querySelector(".is-active")?.classList.remove("is-active");
    if (this.activeIndex < 0) {
      this.input.removeAttribute("aria-activedescendant");
      return;
    }
    const row = this.list.querySelector(`[data-index="${this.activeIndex}"]`);
    row?.classList.add("is-active");
    row?.scrollIntoView({ block: "nearest" });
    this.input.setAttribute("aria-activedescendant", row?.id || "");
  }

  place() {
    const rect = this.input.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 320), innerWidth - 16);
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const openUp = below < 200 && above > below;
    this.list.style.width = `${width}px`;
    this.list.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - width - 8))}px`;
    this.list.style.maxHeight = `${Math.min(340, openUp ? above : below)}px`;
    this.list.style.top = openUp ? "" : `${rect.bottom + 2}px`;
    this.list.style.bottom = openUp ? `${innerHeight - rect.top + 2}px` : "";
  }

  choose(option) {
    if (!option) return;
    this.value = option.value;
    this.close();
    this.onSelect(option.value);
  }

  onKey(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.isOpen) this.open();
      const size = this.visible.length;
      if (!size) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      this.activeIndex = this.activeIndex < 0 ? 0 : (this.activeIndex + step + size) % size;
      this.highlight();
    } else if (event.key === "Enter") {
      if (this.isOpen) {
        event.preventDefault();
        if (this.activeIndex >= 0) this.choose(this.visible[this.activeIndex]);
        else this.close();
      }
    } else if (event.key === "Escape") {
      if (this.isOpen) {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        this.input.select();
      }
    }
  }
}
