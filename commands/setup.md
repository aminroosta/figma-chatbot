---
name: setup
description: Verify Bun and Figma dev plugin setup.
disable-model-invocation: true
allowed-tools: Bash, Glob
---

# /fig:setup

Verify Bun, confirm the Figma dev plugin folder exists, provide import instructions.

1) Check Bun: `bun --version`
   - Missing? Install from https://bun.sh/, restart shell.
   - macOS: offer `curl -fsSL https://bun.sh/install | bash` only after explicit confirmation.

2) Verify `${CLAUDE_PLUGIN_ROOT}/chatbot/manifest.json` exists via Glob.
   - Missing? Tell user `chatbot/` folder is required.

3) Print import instructions:
   - "Plugins → Development → Import plugin from manifest → `${CLAUDE_PLUGIN_ROOT}/chatbot`"
   - "Press `Cmd+/`, search 'chatbot', run. Keep open while using `/fig:go`."
