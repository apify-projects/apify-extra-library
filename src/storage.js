const Apify = require('apify');
const bluebird = require('bluebird');
const { createHash } = require('crypto');
const { Sema } = require('async-sema');

const { log } = Apify.utils;

/**
 * Provides an easy way to store large arrays as a single record in KV Store
 * Behind the scenes, this chunked store splits the array
 * and saves each chunk as a separate record with name of `${key}-${chunkIndex}`
 * You need to lower the chunkSize if you have really huge items
 *
 * This option is generally faster and cheaper than using large datasets
 *
 * @example
 * // Use like normal Key Value store
 * const store = await Apify.openKeyValueStore();
 * const chunkedStore = await openChunkedRecordStore(store);
 * // Save some big array of data
 * await chunkedStore.setValue('ITEMS', bigData);
 * // Get bigData back
 * const loadedBigData = await chunkedStore.getValue('ITEMS');
 *
 * @param {Apify.KeyValueStore} store
 * @param {object} options
 * @param {number} [options.chunkSize=50000]
 * @param {number} [options.concurrency=20]
 * @param {boolean} [options.debugLog=false]
 */
const openChunkedRecordStore = async (store, options = {}) => {
    const { chunkSize = 50000, concurrency = 20, debugLog = false } = options;
    // TODO: Figure out if we can replicate bluebird concurrency without bluebird
    // for now I will do less optimal solution with Promise.all each concurrency batch
    /**
     * @param {function[]} fns
     */
    const executeFnsSemiParallel = async (fns) => {
        for (let i = 0; i < fns.length; i += concurrency) {
            const sliceFns = fns.slice(i, i + concurrency);
            if (debugLog) {
                log.info(`Executing ${sliceFns.length} in parallel`);
            }
            await Promise.all(sliceFns.map(async (fn) => fn()));
            if (debugLog) {
                log.info(`Finished executing ${sliceFns.length} in parallel`);
            }
        }
    };
    return {
        /**
         * @param {string} key
         * @returns {Promise<any[]>} data
         */
        getValue: async (key) => {
            /** @type {any[]} */
            const data = [];
            const keys = [];
            await store.forEachKey((loadedKey) => {
                const match = loadedKey.match(new RegExp(`${key}-\\d+`));
                if (match) {
                    keys.push(loadedKey);
                }
            });
            if (debugLog) {
                log.info(`Found ${keys.length} chunks in the Store`);
            }
            const fns = [];
            for (let i = 0; i < keys.length; i++) {
                fns.push(async () => {
                    const chunkKey = `${key}-${Math.ceil(i)}`;
                    for (const chunk of await store.getValue(chunkKey)) {
                        data.push(chunk);
                    }
                });
            }
            await executeFnsSemiParallel(fns);
            return data;
        },
        /**
         * @param {string} key
         * @param {any[]} data
         */
        setValue: async (key, data) => {
            if (!Array.isArray(data)) {
                throw new Error(`ChunkedRecordStore can only store arrays, you provided type: ${typeof data}`);
            }
            const fns = [];
            for (let i = 0; i < data.length; i += chunkSize) {
                const dataChunk = data.slice(i, i + chunkSize);
                fns.push(async () => store.setValue(`${key}-${Math.ceil(i / chunkSize)}`, dataChunk));
            }
            await executeFnsSemiParallel(fns);
        },
    };
};

/**
 * Provides a dataset-like object that pushes data to internal buffer
 * before pushing to real dataset to save API calls. Useful for large loads.
 * This implementation doesn't use KV store, it simply pushes the data on migration.
 * You have to always call await bufferedDataset.flush() after the crawl ends to push the final data.
 * If you abort the run, you will loose the data in the buffer.
 * There is also pocesar's timeout-based version that deduplicates so pick what you like :)
 *
 * @example
 * // Use like normal dataset, just flush after crawler.run()
 * const buffered = bufferDataset(dataset);
 * await bufered.pushData(data);
 * // Only needed after run ends
 * await buffered.flush()
 *
 * @param {Apify.Dataset} dataset
 * @param {object} options
 * @param {number} [options.maxBufferSize=500]
 * @param {boolean} [options.verboseLog]
 */
