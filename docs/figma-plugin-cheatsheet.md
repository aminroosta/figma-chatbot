# Figma Plugin Architecture Cheatsheet

This is a high-density reference for how Figma plugins are structured and how execution, networking, and messaging behave at runtime.

## Execution Model (Two Worlds)

Plugins typically have two cooperating runtimes:

- Main plugin code ("sandbox", sometimes called "main thread")
  - Minimal JS environment (ES6+); no DOM; no `XMLHttpRequest`; no browser `window` APIs.
  - Has access to the Figma scene graph via the `figma` global object (read/write).
  - Must terminate with `figma.closePlugin()`; plugins are user-invoked, not background daemons.
- UI code (iframe)
  - Created via `figma.showUI(...)` and runs in an `<iframe>`.
  - Has browser APIs (DOM, networking APIs like `fetch`, `WebSocket`, etc.), but no direct access to the Figma scene.
  - Communicates with main via message passing.

Practical implication: if you need browser primitives (WebSocket, DOM rendering, OAuth flows, etc.), that work usually lives in the UI iframe and is proxied to main.

## Lifecycle / Concurrency

- Invocation is always user-driven; one plugin action at a time per user.
- Figma shows a "Running …" toast while the plugin is active; if you never call `figma.closePlugin()` it can appear to run indefinitely until cancelled.
- The user can cancel a running plugin; Figma will close it.

## Manifest Anatomy (`manifest.json`)

Core fields:

```json
{
  "name": "MyPlugin",
  "id": "...",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma", "figjam", "slides", "buzz", "dev"],
  "documentAccess": "dynamic-page",
  "networkAccess": {
    "allowedDomains": ["none"],
    "devAllowedDomains": []
  }
}
```

Notable manifest concepts:

- `editorType`: determines which editor(s) the plugin appears in.
- `menu`: multi-command plugins; selected command appears as `figma.command`.
- `documentAccess: "dynamic-page"`: modern requirement; pages load on demand and many APIs become async.
- `permissions`: gates access to APIs like `figma.currentUser`, `figma.activeUsers`, `figma.teamLibrary`, payments.
- `networkAccess`: declares which domains/schemes the plugin may connect to; affects CSP enforcement for plugin-originated connections.
- `build` (experimental): shell command run before loading `main`/`ui`.

## Network Access + CSP (What Gets Blocked)

Figma enforces a Content Security Policy based on `networkAccess.allowedDomains` and `networkAccess.devAllowedDomains`.

- If a request originates from plugin code/UI to a domain not permitted, it is blocked with a CSP error.
- Domain patterns can be narrow (exact path) or broad (wildcards).
- Allowed patterns can include schemes: `http`, `https`, `ws`, `wss`.
- Localhost / dev servers are expected to be listed under `devAllowedDomains` for development.

The plugin UI iframe typically has a `null` origin; this can constrain CORS behavior: many APIs must reply with `Access-Control-Allow-Origin: *` for requests from the UI to succeed.

## Messaging Between UI and Main

Main -> UI:

```ts
figma.showUI(__html__)
figma.ui.postMessage({ type: 'hello', payload: 123 })
```

UI -> Main:

```js
parent.postMessage({ pluginMessage: { type: 'do-something', payload: 123 } }, '*')
```

Receiving in main:

```ts
figma.ui.onmessage = (msg) => {
  // msg is the value that was sent as pluginMessage
}
```

Receiving in UI:

```js
onmessage = (event) => {
  // event.data.pluginMessage is the value sent from main via figma.ui.postMessage
}
```

Notes:

- UI messages are wrapped under `pluginMessage`; main messages are not.
- Messages serialize like structured clones; prototypes/methods do not survive; `Uint8Array` is supported.

## Common Architectural Split

Typical division of responsibilities:

- UI iframe: networking, auth, rendering, user inputs, websocket client(s).
- Main sandbox: all reads/writes against `figma` document state; selection; node creation; font loading; undo boundaries.

This split is often implemented as an RPC boundary:

- UI sends `{ id, method, params }`.
- Main executes `method` (using `figma.*`) and replies with `{ id, result }` or `{ id, error }`.

## Document Model Essentials

- The file is a node tree rooted at a `DocumentNode`, with `PageNode` children.
- Files are loaded dynamically; pages outside the current view may not be loaded and require async access patterns.
- Write operations are done by creating/modifying nodes: frames, components, vectors, text, etc.

## Fonts, Images, and Other Async Gotchas

- Text: editing text requires fonts to be loaded via `figma.loadFontAsync(...)` before setting `characters`.
- Images/resources: network access restrictions apply to fetching external resources.
- Many APIs are async to accommodate dynamic file loading.

## UI Hosting Modes

- Null-origin iframe (default): UI HTML is embedded via `figma.showUI(__html__)`.
- Non-null origin iframe (navigated): UI can redirect itself to a URL (hosted UI). Message security becomes relevant:
  - Messages can include `pluginId` to scope delivery.
  - PostMessage target origin can be narrowed (e.g. `https://www.figma.com`) instead of `'*'`.

## WebSocket Notes (Local Development)

For designs that involve a local WebSocket server such as `ws://localhost:7017/`:

- WebSocket is a browser API; in the Figma model it naturally fits in the UI iframe (not the main sandbox).
- `networkAccess.devAllowedDomains` supports `ws://...` / `wss://...` patterns; connect attempts outside the allowlist can surface as CSP violations.
- If the plugin closes (or the user cancels it), any active UI websocket connection is torn down along with the iframe.

## Dynamic Code Execution (`eval`) as a Design Constraint

- Plugins are JavaScript; dynamic evaluation exists in JavaScript, but behavior can differ from typical web pages.
- Tooling note from Figma docs: Webpack devtool settings are sometimes adjusted because "Figma's `eval` works differently than normal eval".
- If code is injected from outside (e.g. via websocket), where it is executed matters:
  - Executing in main has access to `figma` but not browser APIs.
  - Executing in UI has browser APIs but no `figma` access (must message main).

Observability: console output is available (minimal console in main; standard-ish console in UI), and CSP/network errors appear in the developer console.

## Quick Reference: Important Globals

- Main sandbox:
  - `figma` (primary API surface)
  - `figma.ui` (UI lifecycle + postMessage bridge)
  - `fetch` (Figma-provided Fetch API; string URL; plain-object headers)
- UI iframe:
  - `window`, DOM, browser `fetch`, `WebSocket` (subject to CSP/CORS)
  - `parent.postMessage(...)` bridge back to main

## Source Links (Official Docs)

- How plugins run: https://www.figma.com/plugin-docs/how-plugins-run/
- Manifest: https://www.figma.com/plugin-docs/manifest/
- Creating UI + messaging: https://www.figma.com/plugin-docs/creating-ui/
- Network access guide: https://www.figma.com/plugin-docs/making-network-requests/
- Global `fetch` reference: https://www.figma.com/plugin-docs/api/properties/global-fetch/
- `figma.ui` reference: https://www.figma.com/plugin-docs/api/figma-ui/
