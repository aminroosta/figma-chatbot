---
description: Verify Bun and Figma dev plugin setup.
allowed-tools: Bash, Glob
---

# /fig:setup

1) Check Bun: `bun --version`
   - Offer `curl -fsSL https://bun.sh/install | bash` only after explicit confirmation.

3) Print import instructions:
   - "Plugins → Development → Import plugin from manifest → `${CLAUDE_PLUGIN_ROOT}/chatbot`"
   - "Press `Cmd+/`, search 'chatbot', run. Keep open while using `/fig:go`."
