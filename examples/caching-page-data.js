const Apify = require('apify');

// Let's imagine we have set the extracting functions
const { extractProductData, extractSellerData } = require('./extractors');

Apify.main(async () => {
    const cache = (await Apify.getValue('CACHE')) || {};

    Apify.events.on('persistState', async () => {
        await Apify.setValue('CACHE', cache);
    });

    const requestQueue = await Apify.openRequestQueue();

    await requestQueue.addRequest({
        url: 'https://marketplace.com',
        userData: { label: 'START' },
    });

    // Other crawler setup
    // ...

    // It doesn't matter what crawler class we choose
    const crawler = new Apify.CheerioCrawler({
        // Other crawler configs
        // ...
        requestQueue,
        handlePageFunction: async ({ request, $ }) => {
            const label = request.userData;
            if (label === 'START') {
                // Enqueue categories etc...
            } else if (label === 'CATEGORY') {
                // Enqueue products and paginate...
            } else if (label === 'PRODUCT') {
                // Here is where our example begins
                const productData = extractProductData($);
                const sellerId = $('#seller-id').text().trim();

                // We have all we need from the product page
                // Now we check the cache if we already scraped this seller
                if (cache[sellerId]) {
                    // If yes, we just merge the data and we are done
                    const result = {
                        ...productData,
                        ...cache[sellerId],
                    };
                    await Apify.pushData(result);
                } else {
                    // If the cache doesn't have this seller, we have to go to his or her page
                    await requestQueue.addRequest({
                        url: `https://marketplace.com/seller/${sellerId}`,
                        userData: {
                            label: 'SELLER',
                            // We also have to pass the product data
                            // so we can merge and push them from the seller page
                            productData,
                        },
                    });
                }
            } else if (label === 'SELLER') {
                // And finally we handle the seller page
                // We scrape the seller data
                const sellerData = extractSellerData($);

                // We populate the cache so all other products of this sellers can be server from there
                cache[sellerData.sellerId] = sellerData;

                // We merge seller and product data and push
                const result = {
                    ...request.userData.productData,
                    ...sellerData,
                };
                await Apify.pushData(result);
            }
        },
    });

    await crawler.run();
});
