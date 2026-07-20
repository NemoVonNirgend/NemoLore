# Reviewed cross-chat preference memory

Preference memory is an opt-in subsystem and is intentionally separate from per-chat story memory. Candidates never enter context until explicitly accepted.

## Record boundary

- Preference records carry candidate, accepted, rejected, or disabled status.
- Evidence records preserve a bounded explanation and source type independently from the candidate.
- Preferences may be global or scoped to a specific user persona.
- Context injection selects accepted records only, sorts them by priority, and obeys its own token and item budgets.

## Delivery checkpoints

1. Durable records, evidence, reversible review, and accepted-only context injection.
2. Review UI with evidence inspection, editing, acceptance, rejection, and disabling.
3. Conservative bounded swipe/edit/problem-line evidence collector API, disabled by default.
4. Manual candidate inference with repetition thresholds and no automatic acceptance.
5. Versioned import from the retired NemoPresetExt localforage store.
