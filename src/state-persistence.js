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
 * Better version of internal waitForFinish
 *
 * @param {ReturnType<Apify.newClient>} client
 * @param {string} runId
 */
const waitForFinish = async (client, runId) => {
    const run = client.run(runId);

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            const { status } = await run.get();
            if (status !== 'RUNNING' && status !== 'READY') {
                break;
            }
            await Apify.utils.sleep(1000);
        } catch (e) {
            Apify.utils.log.debug(e.message);

            break;
        }
    }
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
 * @param {string} actorName
 * @param {ReturnType<Apify.newClient>} [client]
 * @param {ReturnType<Apify.newClient>} [keyValueStoreId] Uses the current run one
 *
 * @example
 *   const callInstagram = persistedCall('jaroslavhejlek/instagram-scraper');
 *
 *   const run = await callInstagram({ directUrls: ["https://www.instagram.com/p/"] });
 *   // run is Apify.ActorRun, containing id, defaultDatasetId, etc
 */
const persistedCall = async (
    actorName,
    client = Apify.newClient(),
    keyValueStoreId = Apify.getEnv().defaultKeyValueStoreId,
) => {
    const kv = client.keyValueStore(keyValueStoreId);
    const actor = client.actor(actorName);

    /**
     * @type {Map<string, Apify.ActorRun>}
     */
    const calls = new Map((await kv.getRecord('CALLS').then((s) => s.value).catch(() => [])) ?? []);

    // don't try to write all at once for all events
    let persisting = false;

    const persistState = async () => {
        if (!persisting) {
            persisting = true;
            await kv.setValue('CALLS', [...calls.entries()]);
            persisting = false;
        }
    };

    Apify.events.on('persistState', persistState);
    Apify.events.on('migrating', persistState);
    Apify.events.on('aborting', persistState);

    /**
     * @param {Record<string, any>} [input] Any input to call the actor
     * @param {Parameters<typeof Apify.call>[2]} [options] Same options are Apify.call options
     * @param {string|null} [idempotencyKey] A string that can be used to distinguish calls with same inputs
     *
     * @example
     *   call({ ...yourInput }, { build: 'beta' }, 'run-2');
     */
    return async (input = {}, options = {}, idempotencyKey = null) => {
        const inputHash = createHash('md5', { autoDestroy: true })
            .update(`${actorName}${JSON.stringify({ input, options })}${idempotencyKey}`)
            .digest('hex');

        const call = calls.get(inputHash);

        if (call?.id) {
            await waitForFinish(
                client,
                call.id,
            );

            return call;
        }

        const run = await actor.call(input, {
            ...options,
            waitSecs: 1, // this might make the next polling call to be already finished
        });

        calls.set(inputHash, run);

        await persistState();

        await waitForFinish(
            client,
            run.id,
        );

        return run;
    };
};

/**
 * Useful for pushing a large number of items at once
 * where migration could introduce duplicates and consume extra CUs
 * Only first param is mandatory
 * @param {Array<Object>} items
 * @param {Object} options
 * @param {number} options.uploadBatchSize
 * @param {number} options.uploadSleepMs
 * @param {string} option.outputDatasetIdOrName
 * @param {number} option.parallelPushes
 */
const parallelPersistedPushData = async (items, options = {}) => {
    const {
        uploadBatchSize = 5000,
        uploadSleepMs = 500,
        outputDatasetIdOrName = null,
        parallelPushes = 1,
    } = options;
    let isMigrating = false;
    Apify.events.on('migrating', () => { isMigrating = true; });

    const kvRecordName = `STATE-PUSHED-COUNT-${outputDatasetIdOrName}`;
    let pushedItemsCount = (await Apify.getValue(kvRecordName)) || 0;
    const dataset = await Apify.openDataset(outputDatasetIdOrName);

    for (let i = pushedItemsCount; i < items.length; i += uploadBatchSize) {
        if (isMigrating) {
            log.info('Forever sleeping until migration');
            // Do nothing
            await new Promise(() => {});
        }
        const itemsToPush = items.slice(i, i + uploadBatchSize);

        const pushPromises = [];
        const parallelizedBatchSize = Math.ceil(itemsToPush.length / parallelPushes);
        for (let j = 0; j < parallelPushes; j++) {
            const start = j * parallelizedBatchSize;
            const end = (j + 1) * parallelizedBatchSize;
            const parallelPushChunk = itemsToPush.slice(start, end);
            pushPromises.push(dataset.pushData(parallelPushChunk));
        }
        // We must update it before awaiting the promises because the push can take time
        // and migration can cut us off but the items will already be on the way to dataset
        pushedItemsCount += itemsToPush.length;
        await Apify.setValue(kvRecordName, pushedItemsCount);
        await Promise.all(pushPromises);
        await Apify.utils.sleep(uploadSleepMs);
    }
};

module.exports = {
    persistedCall,
    createPersistedMap,
    parallelPersistedPushData,
    waitForFinish,
};
