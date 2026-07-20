# Changelog

## 1.3.0 - 2026-07-20

### Added

- NemoTavern runtime interop with explicit per-engine ownership and native
  context-ledger/provenance visibility.
- Source-linked import of NemoTavern per-message summaries and valid chapter
  chunks, including edit, append, delete, and stale-chunk reconciliation.

### Changed

- Legacy engine modes delegate to enabled NemoTavern native workers when the
  fork is present; stock SillyTavern continues to use standalone legacy mode.
- The inspector now displays engine owners and native ledger, memory, and
  provenance state.

### Fixed

- Duplicate native/modular summary and memory context contributions.
- Late helper and migration commits after ownership or active-chat changes.
- Ownership checks cloning complete native stores on generation hot paths.

## 1.2.0 - 2026-07-20

### Added

- Modular memory ingestion, retrieval, source provenance, persistence, and management UI.
- Modular summary generation, lineage tracking, precedence controls, chat display, and management UI.
- Modular lore generation with preview, selective approval, protection, identity matching, and duplicate merging.
- Helper scheduling, deduplication, provider fallback routing, and an observability inspector.
- A SillyTavern-native provider and an optional OpenAI-compatible asynchronous provider.
- Installation, configuration, management, migration, architecture, and troubleshooting documentation.

### Changed

- The modular bootstrap loads the legacy module through compatibility gates and installs controls in its settings drawer.
- Legacy and lowercase settings namespaces share one live object while preserving historical preferences during upgrade.
- Summary and automatic lore engines can be selected independently without running both implementations at once.
- Memory persistence schema v2 stores source-ledger provenance with chat-scoped memory records.
- Legacy core-memory lore writes use the SillyTavern 1.18 world-info API contract.

### Fixed

- Settings template resolution and delayed drawer installation in current SillyTavern.
- Stale chat metadata references and cross-chat helper or management writes.
- Cross-chat memory context during asynchronous chat activation.
- Concurrent summary ordering and first-time lorebook creation races.
- Source-linked memory reloads and legacy provenance recovery.
- Duplicate helper jobs, engine-mode scheduling starvation, and detached persistence rejections.
- Protected lore updates, alias update serialization, summary display refreshes, and duplicate listeners.
- Empty lore-manager handling and unsafe noun highlighting.

### Compatibility

- Verified against SillyTavern 1.18.0 release commit `8172dcd`.
- Existing installations remain on legacy summary and lore engines until explicitly switched.
- Manual legacy summary and lore tools remain available in modular engine modes.
