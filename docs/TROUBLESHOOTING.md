# Troubleshooting

## Bootstrap or drawer failure

- Confirm the directory is `public/scripts/extensions/third-party/NemoLore`.
- Confirm `manifest.json` points to `bootstrap.js`.
- Remove duplicate NemoLore folders and reload SillyTavern once.
- Check the browser console for the first NemoLore error; later failures may be consequences.

The UI waits briefly for SillyTavern's extension host and installs idempotently. Repeated initialization should not add duplicate lifecycle, summary-display, or post-reply listeners.

## Provider failure

- `sillytavern` requires a working active SillyTavern generation connection.
- `async` requires the full OpenAI-compatible chat-completions endpoint, a valid model, and any required Bearer key.
- Provider route fields use registry names (`sillytavern` or `async`), not model names.
- Open the inspector to view current routes, recent helper failures, and circuit state; reset the circuit after fixing configuration.

Primary and fallback failures are contained within the helper job and must not abort a foreground reply.

## Helpers appear idle

Check the selected profile, helper enablement, per-workflow toggle, minimum-message count, maximum calls per reply, cooldown, and lore-signal requirement. A successfully completed dedupe key intentionally suppresses the same job replay.

## Context is missing

Use the inspector to confirm the contribution was selected rather than omitted by token budget. Summaries and story memories are chat-scoped. Preferences require opt-in plus explicit acceptance; persona preferences must match the active SillyTavern user avatar.

## Semantic retrieval is unavailable

Configure SillyTavern Vector Storage with a source third-party extensions can call. NemoLore reports the inherited source/model and the reason for unavailability. Lexical retrieval continues automatically, so this condition is degraded capability rather than a bootstrap failure.

## Lore update safety

Protect curated entries in the lore manager. Preview operations before applying them. If a chat changes while generation is pending, NemoLore discards the stale result and removes any late-created association rather than writing it to the new chat.

## Reporting a regression

Include the NemoLore version/commit, SillyTavern version/commit, selected profile, provider route names (never secrets), inspector snapshot, first console error, and reproduction steps including any chat switch or reload.
