const Apify = require('Apify');
// Put this on top of your actor, crypto is native module, no need to install
const crypto = require('crypto');

const { generateInputs, processItems } = require('./dummy-fns');

Apify.main(async () => {
    // callState will keep track of matching between inputs and run IDs
    const callState = await Apify.getValue('CALL-STATE') || {};
    // we have to persist it so we always remember accurate matchings
    Apify.events.on('persistState', async () => {
        await Apify.setValue('CALL-STATE', callState);
    });

    // Now we generate the inputs like previously
    const actorInputs = generateInputs();

    // We need to supply the inputs to the BasicCrawler which expects requests
    // And we also want to match inputs with run IDs easily, we will use hashing
    // Instead of hashing, you can also use any value that you know will be unique for each input
    // If you want to call more runs with the same input, simply add an index to the input
    const sources = [];
    for (const actorInput of actorInputs) {
        const hash = crypto
            .createHash('md5')
            .update(JSON.stringify(actorInput))
            .digest('hex');
        const request = {
            // dummy URL
            url: 'http://example.com',
            uniqueKey: hash,
            userData: { actorInput },
        };
        sources.push(request);
    }

    // I recommend creating RequestList without persistence in this case
    // which allows you to resurrect the called actors and await them again
    // Passing null as a name prevents persistence
    const requestList = await Apify.openRequestList(null, sources);

    // We will use client's utility to wait for runs to finish
    const apifyClient = Apify.newClient();

    const crawler = new Apify.BasicCrawler({
        // We want to limit to run 5 parallel runs to perserve memory
        maxConcurrency: 5,
        requestList,
        handleRequestFunction: async ({ request }) => {
            const { uniqueKey: hash, userData } = request;
            const { actorInput } = userData;

            // If the actor was already called, we have a record in state
            if (!callState[hash]) {
                // We want to this to give us the run info immediately so we can store it
                const runInfo = await apifyClient.actor('apify/hello-world').start(actorInput);
                console.log(`Started run: ${runInfo.id} with hash: ${hash}`);
                callState[hash] = runInfo;
            }

            // If the run already finished before, this just returns right away
            // As I mentioned, if we always check the run's actual state, it allows us to resurrect
            const runInfo = await apifyClient.run(callState[hash].id).waitForFinish();
            console.log(`Finished run: ${runInfo.id} with hash: ${hash}`);
            // If it finished, we update the state
            callState[hash] = runInfo;
        },
    });

    await crawler.run();

    // We save the callState at the end so we have consistent values in the KV store
    await Apify.setValue('CALL-STATE', callState);

    // Now we know all runs finished and we have all info in callState
    // e.g. we can process the datasets
    for (const runInfo of Object.values(callState)) {
        const { defaultDatasetId } = runInfo;
        const { items } = await apifyClient.dataset(defaultDatasetId).listItems();
        // Do something with the data
        const processed = processItems(items);
        await Apify.pushData(processed);
        console.log(`Processed run: ${runInfo.id} with dataset ID: ${defaultDatasetId} having ${items.length} items`);
    }
});
