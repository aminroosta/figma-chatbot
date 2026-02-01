# Claude Code Plugins Cheatsheet

This is a dense reference for how Claude Code plugins are structured, loaded, and distributed, with emphasis on: long-running tasks (hooks), command helpers (skills/commands), bundled scripts, and distribution via marketplaces.

## Mental model

- A *plugin* is a directory containing `.claude-plugin/plugin.json` plus optional components at the plugin root.
- Plugin-provided slash commands/skills are *namespaced* to avoid collisions: `/plugin-name:skill`.
- Installed plugins are *copied to a cache directory* (not used in-place), so relative paths and file inclusion rules matter.
- Plugins are “config + files”; Claude Code does not define a general “install step” for dependency installs. If your scripts need runtimes (bun, python, jq, etc.), users must have them available.

## Directory layout (canonical)

Only `plugin.json` goes in `.claude-plugin/`. Everything else is at the plugin root.

```text
my-plugin/
  .claude-plugin/
    plugin.json
  skills/
    my-skill/
      SKILL.md
      reference.md            (optional)
      scripts/                (optional)
  commands/                   (optional; legacy-style skills)
    helper.md
  agents/                     (optional)
    my-agent.md
  hooks/                      (optional)
    hooks.json
  scripts/                    (optional; hook/util scripts)
    do-thing.sh
    helper.ts
  .mcp.json                   (optional)
  .lsp.json                   (optional)
```

## Manifest: `.claude-plugin/plugin.json`

Minimal example:

```json
{
  "name": "my-plugin",
  "description": "What it adds",
  "version": "1.0.0",
  "author": { "name": "You" }
}
```

Core fields:

- `name` (required): plugin identifier; also the *namespace prefix* for skills/commands.
- `version`: semantic version string.
- `description`: shown in plugin manager UI.
- `author`, `homepage`, `repository`, `license`, `keywords`: metadata for discovery.

Component path fields (all relative to plugin root; must start with `./`):

- `commands`: string or array of files/dirs containing markdown commands.
- `skills`: string or array of dirs containing `skills/<name>/SKILL.md`.
- `agents`: string or array for subagent definitions.
- `hooks`: path or inline object (same schema as hooks settings).
- `mcpServers`: path or inline object.
- `lspServers`: path or inline object.

Important behavior:

- Custom paths *supplement* defaults (`commands/`, `skills/`, `agents/`, etc.), they don’t replace them.
- Use `${CLAUDE_PLUGIN_ROOT}` in hook commands and MCP configs to avoid “where was this installed?” problems.

## Skills vs commands (and naming)

Claude Code treats both as “skills” that can become `/slash` commands.

- `skills/<skill>/SKILL.md`: directory-based (supports supporting files).
- `commands/<name>.md`: file-based (legacy; still supported).

In plugins:

- Folder/file name becomes the skill name.
- Invocation is always namespaced: `/my-plugin:skill-name`.

### Skill frontmatter (high-signal fields)

`skills/<name>/SKILL.md` begins with YAML frontmatter.

```yaml
---
name: deploy-helper
description: Explains and runs the repo's deploy workflow
disable-model-invocation: true
argument-hint: "[env] [service]"
allowed-tools: Bash(bun *), Read, Grep
context: fork
agent: Explore
---
```

Notes:

- `disable-model-invocation: true`: keeps Claude from auto-invoking; you run it explicitly.
- `allowed-tools`: tools permitted without interactive approval while this skill is active.
- `context: fork` + `agent`: run the skill in a forked subagent context.
- Argument substitution: `$ARGUMENTS`, `$ARGUMENTS[0]`, `$0`, `${CLAUDE_SESSION_ID}`.

## Agents (subagents)

Plugins can ship specialized subagents in `agents/*.md`.

- Agents appear in `/agents`.
- Claude can invoke them based on their descriptions/capabilities, or you can invoke manually.

## Hooks (automation + long-running work)

Plugins can ship hooks as `hooks/hooks.json` (or inline in `plugin.json`).

Key ideas:

- Hooks run on lifecycle events (examples: `SessionStart`, `PreToolUse`, `PostToolUse`, `SessionEnd`, etc.).
- Each event has matcher groups: a `matcher` regex filters what the hook applies to (often the tool name like `Bash`, `Write|Edit`, or `mcp__.*`).
- Command hooks receive JSON on stdin and can emit JSON on stdout (only parsed on exit code `0`).

### Long-running tasks: `async` command hooks

For “run tests after edits”, “kick off a build”, “sync something”, etc., command hooks support background execution:

