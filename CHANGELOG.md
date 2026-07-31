# Changelog

All notable changes to NemoLore are documented here.

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
