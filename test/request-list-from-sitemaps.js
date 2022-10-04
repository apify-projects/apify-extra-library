const Apify = require('apify');
const { requestListFromSitemaps } = require('../src-js/parsing');

Apify.main(async () => {
    const proxyConfiguration = await Apify.createProxyConfiguration({
        groups: ['SHADER'],
    });

    const requestList = await requestListFromSitemaps({
        proxyConfiguration,
        sitemapUrls: [
        ],
    });

    const crawler = new Apify.CheerioCrawler({
        requestList,
        handlePageFunction: async ({ $ }) => {
            await Apify.pushData({ title: $('title').text() });
        },
    });

    await crawler.run();
});
