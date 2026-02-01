# Architecture

This repository contains a Claude Code plugin that bridges Claude to a local Figma *development* plugin via a localhost WebSocket daemon.

The high-level idea:

- Claude Code runs local scripts (via Bun) to start/manage a daemon and to send JavaScript for execution.
- A Figma dev plugin (in `./chatbot/`) stays open and connects back to the daemon.
- JavaScript is executed in the Figma plugin *main* context so the `figma` global is available.

Scope note:

- Runtime support is macOS-only.
- Bun installation is instructions-first, but `/figma` offers to run the official installer.

## User-Facing Commands

The Claude Code plugin exposes two commands:

- `/figma-setup`
- `/figma`

Note: Claude Code plugin commands are typically namespaced as `/plugin-name:command`. This doc refers to the user-facing intent as `/figma-setup` and `/figma`.

### `/figma-setup`

Purpose: one-time (or occasional) setup guidance.

- Verify Bun is available (or provide the Bun install link).
- Verify the Figma dev plugin folder exists at `./chatbot/` (specifically `./chatbot/manifest.json`).
- Print instructions to import the Figma dev plugin:
  - "Plugins -> Development -> Importa Plugin from manifest -> <the directory where the ./chatbot folder is>"
  - After import, run the plugin from the Development menu and keep it open while using `/figma`.

### `/figma`

Purpose: ensure the local bridge is running and connected, then enable evaluation of arbitrary JavaScript in the Figma plugin context.

Behavior:

1. Ensure Bun is installed/available on `PATH`.
   - If missing, print install instructions and offer to install Bun (macOS) from https://bun.sh/
   - Suggested install action (only if the user explicitly confirms): `curl -fsSL https://bun.sh/install | bash`
2. Ensure the WebSocket daemon is running.
   - The daemon process writes a PID file at `/tmp/figma-chatbot.pid`.
   - If the PID file is missing/stale, start (or restart) the daemon.
3. Ensure the daemon is connected to a Figma plugin client.
   - "Connected" means at least one `ui.html` client is currently attached and has completed a handshake.
   - If not connected, tell the user:
     - "Plugins -> Development -> Importa Plugin from manifest -> <the directory where the ./chatbot folder is>".

## Components

### 1) Claude Code plugin

Provides `/figma-setup` and `/figma`.

Responsibilities:

- Detect Bun (`bun --version`).
- Invoke `figma.ts` to inspect/start/restart the daemon.
- When asked to run code, pass user-provided JavaScript to `figma.ts` and return the evaluated result back to the user.

### 2) `figma-daemon.ts` (background daemon)

A long-running WebSocket server on localhost.

Responsibilities:

- Bind `ws://localhost:7017/` (hardcoded).
- Bind on `127.0.0.1` only.
- Maintain a registry of connected Figma plugin clients (from `ui.html`) and connected CLI clients (from `figma.ts`).
- Accept evaluation requests from `figma.ts` and forward them to the selected Figma client.
- Relay evaluation results back to the requester.
- Enforce a per-request timeout (default: 30s) and return a timeout error if the client does not respond.
- Write and manage the PID file: `/tmp/figma-chatbot.pid`.
- Append logs to `/tmp/figma-chatbot.log`.

Operational expectations:

- Single-instance behavior (PID file + process existence checks).
- Stale PID detection (PID file exists but process is gone).
- Graceful shutdown and cleanup of `/tmp/figma-chatbot.pid`.
- Persist until explicitly stopped (no idle auto-shutdown).

### 3) `figma.ts` (executable client)

A CLI-like script used by `/figma`.

Responsibilities:

- Check daemon status (running vs not running; connected vs not connected).
- Start or restart the daemon (spawning `figma-daemon.ts` via Bun).
- Stop the daemon.
- Send arbitrary JavaScript to the daemon for execution in the Figma plugin context.

Targeting rules:

- If zero Figma clients are connected, `figma.ts` reports "not connected" and `/figma` prints the Figma import/run instructions.
- If exactly one Figma client is connected, it is the default target.
- If more than one Figma client is connected, `figma.ts` requires `--client <id|index>` (strict).

Recommended subcommands:

- `figma.ts status` (JSON): daemon pid/listening + connected clients.
- `figma.ts start|restart|stop`.
- `figma.ts eval --client <id|index>` (or stdin-only eval when exactly one client is connected).

