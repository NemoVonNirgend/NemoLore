export function createPopupCoordinator({ state, logger }) {
    const queue = [];
    let active = false;

    async function drain() {
        if (active || queue.length === 0) return;

        active = true;
        state.raw.processing.popup = true;

        while (queue.length > 0) {
            const job = queue.shift();
            try {
                const result = await job.task();
                job.resolve(result);
            } catch (error) {
                logger.error('Popup task failed.', error);
                job.reject(error);
            }
        }

        active = false;
        state.raw.processing.popup = false;
    }

    function run(task) {
        if (typeof task !== 'function') {
            return Promise.reject(new TypeError('Popup task must be a function.'));
        }

        return new Promise((resolve, reject) => {
            queue.push({ task, resolve, reject });
            void drain();
        });
    }

    function clear(reason = new Error('Popup queue cleared.')) {
        while (queue.length > 0) {
            queue.shift().reject(reason);
        }
    }

    return Object.freeze({
        run,
        clear,
        get isActive() {
            return active;
        },
        get pendingCount() {
            return queue.length;
        },
    });
}
