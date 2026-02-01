---
name: figma
description: Ensure the bridge is running and evaluate JavaScript in Figma.
disable-model-invocation: true
argument-hint: "[--client <id|index>] [js]"
allowed-tools: Bash, Glob
---

# figma

Ensure the daemon is running, confirm a Figma client is connected, then evaluate the user's JavaScript in the Figma plugin context.

Steps:
1) Check Bun.
   - Run `bun --version`.
   - If missing, tell the user to install Bun from https://bun.sh/ and restart their shell.
   - If the user is on macOS, offer to run the official installer only after explicit confirmation:
     `curl -fsSL https://bun.sh/install | bash`
   - Stop if Bun is still unavailable.

2) Ensure the daemon is running.
   - Run `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts status` and parse the JSON.
   - If `daemon.listening` is false or `daemon.pid` is null, run `bun ${CLAUDE_PLUGIN_ROOT}/figma.ts start`.
   - Re-run `status` to get a fresh client list.

3) If no clients are connected, print the import/run instructions and stop.
   - "Plugins -> Development -> Import Plugin from manifest -> <path to the chatbot folder>".
   - Use `${CLAUDE_PLUGIN_ROOT}/chatbot` as the path (or `pwd` if you are running from the repo).
   - Remind them to run the plugin and keep it open.

4) Determine the JS snippet.
   - Prefer a fenced code block in the user's message.
   - Otherwise, treat the remaining arguments as the JS snippet.
   - If no JS was provided, report the current status (daemon + client list) and stop.

5) Handle multi-client targeting.
   - If there is more than one client and no `--client` argument was provided, list clients with index + label + clientId and ask the user which to target.
   - If `--client` is provided, pass it through to `figma.ts eval` unchanged.

6) Run the eval.
   - Use a single-quoted heredoc to pass the JS via stdin:
     ```sh
     bun ${CLAUDE_PLUGIN_ROOT}/figma.ts eval --client <id|index> <<'EOF'
     <js>
     EOF
     ```
   - Parse the JSON response and report `result`, `error`, and `logs` succinctly.

Keep output concise and action oriented.
