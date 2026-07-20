# Memory, summary, and lore management

## Memory manager

Open **Manage Memories** from the NemoLore drawer. The manager operates on the active chat only. It supports search and facets for type, status, tags, entities, and review state. Editing, invalidating, restoring, archiving, contradiction review, and core promotion use the same persistent store as automatic helpers.

Each record retains source identifiers and revision history. Consolidation and episode promotion remain reversible: source records are archived or retained according to the active profile.

## Summary manager

Open **Manage Summary & Lore**, then select Summary. Manual edits are marked as manual revisions. Regeneration runs through the summary helper route and records lineage including the source message range. The modular summary is the only summary context source in this branch.

## Lore manager

The Lore tab lists entries in the chat-associated lorebook. Protect any manually curated entry before running generated updates. A protected identity may appear in preview, but automatic application skips it.

Preview generates operations without writing. Select only the operations to approve, then apply them. Identity matching normalizes duplicate names/keys. Duplicate merge combines selected content and provenance into the retained entry and removes the redundant entries.

## Inspector

The inspector reports the active ownership decision, provider routes and failures, context selections/omissions, helper job history, memory counts, summary availability, lorebook association, and semantic-index health. Use its semantic rebuild only for the current chat after correcting Vector Storage configuration.
