# NemoLore

NemoLore is a SillyTavern extension for persistent chat memory, conversation summaries, and chat-associated lorebooks. The modular runtime adds provider routing, post-reply helper jobs, context assembly, management panels, and an observability inspector while retaining the existing NemoLore interface for compatibility.

The extension starts through `bootstrap.js`. It then loads the legacy `index.js` compatibility module, so established highlighting, manual tools, settings, and the `{{NemoLore}}` macro remain available while modular subsystems are enabled selectively.

## Requirements

- A current SillyTavern checkout
- Node.js 20 or newer for the repository test suite
- A working generation connection in SillyTavern, or an OpenAI-compatible chat-completions endpoint for the optional independent provider

## Installation

### SillyTavern extension installer

In SillyTavern, open **Extensions**, choose **Install Extension**, and enter:

```text
https://github.com/NemoVonNirgend/NemoLore
```

The installer follows the repository's published/default branch. To test the modular release-candidate branch before it is published, use the branch checkout below.

Reload SillyTavern after installation. NemoLore should appear in the Extensions settings drawer.

### Branch checkout for release-candidate testing

From the SillyTavern directory:

```bash
cd public/scripts/extensions/third-party
git clone --branch agent/modular-architecture https://github.com/NemoVonNirgend/NemoLore.git NemoLore
```

If a `NemoLore` directory already exists, update that checkout instead of nesting another copy inside it:

```bash
cd public/scripts/extensions/third-party/NemoLore
git fetch origin
git switch agent/modular-architecture
git pull --ff-only
```

Restart SillyTavern and hard-refresh the browser. The installed directory must contain `manifest.json`, `bootstrap.js`, `index.js`, and `src/` directly.

## Quick start

1. Open a character chat, then open **Extensions > NemoLore**.
2. Leave both engine modes on `legacy` for the closest match to earlier NemoLore releases.
3. To test the modular pipeline, set **Summary engine** and/or **Automatic lore engine** to `modular`, configure the corresponding post-reply helper, then reload the page.
4. Use **Manage Memories**, **Manage Summary & Lore**, and **Open NemoLore Inspector** under **Parallel Helpers & Context** to inspect the current chat.

Settings and per-chat data are saved through SillyTavern. Switch chats normally; NemoLore flushes the previous chat's memory before activating the next one.

## Engine modes

Summary and lore automation can be migrated independently.

| Mode | Summary behavior | Lore behavior |
| --- | --- | --- |
| `legacy` | Existing automatic summarization, display, context exclusion, and legacy injection remain active. | Existing chat setup, prompts, coupled generation, and periodic updates remain active. |
| `modular` | Legacy automatic summary work and legacy message hiding are gated off. Modular summary helpers and context contribution are available. | Legacy automatic lore setup and updates are gated off. Modular lore helpers and management workflow are available. |

Changing either engine selector requires a reload. Manual legacy tools remain available for compatibility. A modular summary helper only runs when all of the following are true: helper agents are enabled, **Run summary after replies** is enabled, and the summary engine is `modular`. The equivalent rule applies to modular lore.

NemoLore never intentionally runs the legacy and modular automatic workflow for the same subsystem at the same time. Memory helpers are independent of the summary and lore engine selectors.

On the NemoTavern fork, `legacy` delegates to the enabled native summary/lore engine and the native memory worker owns automatic memory unless the modular memory helper is enabled. See [NemoTavern interoperability](docs/NEMOTAVERN.md) for ownership, migration, and diagnostic details.

For full mode and precedence details, see [Configuration](docs/CONFIGURATION.md).

## Helper agents and providers

NemoLore always registers a `sillytavern` provider. It sends helper prompts through SillyTavern's currently configured generation connection. An optional `async` provider is registered at page startup when **Enable Independent Async API** is enabled and an endpoint is configured; this endpoint must accept OpenAI-compatible chat-completions requests.