const bufferDataset = (dataset, options = {}) => {
    const { maxBufferSize = 500, verboseLog = false } = options;
    /** @type {any[]} */
    let buffer = [];

    /**
     * Flushes any remaining items on the pending array.
     * Call this after await crawler.run()
     */
    const flush = async () => {
        // We reassign and clean the buffer here
        // If we would clean after pushing, new items might have been added between the await
        const data = buffer;
        buffer = [];
        if (verboseLog) {
            log.info(`Flushing buffer with size: ${data.length}`);
        }
        await dataset.pushData(data);
    };

    let isMigrating = false;
    Apify.events.on('migrating', async () => {
        isMigrating = true;
        await flush();
    });

    /**
     * Use like normal dataset.pushData
     *
     * @param {any} data
     */
    const pushData = async (data) => {
        if (Array.isArray(data)) {
            buffer.push(...data);
        } else {
            buffer.push(data);
        }

        // If we are migrating, we need to reverse to normal pushData
        // because we don't know when it will really happen and more pushes might occur
        const willFlush = isMigrating || buffer.length >= maxBufferSize;
        if (willFlush) {
            await flush();
        }
    };

    /**
     * Gets current size of the buffer
     *
     * @returns {number} bufferSize
     */
    const bufferSize = () => buffer.length;

    return {
        pushData,
        flush,
        bufferSize,
    };
};

/**
 * Loads items from one or many datasets in parallel by chunking the items from each dataset into batches,
 * retaining order of both items and datasets. Useful for large loads.
 * By default returns one array of items in order of datasets provided.
 * By changing concatItems or concatDatasets options, you can get array of arrays (of arrays) back
 * Requires bluebird dependency and copy calculateLocalOffsetLimit function!!!
 *
 * @param {string[]} datasetIds IDs or names of datasets you want to load
 * @param {object} options Options with default values.
 * If both concatItems and concatDatasets are false, output of this function is an array of datasets containing arrays
 * of batches containig array of items.
 * concatItems concats all batches of one dataset into one array of items.
 * concatDatasets concat all datasets into one array of batches
 * Using both concatItems and concatDatasets gives you back a sinlge array of all items in order.
 * Both are true by default.
 * @param {(items: any[], params: { datasetId: string, datasetOffset: number }) => Promise<void>} [options.processFn]
 *  Data are not returned by fed to the supplied async function on the fly (reduces memory usage)
 * @param {number} [options.parallelLoads]
 * @param {number} [options.batchSize]
 * @param {number} [options.offset=0]
 * @param {number} [options.limit=999999999]
 * @param {boolean} [options.concatItems]
 * @param {boolean} [options.concatDatasets]
 * @param {boolean} options.fields
 * @param {boolean} options.useLocalDataset Datasets will be always loaded from Apify could, even locally
 * @param {boolean} [options.debugLog]
 * @param {boolean} [options.persistLoadingStateForProcesFn=false]
 * Will not load batches that were already processed before migration, does nothing if processFn is not used.
 * It does not persist the state inside processFn, that is a responsibillity of the caller (if needed)
 * You must not manipulate input parameters (and underlying datasets) between migrations or this will break
 */
