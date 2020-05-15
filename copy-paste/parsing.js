// Extract a float from common price string
exports.parsePrice = (priceString) => Number(priceString.replace(/[^0-9.]/g, ''));