Provider fields in **Parallel Helpers & Context** use registry names, normally:

- `sillytavern`
- `async`

Set a shared provider or override memory, summary, and lore individually. A fallback provider can be tried after the primary provider exhausts its retry policy. Provider timeouts, retries, and circuit breaking isolate helper failures from normal chat generation. Reload after enabling or changing the independent provider so it is registered from the saved configuration.

Post-reply helpers support concurrency, per-workflow minimum message counts, cooldowns, a maximum number of calls per reply, and an optional lore-signal requirement. Jobs use a chat/message/workflow dedupe key: a successfully completed job is not re-run for the same reply during the current page session, while failed or cancelled work may be retried.

See [Configuration](docs/CONFIGURATION.md) for setup and routing order.

## Management tools

The modular settings section adds three operator surfaces:

- **Manage Memories** searches and filters current-chat memories. A record can be edited, invalidated/restored, archived, promoted to core, or marked reviewed; provenance and revision metadata are shown with it.
- **Manage Summary & Lore** edits or regenerates the current summary, shows lineage and source ranges, changes legacy/modular precedence, protects lore entries, previews generated changes, selectively approves operations, and merges duplicates.
- **Open NemoLore Inspector** shows the active chat, selected and omitted context contributions, token estimates, memory and summary state, lorebook association, helper queue state, recent jobs, and recent runtime events.

Generated lore will not overwrite an entry marked protected. Identity matching resolves generated updates against existing keys before creating a new entry. Preview operations are not persisted until approved.

See [Management tools](docs/MANAGEMENT.md) for operating details and safety notes.

## Persistence and context

Modular memories and summaries live in the current chat's SillyTavern metadata under `nemolore`. The associated lorebook name is stored both in NemoLore metadata and SillyTavern's world-info association field. Global extension settings are exposed through both `nemolore` and the historical `NemoLore` namespace, backed by the same object for compatibility.

When modular context is built:

- the conversation summary is contributed after the system prompt;
- retrieved memory context is budgeted and contributed through the context registry;
- old chat messages are hidden only in modular summary mode, only when a modular summary exists, and only when message hiding is enabled;
- legacy summary mode receives the legacy interceptor's expected full chat array.

The inspector is the easiest way to confirm which contributions were selected or omitted.

## Migration

The default engine mode remains `legacy`; installing this branch does not opt a chat into modular automation. On chat activation, eligible legacy summaries and NemoTavern's native per-message summaries/chapter chunks are copied into source-linked modular memory records. Original source data is preserved, while later edits, deletes, invalid chunks, and appended summaries are reconciled. Modular and legacy summary sources can then be selected with `new-first`, `legacy-first`, `new-only`, or `legacy-only` precedence.

Back up SillyTavern user data before a large migration or downgrade. See [Migration notes](docs/MIGRATION.md) for the staged procedure and rollback expectations.

## Troubleshooting

- If NemoLore is absent, verify the install directory layout and check the browser console for a failure from `bootstrap.js` or `index.js`.
- If **Parallel Helpers & Context** is absent, reopen the Extensions drawer after the page is fully loaded and hard-refresh once.
- If a modular helper never runs, check the master helper toggle, workflow toggle, engine mode, message minimum, cooldown, maximum calls per reply, provider name, and lore-signal requirement.
- If the `async` provider is unavailable, save its endpoint configuration and reload the page.
- If a summary or memory appears to follow the wrong chat, stop generation, switch chats again, and inspect the active chat ID. Do not copy chat metadata by hand between chats.
- If provider failures continue after recovery, use **Reset Provider Circuits**.

More diagnostics are in [Troubleshooting](docs/TROUBLESHOOTING.md).

## Development

Run the complete Node test suite from the extension directory:

```bash
npm test
```

Run only import smoke tests with:

```bash
npm run test:smoke
```

The modular dependency boundaries and public runtime surface are documented in [Architecture](docs/ARCHITECTURE.md).
