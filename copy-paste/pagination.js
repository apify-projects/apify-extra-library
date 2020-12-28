/**
 * Useful when you need to split price filters
 * to overcome max pages shown for a cateogry
 * This just takes an object with min and max numbers and splits them into halves
 * For full crawler example, check examples/crawler-with-filters
 *
 * @param {{ min: number, max: number }} filter
 */
exports.splitFilter = (filter) => {
    const { min, max } = filter;
    if (min > max) {
        throw new Error(`WRONG FILTER - min(${min}) is greater than max(${max})`);
    }
    const middle = min + Math.floor((max - min) / 2);

    const filterMin = {
        min,
        max: Math.max(middle, min),
    };
    const filterMax = {
        min: Math.min(middle + 1, max),
        max,
    };
    return [filterMin, filterMax];
};
