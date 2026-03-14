# Simple Word Counter

Obsidian plugin that counts characters in the current note, with customizable regex-based exclusions.

## Features

- Shows current character count in a floating counter at the bottom center of the editor.
- Adds a command: **Show character count**.
- Supports multiple exclusion regex patterns before counting.
- Ignores invalid regex entries safely.

## Default Behavior

- Default exclusion pattern: `\\s`
- This removes whitespace before counting, so the count represents non-whitespace characters by default.

## Installation (Manual)

1. In your vault, open `.obsidian/plugins/`.
2. Create a folder named `custom-word-counter`.
3. Copy these files into that folder:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Reload Obsidian.
5. Go to **Settings -> Community plugins** and enable **Simple Word Counter**.

## Usage

- Open any markdown note.
- The floating `Chars: N` indicator updates automatically as you type.
- Run command palette action: **Simple Word Counter: Show character count** to display a notice.

## Settings

Path: **Settings -> Community plugins -> Simple Word Counter**

- Add one or more regex patterns to exclude from counting.
- You can use either:
  - Plain pattern (example: `\\s`)
  - Slash format with flags (example: `/#[^\\n]*/g`)
- Invalid regex patterns are ignored.

## Development Notes

- Entry file: `main.js`
- Styles: `styles.css`
- Manifest: `manifest.json`
- `minAppVersion`: `1.4.0`
