# Migration notes

## Upgrading from a legacy NemoLore release

Back up SillyTavern user data before switching branches. Install this branch in a directory named `NemoLore` and remove or disable duplicate copies.

At bootstrap, NemoLore:

1. Links `extension_settings.NemoLore` and `extension_settings.nemolore` to one live object.
2. Classifies pre-profile settings into the nearest story profile.
3. Records a source policy snapshot and migration audit in `presetMigration`.
4. Imports legacy summary data into modular summary and memory storage.
5. Normalizes summary and lore ownership to the modular runtime.

The migration is idempotent. Reloading does not duplicate imported records or listeners. Legacy values remain useful as audit/source data but cannot turn the retired runtime back on.

## NemoTavern coexistence

When NemoTavern exposes its Nemo ownership APIs, NemoLore reads the live host state and elects one owner for memory, summary, and lore. This prevents both extensions from running the same automatic workflow. Manual managers remain available for NemoLore-owned data.

## Downgrading

Older releases do not understand preset policy, modular lineage, reviewed preferences, or semantic-index metadata. Keep a backup and expect older code to ignore those fields. Do not delete modular metadata merely to make a downgrade appear clean.
