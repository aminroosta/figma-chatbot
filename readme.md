# figma-chatbot

A Claude Code plugin that lets Claude execute JavaScript directly in your Figma documents via a local WebSocket bridge.

![figma-chatbot in action](help.png)

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Claude Code   │       │  figma-daemon   │       │  Figma Plugin   │
│                 │       │  (localhost)    │       │  (ui + sandbox) │
│  /figma cmd ────┼──ws──►│                 │◄──ws──┼────────────────►│
│                 │       │   :7017         │       │   figma.* API   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
        │                         │                         │
        │   eval request ────────►│────── forward ─────────►│
        │                         │                         │  executes JS
        │◄─────── result ─────────│◄─────── response ───────│
```

## Prerequisites

- [Bun](https://bun.sh) runtime (macOS only for now)

## Install

```sh
claude plugin install aminrsoota/figma-chatbot
```

Or clone and load locally:

```sh
git clone https://github.com/aminrsoota/figma-chatbot.git
claude --plugin-dir ./figma-chatbot
```

## Figma Client Setup

1. Open Figma Desktop (or browser with a design file open)
2. **Plugins → Development → Import plugin from manifest**
3. Select the `chatbot/` folder inside this repo (contains `manifest.json`)
4. **Plugins → Development → figma-chatbot** to launch
5. Keep the plugin window open while using `/figma`

The plugin UI shows connection state, client ID, and current document/page label.

## Commands

| Command | Purpose |
|---------|---------|
| `/figma-chatbot:figma-setup` | Verify Bun, confirm plugin folder, print Figma import instructions |
| `/figma-chatbot:figma` | Start daemon if needed, evaluate JS in connected Figma client |

### `/figma-chatbot:figma`

With no arguments, reports daemon status and connected clients.

With JS (inline or fenced block):

```
/figma-chatbot:figma
figma.currentPage.selection
```

Returns JSON: `{ ok, result, logs }` or `{ ok: false, error, logs }`.

Multi-client: if multiple Figma windows are connected, pass `--client <id|index>` to target one.

## Architecture

See [docs/architecture.md](docs/architecture.md) for protocol details, data flow, and component responsibilities.

## Files

```
.claude-plugin/plugin.json   # Claude Code plugin manifest
skills/figma-setup/          # /figma-setup command
skills/figma/                # /figma command
figma.ts                     # CLI client (status/start/stop/eval)
figma-daemon.ts              # WebSocket server on 127.0.0.1:7017
chatbot/                     # Figma dev plugin (manifest, ui.html, code.js)
docs/                        # Architecture, cheatsheets
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bun: command not found` | Install Bun, restart shell |
| Daemon running but "no clients" | Open Figma, import + run the dev plugin |
| Port 7017 in use | `bun figma.ts stop` or kill stale process via `/tmp/figma-chatbot.pid` |
| Plugin UI says "disconnected" | Daemon not running; `/figma-chatbot:figma` auto-starts it |

## License

MIT
