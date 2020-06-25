const Apify = require('apify');

/**
 * Create and return a Map that is persisted to KV on 'persistState'
 * and can be persisted manually calling `await persistState()`
 *
 * @param {string} name
 * @param {string} key
 */
exports.createPersistedMap = async (name, key) => {
  const kv = await Apify.openKeyValueStore(name);

  /** @type {Map<string, any>} */
  const state = new Map(
      await kv.getValue(key),
  );

  const persistState = async () => {
      await kv.setValue(key, [...state]);
  };

  Apify.events.on('persistState', persistState);

  return {
      persistState,
      state,
      name,
      key,
  };
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
    let isMigrating = false;

    const interval = setInterval(async () => {
        if (!isMigrating && data.size >= limit) {
            const dataToPush = [...data.values()];
            data.clear();
            await dataset.pushData(dataToPush);
        }
    }, 10000);

    Apify.events.on('migrating', async () => {
        isMigrating = true;
        clearInterval(interval);
        await Apify.setValue('PENDING_PUSH', [...data.entries()]);
    });

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
            clearInterval(interval);

            const dataToPush = [...data.values()];

            while (dataToPush.length) {
                await Apify.pushData(dataToPush.splice(0, limit));
                await Apify.utils.sleep(1000);
            }
        }
    }
}