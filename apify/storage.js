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