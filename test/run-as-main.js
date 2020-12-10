// Run this with apify run CLI

const Apify = require('Apify');

const { loadDatasetItemsInParallel } = require('../copy-paste/storage');

Apify.main(async () => {
    const datasetIds = []; // Add your test datasets
    const options = {
        parallelLoads: 5,
        processFn: (items) => {
            console.log(`ProcessFn: Loaded ${items.length} items`);
        },
        batchSize: 5000,
        fields: ['id'],
        persistLoadingStateForProcesFn: true,
        debugLog: true,
    };
    await loadDatasetItemsInParallel(datasetIds, options);
})
