# Changelog

All notable changes to NemoLore are documented here.

## 1.4.0-rc.4 - 2026-11-01

### Added

- A Helper connection panel above Advanced tuning: select a SillyTavern provider and model, with automatic saving across reloads.
- Saved-connection helpers reuse SillyTavern's native default endpoints, provider configuration, and server-side credentials, including Vertex Express and service-account authentication.
- Source-specific model lists, automatic API listing where supported, manual refresh, and custom model IDs. Vertex uses SillyTavern's catalogue, including models added by other extensions.
- Common endpoint presets for manual OpenAI-compatible connections.

### Changed

- Replaced free-text workflow routing fields with labeled connection selectors and hid manual endpoint fields until needed.
- Saved-connection helpers use isolated request settings and inherit the displayed response-token limit without changing the foreground connection or its token settings.

## 1.4.0-rc.3 - 2026-11-01

### Changed

- Removed fixed output-token defaults of 1,200 for memory extraction, 500 for summaries, and 1,000 for lore generation.
- SillyTavern-backed helpers now inherit the active Max Response Length by default. OpenAI-compatible helpers omit `max_tokens` by default. Explicit caller-supplied limits are preserved.

## 1.4.0-rc.2 - 2026-11-01

### Fixed

- Kept in-chat summaries below the message content instead of beside it, preventing summaries from shrinking the narration and workbench column.
- Isolated summary styling from SillyTavern's narration layout, preserved summary line breaks, and wrapped long unbroken text within the available width.

## 1.4.0-rc.1 - 2026-07-20

### Added

- Four story-scale profiles: Short RP, Long Form, Episodic, and Epic.
- Reviewed global and persona-scoped preference memory.
- Semantic memory retrieval through SillyTavern Vector Storage, with lexical fallback.
- Memory, summary/lore, and observability management interfaces.
- Built-in SillyTavern and OpenAI-compatible helper providers with per-workflow routing and fallback.
- NemoTavern ownership interop to prevent competing automatic workflows.

### Changed

- Completed the modular-only runtime cutover; legacy settings are migration inputs, not alternate engines.
- Hardened per-chat memory, summary, lorebook, migration, and semantic-index activation.
- Serialized chat transitions and same-chat generation, and rejected stale async writes after chat switches.
- Made helper deduplication durable after success while allowing failed work to be retried.
- Updated lore operations for current SillyTavern world-info contracts and object-keyed provider responses.
- Made noun highlighting operate on text nodes without changing links or nested markup.

### Verified

- 159 automated tests pass on Node.js 22.
- End-to-end smoke testing passes on SillyTavern staging 1.18.0 at commit `380e31e8c58d196969b6a0da74f431ba999c7e0a`.
- Live helper generation, fallback, context injection, lifecycle persistence, management actions, and error containment were exercised with an OpenAI-compatible DeepSeek V3 endpoint.

### Known limitations

- Semantic retrieval requires a compatible embedding source configured in SillyTavern Vector Storage. NemoLore uses lexical retrieval when no compatible source is available.
- This branch intentionally does not run the retired legacy `index.js` runtime.
