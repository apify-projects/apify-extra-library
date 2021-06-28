const BigSet = require('big-set');

const { loadDatasetItemsInParallel } = require('./storage');

/**
 * Set that can be used to keep multiple actor runs fairly synchronised
 * WARNING: The synchronisation is only eventual, if you need 100% synchronized
 * set, don't use this.
 * The synchronization is good enough for pagination deduplication.
 * This function creates a set that uses dataset as a backing storage.
 * Dataset has a nice property that you can append without needing to read all.
 * We can use this to our advantage that we remember the offset we last read and only read
 * the new items.
 * We need to read the full dataset only on start or migration
 */
module.exports.parallelPersistedSet = async (datasetName, options = {}) => {
    const { } = options;


}