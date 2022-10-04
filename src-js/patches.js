const Apify = require('apify');

/**
 * Loops asynchronously using setTimeout.
 *
 * @param {{
 *   polling?: number,
 *   isCompleted: (abort: AbortSignal) => Promise<boolean>,
 *   cb: (error?: null) => void
 * }} params
 */
const loopedInterval = ({ isCompleted, cb, polling = 50 }) => {
    const controller = new AbortController();
    const { signal } = controller;
    /** @type {any} */
    let lastTimeout;

    const cleanup = () => {
        if (lastTimeout) {
            clearTimeout(lastTimeout);
        }

        signal.removeEventListener('abort', cleanup);
    };

    signal.addEventListener('abort', cleanup);

    const wrap = async () => {
        try {
            if (signal.aborted) {
                return;
            }

            if (await isCompleted(signal)) {
                cb();
            }
        } catch (e) {
            controller.abort();
            cb(e);
        } finally {
            lastTimeout = setTimeout(wrap, polling);
        }
    };

    return {
        controller,
        start() {
            lastTimeout = setTimeout(wrap);
        },
    };
};

/**
 * Creates a promise that can be resolved/rejected from the outside
 * Allows to query for the resolved status.
 *
 * Uses setTimeout to schedule the resolving/rejecting to the next
 * event loop, so things like Promise.race/all have a chance to attach
 * to them.
 */
const deferred = () => {
    /** @type {(val: any) => void} */
    let resolve = () => {};
    /** @type {(err?: Error) => void} */
    let reject = () => {};
    let resolved = false;
    const promise = new Promise((_resolve, _reject) => {
        resolve = (val) => {
            if (!resolved) {
                resolved = true;
                setTimeout(() => {
                    _resolve(val);
                });
            }
        };
        reject = (err) => {
            if (!resolved) {
                resolved = true;
                setTimeout(() => {
                    _reject(err);
                });
            }
        };
    });
    return {
        promise,
        get resolved() {
            return resolved;
        },
        resolve,
        reject,
    };
};

/**
 * Patches the crawler to stop when the concurrency is 0 or the pending request is negative
 *
 * @param {Apify.BasicCrawler} crawler
 * @example
 *   const crawler = new Apify.PuppeteerCrawler({ ... });
 *   await concurrency(crawler);
 */
const concurrency = async (crawler) => {
    const defer = deferred();

    const interval = loopedInterval({
        async isCompleted() {
            const info = await crawler.requestQueue?.getInfo?.();

            return crawler.autoscaledPool?.currentConcurrency === 0
                && (info?.pendingRequestCount ?? Infinity) <= 0
                && ((info?.totalRequestCount ?? 0) >= (info?.handledRequestCount ?? 0));
        },
        cb(err) {
            if (err) {
                return defer.reject(err);
            }
            defer.resolve(true);
        },
    });

    try {
        interval.start();

        return await Promise.race([
            crawler.run(),
            defer.promise,
        ]);
    } finally {
        try {
            await crawler?.autoscaledPool?.abort?.();
        } catch (e) {}
        interval.controller.abort();
    }
};

module.exports = {
    concurrency,
    deferred,
    loopedInterval,
};
