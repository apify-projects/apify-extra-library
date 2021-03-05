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
 * @param {*} value
 * @returns {moment.Moment | null}
 */
const parseTimeUnit = (value) => {
    if (!value) {
        return null;
    }

    const [, number, unit] = `${value}`.match(/^(\d+) (minute|second|day|hour|month|year|week)s?$/i) || [];

    if (+number && unit) {
        return moment().subtract(+number, unit);
    }

    return moment(value);
};

/**
 * @typedef {ReturnType<typeof minMaxDates>} MinMaxDates
 * @typedef {{ min?: number | string; max?: number | string; }} MinMax
 */

/**
 * Generate a function that can check date intervals depending on the input
 *
 * @example
 *    const checkDate = minMaxDates({ min: '1 month', max: '2021-03-10' });
 *    checkDate.compare('2021-02-09');
 *
 * @param {MinMax} params
 */
const minMaxDates = ({ min, max }) => {
    const minDate = parseTimeUnit(min);
    const maxDate = parseTimeUnit(max);

    if (minDate && maxDate && maxDate.diff(minDate) < 0) {
        throw new Error(`Minimum date ${minDate.toString()} needs to be less than max date ${maxDate.toString()}`);
    }

    return {
        /**
         * cloned min date, if set
         */
        get minDate() {
            return minDate ? minDate.clone() : null;
        },
        /**
         * cloned max date, if set
         */
        get maxDate() {
            return maxDate ? maxDate.clone() : null;
        },
        /**
         * compare the given date/timestamp to the time interval
         * @param {string | number} time
         */
        compare(time) {
            const base = moment(time);
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
