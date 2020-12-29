// @ts-nocheck
const Apify = require('apify');

/**
 * Utility class that allows you to wrap your functions
 * with a try/catch that saves a screenshot on the first occurence
 * of that error
 */
class ErrorManager {
    constructor() {
        this.errorState = {};
        this.BASE_MESSAGE = 'Operation failed: ';
        this.SNAPSHOT_PREFIX = 'ERROR-SNAPSHOT-';
    }

    /**
     * Loads from state and initializes events
     */
    async initialize() {
        this.errorState = (await Apify.getValue('ERROR-MANAGER-STATE')) || {};
        Apify.events.on('persistState', this.persistState.bind(this));
    }

    async persistState() {
        await Apify.setValue('ERROR-MANAGER-STATE', this.errorState);
    }

    /**
     * Provide a page or HTML used to snapshot and a closure to be called
     * Optionally, you can name the action for nicer logging, otherwise name of the error is used
     * These functions can be nested, in that case only one snapshot is produced (for the bottom error)
     * @param {any} pageOrHtml
     * @param {() => void} fn
     * @param {object} options
     * @param {string} options.name Optional name of the action
     * @param {boolean} options.returnError Returns an Error instance instead of re-throwing it
     */
    async tryWithSnapshot(pageOrHtml, fn, options = {}) {
        if (typeof pageOrHtml !== 'string' && typeof pageOrHtml !== 'object') {
            throw new Error('Try with snapshot: Wrong input! pageOrHtml must be Puppeteer page or HTML');
        }
        const { name, returnError } = options;
        try {
            fn();
        } catch (e) {
            // If error starts with BASE_MESSAGE, it means it was another nested tryWithScreenshot
            // In that case we just re-throw and skip all state updates and screenshots
            if (e.message.startsWith(this.BASE_MESSAGE)) {
                throw e;
            }
            // Normalize error name
            const errorKey = (name || e.message).slice(0, 30).replace(/[^a-zA-Z0-9-_]/g, '-');

            if (!this.errorState[errorKey]) {
                this.errorState[errorKey] = 0;
            }
            this.errorState[errorKey]++;

            // We check the errorState because we save the screenshots only the first time for each error
            if (this.errorState[errorKey] === 1) {
                await this.saveSnapshot(pageOrHtml, errorKey);
            }
            e.message = `${this.BASE_MESSAGE}${`: ${name}` || ''}. Error detail: ${e}`;
            if (returnError) {
                return e;
            }
            throw e;
        }
    }

    /**
     * Works for both HTML and Puppeteer Page
     * @param {*} pageOrHtml
     * @param {string} errorKey
     */
    async saveSnapshot(pageOrHtml, errorKey) {
        if (typeof pageOrHtml === 'string') {
            await Apify.setValue(`${this.SNAPSHOT_PREFIX}${errorKey}`, pageOrHtml, { contentType: 'text/html' });
        } else {
            await Apify.utils.puppeteer.saveSnapshot(pageOrHtml, { key: `${this.SNAPSHOT_PREFIX}${errorKey}` });
        }
    }
}

module.exports = ErrorManager;
