const Apify = require('apify');
const { load } = require('cheerio');

const { requestAsBrowser, log } = Apify.utils;

const numberAsCommaString = (num) => {
    let str = '';
    let currLen = 0;
    const numStr = `${num}`;
    for (let i = numStr.length - 1; i >= 0; i--) {
        let char = numStr[i];
        if (currLen === 3) {
            char = `${char},`;
            currLen = 0;
        }
        str = `${char}${str}`;
        currLen++;
    }
    return str;
};

/**
 * Extracts a float from common price string. Removes commas, currency symbols and others.
 *
 * @param {string} priceString
 */
const parsePrice = (priceString) => Number(priceString.replace(/[^0-9.]/g, ''));

/**
 * Safe(r) encodeURI, tries to not double encode the url
 *
 * @param {string} url
 */
const encodeUrl = (url) => (/%[0-9a-f]{2}/i.test(url) ? url : encodeURI(url));

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
const subString = (html, start, end, endOffset = 0, startOffset = 0) => {
    const startIndex = html.indexOf(start);
    if (startIndex === -1) {
        throw new Error('"start" not found');
    }
    html = html.slice(startIndex);
    const endIndex = html.indexOf(end);
    if (endIndex === -1) {
        throw new Error('"end" not found');
    }
    return html.slice(start.length + startOffset, endIndex + end.length + endOffset);
};

/**
 * Uses a BasicCrawler to get links from sitemaps XMLs
 *
 * @example
 *   const proxyConfiguration = await Apify.createProxyConfiguration();
 *   const requestList = await requestListFromSitemaps({
 *
 *      sitemapUrls: [
 *         'https://example.com/sitemap.xml',
 *      ]
 *   })
 *
 * @param {{
 *  proxyConfiguration: Apify.ProxyConfiguration,
 *  sitemapUrls: string[],
 *  timeout?: number,
 *  maxConcurrency?: number
 * }} params
 */
const requestListFromSitemaps = async ({ proxyConfiguration, timeout = 600, sitemapUrls, maxConcurrency = 1 }) => {
    const urls = new Set();

    const sitemapCrawler = new Apify.BasicCrawler({
        requestList: await Apify.openRequestList('SITEMAPS', sitemapUrls),
        useSessionPool: true,
        maxConcurrency,
        handleRequestTimeoutSecs: timeout,
        sessionPoolOptions: {
            persistStateKey: 'SITEMAPS_SESSION_POOL',
        },
        maxRequestRetries: 10,
        handleRequestFunction: async ({ request, session }) => {
            const response = await requestAsBrowser({
                url: request.url,
                useInsecureHttpParser: true,
                ignoreSslErrors: true,
                proxyUrl: proxyConfiguration?.newUrl(session.id),
            });

            log.debug(`Parsing sitemap ${request.url}`);

            const $ = load(response.body, { decodeEntities: true });

            $('url loc').each((_, el) => {
                urls.add($(el).text().replace(/[\n\r]/g, '').trim());
            });
        },
    });

    await sitemapCrawler.run();

    log.info(`Found ${urls.size} URLs from ${sitemapUrls.length} sitemap URLs`);

    return Apify.openRequestList('STARTURLS', [...urls.values()]);
};

const ast = require('abstract-syntax-tree');

/**
 * @param {string} scriptText
 * @param {string} propertyKeyToFind
 * @returns {object}
 */
const findObjectInScriptByPropertyKey = (scriptText, propertyKeyToFind) => {
    const parsed = ast.parse(scriptText);
    const objects = ast.find(parsed, 'ObjectExpression');
    const foundObject = objects.find((object) => object.properties.some((property) => {
        return property.key.value === propertyKeyToFind;
    }));
    const myJson = ast.generate(foundObject);
    return JSON.parse(myJson);
};

/**
 * Given JQuery/Cheerio handle, it finds an object in scripts in the HTML
 * The object is found by searching for a property of the object or nested ones
 * The property should be unique in the objects, otherwise it might not find the correct one
 * @param {cheerio.Root} $
 * @param {string} propertyToFind
 * @returns {object}
 */
module.exports.findObjectInHtml = ($, propertyToFind) => {
    const scripts = $(`script:contains(${propertyToFind})`);
    if (scripts.length === 0) {
        throw `Did not find any script with property: ${propertyToFind}`;
    }
    const scriptText = scripts.html();
    try {
        return findObjectInScriptByPropertyKey(scriptText, propertyToFind);
    } catch (e) {
        throw `Could not parse property: ${propertyToFind} from the script. Probably wrong HTML`;
    }
}

module.exports = {
    subString,
    encodeUrl,
    parsePrice,
    requestListFromSitemaps,
    numberAsCommaString,
};
