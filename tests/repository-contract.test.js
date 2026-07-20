import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

test('package and manifest versions remain aligned', async () => {
    const [manifest, pkg] = await Promise.all([
        readJson('manifest.json'),
        readJson('package.json'),
    ]);
    assert.equal(pkg.version, manifest.version);
    assert.equal(pkg.type, 'module');
    assert.equal(typeof pkg.scripts?.test, 'string');
});

test('manifest entry files and test workflow exist', async () => {
    const manifest = await readJson('manifest.json');
    await Promise.all([
        access(manifest.js),
        access(manifest.css),
        access('.github/workflows/test.yml'),
    ]);
    assert.equal(manifest.generate_interceptor, 'nemolore_intercept_messages');
});

test('bootstrap no longer loads the legacy runtime module', async () => {
    const [bootstrap, settings] = await Promise.all([
        readFile('bootstrap.js', 'utf8'),
        readFile('settings.html', 'utf8'),
    ]);
    assert.doesNotMatch(bootstrap, /import\(['"]\.\/index\.js['"]\)/);
    assert.match(bootstrap, /createModularUiBootstrap/);
    assert.match(settings, /data-nemolore-modular-host/);
    assert.ok(settings.length < 2_000, 'Settings template should remain a small modular host.');
});
