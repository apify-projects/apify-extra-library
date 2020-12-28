module.exports =  {
    // These is just an example, choose what makes sense for your site
    PIVOT_PRICE_RANGES: [
        { min: 0, max: 9.99 },
        { min: 10, max: 99.99 },
        { min: 100, max: 999.99 },
        { min: 1000, max: 9999.99 },
        { min: 10000, max: null }, // open ended
    ],
    MAX_PRODUCTS_PAGINATION: 1000,
};
