---
description: Evaluate JavaScript in Figma.
disable-model-invocation: true
argument-hint: "[--client <id|index>] [js]"
allowed-tools: Bash, Glob
---

# /fig:go

Ensure daemon is running, confirm Figma client connected, evaluate JS in Figma plugin context.

1) Check Bun: `bun --version`
   - Missing? Install from https://bun.sh/, restart shell.
   - macOS: offer `curl -fsSL https://bun.sh/install | bash` only after explicit confirmation.

2) Ensure daemon running:
   - `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts status` → parse JSON
   - If `daemon.listening` false or `daemon.pid` null → `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts start`
   - Re-run `status` for fresh client list.

3) No clients? Print import instructions and stop:
   - "Plugins → Development → Import plugin from manifest → `${CLAUDE_PLUGIN_ROOT}/chatbot`"
   - "Press `Cmd+/`, search 'chatbot', run. Keep open."

4) Determine JS snippet:
   - Prefer fenced code block in user message.
   - Otherwise treat remaining arguments as JS.
   - No JS? Report status (daemon + clients) and stop.

5) Multi-client targeting:
   - >1 client and no `--client`? List clients (index + label + id), ask which to target.
   - `--client` provided? Pass through to `figma.ts eval`.

6) Run eval via heredoc:
   ```sh
   bun ${CLAUDE_PLUGIN_ROOT}/figma.ts eval --client <id|index> <<'EOF'
   <js>
   EOF
   ```
   Parse JSON response, report `result`, `error`, `logs` succinctly.
