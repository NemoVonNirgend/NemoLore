# Migration notes

The modular branch is intentionally compatibility-first. `bootstrap.js` owns the modular services and then imports `index.js`, which continues to provide established NemoLore behavior and UI. Migration is controlled per subsystem rather than as one irreversible switch.

## Before upgrading

1. Back up the SillyTavern user-data directory that contains chats, settings, and world-info files.
2. Record the currently selected NemoLore connection profile, completion preset, async API settings, running-memory size, and lorebook association.
3. Finish any active generation and reload after updating the extension files.
4. Confirm the browser console reports the modular bootstrap and legacy compatibility module as loaded.

The settings namespaces `extension_settings.nemolore` and `extension_settings.NemoLore` are linked to one backing object at startup. This preserves older consumers while avoiding two independent settings copies.

## Recommended staged migration

### Stage 1: compatibility baseline

Leave both engines on `legacy`. Confirm existing chats, the legacy settings drawer, highlighting, summaries, the `{{NemoLore}}` macro, and lorebook associations behave as expected. Open each important chat at least once so migration can inspect its metadata.

### Stage 2: modular memory

Enable helper agents and leave **Run memory after replies** enabled. Keep summary and lore engines on legacy. Validate records in the Memory Manager and switch between chats to verify isolation.

When a chat activates, NemoLore searches compatible legacy summary locations. Eligible legacy summaries are copied into consolidated modular memory records with `legacy-summary` and `migrated` tags. On NemoTavern it also imports valid native per-message summaries and chapter chunks as source-linked records. Repeated activation is a no-op, while source edits, deletes, invalid chunks, and appended summaries are reconciled. The original source is not removed.

### Stage 3: modular summary

Set the summary engine to `modular`, enable **Run summary after replies**, and reload. Start with `new-first` precedence so a modular summary is used when available and legacy remains a fallback. Verify lineage and context placement with the manager and inspector before enabling old-message hiding.

Legacy automatic summary queues, pending automatic drains, legacy summary injection, and legacy exclusion are gated in this mode. Manual legacy tools remain available. Avoid manually triggering both summary implementations during comparison tests because their stores and granularity differ.

### Stage 4: modular lore

Protect important manual entries, set the lore engine to `modular`, enable **Run lore after replies**, and reload. Begin with preview/selective approval. Verify the associated lorebook and identity matches before accepting bulk updates.

Legacy automatic chat setup, coupled lore generation, and periodic updates are gated in modular lore mode. Existing lorebook files and associations are preserved.

## Data locations

Modular state is stored through SillyTavern rather than in browser-only memory:

- memories: `chat_metadata.nemolore.memory`;
- modular summaries: `chat_metadata.nemolore.summaries[chatId]`;
- migration markers: `chat_metadata.nemolore.migrations`;
- lorebook association: `chat_metadata.nemolore.lorebook` and SillyTavern's world-info metadata key;
- global settings: linked `nemolore` / `NemoLore` extension settings.

World-info entry content remains in SillyTavern's lorebook files. Helper queues, dedupe state, circuit state, and observability history are session state and reset on reload.

## Returning to legacy mode

Set the affected engine selector back to `legacy` and reload. NemoLore does not delete modular memory, summaries, migration markers, or lorebook data when a mode changes. Legacy automation resumes for that subsystem.

The legacy engine does not consume every modular record format. If returning temporarily, use `legacy-first` or `legacy-only` summary precedence as appropriate and verify the final context. Do not remove migration markers to force a second import; that can duplicate memory records.

## Downgrade considerations

Older extension releases may ignore modular metadata but should not be expected to manage or clean it. A downgrade can also restore legacy automatic behavior without awareness of modular helper work performed earlier. Keep the backup until every important chat and lorebook has been checked after downgrade.

If an older release fails to load because it encounters newer data, restore the extension and user data as a matched pair from the backup rather than selectively deleting metadata fields.
