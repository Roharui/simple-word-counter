const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require("obsidian");

const DEFAULT_SETTINGS = {
  excludeRegexPatterns: ["\\s"],
  targetCharacterCount: "",
  uploadScheduledAt: "",
};

class CustomWordCounterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.counterRefreshTimer = window.setInterval(() => {
      this.updateEditorCounter();
    }, 1000);

    this.addCommand({
      id: "show-character-count",
      name: "Show character count",
      callback: () => {
        const count = this.getCurrentCharacterCount();
        const ratioText = this.getWeightedRatioText(count);
        new Notice(`Character count: ${count}${ratioText ? ` | Ratio: ${ratioText}` : ""}`);
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
    if (this.counterRefreshTimer) {
      window.clearInterval(this.counterRefreshTimer);
      this.counterRefreshTimer = null;
    }

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

  getTargetCharacterCount() {
    const rawTarget = this.settings.targetCharacterCount;
    const target = Number(rawTarget);

    if (!Number.isFinite(target) || target <= 0) {
      return null;
    }

    return target;
  }

  getUploadScheduledAt() {
    const rawDateTime = this.settings.uploadScheduledAt;
    if (!rawDateTime || typeof rawDateTime !== "string") {
      return null;
    }

    const timeParts = rawDateTime.trim().split(":").map((part) => Number(part));
    if (timeParts.length < 2 || timeParts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    const [hours, minutes, seconds = 0] = timeParts;
    const scheduledAt = new Date();
    scheduledAt.setHours(hours, minutes, seconds, 0);

    if (Number.isNaN(scheduledAt.getTime())) {
      return null;
    }

    return scheduledAt;
  }

  getWeightedRatioValue(characterCount) {
    const targetCharacterCount = this.getTargetCharacterCount();
    const uploadScheduledAt = this.getUploadScheduledAt();

    if (!targetCharacterCount || !uploadScheduledAt) {
      return null;
    }

    const remainingMilliseconds = uploadScheduledAt.getTime() - Date.now();
    return (characterCount / targetCharacterCount) * remainingMilliseconds;
  }

  getWeightedRatioText(characterCount) {
    const ratioValue = this.getWeightedRatioValue(characterCount);
    if (ratioValue === null) {
      return null;
    }

    return this.formatDurationText(ratioValue);
  }

  formatDurationText(milliseconds) {
    if (!Number.isFinite(milliseconds)) {
      return null;
    }

    const sign = milliseconds < 0 ? "-" : "";
    let remainingSeconds = Math.round(Math.abs(milliseconds) / 1000);

    const hours = Math.floor(remainingSeconds / 3600);
    remainingSeconds -= hours * 3600;

    const minutes = Math.floor(remainingSeconds / 60);
    remainingSeconds -= minutes * 60;

    const seconds = remainingSeconds;

    const paddedHours = String(hours).padStart(2, "0");
    const paddedMinutes = String(minutes).padStart(2, "0");
    const paddedSeconds = String(seconds).padStart(2, "0");

    return `${sign}${paddedHours}:${paddedMinutes}:${paddedSeconds}`;
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
    const ratioText = this.getWeightedRatioText(count);
    const uploadScheduledAt = this.getUploadScheduledAt();
    const shouldWarn =
      uploadScheduledAt && uploadScheduledAt.getTime() < Date.now() && count < 3000;

    counterEl.classList.toggle("cwc-editor-counter--warning", shouldWarn);
    counterEl.setText(`${count}${ratioText ? ` | ${ratioText}` : ""}`);
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

    containerEl.createEl("h3", { text: "Character Count" });

    new Setting(containerEl)
      .setName("Target character count")
      .setDesc("Used together with the upload time to calculate the displayed ratio.")
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

    containerEl.createEl("h3", { text: "Upload Time" });

    new Setting(containerEl)
      .setName("Upload scheduled time")
      .setDesc("Choose today's planned upload time used in the ratio calculation.")
      .addText((text) => {
        text.inputEl.type = "time";
        text.setValue(this.plugin.settings.uploadScheduledAt || "");
        text.onChange(async (value) => {
          this.plugin.settings.uploadScheduledAt = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Regex Patterns" });

    new Setting(containerEl)
      .setName("Excluded regex patterns")
      .setDesc(
        "Define multiple regex patterns to remove before character counting. Use plain patterns like \\\\s or /pattern/flags."
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


    containerEl.createEl("h3", { text: "Regex Pattern List" });

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
