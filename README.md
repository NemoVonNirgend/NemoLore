<<<<<<< HEAD
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
=======
# NemoLore

NemoLore is a modular SillyTavern extension for long-running roleplay continuity. It maintains per-chat memories and summaries, retrieves relevant context, manages generated lore safely, and can run memory, summary, and lore helpers after replies.

This release-candidate branch uses the modular runtime exclusively. Legacy settings and data are migrated, but the retired legacy runtime is not loaded.

## Requirements

- A current SillyTavern stable or staging checkout.
- Node.js 20 or newer to run the test suite.
- A working SillyTavern text-generation connection, or an OpenAI-compatible chat-completions endpoint for helper jobs.
- A compatible source configured in SillyTavern Vector Storage if semantic retrieval is enabled. Lexical retrieval remains available without it.

## Installation

Clone the branch into SillyTavern's third-party extensions directory. The installed directory must be named `NemoLore` because SillyTavern resolves extension assets from that path.

```powershell
Set-Location <SillyTavern>\public\scripts\extensions\third-party
git clone --branch dev/preset-architecture https://github.com/NemoVonNirgend/NemoLore.git NemoLore
```

Start SillyTavern, enable NemoLore under Extensions, and reload the page. Open the NemoLore drawer and confirm that a story profile and the management buttons are visible.

For an existing installation:

```powershell
Set-Location <SillyTavern>\public\scripts\extensions\third-party\NemoLore
git fetch origin
git switch dev/preset-architecture
git pull --ff-only
```

Back up SillyTavern user data before changing branches. Do not install two copies of NemoLore under different folder names.

## Story profiles and engine modes

NemoLore exposes four profiles:

- **Short RP** uses a large recent window with sparse helper activity.
- **Long Form** is the recommended balanced profile for stories lasting hundreds of messages.
- **Episodic** promotes scenes and consequences sooner.
- **Epic** favors precise provenance, hierarchical continuity, and aggressive extraction for very long chats.

Advanced changes become explicit overrides on the selected profile. Profile changes persist through SillyTavern's extension settings.

`summaryEngineMode` and `loreEngineMode` are always normalized to `modular` in this architecture. `summaryContextPrecedence` is always `new-only`. Old `legacy` values trigger migration; they do not reactivate the retired automatic workflows. When NemoTavern is present, live ownership checks prevent its Nemo memory, summary, or lore workers from running at the same time as NemoLore's modular owner.

## Provider and helper-agent setup

The provider registry always includes:

- `sillytavern`: uses SillyTavern's active text-generation connection through `generateRaw`.
- `async`: available when **Enable OpenAI-compatible provider** is enabled and a complete endpoint is configured.

For an OpenAI-compatible provider, enter the full chat-completions URL, API key, and model, for example a URL ending in `/v1/chat/completions`. Credentials stay in SillyTavern extension settings; avoid sharing exported settings files containing keys.

Helper routing fields accept the provider names `sillytavern` and `async`:

1. Enable helper agents.
2. Choose a shared helper provider, or set memory, summary, and lore overrides.
3. Optionally choose a fallback provider.
4. Enable the desired post-reply workflows and adjust cadence in Advanced settings.

Jobs have bounded concurrency, timeouts, retries, circuit breaking, and replay deduplication. A helper failure is isolated from foreground chat generation. Failed jobs release their dedupe key so a later reply can retry them.

## Context injection

Before foreground generation, NemoLore composes accepted preferences, the active modular summary, and relevant memory into the configured extension-prompt position. The inspector shows selected and omitted contributions and token use.

When a modular summary exists and the active profile enables message hiding, only messages outside the profile's recent window are excluded. This exclusion belongs to the modular summary policy; no legacy interceptor is invoked.

## Managers

Use the buttons at the bottom of the NemoLore drawer:

- **Manage Memories** searches and filters the active chat's records, edits fields, reviews contradictions, archives/restores entries, and promotes important records to core memory.
- **Manage Summary & Lore** edits or regenerates the current summary, exposes lineage/source ranges, protects manual lore entries, previews generated operations, selectively approves changes, and merges duplicates.
- **Open NemoLore Inspector** shows context contributions, active memory/summary/lore state, helper jobs, provider routes, NemoTavern ownership, semantic-index status, and a guarded semantic rebuild action.

Memory, summaries, lorebook associations, and migration state are scoped to the active chat and survive chat switches and reloads.

## Reviewed preference memory

Preference memory is opt-in and cross-chat. Candidate preferences never enter model context until accepted. Accepted records can be global or scoped to the current SillyTavern user persona. Rejected, disabled, candidate, and wrong-persona records are excluded.

See [Preference memory](docs/PREFERENCE_MEMORY.md) for the data model.

## Semantic retrieval

NemoLore reuses SillyTavern Vector Storage's selected source, model, credentials, and alternate endpoint. Configure Vector Storage first, then enable semantic retrieval in the NemoLore profile or Advanced settings. The inspector reports the inherited source, indexed/pending counts, and any error.

If Vector Storage has no compatible source, NemoLore reports semantic retrieval as unavailable and continues with deterministic lexical, entity, importance, recency, and type scoring. The in-process `webllm` and `koboldcpp` sources are not currently exposed to third-party extensions.

## Migration

On first load, pre-profile settings are classified into the closest story profile. NemoLore records the prior policy in `presetMigration`, imports legacy summaries into modular stores, and links the historical `NemoLore` settings namespace to the canonical `nemolore` object. Migration is idempotent and source-preserving.

See [Migration notes](docs/MIGRATION.md) before upgrading or downgrading.

## Development and verification

```powershell
npm test
npm run test:smoke
```

Release candidate 1.4.0-rc.1 was exercised against SillyTavern staging 1.18.0 at commit `380e31e8c58d196969b6a0da74f431ba999c7e0a`. See the [changelog](CHANGELOG.md) for verification scope.

## Troubleshooting

- **Drawer does not appear:** confirm the folder is exactly `NemoLore`, the extension is enabled, and `manifest.json` loads `bootstrap.js`; then inspect the browser console.
- **Helpers do not run:** confirm helper agents and the individual workflow are enabled, the minimum-message/lore-signal rule is met, and the provider name is `sillytavern` or `async`.
- **OpenAI-compatible requests fail:** use the full chat-completions URL and confirm the endpoint accepts Bearer authentication and the configured model.
- **No semantic matches:** configure a compatible SillyTavern Vector Storage source or rely on the automatic lexical fallback.
- **Wrong chat data appears:** stop testing and capture the inspector snapshot and console. Chat switches are guarded; stale async work should be discarded rather than committed.
- **Two automatic systems appear active:** disable duplicate extension copies. NemoLore coordinates with supported NemoTavern host APIs, but cannot arbitrate unrelated forks that do not expose ownership state.

More detail is available in [Troubleshooting](docs/TROUBLESHOOTING.md), [Configuration](docs/CONFIGURATION.md), [Management](docs/MANAGEMENT.md), and [Architecture](docs/ARCHITECTURE.md).
>>>>>>> dev/preset-architecture
