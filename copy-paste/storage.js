const Apify = require('apify');
const Promise = require('bluebird');

/**
 * Loads items from many datasets in parallel, retaining order of both items and datasets. Useful for large loads.
 * By default returns one array of items in order of datasets provided.
 * By changing concatItems or concatDatasets options, you can get array of arrays (of arrays) back
 * Requires bluebird dependency
 *
 * @param {array} datasetIds IDs of datasets you want to load
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