Primary UX pattern: heredoc JavaScript

```sh
figma.ts <<'EOF'
  // js code to be evaluated in figma plugin context
EOF
```

Expected behavior:

- Read the entire stdin payload as a JavaScript string.
- Send it to the daemon as an eval request.
- Print JSON to stdout: `{ ok: true, result, logs }` or `{ ok: false, error, logs }`.

### 4) Figma dev plugin (`./chatbot/`)

This is a separate Figma plugin that the user loads into Figma via "Import plugin from manifest".

Lifecycle:

- The plugin is intended to stay running while the bridge is in use.
- In normal operation it should not call `figma.closePlugin()`; the user can close/cancel it, which disconnects the websocket.

UI:

- Show a small visible status UI (connection state, clientId, label).

Key files:

- `chatbot/manifest.json`: Figma plugin manifest.
- `chatbot/code.js`: main (sandbox) plugin code with access to the `figma` global.
- `chatbot/ui.html`: UI iframe that has browser APIs (including `WebSocket`).

#### `ui.html` (WebSocket client + message bridge)

Responsibilities:

- Repeatedly attempt to connect to the daemon at `ws://localhost:7017/`.
- Maintain the connection (reconnect on failure; exponential backoff + jitter; cap the delay).
- Receive eval requests from the daemon.
- Forward eval requests to `code.js` via `parent.postMessage({ pluginMessage: ... }, '*')`.
- Receive eval responses from `code.js` and forward them back to the daemon.

Client identity:

- `ui.html` generates a UUID `clientId` and persists it in `localStorage`.
- On connect, `ui.html` handshakes with `{ role: "figma-ui", clientId }`.
- `ui.html` maintains a human-readable `label` derived from main context: `figma.root.name` + `figma.currentPage.name`.
- `ui.html` reports `label` to the daemon (initially in `hello` if available, otherwise via a later update message).

Important runtime constraint:

- `ui.html` has browser APIs, but cannot access the `figma` scene graph directly.

#### `code.js` (Figma context evaluator)

Responsibilities:

- Receive eval requests from `ui.html`.
- Evaluate the provided JavaScript with the `figma` global object in scope.
- Plain JavaScript (no TypeScript, no build step).
- Return a serializable result or a structured error.

Evaluation model:

- The implementation should treat incoming code as untrusted and only run it on the local machine.
- To support async code (and a small helper surface), wrap snippets like:

```ts
// conceptually
const result = await (async ({ figma, helpers }) => {
  // user snippet
})({ figma, helpers })
```

Helper surface (initial):

- `helpers.notify(...)`: wraps `figma.notify`.
- `helpers.serializeNode(node)`: converts Figma nodes to JSON-friendly objects.

Logging:

- Capture `console.log` (and optionally other console methods) during snippet execution and return as `logs` in the response.

Result constraints:

- Returned values must be structured-clone / JSON-friendly.
- Figma node objects should be converted to plain objects (e.g. `{ id, name, type }`) before returning.
- Large results are allowed (no enforced cap); be mindful of memory and latency.

## Data Flow (Eval)

End-to-end sequence for evaluating JavaScript:

1. User runs `/figma` (optionally providing a JS snippet).
2. Claude Code plugin calls `figma.ts`.
3. `figma.ts` ensures the daemon is up (or starts it), then resolves the target Figma client (default if exactly one; otherwise require `--client`).
4. `figma.ts` sends an eval request to `figma-daemon.ts` over the same WebSocket endpoint.
5. `figma-daemon.ts` forwards the request to the selected connected `ui.html` client.
6. `ui.html` forwards the request to `code.js`.
7. `code.js` evaluates JavaScript with access to `figma` and returns `{ result | error }`.
8. `ui.html` forwards the response to the daemon.
9. `figma-daemon.ts` forwards the response back to `figma.ts`.
10. `figma.ts` prints the final output; `/figma` presents it to the user.

## WebSocket Protocol (Suggested)

All messages are UTF-8 JSON objects.

Minimum fields:

- `type`: one of `hello`, `hello_ack`, `client_update`, `eval_request`, `eval_response`, `status_request`, `status_response`.
- `id`: request/response correlation id (string).

Roles and handshake:

- The first message each peer sends is `hello` with a `role`.
- The daemon replies with `hello_ack`.

```json
{ "type": "hello_ack" }
```

Figma UI handshake:

