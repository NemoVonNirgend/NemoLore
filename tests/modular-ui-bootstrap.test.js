import test from 'node:test';
import assert from 'node:assert/strict';

import { createModularUiBootstrap } from '../src/ui/modular-ui-bootstrap.js';

test('standalone UI renders the modular template and installs controls once', async () => {
    const calls = [];
    const mounted = { root: { isConnected: true, remove() { calls.push('remove'); } }, host: { id: 'host' } };
    const ui = createModularUiBootstrap({
        async renderTemplate(path, name) { calls.push(['render', path, name]); return '<section>NemoLore</section>'; },
        mount(html) { calls.push(['mount', html]); return mounted; },
        settingsController: {
            install(host) { calls.push(['install', host.id]); return true; },
            uninstall() { calls.push('uninstall'); },
        },
    });

    assert.equal(await ui.install(), true);
    assert.equal(await ui.install(), false);
    assert.deepEqual(calls.slice(0, 3), [
        ['render', 'third-party/NemoLore', 'settings'],
        ['mount', '<section>NemoLore</section>'],
        ['install', 'host'],
    ]);
    ui.uninstall();
    assert.deepEqual(calls.slice(-2), ['uninstall', 'remove']);
});

test('standalone UI fails clearly when the template host is missing', async () => {
    const ui = createModularUiBootstrap({
        renderTemplate: async () => '<section></section>',
        mount: () => ({ root: {} }),
        settingsController: { install: () => true },
    });
    await assert.rejects(ui.install(), /Unable to mount/);
});