- Field: `async` (command hooks only)
- Behavior: runs in the background without blocking the session.
- Limitations: async hooks can’t meaningfully block/control the triggering action; “decision” fields don’t apply.
- Delivery: async hook output (e.g. `systemMessage` / `additionalContext`) is surfaced on the *next* conversation turn.
- Timeouts: hook handler field `timeout` is seconds; defaults: 600 (command), 30 (prompt), 60 (agent). For async command hooks, `timeout` is the max background runtime.

Example (plugin hook):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/scripts/run-tests.sh",
            "async": true,
            "timeout": 120,
            "statusMessage": "Running tests in background"
          }
        ]
      }
    ]
  }
}
```

### Hook IO at a glance

- stdin: JSON including common fields like `session_id`, `cwd`, `hook_event_name`, plus event-specific fields (`tool_name`, `tool_input`, `prompt`, etc.).
- exit codes:
  - `0`: success; stdout may be parsed as JSON output (if it’s *only* a JSON object).
  - `2`: blocking error for events that support blocking (e.g. `PreToolUse`, `UserPromptSubmit`).
  - other: non-blocking error.

Useful hook output fields (top-level):

- `systemMessage`: warning/info shown to the user.
- `continue: false` + `stopReason`: stop processing.

Event-specific outputs are nested under `hookSpecificOutput` with `hookEventName`.

### Pathing and environment

- `${CLAUDE_PLUGIN_ROOT}`: absolute path to the plugin root (works even when installed from marketplace cache).
- `$CLAUDE_PROJECT_DIR`: project root directory.

## MCP servers and LSP servers (optional)

- `.mcp.json` or `plugin.json:mcpServers`: bundle MCP server configs; use `${CLAUDE_PLUGIN_ROOT}` for commands/cwd/config paths.
- `.lsp.json` or `plugin.json:lspServers`: configure language server(s); binaries must exist on the user machine’s `PATH`.

## Plugin caching (critical for distribution)

When a plugin is installed, Claude Code copies it into a cache directory.

Implications:

- `../something` references outside the plugin root won’t work after installation.
- Anything your helpers need must be included under the copied root (or brought in via symlinks that are followed during copying).

Two documented patterns for shared files:

- Put shared content *inside* the directory tree that the marketplace `source` copies.
- Use symlinks within the plugin directory pointing to external content; symlink targets are followed during copying.

## Distribution: marketplaces

To distribute easily, publish a marketplace repo with `.claude-plugin/marketplace.json`.

Minimal marketplace file:

```json
{
  "name": "my-marketplace",
  "owner": { "name": "You" },
  "plugins": [
    {
      "name": "my-plugin",
      "source": "./plugins/my-plugin",
      "description": "Adds helpers"
    }
  ]
}
```

Marketplace `source` options (high-level):

- relative path in the marketplace repo (works when marketplace is added via git clone)
- GitHub repo source `{ "source": "github", "repo": "owner/repo", "ref": "v1.2.3", "sha": "..." }`
- git URL source `{ "source": "url", "url": "https://...repo.git", "ref": "main", "sha": "..." }`

Users add marketplaces via `/plugin marketplace add ...` and install via `/plugin install plugin@marketplace`.

## Development loop / debugging

- Load a local plugin directory without installing: `claude --plugin-dir ./path/to/plugin`.
- Validate manifests/marketplaces: `claude plugin validate .` (or `/plugin validate .`).
- Debug plugin/hook loading: `claude --debug`.

## Bundling JS helpers with bun

Operational facts to design around:

- Claude Code executes hook commands / Bash tool commands on the user machine; it does not bundle runtimes.
- If you call `bun`, bun must be on `PATH` (or you must invoke it via an explicit absolute path).
- If your TypeScript/JS helpers need dependencies, those dependencies must be available *in the installed plugin copy*; there is no built-in “npm install/bun install on plugin install” lifecycle.

Common packaging shapes (pick based on your constraints):

- Ship a single-file bundled JS helper (no runtime deps beyond bun) and run it with `bun`.
- Ship a small TS/JS project and vendor dependencies into the plugin tree (so the cached copy contains them).
- Ship a compiled artifact (so your hook runs a binary/script with minimal external requirements).

When invoking scripts from hooks/skills:

- Use `${CLAUDE_PLUGIN_ROOT}/scripts/...` paths.
- Consider `statusMessage` + `timeout` for anything that can take time.
- Use async hooks if you want “kick it off, don’t block”.

## Quick lookup

- Plugin root marker: `.claude-plugin/plugin.json`
- Plugin namespace: `/plugin-name:skill`
- Dev load: `claude --plugin-dir ./my-plugin`
- Distribution: `.claude-plugin/marketplace.json`
- Cache-safe paths: `${CLAUDE_PLUGIN_ROOT}/...`
- Long-running hook: command hook + `async: true`
