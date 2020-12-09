const { RequestQueue, Request } = require('apify');
const Apify = require('apify');
const Promise = require('bluebird');

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
exports.bufferDataset = (dataset, options = {}) => {
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
            console.log(`Flushing buffer with size: ${data.length}`);
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

module.exports.calculateLocalOffsetLimit = calculateLocalOffsetLimit;

/**
 * Loads items from one or many datasets in parallel by chunking the items from each dataset into batches,
 * retaining order of both items and datasets. Useful for large loads.
 * By default returns one array of items in order of datasets provided.
 * By changing concatItems or concatDatasets options, you can get array of arrays (of arrays) back
 * Requires bluebird dependency and copy calculateLocalOffsetLimit function!!!
 *
 * @param {string[]} datasetIds IDs of datasets you want to load
 * @param {object} options Options with default values.
 * If both concatItems and concatDatasets are false, output of this function is an array of datasets containing arrays of batches containig array of items.
 * concatItems concats all batches of one dataset into one array of items.
 * concatDatasets concat all datasets into one array of batches
 * Using both concatItems and concatDatasets gives you back a sinlge array of all items in order.
 * Both are true by default.
 * @param {Function} options.processFn - Data are not returned by fed to the supplied async function on the fly (reduces memory usage)
 * @param {number} options.parallelLoads
 * @param {number} options.batchSize
 * @param {number} options.offset=0
 * @param {number} options.limit=999999999
 * @param {boolean} options.concatItems
 * @param {boolean} options.concatDatasets
 * @param {boolean} options.fields
 * @param {boolean} options.debugLog
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
        fields,
        debugLog,
    } = options;

    const loadStart = Date.now();

    const createRequestArray = async () => {
        // We increment for each dataset so we remember their order
        let datasetIndex = 0;

        // This array will be used to create promises to run in parallel
        const requestInfoArr = [];

        for (const datasetId of datasetIds) {
            // We get the number of items first and then we precreate request info objects
            const { cleanItemCount } = await Apify.client.datasets.getDataset({ datasetId });
            if (debugLog) console.log(`Dataset ${datasetId} has ${cleanItemCount} items`);
            const numberOfBatches = Math.ceil(cleanItemCount / batchSize);

            for (let i = 0; i < numberOfBatches; i++) {
                const localOffsetLimit = calculateLocalOffsetLimit({ offset, limit, localStart: i * batchSize, batchSize });
                if (!localOffsetLimit) {
                    continue;
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

    const requestInfoArr = await createRequestArray();
    if (debugLog) console.log(`Number of requests to do: ${requestInfoArr.length}`);

    //  Now we execute all the requests in parallel (with defined concurrency)
    await Promise.map(requestInfoArr, async (requestInfoObj) => {
        const { index, datasetId, datasetIndex } = requestInfoObj;
        const { items } = await Apify.client.datasets.getItems({
            datasetId,
            offset: requestInfoObj.offset,
            limit: requestInfoObj.limit,
            fields,
        });

        if (!totalLoadedPerDataset[datasetId]) {
            totalLoadedPerDataset[datasetId] = 0;
        }

        totalLoadedPerDataset[datasetId] += items.length;
        totalLoaded += items.length;

        if (debugLog) {
            console.log(
                `Items loaded from dataset ${datasetId}: ${items.length}, offset: ${requestInfoObj.offset},
        total loaded from dataset ${datasetId}: ${totalLoadedPerDataset[datasetId]},
        total loaded: ${totalLoaded}`,
            );
        }
        // We either collect the data or we process them on the fly
        if (processFn) {
            await processFn(items, { datasetId, datasetOffset: requestInfoObj.offset });
        } else {
            if (!loadedBatchedArr[datasetIndex]) {
                loadedBatchedArr[datasetIndex] = [];
            }
            // Now we correctly assign the items into the main array
            loadedBatchedArr[datasetIndex][index] = items;
        }
    }, { concurrency: parallelLoads });

    if (debugLog) console.log(`Loading took ${Math.round((Date.now() - loadStart) / 1000)} seconds`);

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

const md5 = require('md5');

/**
 * Requires md5 dependency
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
 * @return {Promise<{ addRequest: function, getInfo: function, queues: Array<RequestQueue> }>} addRequest method and access to underlying queues (should not be needed)
 */
const openSplitDedupQueue = async (name, queueCount = 20) => {
    /**
     * @param {string | Buffer | number[]} uniqueKey
     * @param {number} moduloBy
     */
    const getModuloHash = (uniqueKey, moduloBy) => {
        const hash = md5(uniqueKey).slice(0, 4);
        const parsedInt = parseInt(hash, 16);
        return parsedInt % moduloBy;
    };

    /** @type RequestQueue[] */
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
    }

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