module.exports.loadDatasetItemsInParallel = async (datasetIds, options = {}) => {
    const {
        processFn,
        parallelLoads = 20,
        batchSize = 50000,
        offset = 0,
        limit = 999999999,
        concatItems = true,
        concatDatasets = true,
        debugLog = false,
        persistLoadingStateForProcesFn = false,
        fields,
        // Figure out better name since this is useful for datasets by name on platform
        useLocalDataset = false, // Will fetch/create datasets by id or name locally or on current account
    } = options;

    if (!Apify.isAtHome() && fields) {
        log.warning('loadDatasetItemsInParallel - fields option does not work on local datasets');
    }

    const loadStart = Date.now();

    // Returns either null if offset/limit does not fit the current chunk
    // or { offset, limit } object
    const calculateLocalOffsetLimit = ({ offset, limit, localStart, batchSize }) => {
        const localEnd = localStart + batchSize;
        const inputEnd = offset + limit;

        // Offset starts after the current chunk
        if (offset >= localEnd) {
            return null;
        }
        // Offset + limit ends before our chunk
        if (inputEnd <= localStart) {
            return null;
        }

        // Now we know that the some data are in the current batch
        const calculateLimit = () => {
            // limit overflows current batch
            if (inputEnd >= localEnd) {
                // Now either the offset is less than local start and we do whole batch
                if (offset < localStart) {
                    return batchSize;
                }
                // Or it is inside the current batch and we slice it from the start (including whole batch)
                return localEnd - offset;
            // eslint-disable-next-line no-else-return
            } else { // Consider (inputEnd < localEnd) Means limit ends inside current batch
                if (offset < localStart) {
                    return inputEnd - localStart;
                }
                // This means both offset and limit are inside current batch
                return inputEnd - offset;
            }
        };

        return {
            offset: Math.max(localStart, offset),
            limit: calculateLimit(),
        };
    };

    // If we use processFnLoadingState, we skip requests that are done
    const createRequestArray = async (processFnLoadingState) => {
        // We increment for each dataset so we remember their order
        let datasetIndex = 0;

        // This array will be used to create promises to run in parallel
        const requestInfoArr = [];

        for (const datasetId of datasetIds) {
            if (processFnLoadingState && !processFnLoadingState[datasetId]) {
                processFnLoadingState[datasetId] = {};
            }
            // We get the number of items first and then we precreate request info objects
            let itemCount;
            if (useLocalDataset) {
                const dataset = await Apify.openDataset(datasetId);
                itemCount = await dataset.getInfo().then((res) => res.itemCount);
            } else {
                itemCount = await Apify.newClient().dataset(datasetId).get().then((res) => res.itemCount);
            }
            if (debugLog) {
                log.info(`Dataset ${datasetId} has ${itemCount} items`);
            }
            const numberOfBatches = Math.ceil(itemCount / batchSize);

            for (let i = 0; i < numberOfBatches; i++) {
                const localOffsetLimit = calculateLocalOffsetLimit({ offset, limit, localStart: i * batchSize, batchSize });
                if (!localOffsetLimit) {
                    continue; // eslint-disable-line no-continue
                }

                if (processFnLoadingState) {
                    if (!processFnLoadingState[datasetId][localOffsetLimit.offset]) {
                        processFnLoadingState[datasetId][localOffsetLimit.offset] = { done: false };
                    } else if (processFnLoadingState[datasetId][localOffsetLimit.offset].done) {
                        log.info(`Batch for dataset ${datasetId}, offset: ${localOffsetLimit.offset} was already processed, skipping...`);
                        continue; // eslint-disable-line no-continue
                    }
                }

                requestInfoArr.push({
                    index: i,
                    offset: localOffsetLimit.offset,
                    limit: localOffsetLimit.limit,
                    datasetId,
                    datasetIndex,
                });
            }

            datasetIndex++;
        }
        return requestInfoArr;
    };

    // This is array of arrays. Top level array is for each dataset and inside one entry for each batch (in order)
    /** @type {any[]} */
    let loadedBatchedArr = [];

    let totalLoaded = 0;
    const totalLoadedPerDataset = {};

    const processFnLoadingState = persistLoadingStateForProcesFn
        ? ((await Apify.getValue('PROCESS-FN-LOADING-STATE')) || {})
        : null;

    // Apify.events doesn't work because this is different Apify instance
    if (processFnLoadingState) {
        setInterval(async () => {
            await Apify.setValue('PROCESS-FN-LOADING-STATE', processFnLoadingState);
        }, 15000);
    }

    const requestInfoArr = await createRequestArray(processFnLoadingState);
    if (debugLog) {
        log.info(`Number of requests to do: ${requestInfoArr.length}`);
    }

    //  Now we execute all the requests in parallel (with defined concurrency)
    await bluebird.map(requestInfoArr, async (requestInfoObj) => {
        const { index, datasetId, datasetIndex } = requestInfoObj;

        const getDataOptions = {
            offset: requestInfoObj.offset,
            limit: requestInfoObj.limit,
            fields,
        };
        let items;
        if (useLocalDataset) {
            // This open should be cached
            const dataset = await Apify.openDataset(datasetId);

            if (!Apify.isAtHome()) {
                delete getDataOptions.fields;
            }
            items = await dataset.getData(getDataOptions)
                .then((res) => res.items);
        } else {
            items = await Apify.newClient().dataset(datasetId).listItems(getDataOptions)
                .then((res) => res.items);
        }

        if (!totalLoadedPerDataset[datasetId]) {
            totalLoadedPerDataset[datasetId] = 0;
        }

        totalLoadedPerDataset[datasetId] += items.length;
        totalLoaded += items.length;

        if (debugLog) {
            log.info(
                `Items loaded from dataset ${datasetId}: ${items.length}, offset: ${requestInfoObj.offset},
        total loaded from dataset ${datasetId}: ${totalLoadedPerDataset[datasetId]},
        total loaded: ${totalLoaded}`,
            );
        }
        // We either collect the data or we process them on the fly
        if (processFn) {
            await processFn(items, { datasetId, datasetOffset: requestInfoObj.offset });
            if (processFnLoadingState) {
                processFnLoadingState[datasetId][requestInfoObj.offset].done = true;
            }
        } else {
            if (!loadedBatchedArr[datasetIndex]) {
                loadedBatchedArr[datasetIndex] = [];
            }
            // Now we correctly assign the items into the main array
            loadedBatchedArr[datasetIndex][index] = items;
        }
    }, { concurrency: parallelLoads });

    if (debugLog) {
        log.info(`Loading took ${Math.round((Date.now() - loadStart) / 1000)} seconds`);
    }

    if (!processFn) {
        if (concatItems) {
            for (let i = 0; i < loadedBatchedArr.length; i++) {
                /**
                 * @param {any} item
                 */
                loadedBatchedArr[i] = loadedBatchedArr[i].flatMap((item) => item);
            }
        }

        if (concatDatasets) {
            loadedBatchedArr = loadedBatchedArr.flatMap((item) => item);
        }
        return loadedBatchedArr;
    }
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
const intervalPushData = async (dataset, limit = 50000) => {
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
const rateLimitedRQ = (rq) => {
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

/**
 * Queue that consist of many internal queues to
 * get over the request/s limit
 * Supports only addRequest for deduping
 * @example
 * const splitQueue = await openSplitDedupQueue('my-q', 20);
 *   for (let i = 0; i < 10; i++) {
 *      const str = `${Math.random()}`;
 *      let { wasAlreadyPresent } = await splitQueue.addRequest({ url: str });
 *  }
 *  console.dir(await splitQueue.getInfo());
 * @param {string} name Base name of the queue, they are named name-0, name-1, etc.
 * @param {number} queueCount=20 More queues allow higher speed
 * @return {Promise<{ addRequest: function, getInfo: function, queues: Array<RequestQueue> }>}
 *  addRequest method and access to underlying queues (should not be needed)
 */
const openSplitDedupQueue = async (name, queueCount = 20) => {
    /**
     * @param {string | Buffer | number[]} uniqueKey
     * @param {number} moduloBy
     */
    const getModuloHash = (uniqueKey, moduloBy) => {
        const hash = createHash('md5', { autoDestroy: true }).update(uniqueKey).digest('hex').slice(0, 4);
        const parsedInt = parseInt(hash, 16);
        return parsedInt % moduloBy;
    };

    /** @type {Apify.RequestQueue[]} */
    const queues = [];
    for (let i = 0; i < queueCount; i++) {
        const queue = await Apify.openRequestQueue(`${name}-${i}`);
        queues.push(queue);
    }

    /**
     * Only supports url/uniqueKey now
     * @param {Request} request
     * @return {Promise<Apify.QueueOperationInfo>} queue add result
     */
    const addRequest = async (request) => {
        const index = getModuloHash(request.uniqueKey || request.url, queueCount);
        // console.log(`Adding ${request.url} to queue ${index}`);
        return queues[index].addRequest(request);
    };

    /**
     * Sums counts from all underlying queues
     * @return {Promise<Apify.RequestQueueInfo>} Almost like Apify.RequestQueueInfo
     */
    const getInfo = async () => {
        const counts = {
            totalRequestCount: 0,
            handledRequestCount: 0,
            pendingRequestCount: 0,
        };
        for (const queue of queues) {
            const queueInfo = await queue.getInfo();
            counts.totalRequestCount += queueInfo.totalRequestCount;
            counts.handledRequestCount += queueInfo.handledRequestCount;
            counts.pendingRequestCount += queueInfo.pendingRequestCount;
        }
        return counts;
    };

    return { addRequest, getInfo, queues };
};

/**
 * Distributes items evenly between many internal map instances, that
 * can be persisted to the KV store on demand. Acts as a
 * transparent Map instance.
 *
 * Used to overcome the 9MB limit of the key value store when
 * serializing big objects or arrays.
 *
 * Does nothing when not initialized
 *
 * @example
 *   const kv = await roundRobinKV(await Apify.openKeyValueStore('NAMED-KV'));
 *   await kv.initialize();
 *
 *   for (let i = 0; i < 10000; i++) {
 *      kv.set(`key${i}`, { value: `content ${i}` });
 *   }
 *
 *   await kv.persistState(); // if you do not kv.initialize(), this call won't save anything to the store
 *
 *   // NAMED-KV will have 5 keys as RR-STORE-0, RR-STORE-1, ... after this call
 *   // and each KV will have 2000 items each.
 *
 * @param {Apify.KeyValueStore} store
 * @param {object} options
 * @param {number} [options.splitSize=5]
 * @param {string} [options.prefix]
 */
const roundRobinKV = async (store, options = {}) => {
    const { splitSize = 5, prefix = '' } = options;

    const prefixStr = (/** @type {number} */id) => `${prefix || 'RR-STORE'}-${id}`;

    /**
     * @type {Array<Map<string, any>>}
     */
    const maps = new Array(splitSize).fill(0).map(() => new Map());
    let currentIndex = 0;
    let initialized = false;

    return {
        async initialize() {
            for (let i = 0; i < splitSize; i++) {
                if (!(await store.getValue(`${prefixStr(i)}`))) {
                    await store.setValue(`${prefixStr(i)}`, []);
                }

                // overwrite empty Map with KV values
                maps[i] = new Map((await store.getValue(`${prefixStr(i)}`)) || []);
            }

            initialized = true;
        },
        /**
         * emulate .size getter
         */
        get size() {
            return maps.reduce((out, map) => (out + map.size), 0);
        },
        /**
         * @param {string} [key]
         */
        get(key) {
            if (key === undefined) {
                return undefined;
            }

            for (const map of maps) {
                if (map.has(key)) {
                    return map.get(key);
                }
            }

            return undefined;
        },
        /**
         * @param {string} [key]
         */
        has(key) {
            if (key === undefined) {
                return false;
            }

            for (const map of maps) {
                if (map.has(key)) {
                    return true;
                }
            }

            return false;
        },
        values() {
            return maps.flatMap((map) => [...map.values()]);
        },
        /**
         * @param {string} [key]
         * @param {any} [data]
         */
        set(key, data) {
            if (key === undefined) {
                return;
            }

            for (const map of maps) {
                // if key already exists, keep it on the same map
                if (map.has(key)) {
                    map.set(key, data);
                    return;
                }
            }

            if (currentIndex >= splitSize) {
                currentIndex = 0;
            }

            maps[currentIndex++].set(key, data);
        },
        /**
         * Persist each internal map to a different key, one by one
         */
        async persistState() {
            if (!initialized) {
                return;
            }

            for (let i = 0; i < splitSize; i++) {
                await store.setValue(`${prefixStr(i)}`, [...maps[i].entries()]);
            }
        },
    };
};

/**
 * @typedef {{
 *   close: () => void,
 *   addRequest: (request: Apify.RequestOptions) => void,
 * }} StreamRequestList
 */

/**
 * A request queue that works more like a mix of RequestList and a Node.JS stream.
 * You push items to it, and it will push it to the crawler that is running undefinitely until
 * you close it.
 *
 * Monkeypatches the original RequestList inner workings to achieve this.
 * Supports persisting like RequestList does to survive migrations.
 *
 * This effectively bypasses issuing RequestQueue fetchNext requests
 *
 * @param {string} name
 * @returns {Promise<Apify.RequestList & StreamRequestList>}
 */
const streamRequestList = async (name = 'STREAM') => {
    /** @type {Apify.RequestList & StreamRequestList} */
    const rl = await Apify.openRequestList(name, []);
    let closed = false;

    const semaphore = new Sema(
        1,
        {
            capacity: 1,
        },
    );

    rl.isFinished = async function () {
        return closed;
    };

    rl.isEmpty = async function () {
        return closed;
    };

    const originalFetchNext = rl.fetchNextRequest.bind(rl);

    rl.fetchNextRequest = async function () {
        if (closed) {
            return null;
        }
        await semaphore.acquire();
        if (closed) {
            return null;
        }
        const next = await originalFetchNext();
        return next;
    };

    rl.addRequest = function (request) {
        // eslint-disable-next-line no-underscore-dangle
        rl._addRequest(request);
        semaphore.release();
    };

    rl.close = function () {
        closed = true;
        semaphore.release();
    };

    return rl;
};

module.exports = {
    openSplitDedupQueue,
    rateLimitedRQ,
    intervalPushData,
    loadDatasetItemsInParallel,
    bufferDataset,
    openChunkedRecordStore,
    roundRobinKV,
    streamRequestList,
};
