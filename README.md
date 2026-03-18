# Cursor Spend Tracker (CLI + macOS notification)

Track your Cursor API spend from the terminal and get a summary in a macOS notification—no VS Code or Cursor window required.

This project adds a **CLI** and a **notification script** on top of the logic from the [Cursor Spend Tracker](https://github.com/maurice2k/cursor-spend-tracker) extension. It reads the same Cursor auth state and usage APIs to show spend, today/yesterday/last 2h stats.

---

## Requirements

- **Node.js** (with `npm`)
- **sqlite3** on your PATH (used to read Cursor’s auth token from its state DB)
- **Cursor** used at least once on this machine (so the auth token exists)
- **macOS** (for the notification script; the CLI works on any platform)

Install `sqlite3` if needed:

- **macOS (Homebrew):** `brew install sqlite`

---

## Setup

```bash
git clone https://github.com/rohm1/cursor-spend-tracker-cli.git
npm ci --ignore-scripts
```

---

## Usage

### CLI only (terminal output)

Print your current Cursor spend summary to stdout:

```bash
npm run spend
```

Or:

```bash
npx tsx cli.ts
```

Example output:

```
Spend: $3.96 / $100 ($96.04 left)
Today: 16 reqs, $0.98
Yesterday: 3 reqs, $0.17
Last 2h: 2 reqs, $0.15
```

### CLI + macOS notification

Run the CLI and show the same summary in a **macOS notification**:

```bash
./notify-spend.sh
```

Or:

```bash
npm run notify-spend
```

On success the notification title is **“Cursor Spend”**; on error (e.g. not logged in, network issue) it’s **“Cursor Spend — Error”** and the body shows the error message.

You can run `./notify-spend.sh` from cron, launchd, or a keyboard shortcut to check spend without opening Cursor.

---

## How it works

- **`cli.ts`** – Standalone script (no VS Code dependency). Reads the Cursor session token from the Cursor state SQLite DB, calls Cursor’s usage APIs, and prints a short summary.
- **`notify-spend.sh`** – Runs `cli.ts` with `npx tsx`, captures the output, and displays it via macOS `osascript` (AppleScript) as a notification.

The extension UI and logic (auth, API calls, formatting) are from the original Cursor Spend Tracker extension.

---

## Acknowledgement

The core logic (reading Cursor auth from the state DB, calling Cursor usage APIs, and the usage/event formatting) is derived from:

- **[Cursor Spend Tracker](https://github.com/maurice2k/cursor-spend-tracker)** by [maurice2k](https://github.com/maurice2k)  
  - Original README: <https://github.com/maurice2k/cursor-spend-tracker/blob/main/README.md>

This repo adds a VSCode-free CLI and a macOS notification wrapper around that logic; it is not affiliated with the original extension author.