```json
{ "type": "hello", "role": "figma-ui", "clientId": "uuid", "label": "My File / Page 1" }
```

Client update (optional, for when label becomes available later):

```json
{ "type": "client_update", "clientId": "uuid", "label": "My File / Page 1" }
```

CLI handshake:

```json
{ "type": "hello", "role": "cli" }
```

Eval request:

```json
{ "type": "eval_request", "id": "...", "clientId": "uuid", "js": "..." }
```

Eval response:

```json
{ "type": "eval_response", "id": "...", "ok": true, "result": { "any": "json" }, "logs": ["..."] }
```

Errors:

```json
{ "type": "eval_response", "id": "...", "ok": false, "error": { "name": "Error", "message": "...", "stack": "..." }, "logs": ["..."] }
```

Status request/response:

```json
{ "type": "status_request", "id": "..." }
```

```json
{ "type": "status_response", "id": "...", "daemon": { "pid": 123, "listening": true }, "clients": [ { "clientId": "uuid", "label": "My File / Page 1" } ] }
```

Concurrency:

- Parallel in-flight evals are allowed.
- Every eval must carry a unique `id`; the daemon and the UI must route responses by `id`.
- The daemon times out requests that do not receive an `eval_response` within 30 seconds.

## Process Management

Daemon lifecycle is managed via PID file:

- PID file path: `/tmp/figma-chatbot.pid`.
- Log file path: `/tmp/figma-chatbot.log`.
- Start rules:
  - If PID file does not exist: start daemon.
  - If PID file exists but process is not running: treat as stale; remove PID file; start daemon.
  - If daemon is running but unhealthy (e.g. not listening): restart.

Stop rules:

- `figma.ts` can stop the daemon (terminate PID, then remove PID file).

Connection health:

- Daemon is considered "connected" only when at least one Figma UI client is attached.
- If daemon is running but not connected, `/figma` prints the Figma import instruction:
  - "Plugins -> Development -> Importa Plugin from manifest -> <the directory where the ./chatbot folder is>"

## Security Notes

- This design intentionally supports arbitrary JavaScript execution in a Figma document context.
- Bind only to localhost (`127.0.0.1`) and avoid exposing the daemon port on the network.
- No authentication: any local process could connect to `ws://localhost:7017/`.
- Treat any future plan to allow remote connections as a security-sensitive change (authentication, origin checks, encryption).

## Troubleshooting

- Bun missing: install from https://bun.sh/ and restart your shell so `bun` is on `PATH`.
- Daemon running but not connected: import/run the Figma dev plugin and keep it open.
- If the Figma plugin is closed/cancelled, the UI websocket disconnects; relaunch the plugin.
- Port in use (`7017`): stop the existing process (check `/tmp/figma-chatbot.pid`) or restart the daemon.

## Suggested Next Steps

- [ ] Scaffold the Figma dev plugin in `chatbot/` (`manifest.json`, `ui.html`, `code.js`) with a small visible status UI (connected/disconnected, `clientId`, label).
- [ ] Implement `figma-daemon.ts`: WS server on `127.0.0.1:7017`, PID `/tmp/figma-chatbot.pid`, logs `/tmp/figma-chatbot.log`, role handshake, client registry, request routing by `id`, parallel in-flight evals, 30s timeout, graceful shutdown/cleanup.
- [ ] Implement `figma.ts` executable: `status/start/restart/stop/eval`, strict `--client <id|index>` when >1 client, heredoc JS input, JSON output `{ ok, result|error, logs }`.
- [ ] Wire `chatbot/ui.html` to the daemon: reconnect with exponential backoff + jitter, handshake `{ role: "figma-ui", clientId, label }`, forward `eval_request` to `code.js` and return `eval_response` (including `logs`).
- [ ] Implement evaluator in `chatbot/code.js`: async wrapper `(async ({ figma, helpers }) => { ... })`, `helpers.notify` + `helpers.serializeNode`, capture `console.log` into `logs`, serialize errors.
- [ ] Implement Claude Code plugin commands `/figma-setup` and `/figma`: Bun detection (macOS) with instructions + explicit-confirm install option, daemon manage via `figma.ts`, and "Import Plugin from manifest … ./chatbot" guidance when not connected.
- [ ] Run an end-to-end smoke test: start daemon, connect Figma plugin, run a trivial snippet and a snippet that edits selection; confirm multi-client strict targeting and timeout behavior.
