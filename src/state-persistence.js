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
 * Call as many runs as you need, the runs are matched via inputs
 * so if you call the same input twice, it will wait the first call.
 * You can just add a dummy value to the input if you want to run the same input again.
 *
 * @param {string} actorOrTaskNameOrId
 * @param {inputs} inputs
 * @param {object} options
 * @param {number} options.maxConcurrency
 * @param {string} options.kvStoreName
 * @param {string} options.type
 *
 * @example
 * const inputsAndOptions = [{ input: { url: 'https://example.com } }];
 * // Call the actor, it will call only once for the same input + options. Input and options are optional.
 * const [runInfo] = await persistedParallelCall('me/my-actor', inputsAndOptions, { type: 'actor', maxConcurrency: 2 });
 * // Get data from the dataset
 * const { items } = await Apify.newClient().dataset(runInfo.defaultDatasetId).listItems();
 */
const persistedParallelCall = async (
    actorOrTaskNameOrId,
    inputsAndOptions = [],
    options = {},
) => {
    const { maxConcurrency = 10, kvStoreName, type = 'actor' } = options;

    const client = Apify.newClient();
    const actorOrTaskClient = client[type](actorOrTaskNameOrId);

    const kvStore = await Apify.openKeyValueStore(kvStoreName);

    const callState = await kvStore.getValue('CALLS-STATE') || {};

    Apify.events.on('persistState', async () => {
        await kvStore.setValue('CALLS-STATE', callState);
    });

    const sources = inputsAndOptions.map(({ input, options}) => {
        const callHash = createHash('md5', { autoDestroy: true })
            .update(`${actorOrTaskNameOrId}${JSON.stringify({ input, options })}`)
            .digest('hex');
        return {
            url: 'https://example.com', // dummy
            uniqueKey: callHash,
            userData: { input, options },
        };
    });

    // If we skip name, the store is not persisted which we want
    // to be able to pick up resurrected runs
    const requestList = await Apify.openRequestList(null, sources);

    const crawler = new Apify.BasicCrawler({
        requestList,
        handleRequestTimeoutSecs: 99999,
        maxConcurrency,
        handleRequestFunction: async ({ request }) => {
            const { uniqueKey } = request;
            const { input = {}, options } = request.userData;

            if (!callState[uniqueKey]) {
                log.info(`Calling an actor/task with input hash: ${uniqueKey}`);
                const runInfo = await actorOrTaskClient.start(input, options);
                callState[uniqueKey] = runInfo;
            }

            log.info(`Waiting for run ${callState[uniqueKey].id} to finish`);
            const runInfo = await client.run(callState[uniqueKey].id).waitForFinish();
            log.info(`Run finished: ${callState[uniqueKey].id} with status ${runInfo.status}`);
            callState[uniqueKey] = runInfo;
        },
    });

    await crawler.run();
    await kvStore.setValue('CALLS-STATE', callState);

    return Object.values(callState);
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

/**
 * Locking mechanism for resources shared accross actor runs.
 * This lock doesn't provide 100% guarante of safety from race condition
 * which is not possible due to asynchronous and distributed nature of Apify platform.
 * The lock relies on wait times before acquiring the lock so in case of dead slow Apify API
 * it can malfunction
 * This lock is also not a good option for high contention cases or
 * when you cannot afford to wait candidateWaitTimeMs (10 sec) before executing critical section
 *
 * @example
 * const lock = new Lock();
 * await lock.init();
 * const criticalSection = async () => {
 *  // Do something that no one else can touch now
 *  // At the end of this function, lock gets released
 * }
 * await lock.lockAndRunSection(criticalSection);
 */
class Lock {
    constructor(options = {}) {
        const {
            storeName = 'LOCK',
            instanceId = Apify.getEnv().actorRunId,
            pollIntervalMs = 30000,
            candidateWaitTimeMs = 10000,
        } = options;
        this.storeName = storeName;
        this.instanceId = instanceId;
        this.pollIntervalMs = pollIntervalMs;
        this.candidateWaitTimeMs = candidateWaitTimeMs;
        this.store = null;
        this.isMigrating = false;
        this.ourLocked = false;
    }

    async init() {
        this.store = await Apify.openKeyValueStore(this.storeName);
        Apify.events.on('migrating', async () => { await this.handleMigration(); });
        Apify.events.on('aborting', async () => { await this.handleMigration(); });
    }

    async handleMigration() {
        this.isMigrating = true;
        if (this.ourLocked) {
            await this.unlock();
        }
    }

    async isLocked() {
        const { locked } = await this.store.getValue('LOCKED') || {};
        return locked;
    }

    async unlock() {
        await this.store.setValue('LOCKED', { locked: false });
    }

    async waitAsCandidate() {
        await this.store.setValue('CANDIDATE', { instanceId: this.instanceId });
        // We wait to see if no other instance acquired a candidate meanwhile
        await Apify.utils.sleep(this.candidateWaitTimeMs);
        const { instanceId } = await this.store.getValue('CANDIDATE');
        return instanceId === this.instanceId;
    }

    async acquireLock() {
        if (await this.isLocked()) {
            return false;
        }
        if (!await this.waitAsCandidate()) {
            return false;
        }
        // We need to check lock again in case someone locks
        // and someone else starts waitAsCandidate at the same time
        if (await this.isLocked()) {
            return false;
        }
        if (this.isMigrating) {
            await Apify.utils.sleep(99999);
        }
        this.ourLocked = true;
        await this.store.setValue('LOCKED', { locked: true });
        return true;
    }

    /**
     * Waits (infinitely) until it can acquire unlocked lock
     * then locks it, runs critical sections and unlocks
     * Unlocks and sleeps on actor migrations
     * @param {function} criticalSection
     */
    async lockAndRunSection(criticalSection) {
        // We do linear backoff to prevent deadlock
        let lockAttempts = 1;
        // Looping until we acquire the lock
        for (;;) {
            if (this.isMigrating) {
                await Apify.utils.sleep(99999);
            }
            if (await this.acquireLock()) {
                break;
            }
            await Apify.utils.sleep(this.pollIntervalMs * lockAttempts);
            lockAttempts++;
        }
        // We have the lock now
        await criticalSection();
        await this.unlock();
    }
}

module.exports = {
    persistedParallelCall,
    createPersistedMap,
    parallelPersistedPushData,
    waitForFinish,
};
