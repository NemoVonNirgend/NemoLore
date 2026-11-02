# Troubleshooting

## Bootstrap or drawer failure

- Confirm the directory is `public/scripts/extensions/third-party/NemoLore`.
- Confirm `manifest.json` points to `bootstrap.js`.
- Remove duplicate NemoLore folders and reload SillyTavern once.
- Check the browser console for the first NemoLore error; later failures may be consequences.

The UI waits briefly for SillyTavern's extension host and installs idempotently. Repeated initialization should not add duplicate lifecycle, summary-display, or post-reply listeners.

## Provider failure

- **Use current chat connection** requires a working active SillyTavern generation connection.
- For a named provider, configure its credentials in SillyTavern's API Connections first, then select it and a model in **NemoLore → Helper connection**. Vertex also needs its region and Express/project or service-account configuration there.
- **Manual OpenAI-compatible endpoint** requires the full chat-completions URL, a valid model, and any required Bearer key. Changing the manual URL clears its old key.
- If a model is missing, refresh the list or use **Enter another model ID…**. Vertex uses SillyTavern's catalogue; listed models still need account access.
- Workflow selectors in Advanced tuning normally stay at **Use shared helper connection**. Integrations can still use registry IDs (`sillytavern`, `st-saved`, `async`).
- Open the inspector to view current routes, recent helper failures, and circuit state; reset the circuit after fixing configuration.

Primary and fallback failures are contained within the helper job and must not abort a foreground reply.

## Helpers appear idle

Check the selected profile, helper enablement, per-workflow toggle, minimum-message count, maximum calls per reply, cooldown, and lore-signal requirement. A successfully completed dedupe key intentionally suppresses the same job replay.

## Repeated helper requests or unexpected temperature

Memory can normally make three extraction requests per reply, plus one each for enabled summary and lore jobs. The concurrency and per-reply limits count jobs. Reducing enabled workflows reduces these requests.

From 1.4.0-rc.5 onward, helper temperature inherits the connection instead of forcing 0.2. **Advanced tuning → Helper temperature** can set a separate value; clear it to inherit. A helper's logged request parameters do not by themselves indicate a change to foreground sampling.

Deleting, editing, or swiping messages cancels obsolete work, invalidates derived memory/summaries, and permits one replacement batch after a new reply completes. Late responses are discarded. Already-applied lore entries can be reviewed in the lore manager. If token counts still grow after updating and refreshing, compare the actual request prompts and workflow names in the inspector; a model-configuration screenshot alone does not identify duplicated content.

## Context is missing

Use the inspector to confirm the contribution was selected rather than omitted by token budget. Summaries and story memories are chat-scoped. Preferences require opt-in plus explicit acceptance; persona preferences must match the active SillyTavern user avatar.

## Semantic retrieval is unavailable

Configure SillyTavern Vector Storage with a source third-party extensions can call. NemoLore reports the inherited source/model and the reason for unavailability. Lexical retrieval continues automatically, so this condition is degraded capability rather than a bootstrap failure.

## Lore update safety

Protect curated entries in the lore manager. Preview operations before applying them. If a chat changes while generation is pending, NemoLore discards the stale result and removes any late-created association rather than writing it to the new chat.

## Reporting a regression

Include the NemoLore version/commit, SillyTavern version/commit, selected profile, provider route names (never secrets), inspector snapshot, first console error, and reproduction steps including any chat switch or reload.
