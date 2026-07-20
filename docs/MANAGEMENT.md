# Management tools

The modular management tools are under **Extensions > NemoLore > Parallel Helpers & Context**. Open a chat before using them; memory, summary, and lore association are scoped to the active chat.

## Memory Manager

Choose **Manage Memories** to open the current in-memory record set loaded from the active chat metadata.

The sidebar supports:

- full-text search across memory fields;
- type filtering;
- status filtering;
- a **Needs review only** filter.

Selecting a record exposes its title, content, tags, entities, importance, confidence, status, revision, source IDs, supersession links, and metadata. Available actions are:

- **Save changes**: creates the next revision of the record;
- **Invalidate** / **Restore**: removes or returns a record to normal retrieval without deleting its provenance;
- **Archive**: retains the record while taking it out of active use;
- **Promote to core**: changes a durable record into a core memory;
- **Mark reviewed**: records that an operator reviewed the item.

Memory changes are persisted to `chat_metadata.nemolore.memory` with a short debounce. NemoLore flushes pending changes before activating another chat. If you are closing SillyTavern immediately after a bulk edit, wait briefly for persistence or switch chats once to force a flush.

## Summary Manager

Choose **Manage Summary & Lore**. The Summary tab operates on the current chat's single modular summary record.

- **Save summary** stores a manual edit and adds `manuallyEdited` and `editedAt` metadata.
- **Regenerate from current chat** sends the visible chat messages to the selected summary provider, including the previous summary as continuity input.
- The lineage block shows the chat ID, source range, source message IDs, timestamps, and generation/edit metadata.
- **Apply precedence** persists how modular and legacy summary sources are resolved for context injection.

Regeneration replaces the current modular summary after a successful provider response. It does not delete legacy summary data. If a manual edit is important, copy it before regenerating or verify the newly stored record immediately afterward.

## Lore Manager

The Lore tab requires a lorebook association for the current chat. Modular lore generation creates and associates a NemoLore lorebook on demand; an existing SillyTavern world-info association is also recognized.

The entry list can be searched by comment, content, or key. Selecting an entry displays its UID, keys, normalized identities, content, and protection state.

### Protecting manual entries

Use **Protect manual entry** before running generated updates against prose that must not be changed. Protection is stored in `entry.extensions.nemolore.protected`. Preview marks protected matches, leaves them unchecked by default, and the apply layer re-checks protection against the latest saved lorebook before writing. Removing protection is explicit.

### Preview and selective approval

Paste recent roleplay text into the preview input and choose **Preview lore changes**. The provider returns create, update, or no-op operations. NemoLore resolves identities against current entries before presenting the result.

- Create/update operations are selected by default unless protected.
- Clear any operation that should not be applied.
- **Apply approved changes** writes only selected operations.
- **Reject preview** writes nothing.

Preview is advisory; the apply step reloads current lore and resolves identity/protection again to reduce stale-write risk.

### Identity matching and duplicate merge

Generated entries are matched by normalized entry identity and existing keys. A match becomes an update instead of a new record. If duplicates already exist, select the entry to keep, enter the duplicate UIDs separated by commas, and choose **Merge duplicates into this entry**.

Merge combines unique content blocks and keys into the primary entry, records `mergedFrom` metadata, then removes the listed duplicates. This action is not automatically reversible; back up the lorebook or test the UID list before applying it.

## NemoLore Inspector

Choose **Open NemoLore Inspector** for a read-only runtime view. It reports:

- active chat ID;
- context tokens used versus available;
- selected and omitted context contributions;
- active and total memories;
- whether a modular summary exists;
- associated lorebook;
- helper runtime queue/running counts and recent job status;
- recent memory and helper events retained in the page session.

The inspector is intended for diagnosis, not editing. Close and reopen it to refresh the snapshot after a workflow. Observability history defaults to the most recent 100 events and resets with the page session.

## Chat switching checklist

When validating persistence:

1. Open chat A and create or edit a memory and summary.
2. Note chat A's lorebook name in the inspector.
3. Switch to chat B and confirm A's records are absent.
4. Add different records to B.
5. Switch back to A and verify its records and lorebook association return.
6. Reload and repeat the check.

Do not test isolation by editing `chat_metadata` directly. Use real SillyTavern chat changes so NemoLore can flush and activate each chat in order.
