const Apify = require('apify');

const { log } = Apify.utils;

const isDoingNothing = async (crawler) => {
    if (crawler.autoscaledPool?.currentConcurrency === 0) {
        const info = await crawler.requestQueue?.getInfo?.();
        if (!info || info.pendingRequestCount <= 0) {
            return true;
        }
    }
};

const abortIfStuck = async (crawler, state) => {
    const MAX_DOING_NOTHING_SECS = 60;
    const POLLING_INTERVAL_SECS = 5;
    let doingNothingInRowSecs = 0;
    for (;;) {
        await Apify.utils.sleep(POLLING_INTERVAL_SECS * 1000);
        // TODO: Clean this promise when the crawler naturally finishes
        // isStopped is only true after abort() is called
        if (state.raceFinished || crawler.autoscaledPool?.isStopped) {
            return;
        }
        log.debug('0 Concurrency health check: Checking if the crawler is stuck at 0 concurrency');
        const isDoingNothingNow = await isDoingNothing(crawler);
        if (isDoingNothingNow) {
            log.warning(`0 Concurrency health check: Crawler is at 0 concurrency already for ${doingNothingInRowSecs} seconds`);
            doingNothingInRowSecs += POLLING_INTERVAL_SECS;
        } else {
            doingNothingInRowSecs = 0;
        }
        if (doingNothingInRowSecs > MAX_DOING_NOTHING_SECS) {
            log.warning(`0 Concurrency health check: Aborting crawler for being at 0 concurrency for more than ${MAX_DOING_NOTHING_SECS} seconds`);
            // Here we abort the crawler, wait a bit and then return to clean the promise
            await crawler.autoscaledPool.abort();
        }
    }
};

module.exports.runAndProtect0Concurrency = async (crawler) => {
    const state = { raceFinished: false };
    await Promise.race([
        crawler.run(),
        abortIfStuck(crawler, state),
    ]);
    state.raceFinished = true;
};
