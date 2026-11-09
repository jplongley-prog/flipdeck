# FlipDeck

Desktop companion for the **Flipper One** — a cross-platform (Windows 11 + Linux)
control app that talks to the device over SSH.

Built with **Tauri 2** (Rust core) + **React/TypeScript** frontend.

## Status

- ✅ App shell: connection bar, sidebar nav, status line
- ✅ SSH login — **password and key** auth (embedded `russh` client)
- ✅ **Saved connections** — persisted host/port/user/key (never passwords)
- ✅ **Console** — run commands on the device over SSH
- ✅ **Files** — SFTP browse / download / upload with native file dialogs
- ⬜ FlipCTL control panel — _planned_
- ⬜ Profiles/snapshots (btrfs) — _planned_

The SSH/SFTP backend uses the pure-Rust `russh` client — no native SSH library
or system `ssh` binary required, so it ships cleanly on both Windows 11 and Linux.

## Prerequisites

- **Node.js** (installed) — frontend
- **Rust** (rustup) — Tauri core
- **Linux only:** WebKitGTK + build deps

### Install Rust

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
. "$HOME/.cargo/env"
```

### Install Linux system deps (Debian/Kali)

```sh
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libayatana-appindicator3-dev build-essential curl wget file \
  libssl-dev libxdo-dev pkg-config
```

## Run

```sh
npm install          # frontend deps (done)
npm run tauri dev    # launch the desktop app
```

## Build a release

```sh
npm run tauri build
```

## Layout

```
src/               React frontend
  App.tsx          app shell, connection bar, console, saved connections
  Files.tsx        SFTP file browser
  lib/ssh.ts       SSH command wrappers
  lib/sftp.ts      SFTP wrappers
  lib/connections.ts  saved-connection wrappers
src-tauri/         Rust core
  src/lib.rs       ssh / sftp / connections Tauri commands (russh)
  tauri.conf.json  window + bundle config
```

Saved connections live in the OS app-config dir
(`~/.config/net.flipper.flipdeck/connections.json` on Linux).
