# NemoTavern interoperability

NemoLore detects the NemoTavern fork at runtime. Installed features and active
workers are treated separately: a disabled native engine does not claim work
just because its API exists.

## Automatic ownership

One owner is selected independently for summary, lore, and memory:

| Configuration | Summary owner | Lore owner | Memory owner |
| --- | --- | --- | --- |
| Stock SillyTavern, legacy modes | standalone legacy | standalone legacy | none |
| NemoTavern, enabled native engines, legacy modes | NemoTavern | NemoTavern | NemoTavern |
| Modular modes and modular memory helper | modular | modular | modular |

Owner names reported by the API are `nemolore-modular`,
`nemolore-legacy`, `nemotavern`, and `none`.

```js
NemoLore.ownership.snapshot()
NemoLore.hostInterop.snapshot()
NemoTavern.capabilities.snapshot()
NemoTavern.capabilities.active()
```

Ownership is checked again after asynchronous provider work. A mode switch or
chat switch therefore discards a late result instead of committing it to the
wrong engine or chat.

## Context behavior

When NemoTavern owns native summary or memory, the modular contributor leaves
that context slot to the host. When modular owns the engine, NemoTavern clears
its native prompt slot. This prevents duplicate summaries and memory ledgers.

The NemoLore inspector displays engine owners and, when available, the native
context ledger, per-message summary/chunk counts, and provenance state.

## Native memory migration

At chat activation, NemoLore reads:

- `message.extra.nemo_summary`;
- valid `message.extra.nemo_chunk` chapter recaps;
- native summary/source hashes used to detect later edits.

A valid chunk supersedes the member summaries it covers. The migration is a
true no-op when nothing changed. Appended sources are imported; edited sources
are revised; deleted summaries and invalidated chunks invalidate their linked
modular records so retrieval cannot resurrect stale content. Source fields are
not removed from the chat.

## Native lore safety

NemoTavern's native manager exposes protection, manual extraction preview,
selective approval, and duplicate merging. Protection is honored by generated
updates, fact compaction, and rollback projection cleanup. Duplicate merging
updates the native source store and World Info projection together, preventing
deleted duplicates from reappearing on the next projection.

Standalone modular lore retains its own preview, protection, identity, and
merge workflow when **Automatic lore engine** is set to `modular`.

## Settings migration

NemoTavern native lore settings live under
`extension_settings.nemotavernLore`. Older native preferences are copied once
from the shared `nemolore` namespace, then persisted separately so the fork
and extension do not overwrite each other's engine settings.

## Troubleshooting

- If legacy mode reports `nemolore-legacy` on NemoTavern, check
  `NemoTavern.capabilities.active()`; the corresponding native engine may be
  disabled.
- If a prompt contribution appears twice, open the inspector and compare its
  engine owners with the native context ledger.
- If startup slows with a large chat, update both sides of the parity release.
  Current ownership checks use lightweight active-state methods and do not
  clone full native stores.
- Keep older `third-party/NemoLore` copies disabled. One enabled checkout
  should provide `bootstrap.js`.
