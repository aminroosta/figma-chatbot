---
name: figma-setup
description: Verify Bun and the Figma dev plugin setup.
disable-model-invocation: true
argument-hint: ""
allowed-tools: Bash, Glob
---

# figma-setup

You are the setup helper for the Figma bridge. Verify Bun, confirm the Figma dev plugin folder exists, and provide import instructions.

Steps:
1) Check Bun.
   - Run `bun --version`.
   - If missing, tell the user to install Bun from https://bun.sh/ and restart their shell.
   - If the user is on macOS, offer to run the official installer only after explicit confirmation:
     `curl -fsSL https://bun.sh/install | bash`
   - Stop if Bun is still unavailable.

2) Verify the Figma dev plugin files exist.
   - Use `Glob` to check for `chatbot/manifest.json` under `${CLAUDE_PLUGIN_ROOT}`.
   - If missing, tell the user the `chatbot/` folder is required and stop.

3) Print import/run instructions.
   - Provide: "Plugins -> Development -> Import Plugin from manifest -> <path to the chatbot folder>".
   - Use `${CLAUDE_PLUGIN_ROOT}/chatbot` as the path (or `pwd` if you are running from the repo).
   - Remind them to run the plugin from the Development menu and keep it open while using `/figma`.

Keep the response short and action oriented.
