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

/**
 * Extract a substring from HTML (usually script tags / JSON-LD).Throws when not found.
 * A better version of substr/substring
 *
 * @param {string} html Plain HTML
 * @param {string} start Start of variable/data. eg: 'var something = '. Excludes the provided "start" string
 * @param {string} end End of the data. eg: '};'. Includes the provided "end" string
 * @param {number} [endOffset=0] Apply an offset to the end
 * @param {number} [startOffset=0] Apply an offset to the start
 */
exports.subString = (html, start, end, endOffset = 0, startOffset = 0) => {
  let startIndex = html.indexOf(start);
  if (startIndex === -1) {
    throw new Error('"start" not found');
  }
  html = html.slice(startIndex);
  let endIndex = html.indexOf(end);
  if (endIndex === -1) {
    throw new Error('"end" not found');
  }
  return html.slice(start.length + startOffset, endIndex + end.length + endOffset);
}