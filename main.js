const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require("obsidian");

const DEFAULT_SETTINGS = {
  excludeRegexPatterns: ["\\s"],
  targetCharacterCount: "",
  targetFilePath: "",
  counterHoverOnly: true,
};

class CustomWordCounterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.updateBodyClass();

    this.counterRefreshTimer = window.setInterval(() => {
      this.updateEditorCounter().catch(err => console.error("Counter update error:", err));
    }, 1000);

    this.addCommand({
      id: "set-target-file",
      name: "Set target file",
      callback: async () => {
        const activeFile = this.getActiveMarkdownView()?.file ?? null;
        if (!activeFile) {
          new Notice("No file is currently open.");
          return;
        }
        this.settings.targetFilePath = activeFile.path;
        await this.saveSettings();
        new Notice(`Target file set: ${activeFile.path}`);
      },
    });

    this.addCommand({
      id: "show-character-count",
      name: "Show character count",
      callback: async () => {
        const count = await this.getCurrentCharacterCount();
        const target = this.getTargetCharacterCount();
        const fileInfo = this.settings.targetFilePath?.trim()
          ? ` (${this.settings.targetFilePath})`
          : "";
        new Notice(`Character count: ${count}${target ? ` / ${target}` : ""}${fileInfo}`);
      },
    });

    this.addCommand({
      id: "toggle-counter-hover",
      name: "Toggle counter hover visibility",
      callback: async () => {
        this.settings.counterHoverOnly = !this.settings.counterHoverOnly;
        await this.saveSettings();
        new Notice(`Counter hover visibility: ${this.settings.counterHoverOnly ? "On" : "Off"}`);
      },
    });

    this.addSettingTab(new CustomWordCounterSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.syncEditorCounters().catch(err => console.error("Counter update error:", err)))
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => this.updateEditorCounter().catch(err => console.error("Counter update error:", err)))
    );
    this.registerEvent(
      this.app.workspace.on("file-open", () => this.syncEditorCounters().catch(err => console.error("Counter update error:", err)))
    );
    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.syncEditorCounters().catch(err => console.error("Counter update error:", err)))
    );

    this.syncEditorCounters().catch(err => console.error("Counter update error:", err));
  }

  onunload() {
    if (this.counterRefreshTimer) {
      window.clearInterval(this.counterRefreshTimer);
      this.counterRefreshTimer = null;
    }

    this.clearAllEditorCounters();
    document.body.classList.remove("is-cwc-counter-visible");
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    if (!Array.isArray(this.settings.excludeRegexPatterns)) {
      this.settings.excludeRegexPatterns = [...DEFAULT_SETTINGS.excludeRegexPatterns];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateBodyClass();
    await this.updateEditorCounter();
  }

  updateBodyClass() {
    if (this.settings.counterHoverOnly) {
      document.body.classList.remove("is-cwc-counter-visible");
    } else {
      document.body.classList.add("is-cwc-counter-visible");
    }
  }

  async syncEditorCounters() {
    this.clearAllEditorCounters();
    await this.updateEditorCounter();
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

  async getCurrentCharacterCount() {
    const targetPath = this.settings.targetFilePath?.trim();
    if (targetPath) {
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (file) {
        return await this.getFileCharacterCount(file);
      }
      return 0;
    }

    const activeFile = this.getActiveMarkdownView()?.file ?? null;
    if (!activeFile) {
      return 0;
    }

    return await this.getFileCharacterCount(activeFile);
  }

  async getFileCharacterCount(file) {
    const activeFile = this.getActiveMarkdownView()?.file ?? null;
    if (activeFile && file.path === activeFile.path) {
      const editor = this.getActiveEditor();
      if (!editor) {
        return 0;
      }

      return this.countCharacters(editor.getValue());
    }

    const content = await this.app.vault.read(file);
    return this.countCharacters(content);
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

  getTargetCharacterCount() {
    const rawTarget = this.settings.targetCharacterCount;
    const target = Number(rawTarget);

    if (!Number.isFinite(target) || target <= 0) {
      return null;
    }

    return target;
  }

  parseRegexInput(rawPattern) {
    if (!rawPattern || typeof rawPattern !== "string") {
      return null;
    }

    const pattern = rawPattern.trim();
    if (!pattern) {
      return null;
    }

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
      const counter = view?.contentEl?.querySelector(".cwc-editor-counter");
      if (counter) {
        counter.remove();
      }
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

  async updateEditorCounter() {
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

    const count = await this.getCurrentCharacterCount();
    const targetCount = this.getTargetCharacterCount();
    const overTarget = targetCount && count > targetCount;

    const counterText = `${count} ${targetCount ? `/ ${targetCount}` : ""}`;
    counterEl.setText(counterText);

    if (overTarget) {
      counterEl.classList.add("cwc-over-target");
    } else {
      counterEl.classList.remove("cwc-over-target");
    }
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

    containerEl.createEl("h2", { text: "Simple Word Counter" });

    containerEl.createEl("h3", { text: "Target File" });

    new Setting(containerEl)
      .setName("Target file path")
      .setDesc("Path of the file to count characters from. Leave empty to count the active file.")
      .addText((text) => {
        text.setPlaceholder("Example: folder/note.md");
        text.setValue(this.plugin.settings.targetFilePath || "");
        text.onChange(async (value) => {
          this.plugin.settings.targetFilePath = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Character Count" });

    new Setting(containerEl)
      .setName("Target character count")
      .setDesc("Optional target character count to display alongside the current count.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "0";
        text.setPlaceholder("Example: 1000");
        text.setValue(this.plugin.settings.targetCharacterCount || "");
        text.onChange(async (value) => {
          this.plugin.settings.targetCharacterCount = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Require hover to show counter")
      .setDesc("When enabled, the character counter is hidden until you hover over it.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.counterHoverOnly);
        toggle.onChange(async (value) => {
          this.plugin.settings.counterHoverOnly = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Regex Patterns" });

    new Setting(containerEl)
      .setName("Excluded regex patterns")
      .setDesc(
        "Define regex patterns to remove before character counting. Use plain patterns like \\\\s or /pattern/flags."
      )
      .addButton((button) => {
        button
          .setButtonText("Add regex")
          .setCta()
          .onClick(async () => {
            this.plugin.settings.excludeRegexPatterns.push("");
            await this.plugin.saveSettings();
            renderRows();
          });
      });

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
  }
}

module.exports = CustomWordCounterPlugin;
