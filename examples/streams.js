const Apify = require('apify');
const { load } = require('cheerio');
const htmlparser = require('htmlparser2');
const { Readable, PassThrough, Writable, pipeline } = require('stream');
const { IncomingMessage } = require('http');
const { readStreamToString } = require('apify-shared/streams_utilities');
const { createUnzip } = require('zlib');

const { requestAsBrowser } = Apify.utils;

/**
 * Read stream as a string
 *
 * @param {Readable} stream
 */
const streamToString = (stream, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        readStreamToString(pipeline(
            stream,
            exports.passthroughAbortStream(timeout),
            (err) => {
                if (err) {
                    reject(err);
                }
            },
        )).then(resolve);
    });
};

exports.streamToString = streamToString;

/**
 * A passthrough stream that aborts when nothing is
 * happening for a while, or the stream is too slow
 *
 * @param {number} timeoutMillis
 */
exports.passthroughAbortStream = (timeoutMillis, intervalMillis = 1000) => {
    let lastActivity = Date.now();

    const passthrough = new PassThrough({
        autoDestroy: true,
        emitClose: true,
        transform(chunk, _encoding, callback) {
            lastActivity = Date.now();
            callback(null, chunk);
        },
    });

    const interval = setInterval(() => {
        if (Date.now() - lastActivity >= timeoutMillis) {
            clear();
            passthrough.destroy(new Error(`Aborted slow/stuck stream after ${timeoutMillis}ms`));
        }
    }, intervalMillis);

    const clear = () => clearInterval(interval);

    passthrough
        .once('close', clear)
        .once('end', clear)
        .once('error', clear);

    return passthrough;
};

/**
* Requests as stream, since we need to either use the gzip on the sitemaps
* or pass to the htmlparser2 streaming parser
*
* @throws {Error}
* @param {{ headers?: any, url: string, proxyUrl?: string }} opts
* @return {Promise<Readable>}
*/
const requestStream = async ({ url, headers = {}, proxyUrl, ...rest }) => {
    /**
   * @type {IncomingMessage & Readable}
   */
    const stream = await requestAsBrowser({
        url,
        ignoreSslErrors: true,
        useBrotli: true,
        timeoutSecs: 120,
        abortFunction: () => false,
        proxyUrl,
        stream: true,
        headers,
        ...rest,
    });

    if (!stream) {
        throw new Error('Empty stream');
    }

    if (!stream.statusCode || stream.statusCode >= 400) {
        throw new Error(`Status code ${stream.statusCode}`);
    }

    return stream;
};

exports.requestStream = requestStream;

/**
* @param {(err: Error | null, $?: cheerio.CheerioAPI) => void} cb
* @returns {Writable}
*/
const cheerioStream = (cb) => {
    const domHandler = new htmlparser.DomHandler((err, dom) => {
        if (err) cb(err);
        else cb(null, load(dom));
    });

    return new htmlparser.Parser(domHandler, { decodeEntities: true });
};

exports.cheerioStream = cheerioStream;

/**
* @param {Readable} stream
* @returns {Promise<cheerio.CheerioAPI>}
*/
const cheerioFromStream = (stream, timeout = 5000) => {
    return new Promise((resolve, reject) => {
        pipeline(
            stream,
            exports.passthroughAbortStream(timeout),
            exports.cheerioStream((err, $) => {
                if (err) {
                    reject(err);
                } else {
                    resolve($);
                }
            }),
            (err) => {
                if (err) {
                    reject(err);
                }
            },
        );
    });
};

exports.cheerioFromStream = cheerioFromStream;

/**
 * @param {Readable} stream
 * @return {Promise<cheerio.CheerioAPI>}
 */
const getGzipSitemap = (stream, timeout = 15000) => {
    return new Promise((resolve, reject) => {
        pipeline(
            stream,
            exports.passthroughAbortStream(timeout),
            createUnzip(),
            exports.cheerioStream((err, $) => {
                if (err) {
                    reject(err);
                } else {
                    resolve($);
                }
            }),
            (err) => {
                if (err) {
                    reject(err);
                }
            },
        );
    });
};

exports.getGzipSitemap = getGzipSitemap;
