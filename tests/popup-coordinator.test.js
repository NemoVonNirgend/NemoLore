import assert from 'node:assert/strict';
import test from 'node:test';
import { createPopupCoordinator } from '../src/ui/popup-coordinator.js';

function createHarness() {
    return {
        state: { raw: { processing: { popup: false } } },
        logger: { error() {} },
    };
}

test('popup coordinator runs queued tasks sequentially', async () => {
    const { state, logger } = createHarness();
    const coordinator = createPopupCoordinator({ state, logger });
    const order = [];

    const first = coordinator.run(async () => {
        order.push('first:start');
        await Promise.resolve();
        order.push('first:end');
        return 1;
    });

    const second = coordinator.run(async () => {
        order.push('second');
        return 2;
    });

    assert.equal(await first, 1);
    assert.equal(await second, 2);
    assert.deepEqual(order, ['first:start', 'first:end', 'second']);
    assert.equal(state.raw.processing.popup, false);
    assert.equal(coordinator.isActive, false);
});

test('popup coordinator rejects invalid tasks', async () => {
    const coordinator = createPopupCoordinator(createHarness());
    await assert.rejects(() => coordinator.run(null), TypeError);
});
