const Apify = require('apify');
const { streamRequestList } = require('../src/storage');

Apify.main(async () => {
    const requestList = await streamRequestList();

    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        handlePageFunction: async ({ page }) => {
            await Apify.pushData(page.title());
        },
    });

    requestList.addRequest({
        url: 'https://apify.com',
    });

    await Promise.all([
        crawler.run(),
        new Promise((r) => {
            setTimeout(async () => {
                await Apify.utils.sleep(3000);

                requestList.addRequest({
                    url: 'https://apify.com/store',
                });

                await Apify.utils.sleep(3000);

                requestList.close();
                r(null);
            }, 5000);
        }),
    ]);
});
