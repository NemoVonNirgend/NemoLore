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
git clone --branch main https://github.com/NemoVonNirgend/NemoLore.git NemoLore
```

Start SillyTavern, enable NemoLore under Extensions, and reload the page. Open the NemoLore drawer and confirm that a story profile and the management buttons are visible.

For an existing installation:

```powershell
Set-Location <SillyTavern>\public\scripts\extensions\third-party\NemoLore
git fetch origin
git switch main
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

Open **Extensions → NemoLore → Helper connection**, above Advanced tuning:

1. Enable helper agents.
2. Choose a provider, such as **Google Vertex AI** or **Google AI Studio**.
3. Pick a model. Changes save automatically and persist after refreshing SillyTavern.

Configure the provider once in SillyTavern's **API Connections** first. NemoLore reuses its default endpoint, saved provider configuration, and server-side credentials. Vertex inherits its region and Express/project or service-account settings. The main chat connection stays selected, so helpers can use a different provider and model. Saved keys are never copied into NemoLore settings.

Model lists include SillyTavern's source-specific catalogue and extension-added models. Providers with a model-list API refresh automatically when selected; use **Refresh models** to reload. Vertex uses the existing SillyTavern catalogue. These lists do not guarantee account access to every model. Choose **Enter another model ID…** for an unlisted model.

Choose **Use current chat connection** to follow the main model instead. For a separate server, choose **Manual OpenAI-compatible endpoint**, select an endpoint preset or enter the full chat-completions URL, then provide its key and model. Manual keys are stored in extension settings; avoid sharing exports containing keys. Changing the manual endpoint clears its old key.

Advanced tuning has optional memory, summary, lore, and fallback connection selectors, plus workflow toggles and cadence controls. Leave workflow connections at **Use shared helper connection** to use the picker for every helper.

Jobs have bounded concurrency, timeouts, retries, circuit breaking, and replay deduplication. A helper failure is isolated from foreground chat generation. Failed jobs release their dedupe key so a later reply can retry them.

Memory extraction, summary, and lore helpers do not impose a fixed output-token cap. Saved SillyTavern connections inherit the displayed **Max Response Length** using a separate request snapshot. The current-chat connection inherits it through `generateRaw`. Manual endpoints omit `max_tokens` and apply the endpoint default. A caller-supplied `maxTokens` still sets an explicit limit. Summary word targets and context-injection budgets remain separate from this output limit.

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
- **Helpers do not run:** confirm helper agents and the individual workflow are enabled, the minimum-message/lore-signal rule is met, and Helper connection has a configured provider and model.
- **OpenAI-compatible requests fail:** use the full chat-completions URL and confirm the endpoint accepts Bearer authentication and the configured model.
- **No semantic matches:** configure a compatible SillyTavern Vector Storage source or rely on the automatic lexical fallback.
- **Wrong chat data appears:** stop testing and capture the inspector snapshot and console. Chat switches are guarded; stale async work should be discarded rather than committed.
- **Two automatic systems appear active:** disable duplicate extension copies. NemoLore coordinates with supported NemoTavern host APIs, but cannot arbitrate unrelated forks that do not expose ownership state.

More detail is available in [Troubleshooting](docs/TROUBLESHOOTING.md), [Configuration](docs/CONFIGURATION.md), [Management](docs/MANAGEMENT.md), and [Architecture](docs/ARCHITECTURE.md).
