exports.waiter = async (predicate, { timeout, delay }) => {
    const start = Date.now();
    while (true) {
        if (predicate()) {
            return;
        }
        const waitingFor = Date.now() - start;
        if (waitingFor > timeout) {
            throw new Error(`Timeout reached when waiting for predicate for ${waitingFor} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
};

/**
 * Cumulative timer
 *
 * ```
 * const { start } = stopwatch();
 * const end = start();
 * end() === millis;
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