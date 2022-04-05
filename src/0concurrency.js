const Apify = require('apify');

const { log } = Apify.utils;

const handleResurrect = async (crawler) => {
    const runId = Apify.getEnv().actorRunId;
    await Apify.addWebhook({
        eventTypes: ['SUCCEEDED', 'ABORTED', 'FAILED'],
        requestUrl: `https://api.apify.com/v2/actor-runs/${runId}/resurrect?token=${Apify.getEnv().token}`,
    });
    await Apify.newClient().run(runId).abort({ gracefully: true });
};

const handleAbort = async (crawler) => {
    const queueInfo = await crawler.requestQueue?.getInfo?.();
    const listHasRequests = await crawler.requestList?.isFinished?.() === false;
    const hasStillRequests = queueInfo?.pendingRequestCount > 0 || listHasRequests;

    if (hasStillRequests) {
        await handleResurrect(crawler);
    } else {
        await crawler.autoscaledPool.abort();
    }
};

const isDoingNothing = async (crawler) => {
    return crawler.autoscaledPool?.currentConcurrency === 0;
};

const abortIfStuck = async (crawler) => {
    const MAX_DOING_NOTHING_SECS = 120;
    const POLLING_INTERVAL_SECS = 5;
    let doingNothingInRowSecs = 0;
    for (;;) {
        await Apify.utils.sleep(POLLING_INTERVAL_SECS * 1000);
        if (crawler.autoscaledPool?.isStopped) {
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
            await handleAbort(crawler);
        }
    }
};

module.exports.runAndProtect0Concurrency = async (crawler) => {
    await Promise.race([
        crawler.run(),
        abortIfStuck(crawler),
    ]);
};
