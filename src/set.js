const Apify = require('apify');
const BigSet = require('big-set');

const { loadDatasetItemsInParallel } = require('./storage');

const { log } = Apify.utils;

// Experiemental only
class ParallelPersistedSet {
    constructor(datasetName, options = {}) {
        const { writeSyncIntervalMs, readSyncIntervalMs } = options;

        this.set = new BigSet();
        this.datasetName = datasetName;
        this.offset = 0;
        this.pushDataBuffer = [];

        // These are set on _initialize()
        this.writeSyncIntervalMs = writeSyncIntervalMs || 5000;
        this.readSyncIntervalMs = readSyncIntervalMs || 30000;
        this.writeSyncInterval = null;
        this.readSyncInterval = null;
    }

    add(key) {
        if (!this.set.has(key)) {
            this.set.add(key);
            this.pushDataBuffer.push({ d: key });
            return true;
        }
        return false;
    }

    has(key) {
        return this.set.has(key);
    }

    toArray() {
        return this.set.keys();
    }

    size() {
        return this.set.size;
    }

    async _fillSetWithNewItems() {
        const items = await loadDatasetItemsInParallel([this.datasetName], { offset: this.offset });

        for (const item of items) {
            // We use direct add to Set here since we don't want to push those items
            // d is arbitraty property name, using one char so it consumes the last data
            this.set.add(item.d);
        }
        log.debug(`fillSetWithNewItems: Loaded ${items.length} new items, with offset ${this.offset}, set has ${this.set.size} keys`);

        this.offset += items.length;
    }

    async _pushData() {
        const toPush = this.pushDataBuffer;
        this.pushDataBuffer = [];

        const dataset = await Apify.openDataset(this.datasetName);
        log.debug(`pushData: Pushing ${toPush.length} new unique keys`);
        await dataset.pushData(toPush);
    }

    async _initialize() {
        await this._fillSetWithNewItems();

        this.writeSyncInterval = setInterval(this._pushData, this.writeSyncIntervalMs);
        this.readSyncInterval = setInterval(this._fillSetWithNewItems, this.readSyncInterval);

        log.debug(`initialize: Initialized read/write sync intervals`);
    }

    /**
     * Clears intervals that are reading from and pushing to dataset.
     * Set is then a normal non-synchronised set.
     */
    stopSynchronisation() {
        if (this.readSyncInterval) {
            clearInterval(this.readSyncInterval);
            this.readSyncInterval = null;
        }

        if (this.writeSyncInterval) {
            clearInterval(this.writeSyncInterval);
            this.writeSyncInterval = null;
        }
        log.debug(`stopSynchronisation: Removed read/write sync intervals`);
    }
}
/**
 * WARNING: The synchronisation is only eventual, if you need 100% synchronized set, don't use this.
 * Set that can be used to keep multiple actor runs fairly synchronised
 * The synchronization is good enough for pagination deduplication.
 * This function creates a set that uses dataset as a backing storage.
 * Dataset has a nice property that you can append without needing to read all.
 * We can use this to our advantage that we remember the offset we last read and only read
 * the new items.
 * We need to read the full dataset only on start or migration
 *
 * Currently the set only supports .add, .has and .toArray methods
 */
module.exports.createParallelPersistedSet = async (datasetName, options = {}) => {
    const { writeSyncIntervalMs, readSyncIntervalMs } = options;

    const set = new ParallelPersistedSet(datasetName, { writeSyncIntervalMs, readSyncIntervalMs });
    await set._initialize();
    return set;
};
