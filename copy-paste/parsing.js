// Extract a float from common price string
exports.parsePrice = (priceString) => Number(priceString.replace(/[^0-9.]/g, ''));

/**
 * 50000 -> 500.00 | null
 *
 * @param {string|number} value
 * @returns {(number|null)}
 */
exports.parseCents = (value) => {
  value = parseFloat(value / 100);
  return value ? +(value.toFixed(2)) : null;
};

/**
 * Safe(r) encodeURI, tries to not double encode the url
 *
 * @param {string} url
 */
exports.encodeUrl = (url) => /%[0-9a-f]{2}/i.test(url) ? url : encodeURI(url);
