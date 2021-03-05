// Run this with apify run CLI

const Apify = require('Apify');

const { loadDatasetItemsInParallel, openChunkedRecordStore } = require('../src/storage');

Apify.main(async () => {
    /*
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
    */

    const store = await Apify.openKeyValueStore();
    const chunkedStore = await openChunkedRecordStore(store, { debugLog: true });
    // Save some big array of data
    const bigData = [];
    for (let i = 0; i < 2000000; i++) {
        bigData.push({ index: i });
    }
    await chunkedStore.setValue('ITEMS', bigData);
    console.log('Data stored');
    // Get bigData back
    const loadedBigData = await chunkedStore.getValue('ITEMS');
    console.log(`${loadedBigData.length} items loaded`);
});
