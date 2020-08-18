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
    let buffer = [];

    /**
     * Flushes any remaining items on the pending array.
     * Call this after await crawler.run()
     */
    const flush = async () => {
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

/**
 * Loads items from many datasets in parallel, retaining order of both items and datasets. Useful for large loads.
 * By default returns one array of items in order of datasets provided.
 * By changing concatItems or concatDatasets options, you can get array of arrays (of arrays) back
 * Requires bluebird dependency
 *
 * @param {string[]} datasetIds IDs of datasets you want to load
 * @param {object} options Options with default values.
 * If both concatItems and concatDatasets are false, output of this function is an array of datasets containing arrays of batches containig array of items.
 * concatItems concats all batches of one dataset into one array of items.
 * concatDatasets concat all datasets into one array of batches
 * Using both concatItems and concatDatasets gives you back a sinlge array of all items in order.
 * Both are true by default.
 * @param {number} options.parallelLoads
 * @param {number} options.batchSize
 * @param {boolean} options.concatItems
 * @param {boolean} options.concatDatasets
 */

module.exports.loadDatasetItemsInParallel = async (datasetIds, options = {}) => {
    const { parallelLoads = 20, batchSize = 50000, concatItems = true, concatDatasets = true } = options;

    // This is array of arrays. Top level array is for each dataset and inside one entry for each batch (in order)
    let loadedBatchedArr = [];
    // We increment for each dataset so we remember their order
    let datasetIndex = 0;
    let totalLoaded = 0;
    const loadStart = Date.now();
    for (const datasetId of datasetIds) {
        loadedBatchedArr[datasetIndex] = [];
        let totalLoadedPerDataset = 0;
        // We get the number of items first and then we precreate request info objects
        const { cleanItemCount } = await Apify.client.datasets.getDataset({ datasetId });
        console.log(`Dataset ${datasetId} has ${cleanItemCount} items`);
        const numberOfBatches = Math.ceil(cleanItemCount / batchSize);

        const requestInfoArr = [];
        for (let i = 0; i < numberOfBatches; i++) {
            requestInfoArr.push({
                index: i,
                offset: i * batchSize,
            });
        }

        // eslint-disable-next-line no-loop-func
        await Promise.map(requestInfoArr, async (requestInfoObj) => {
            const { items } = await Apify.client.datasets.getItems({
                datasetId,
                offset: requestInfoObj.offset,
                limit: batchSize,
            });

            totalLoadedPerDataset += items.length;
            totalLoaded += items.length;

            console.log(
                `Items loaded from dataset ${datasetId}: ${items.length}, offset: ${requestInfoObj.offset},
        total loaded from dataset ${datasetId}: ${totalLoadedPerDataset},
        total loaded: ${totalLoaded}`,
            );

            // Now we correctly assign the items into the main array
            loadedBatchedArr[datasetIndex][requestInfoObj.index] = items;
        }, { concurrency: parallelLoads });

        datasetIndex++;
    }
    console.log(`Loading took ${Math.round((Date.now() - loadStart) / 1000)} seconds`);

    if (concatItems) {
        for (let i = 0; i < loadedBatchedArr.length; i++) {
            loadedBatchedArr[i] = loadedBatchedArr[i].reduce((acc, items) => acc.concat(items));
        }
    }

    if (concatDatasets) {
        loadedBatchedArr = loadedBatchedArr.reduce((acc, items) => acc.concat(items));
    }
    return loadedBatchedArr;
}

