// @ts-nocheck
const Apify = require('apify');
const { createHash } = require('crypto');

const { log } = Apify.utils;

/**
 * Create and return a Map that is persisted to KV on 'persistState'
 * and can be persisted manually calling `await persistState()`
 *
 * @param {string} storeName
 * @param {string} recordKey
 */
const createPersistedMap = async (storeName, recordKey) => {
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
 * Make Apify.call idempotent.
 * Wraps the key value store of your choice and keeps the call
 * states there. Same inputs always yield the same call.
 *
 * Provide the idempotencyKey manually to be able to create
 * more calls using the same input, since it defaults to the
 * current Run ID
 *
 * @param {Apify.KeyValueStore} kv
 */
const persistedCall = async (kv) => {
    /**
     * @type {Map<string, { runId: string, actorId: string }>}
     */
    const calls = new Map(await kv.getValue('CALLS'));

    const persistState = async () => {
        await kv.setValue('CALLS', [...calls.entries()]);
    };

    Apify.events.on('persistState', persistState);

    /**
     * @param {string} actorName Actor name
     * @param {any} [input] Any input to call the actor
     * @param {any} [options] Same options are Apify.call options
     * @param {string|null} [idempotencyKey] A string that can be used to distinguish calls with same inputs
     */
    const fn = async (actorName, input = {}, options = {}, idempotencyKey = Apify.getEnv().actorRunId) => {
        const inputHash = createHash('md5', { autoDestroy: true })
            .update(`${actorName}${JSON.stringify({ input, options })}${idempotencyKey}`)
            .digest('hex');

        if (calls.has(inputHash)) {
            const call = calls.get(inputHash);

            return Apify.utils.waitForRunToFinish({
                ...options,
                ...call,
            });
        }

        const run = await Apify.call(actorName, input, { ...options, waitSecs: 0 });

        calls.set(inputHash, {
            runId: run.id,
            actorId: run.actId,
        });

        await persistState();

        return Apify.utils.waitForRunToFinish({
            actorId: run.actId,
            runId: run.actId,
            waitSecs: options.waitSecs,
        });
    };

    return fn;
};

/**
 * Useful for pushing a large number of items at once
 * where migration could introduce duplicates and consume extra CUs
 * Only first param is mandatory
 * @param {Array<Object>} items
 * @param {string} [outputDatasetIdOrName]
 * @param {Object} options
 * @param {number} options.uploadBatchSize
 * @param {number} options.uploadSleepMs
 */
const persistedPushData = async (items, outputDatasetIdOrName, options = {}) => {
    const { uploadBatchSize = 5000, uploadSleepMs = 1000 } = options;
    let isMigrating = false;
    Apify.events.on('migrating', () => { isMigrating = true; });

    let pushedItemsCount = (await Apify.getValue(`STATE-PUSHED-COUNT-${outputDatasetIdOrName}`)) || 0;
    const dataset = await Apify.openDataset(outputDatasetIdOrName);

    for (let i = pushedItemsCount; i < items.length; i += uploadBatchSize) {
        if (isMigrating) {
            log.info('Forever sleeping until migration');
            // Do nothing
            await new Promise(() => {});
        }
        const itemsToPush = items.slice(i, i + uploadBatchSize);

        await dataset.pushData(itemsToPush);
        pushedItemsCount += itemsToPush.length;
        await Apify.setValue('PUSHED', pushedItemsCount);
        await Apify.utils.sleep(uploadSleepMs);
    }
};

module.exports = {
    persistedCall,
    createPersistedMap,
    persistedPushData,
};
