const Apify = require('apify');

const { PIVOT_PRICE_RANGES, MAX_PRODUCTS_PAGINATION } = require('./const');
const { createFilterUrl, getFiltersFromUrl, splitFilter } = require('./utils');

Apify.main(async () => {
    // Actor setup things here
    // ...
    const requestQueue = await Apify.createRequestQueue();
    // And let's enqueue the pivot requests
    for (const { min, max } of PIVOT_PRICE_RANGES) {
        await requestQueue.addRequest({
            url: createFilterUrl({ min, max }),
            userData: { label: 'FILTER' },
        });
    }

    // Doesn't matter what Crawler class we choose
    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        // Crawler options here
        // ...
        handlePageFunction: async ({ request, $ }) => {
            const { label } = request.userData;
            if (label === 'FILTER') {
                // Of course, change the selectors and make it more robust
                const numberOfProducts = Number($('.product-count').text());

                // The filter is either good enough of we have to split it
                if (numberOfProducts <= MAX_PRODUCTS_PAGINATION) {
                    // We just pass the URL for scraping, we could optimize it so the page is not opened again
                    await requestQueue.addRequest({
                        url: `${request.url}&page=1`,
                        userData: { label: 'PAGINATION' },
                    });
                } else {
                    // Here we have to split the filter
                    const { min, max } = getFiltersFromUrl(request.url);
                    // Our generic splitFitler function doesn't account for decimal values so we will have to convert to cents and back to dollars
                    const newFilters = splitFilter({ min: min * 100, max: max * 100 });

                    // And we just enqueue those 2 new filters so the process will recursivelly repeat until all pages get to the PAGINATION phase
                    for (const filter of newFilters) {
                        await requestQueue.addRequest({
                            // Remember that we have to convert back from cents to dollars
                            url: createFilterUrl({ min: filter.min / 100, max: filter.max / 100 }),
                            userData: { label: 'FILTER' },
                        });
                    }
                }
            }
            if (label === 'PAGINATION') {
                // We know we are under the limit here
                // Enqueue next page as long as possible
                // Enqueue or scrape products normally
            }
        }
    });

    crawler.run();
});
