# figma-chatbot

A Claude Code plugin that lets Claude execute JavaScript directly in your Figma documents via a local WebSocket bridge.

![figma-chatbot in action](help.png)

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Claude Code   │       │  figma-daemon   │       │  Figma Plugin   │
│                 │       │  (localhost)    │       │  (ui + sandbox) │
│  /figma cmd ────┼──ws──►│                 │◄──ws──┼─────────────────│
│                 │       │   :7017         │       │   figma.* API   │
└─────────────────┘       └─────────────────┘       └─────────────────┘
        │                         │                         │
        │   eval request ────────►│────── forward ─────────►│
        │                         │                         │  executes JS
        │◄─────── result ─────────│◄─────── response ───────│
```

## Prerequisites

- [bun](https://bun.sh) runtime
  - Can be installed with `curl -fsSL https://bun.sh/install | bash`

## Claude Code Setup

Add the marketplace, then install:

```sh
/plugin marketplace add aminroosta/figma-chatbot
/plugin install fig@fig

/fig:setup # new setup command
/fig:go    # interact with figma desktop app
```

## Figma Client Setup

1. Open Figma Desktop app with a design file open
2. **Plugins → Development → Import plugin from manifest**
3. Select `~/.claude/plugins/marketplaces/fig/chatbot/` (contains `manifest.json`)
  - To see hidden folders like `~/.claude/` on MacOS, you can press `Cmd+Shift+.`.
4. Press `Cmd+/` in figma, search "chatbot", press enter to launch; keep the plugin window open
5. In Claude Code CLI, use `/fig:go` to interact with Figma

The plugin UI shows connection state with Claude Code.

## Commands

| Command | Purpose |
|---------|---------|
| `/fig:setup` | Verify setup |
| `/fig:go` | Interact with figma desktop app |


## Architecture

See [docs/architecture.md](docs/architecture.md) for technical details.

## Files

```
.claude-plugin/
  plugin.json                # Claude Code plugin manifest
  marketplace.json           # Marketplace catalog for distribution
commands/
  setup.md                   # /fig:setup
  go.md                      # /fig:go
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
| Plugin UI says "disconnected" | Run `/fig:go start daemon` in claude code to start the daemon |


## License

MIT
