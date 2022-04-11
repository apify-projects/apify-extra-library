const moment = require('moment');

/**
 * Waits until a predicate (funcion that returns bool) returns true
 *
 * @example
 *   let eventFired = false;
 *   await waiter(() => eventFired, { timeout: 120000, pollInterval: 1000 })
 *   // Something happening elsewhere that will set eventFired to true
 *
 * @template {() => Promise<any>} T
 * @param {T} predicate
 * @param {object} [options]
 * @param {number} [options.timeout=120000]
 * @param {number} [options.pollInterval=1000]
 */
const waiter = async (predicate, options = {}) => {
    const { timeout = 120000, pollInterval = 1000 } = options;
    const start = Date.now();

    while (true) {
        if (await predicate()) {
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
const stopwatch = (startAt) => {
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
const toIsoDate = (dateLike, fallback) => {
    if (!dateLike) {
        return fallback;
    }

    const parsed = new Date(dateLike);

    if (Number.isNaN(parsed.getTime())) {
        return typeof fallback !== 'undefined' ? fallback : dateLike;
    }

    return parsed.toISOString();
};

/**
 * Allows relative dates like `1 month` or `12 minutes`,
 * yesterday and today.
 * Parses unix timestamps in milliseconds and absolute dates in ISO format
 *
 * @param {string|number|Date} value
 * @param {boolean} inTheFuture
 */
const parseTimeUnit = (value, inTheFuture) => {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return moment.utc(value);
    }

    switch (value) {
        case 'today':
        case 'yesterday': {
            const startDate = (value === 'today' ? moment.utc() : moment.utc().subtract(1, 'day'));

            return inTheFuture
                ? startDate.endOf('day')
                : startDate.startOf('day');
        }
        default: {
            // valid integer, needs to be typecast into a number
            // non-milliseconds needs to be converted to milliseconds
            if (+value == value) {
                return moment.utc(+value / 1e10 < 1 ? +value * 1000 : +value, true);
            }

            const [, number, unit] = `${value}`.match(/^(\d+)\s?(minute|second|day|hour|month|year|week)s?$/i) || [];

            if (+number && unit) {
                return inTheFuture
                    ? moment.utc().add(+number, unit)
                    : moment.utc().subtract(+number, unit);
            }
        }
    }

    const date = moment.utc(value);

    if (!date.isValid()) {
        return null;
    }

    return date;
};

/**
 * @typedef MinMax
 * @property {number | string} [min]
 * @property {number | string} [max]
 */

/**
 * @typedef {ReturnType<typeof minMaxDates>} MinMaxDates
 */

/**
 * Generate a function that can check date intervals depending on the input
 * @param {MinMax} param
 */
const minMaxDates = ({ min, max }) => {
    const minDate = parseTimeUnit(min, false);
    const maxDate = parseTimeUnit(max, true);

    if (minDate && maxDate && maxDate.diff(minDate) < 0) {
        throw new Error(`Minimum date ${minDate.toString()} needs to be less than max date ${maxDate.toString()}`);
    }

    return {
        get isComparable() {
            return !!minDate || !!maxDate;
        },
        /**
         * cloned min date, if set
         */
        get minDate() {
            return minDate?.clone();
        },
        /**
         * cloned max date, if set
         */
        get maxDate() {
            return maxDate?.clone();
        },
        /**
         * compare the given date/timestamp to the time interval.
         * never fails or throws.
         *
         * @param {string | number} time
         */
        compare(time) {
            const base = parseTimeUnit(time, false);
            return (minDate ? minDate.diff(base) <= 0 : true) && (maxDate ? maxDate.diff(base) >= 0 : true);
        },
    };
};

module.exports = {
    toIsoDate,
    stopwatch,
    waiter,
    minMaxDates,
    parseTimeUnit,
};
