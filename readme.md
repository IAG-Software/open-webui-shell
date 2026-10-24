# Open WebUI Shell

<div align="center">

**A premium desktop experience for the local AI era.**

Electron-based desktop shell for Open WebUI with a macOS-style Spotlight
command bar, Live voice mode, multi-instance management and native Windows 11
integration.

</div>

---

## ✨ Highlights

| Feature | Details |
|---|---|
| 🔍 **Spotlight bar** | Press `Alt+Space` anywhere — a floating glass command bar appears with a smooth spring animation. Search your actual **Open WebUI chats** (through your logged-in session), jump to conversations, run commands, or connect to any instance. |
| 🎙️ **Live Mode** | The glowing mic pill in the Spotlight bar (or `Ctrl+Alt+M`) opens Open WebUI's native voice-call UI in a compact, always-on-top floating window — like a phone call you leave open in the corner. |
| ⚙️ **Full settings app** | Native-feeling settings window: instance management, backdrop material (Mica/Acrylic), custom CSS editor (live-applied), shortcut recorder for every global hotkey, launch-at-login, close-to-tray, chat URL format and more. |
| 🖥️ **Multi-instance** | Save several Open WebUI instances, switch from the tray, Spotlight or Settings. Scan common ports (`Scan now`) to auto-detect instances running locally. |
| 🪟 **Windows 11 goodness** | Mica / Acrylic translucency, hidden title bar with overlay buttons, tray integration, always-on-top mode. |
| ⌨️ **Shortcuts** | All global hotkeys are changeable in Settings → Shortcuts (click the badge and press the new combo). |

## ⌨️ Default global shortcuts

| Shortcut | Action |
|---|---|
| `Alt+Space` | Open/Dismiss Spotlight |
| `Ctrl+Shift+Space` | Hide/show the shell window |
| `Ctrl+Alt+M` | Toggle Live Mode (voice call window) |
| `Ctrl+Alt+D` | Developer tools |
| `Ctrl+,` (in window) | Open Settings |
| `Ctrl +`/`-`/`0` | Zoom |

Inside Spotlight: `↑/↓` navigate · `Enter` run · `Esc` close · `Ctrl+L` toggle Live · `Backspace` backs out of instance-switch mode.

## 🚀 Getting started

> Open WebUI must already be running locally (or point the shell at any instance URL).

```bash
npm install
npm start
```

First launch connects to `http://localhost:8080` — change it in **Settings → Connection** (or Spotlight → “Switch Instance” → “Detect Local Instances”).

Build the installer:

```bash
npm run dist
```

## 🗂️ Project structure

```
main.js               App entry: wiring, IPC, global shortcuts, smoke test
ConfigManager.js      Full settings persistence (atomic, deep-merged)
WindowManager.js      Main window: load, zoom, CSS, close-to-tray
SpotlightManager.js   The floating command bar
LiveModeManager.js    Floating always-on-top voice call window
SettingsWindow.js     Settings UI window
TrayManager.js        Tray icon + menu
InstanceScanner.js    Local port scan → detect Open WebUI / Ollama / other
ui/spotlight.html     Spotlight markup + logic
ui/settings.html      Settings markup
ui/settings.js        Settings logic
ui/preload.js         Hardened contextBridge (allowlisted IPC)
```

## 🔒 Security notes

- Renderer windows have `contextIsolation: true` and no Node integration.
- The preload bridge exposes an **allowlist** of IPC channels only.
- External links leave the instance origin → opened in the system browser instead.

## 🛡️ License & branding

MIT. “Open WebUI Shell” is distinct from upstream Open WebUI; rendered Open
WebUI content remains subject to the Open WebUI License. This project is not
affiliated with or endorsed by Open WebUI.

---

<div align="center"><sub>Built with care by <strong>Khalid Jehani</strong></sub></div>
