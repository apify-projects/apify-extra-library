const Apify = require('apify');

/**
 * Create and return a Map that is persisted to KV on 'persistState'
 * and can be persisted manually calling `await persistState()`
 *
 * @param {string} storeName
 * @param {string} recordKey
 */
exports.createPersistedMap = async (storeName, recordKey) => {
    const kv = await Apify.openKeyValueStore(storeName);

    /** @type {Map<string, any>} */
    const map = new Map(
        await kv.getValue(recordKey),
    );

    const persistState = async () => {
        await kv.setValue(recordKey, [...map]);
    };

    Apify.events.on('persistState', persistState);

    return {
        persistState,
        map,
        storeName,
        recordKey,
    };
};

/**
 * Intervaled dataset.pushData and provide a way to deduplicate
 * while pushing, by using a key.
 *
 * Saves the pending items to the KV in case of migration
 *
 * @param {Apify.Dataset} dataset
 * @param {number} [limit]
 */
exports.intervalPushData = async (dataset, limit = 50000) => {
    const data = new Map(await Apify.getValue('PENDING_PUSH'));
    await Apify.setValue('PENDING_PUSH', []);
    let shouldPush = true;

    /** @type {any} */
    let timeout;

    const timeoutFn = async () => {
        if (shouldPush && data.size >= limit) {
            const dataToPush = [...data.values()];
            data.clear();
            await dataset.pushData(dataToPush);
        }

        timeout = setTimeout(timeoutFn, 10000);
    };

    Apify.events.on('migrating', async () => {
        shouldPush = false;
        if (timeout) {
            clearTimeout(timeout);
        }
        await Apify.setValue('PENDING_PUSH', [...data.entries()]);
    });

    await timeoutFn();

    return {
        /**
         * Synchronous pushData
         *
         * @param {string} key
         * @param {any} item
         * @returns {boolean} Returns true if the item is new
         */
        pushData(key, item) {
            const isNew = !data.has(key);
            data.set(key, item);
            return isNew;
        },
        /**
         * Flushes any remaining items on the pending array.
         * Call this after await crawler.run()
         */
        async flush() {
            shouldPush = false;

            if (timeout) {
                clearTimeout(timeout);
            }

            const dataToPush = [...data.values()];

            while (dataToPush.length) {
                await Apify.pushData(dataToPush.splice(0, limit));
                await Apify.utils.sleep(1000);
            }
        },
    };
};

/**
 * The more concurrent writes to the RequestQueue,
 * the slower it gets but not exponentially slower, but pretty fast when doing one
 * at a time, that recalculates after each addRequest call
 *
 * Example on increasing concurrentWrites:
 *   1 = 1ms (2ms on addRequest call)
 *   3 = 3ms (6ms)
 *   10 = 10ms (20ms)
 *   20 = 20ms (40ms)
 *   30 = 30ms (60ms)
 *   100 = 200ms (400ms)
 *   1000 = 3000ms (6000ms)
 *
 * @param {Apify.RequestQueue} rq
 */
exports.RateLimitedRQ = (rq) => {
    let concurrentWrites = 0;

    const currentSleepValue = () => (concurrentWrites || 1) * (Math.round(Math.log10(concurrentWrites || 1)) || 1);

    return {
        /**
         * Gets the current interval sleep value in ms
         */
        currentSleepValue,
        /**
         * @param {Partial<Apify.RequestOptions>} request
         * @param {{ forefront: boolean }} [options]
         * @returns {Promise<Apify.QueueOperationInfo>}
         */
        async addRequest(request, options) {
            // racing conditions may happen
            if (concurrentWrites < 0) {
                concurrentWrites = 0;
            }
            concurrentWrites++;

            await Apify.utils.sleep(currentSleepValue());
            const added = await rq.addRequest(request, options);

            concurrentWrites--;
            await Apify.utils.sleep(currentSleepValue());

            if (concurrentWrites < 0) {
                concurrentWrites = 0;
            }

            return added;
        },
    };
};
