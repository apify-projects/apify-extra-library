// Let's create a helper function for creating the filter URLs, you can move those to utils.js file
module.exports.createFilterUrl = ({ min, max }) => {
    const minString = `min_price=${min}`;
    // We don't want to pass the parameter at all if it is null (open ended)
    const maxString = max ? `&max_price=${max}` : '';
    return `https://www.mysite.com/products?${minString}${maxString}`;
};

// And another helper for getting filters back from the URL, we could also pass them in userData
module.exports.getFiltersFromUrl = (url) => {
    const min = Number(url.match(/min_price=([0-9.]+)/)[1]);
    // max price might be empty
    const maxMatch = url.match(/max_price=([0-9.]+)/);
    const max = maxMatch ? Number(maxMatch[1]) : null;
    return { min, max };
};

module.exports.splitFilter = (filter) => {
    const { min, max } = filter;
    // Don't forget that max can be null and we have to handle that situation
    if (max && min > max) {
        throw new Error(`WRONG FILTER - min(${min}) is greater than max(${max})`);
    }

    // We crate a middle value for the split. If max in null, we will use double min as the middle value
    const middle = max
        ? min + Math.floor((max - min) / 2)
        : min * 2;

    // We have to do the Math.max and Math.min to prevent having min > max
    const filterMin = {
        min,
        max: Math.max(middle, min),
    };
    const filterMax = {
        min: max ? Math.min(middle + 1, max) : middle + 1,
        max,
    };
    // We return 2 new filters
    return [filterMin, filterMax];
};
