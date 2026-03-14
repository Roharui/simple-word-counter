const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require("obsidian");

const DEFAULT_SETTINGS = {
  excludeRegexPatterns: ["\\s"],
};

class CustomWordCounterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "show-character-count",
      name: "Show character count",
      callback: () => {
        const count = this.getCurrentCharacterCount();
        new Notice(`Character count: ${count}`);
      },
    });

    this.addSettingTab(new CustomWordCounterSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.updateEditorCounter())
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.updateEditorCounter())
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.updateEditorCounter())
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.updateEditorCounter())
    );

    this.updateEditorCounter();
  }

  onunload() {
    this.clearAllEditorCounters();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    if (!Array.isArray(this.settings.excludeRegexPatterns)) {
      this.settings.excludeRegexPatterns = [...DEFAULT_SETTINGS.excludeRegexPatterns];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateEditorCounter();
  }

  getActiveMarkdownView() {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }

  getActiveEditor() {
    const activeView = this.getActiveMarkdownView();
    if (!activeView) {
      return null;
    }

    return activeView.editor;
  }

  getCurrentCharacterCount() {
    const editor = this.getActiveEditor();
    if (!editor) {
      return 0;
    }

    const text = editor.getValue();
    return this.countCharacters(text);
  }

  countCharacters(text) {
    let filteredText = text;

    for (const rawPattern of this.settings.excludeRegexPatterns) {
      const regex = this.parseRegexInput(rawPattern);
      if (!regex) {
        continue;
      }

      filteredText = filteredText.replace(regex, "");
    }

    return filteredText.length;
  }

  parseRegexInput(rawPattern) {
    if (!rawPattern || typeof rawPattern !== "string") {
      return null;
    }

    const pattern = rawPattern.trim();
    if (!pattern) {
      return null;
    }

    // Supports /pattern/flags or plain pattern.
    const slashRegex = /^\/(.*)\/([a-z]*)$/i;
    const match = pattern.match(slashRegex);

    try {
      if (match) {
        const source = match[1];
        const originalFlags = match[2] || "";
        const flags = originalFlags.includes("g")
          ? originalFlags
          : `${originalFlags}g`;

        return new RegExp(source, flags);
      }

      return new RegExp(pattern, "g");
    } catch (_error) {
      return null;
    }
  }

  clearAllEditorCounters() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");

    for (const leaf of leaves) {
      const view = leaf.view;
      const scroller = view?.contentEl?.querySelector(".cm-scroller");
      scroller?.classList.remove("cwc-counter-anchor");
      const counters = view?.contentEl?.querySelectorAll(".cwc-editor-counter");
      if (!counters) {
        continue;
      }

      counters.forEach((counterEl) => counterEl.remove());
    }
  }

  ensureEditorCounterElement(view) {
    const scrollerEl = view?.contentEl?.querySelector(".cm-scroller");
    if (!scrollerEl) {
      return null;
    }

    scrollerEl.classList.add("cwc-counter-anchor");

    let counterEl = scrollerEl.querySelector(":scope > .cwc-editor-counter");
    if (!counterEl) {
      counterEl = document.createElement("div");
      counterEl.className = "cwc-editor-counter";
      scrollerEl.appendChild(counterEl);
    }

    return counterEl;
  }

  updateEditorCounter() {
    this.clearAllEditorCounters();

    const view = this.getActiveMarkdownView();
    if (!view) {
      return;
    }

    const editor = view.editor;

    if (!editor) {
      return;
    }

    const counterEl = this.ensureEditorCounterElement(view);
    if (!counterEl) {
      return;
    }

    const count = this.countCharacters(editor.getValue());
    counterEl.setText(`Chars: ${count}`);
  }
}

class CustomWordCounterSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Custom Word Counter" });

    new Setting(containerEl)
      .setName("Excluded regex patterns")
      .setDesc(
        "Define multiple regex patterns to remove before character counting. Use plain patterns like \\\\s or /pattern/flags."
      );

    const helpEl = containerEl.createEl("div", {
      cls: "cwc-regex-help",
      text: "Invalid regex entries are ignored.",
    });
    helpEl.setAttr("aria-live", "polite");

    const listEl = containerEl.createDiv({ cls: "cwc-regex-list" });

    const renderRows = () => {
      listEl.empty();

      this.plugin.settings.excludeRegexPatterns.forEach((pattern, index) => {
        const rowEl = listEl.createDiv({ cls: "cwc-regex-row" });

        const inputEl = rowEl.createEl("input", { type: "text" });
        inputEl.value = pattern;
        inputEl.placeholder = "Example: \\s or /#[^\\n]*/g";

        inputEl.addEventListener("change", async () => {
          this.plugin.settings.excludeRegexPatterns[index] = inputEl.value;
          await this.plugin.saveSettings();
          this.display();
        });

        const removeButton = rowEl.createEl("button", { text: "Remove" });
        removeButton.addEventListener("click", async () => {
          this.plugin.settings.excludeRegexPatterns.splice(index, 1);
          await this.plugin.saveSettings();
          renderRows();
        });
      });
    };

    renderRows();

    new Setting(containerEl).addButton((button) => {
      button
        .setButtonText("Add regex")
        .setCta()
        .onClick(async () => {
          this.plugin.settings.excludeRegexPatterns.push("");
          await this.plugin.saveSettings();
          renderRows();
        });
    });
  }
}

module.exports = CustomWordCounterPlugin;
