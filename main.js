const { Plugin, PluginSettingTab, Setting, Notice, MarkdownView } = require("obsidian");

const DEFAULT_SETTINGS = {
  excludeRegexPatterns: ["\\s"],
  targetCharacterCount: "",
  uploadScheduledAt: "",
  uploadScheduledAtPropertyName: "uploadScheduledAt",
  filterPropertyName: "",
  filterPropertyValue: "",
  writingStartedAtPropertyName: "writingStartedAt",
  enableFileInfoUpload: false,
  fileInfoServerIp: "",
};

class CustomWordCounterPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.counterRefreshTimer = window.setInterval(() => {
      this.updateEditorCounter().catch(err => console.error("Counter update error:", err));
    }, 1000);

    this.refreshFileInfoUploadTimer();

    this.addCommand({
      id: "show-character-count",
      name: "Show character count",
      callback: async () => {
        const count = await this.getCurrentCharacterCount();
        const ratioText = this.getWeightedRatioText(count);
        new Notice(`Character count: ${count}${ratioText ? ` | Ratio: ${ratioText}` : ""}`);
      },
    });

    this.addCommand({
      id: "mark-writing-start",
      name: "Mark writing start",
      callback: async () => {
        const view = this.getActiveMarkdownView();
        if (!view || !view.file) {
          new Notice("No file is currently open.");
          return;
        }

        const propertyName = this.settings.writingStartedAtPropertyName || "writingStartedAt";
        const currentTime = new Date().toISOString();
        await this.app.fileManager.processFrontmatter(view.file, (frontmatter) => {
          frontmatter[propertyName] = currentTime;
        });
        new Notice("Writing start time saved to file frontmatter.");
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

    if (this.fileInfoUploadTimer) {
      window.clearInterval(this.fileInfoUploadTimer);
      this.fileInfoUploadTimer = null;
    }

    this.clearAllEditorCounters();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    if (!Array.isArray(this.settings.excludeRegexPatterns)) {
      this.settings.excludeRegexPatterns = [...DEFAULT_SETTINGS.excludeRegexPatterns];
    }

    if (typeof this.settings.uploadScheduledAt !== "string") {
      this.settings.uploadScheduledAt = DEFAULT_SETTINGS.uploadScheduledAt;
    }

    if (typeof this.settings.uploadScheduledAtPropertyName !== "string") {
      this.settings.uploadScheduledAtPropertyName = DEFAULT_SETTINGS.uploadScheduledAtPropertyName;
    }

    if (typeof this.settings.writingStartedAtPropertyName !== "string") {
      this.settings.writingStartedAtPropertyName = DEFAULT_SETTINGS.writingStartedAtPropertyName;
    }

    if (typeof this.settings.enableFileInfoUpload !== "boolean") {
      this.settings.enableFileInfoUpload = DEFAULT_SETTINGS.enableFileInfoUpload;
    }

    if (typeof this.settings.fileInfoServerIp !== "string") {
      this.settings.fileInfoServerIp = DEFAULT_SETTINGS.fileInfoServerIp;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    await this.updateEditorCounter();
    this.refreshFileInfoUploadTimer();
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

  refreshFileInfoUploadTimer() {
    if (this.fileInfoUploadTimer) {
      window.clearInterval(this.fileInfoUploadTimer);
      this.fileInfoUploadTimer = null;
    }

    if (!this.settings.enableFileInfoUpload) {
      return;
    }

    this.fileInfoUploadTimer = window.setInterval(() => {
      this.uploadActiveFileInfo().catch(err => console.error("File info upload error:", err));
    }, 60000);

    this.uploadActiveFileInfo().catch(err => console.error("File info upload error:", err));
  }

  getFileInfoServerUrl() {
    const rawAddress = this.settings.fileInfoServerIp?.trim();
    if (!rawAddress) {
      return null;
    }

    try {
      const normalizedAddress = /^https?:\/\//i.test(rawAddress) ? rawAddress : `http://${rawAddress}`;
      const url = new URL(normalizedAddress);
      url.pathname = "/api/record";

      return url.toString();
    } catch (_error) {
      return null;
    }
  }

  async uploadActiveFileInfo() {
    if (!this.settings.enableFileInfoUpload) {
      return;
    }

    const file = this.getTargetFrontmatterFile();
    const serverUrl = this.getFileInfoServerUrl();

    if (!file || !serverUrl) {
      return;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    const count = await this.getCurrentCharacterCount();

    const payload = {
      file_name: file.basename,
      char_count: count,
    };

    const response = await fetch(serverUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
  }

  async getCurrentCharacterCount() {
    let totalCount = 0;
    const filteredFiles = this.getFilteredMarkdownFiles();

    for (const file of filteredFiles) {
      totalCount += await this.getFileCharacterCount(file);
    }

    return totalCount;
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

  formatLocalDatetimeInput(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return "";
    }

    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  withTodayDate(date) {
    const nextDate = new Date(date);
    if (Number.isNaN(nextDate.getTime())) {
      return new Date();
    }

    const now = new Date();
    nextDate.setFullYear(now.getFullYear(), now.getMonth(), now.getDate());
    return nextDate;
  }

  getUploadScheduledAt() {
    const rawTime = this.settings.uploadScheduledAt;
    if (!rawTime || typeof rawTime !== "string") {
      return null;
    }

    const timeParts = rawTime.trim().split(":").map((part) => Number(part));
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

  getFilteredMarkdownFiles() {
    const filterPropertyName = this.settings.filterPropertyName?.trim();
    const filterPropertyValue = this.settings.filterPropertyValue?.trim();
    const activeFile = this.getActiveMarkdownView()?.file ?? null;

    if (!filterPropertyName || !filterPropertyValue) {
      return activeFile ? [activeFile] : [];
    }

    const markdownFiles = this.app.vault.getMarkdownFiles();
    const matchedFiles = [];

    for (const file of markdownFiles) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!cache || !cache.frontmatter) {
        continue;
      }

      const propertyValue = cache.frontmatter[filterPropertyName];
      if (String(propertyValue) === filterPropertyValue) {
        if (activeFile && file.path === activeFile.path) {
          return [activeFile];
        }

        matchedFiles.push(file);
      }
    }

    if (matchedFiles.length > 0) {
      return matchedFiles;
    }

    return activeFile ? [activeFile] : [];
  }

  getTargetFrontmatterFile() {
    const filteredFiles = this.getFilteredMarkdownFiles();
    return filteredFiles[0] ?? null;
  }

  getFileUploadScheduledAt() {
    const file = this.getTargetFrontmatterFile();
    const rawTime = this.settings.uploadScheduledAt;

    if (!file || !rawTime || typeof rawTime !== "string") {
      return null;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !cache.frontmatter) {
      return null;
    }

    const propertyName = this.settings.uploadScheduledAtPropertyName || "uploadScheduledAt";
    const rawDateTime = cache.frontmatter[propertyName];
    if (!rawDateTime || typeof rawDateTime !== "string") {
      return null;
    }

    const timeParts = rawTime.trim().split(":").map((part) => Number(part));
    if (timeParts.length < 2 || timeParts.some((part) => !Number.isFinite(part))) {
      return null;
    }

    const scheduledAt = new Date(rawDateTime);

    const [hours, minutes, seconds = 0] = timeParts;
    scheduledAt.setHours(hours, minutes, seconds, 0);

    if (Number.isNaN(scheduledAt.getTime())) {
      return null;
    }

    return scheduledAt;
  }

  getWritingStartedAt() {
    const file = this.getTargetFrontmatterFile();
    if (!file) {
      return null;
    }

    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache || !cache.frontmatter) {
      return null;
    }

    const propertyName = this.settings.writingStartedAtPropertyName || "writingStartedAt";
    const rawStartedAt = cache.frontmatter[propertyName];
    if (!rawStartedAt || typeof rawStartedAt !== "string") {
      return null;
    }

    const startedAt = new Date(rawStartedAt);
    if (Number.isNaN(startedAt.getTime())) {
      return null;
    }

    return startedAt;
  }

  formatClockText(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  getWritingSpeedText(characterCount) {
    const startedAt = this.getWritingStartedAt();
    if (!startedAt) {
      return null;
    }

    const elapsedMilliseconds = Date.now() - startedAt.getTime();
    if (elapsedMilliseconds <= 0) {
      return null;
    }

    const charsPerHour = (characterCount * 3600000) / elapsedMilliseconds;
    if (!Number.isFinite(charsPerHour)) {
      return null;
    }

    return Number(charsPerHour.toFixed(1));
  }

  getRequiredCharsPerHour(characterCount) {
    const target = this.getTargetCharacterCount();
    const uploadAt = this.getFileUploadScheduledAt() || this.getUploadScheduledAt();
    if (!target || !uploadAt) {
      return null;
    }

    const remaining = target - characterCount;
    if (remaining <= 0) {
      return 0;
    }

    const remainingMs = uploadAt.getTime() - Date.now();
    if (remainingMs <= 0) {
      return null;
    }

    const hours = remainingMs / 3600000;
    if (!Number.isFinite(hours) || hours <= 0) {
      return null;
    }

    const perHour = remaining / hours;
    return Number(perHour.toFixed(1));
  }

  getCrossingTime(characterCount) {
    const startedAt = this.getWritingStartedAt();
    const target = this.getTargetCharacterCount();
    const uploadAt = this.getFileUploadScheduledAt() || this.getUploadScheduledAt();
    if (!startedAt || !target || !uploadAt) {
      return null;
    }

    const C = Number(characterCount || 0);
    const R = target - C;
    if (!Number.isFinite(C) || R <= 0) {
      // Already met target or invalid
      return new Date();
    }

    const E = Date.now() - startedAt.getTime();
    const M = uploadAt.getTime() - Date.now();
    if (E < 0 || M <= 0) {
      return null;
    }

    const numerator = C * M - R * E;
    const denom = C + R;
    if (!Number.isFinite(numerator) || !Number.isFinite(denom) || denom === 0) {
      return null;
    }

    const dt = numerator / denom; // milliseconds from now
    if (dt <= 0) {
      return new Date();
    }
    if (dt >= M) {
      return null;
    }

    return new Date(Date.now() + dt);
  }

  getWeightedRatioValue(characterCount) {
    const targetCharacterCount = this.getTargetCharacterCount();
    const uploadScheduledAt = this.getFileUploadScheduledAt() || this.getUploadScheduledAt();

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
      const counters = view?.contentEl?.querySelectorAll(".cwc-editor-counter, .cwc-editor-counter-top");
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

    let speedEl = scrollerEl.querySelector(":scope > .cwc-editor-counter");
    if (!speedEl) {
      speedEl = document.createElement("div");
      speedEl.className = "cwc-editor-counter";
      scrollerEl.appendChild(speedEl);
    }

    let counterEl = scrollerEl.querySelector(":scope > .cwc-editor-counter-top");
    if (!counterEl) {
      counterEl = document.createElement("div");
      counterEl.className = "cwc-editor-counter-top";
      scrollerEl.appendChild(counterEl);
    }

    return { counterEl, speedEl };
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

    const els = this.ensureEditorCounterElement(view);
    if (!els) {
      return;
    }
    const { counterEl, speedEl } = els;

    const count = await this.getCurrentCharacterCount();
    const writingSpeed = this.getWritingSpeedText(count);

    const uploadScheduledAt = this.getFileUploadScheduledAt() || this.getUploadScheduledAt();
    const targetCount = this.getTargetCharacterCount();

    const shouldWarn =
      uploadScheduledAt && uploadScheduledAt.getTime() < Date.now() && count < targetCount;
    const shouldSuccess = targetCount && count >= targetCount;

    counterEl.classList.toggle("cwc-editor-counter--warning", shouldWarn);
    counterEl.classList.toggle("cwc-editor-counter--success", shouldSuccess);
    speedEl.classList.toggle("cwc-editor-counter--warning", shouldWarn);
    speedEl.classList.toggle("cwc-editor-counter--success", shouldSuccess);

    // Main counter text (bottom)
    counterEl.setText(`${count} ${targetCount ? `/ ${targetCount}` : ""}`);

    // Speed / requirement / crossing (top)
    const speedParts = [];

    if (writingSpeed !== null) {
      speedParts.push(`${writingSpeed} ch/h`);
    }

    const requiredSpeed = this.getRequiredCharsPerHour(count);

    if (requiredSpeed === 0) {
      speedParts.push(` 0 ch/h`);
    } else if (requiredSpeed !== null) {
      speedParts.push(` ${requiredSpeed} ch/h`);
    }

    const crossing = this.getCrossingTime(count);

    if (requiredSpeed && writingSpeed !== null && requiredSpeed > writingSpeed) {
      speedParts.push('⚠️');
    } else if (crossing instanceof Date) {
      const crossText = this.formatClockText(crossing);

      if (crossText) {
        speedParts.push(` ${crossText}`);
      }
    }

    if (shouldSuccess) {
      speedEl.setText("✅");
    } else {
      speedEl.setText(speedParts.join(' | '));
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


    containerEl.createEl("h3", { text: "File Info Upload" });

    new Setting(containerEl)
      .setName("Enable file info upload")
      .setDesc("Periodically sends the current target file info to the server.")
      .addToggle((toggle) => {
        toggle.setValue(!!this.plugin.settings.enableFileInfoUpload);
        toggle.onChange(async (value) => {
          this.plugin.settings.enableFileInfoUpload = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Server IP or address")
      .setDesc("Example: 192.168.0.10:3000 or http://192.168.0.10:3000")
      .addText((text) => {
        text.setPlaceholder("192.168.0.10:3000");
        text.setValue(this.plugin.settings.fileInfoServerIp || "");
        text.onChange(async (value) => {
          this.plugin.settings.fileInfoServerIp = value;
          await this.plugin.saveSettings();
        });
      });

    containerEl.createEl("h3", { text: "Target File" });

    new Setting(containerEl)
      .setName("Filter property name")
      .setDesc("Leave empty to count only the active file. Or specify a frontmatter property name (e.g., 'category') to count all files with matching values.")
      .addText((text) => {
        text.setPlaceholder("Example: category");
        text.setValue(this.plugin.settings.filterPropertyName || "");
        text.onChange(async (value) => {
          this.plugin.settings.filterPropertyName = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Filter property value")
      .setDesc("The value to match for the property above.")
      .addText((text) => {
        text.setPlaceholder("Example: writing");
        text.setValue(this.plugin.settings.filterPropertyValue || "");
        text.onChange(async (value) => {
          this.plugin.settings.filterPropertyValue = value;
          await this.plugin.saveSettings();
        });
      });

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

    // Writing started at property name
    new Setting(containerEl)
      .setName("Writing started at property")
      .setDesc("Frontmatter property name to store the writing session start time (e.g., writingStartedAt, sessionStart).")
      .addText((text) => {
        text.setPlaceholder("writingStartedAt");
        text.setValue(this.plugin.settings.writingStartedAtPropertyName || "");
        text.onChange(async (value) => {
          this.plugin.settings.writingStartedAtPropertyName = value || DEFAULT_SETTINGS.writingStartedAtPropertyName;
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

    new Setting(containerEl)
      .setName("File upload scheduled at property")
      .setDesc("Frontmatter property name for per-file upload datetime (e.g., uploadScheduledAt, deadline).")
      .addText((text) => {
        text.setPlaceholder("uploadScheduledAt");
        text.setValue(this.plugin.settings.uploadScheduledAtPropertyName || "");
        text.onChange(async (value) => {
          this.plugin.settings.uploadScheduledAtPropertyName = value || DEFAULT_SETTINGS.uploadScheduledAtPropertyName;
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
