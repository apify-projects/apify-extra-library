/**
 * Waits until a predicate (funcion that returns bool) returns true
 *
 * ```
 * let eventFired = false;
 * await waiter(() => eventFired, { timeout: 120000, pollInterval: 1000 })
 * // Something happening elsewhere that will set eventFired to true
 * ```
 *
 * @param {function} predicate
 * @param {object} options
 * @param {number} options.timeout=120000
 * @param {number} options.pollInterval=1000
 */
exports.waiter = async (predicate, options = {}) => {
    const { timeout = 120000, pollInterval = 1000 } = options;
    const start = Date.now();
    while (true) {
        if (predicate()) {
            return;
        }
        const waitingFor = Date.now() - start;
        if (waitingFor > timeout) {
            throw new Error(`Timeout reached when waiting for predicate for ${waitingFor} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
};

/**
 * Cumulative timer
 *
 * ```
 * const { start, total } = stopwatch();
 * const end = start();
 * end() === millis;
 * start()();
 * total() === totalMillis;
 * ```
 *
 * @param {number} startAt Loaded from the persisted state
 */
exports.stopwatch = (startAt) => {
    let total = startAt || 0;

    return {
        start: () => {
            const startTime = Date.now();

            /** stop */
            return () => {
                const value = Date.now() - startTime;
                total += value;
                return value;
            };
        },
        total: () => total,
    };
};

/**
 * @param {string} dateLike
 * @param {*} [fallback] Output the value as is if not able to parse a valid date
 */
exports.toIsoDate = (dateLike, fallback) => {
    if (!dateLike) {
        return fallback;
    }

    const parsed = new Date(dateLike);

    if (Number.isNaN(parsed.getTime())) {
        return typeof fallback !== 'undefined' ? fallback : dateLike;
    }

    return parsed.toISOString();
};
