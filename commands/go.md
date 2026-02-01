---
description: Bridge to the Figma desktop app.
allowed-tools: Bash, Glob
---

# /fig:go

The `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts` command is the bridge between the CLI and the Figma desktop app.
It evaluates JavaScript inside a running Figma dev plugin (main context), where the `figma` global is available,
so snippets can read and update the current file/page/selection.

```sh

bun ${CLAUDE_PLUGIN_ROOT}/figma.ts help
Usage:
  figma.ts status
  figma.ts start
  figma.ts restart
  figma.ts stop
  figma.ts eval [--client <id|index>]
```

Example

```sh
bun ${CLAUDE_PLUGIN_ROOT}/figma.ts eval --client <id|index> <<'EOF'
// JS evaluated in Figma plugin context
EOF
```
