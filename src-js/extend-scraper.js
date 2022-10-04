const Apify = require('apify');
const vm = require('vm');

/**
 * @template T
 * @typedef {T & { Apify: Apify, customData: any, request: Apify.Request }} PARAMS
 */

/**
 * Compile a IO function for mapping, filtering and outputing items.
 * Can be used as a no-op for interaction-only (void) functions on `output`.
 * Data can be mapped and filtered twice.
 *
 * Provided base map and filter functions is for preparing the object for the
 * actual extend function, it will receive both objects, `data` as the "raw" one
 * and "item" as the processed one.
 *
 * Always return a passthrough function if no outputFunction provided on the
 * selected key.
 *
 * @example
 *   const input = await Apify.getInput();
 *
 *   const extendOutputFunction = await extendFunction({
 *      key: 'extendOutputFunction',
 *      input,
 *      map: async (data, { page, request }) => {
 *         if (input.output === 'CSV') {
 *            return data.items.map((item) => { // flatten result, return an array here
 *               const { attached } = data;
 *               return {
 *                  ...attached,
 *                  ...item,
 *               };
 *            })
 *         }
 *
 *         return data; // return the nested data as-is
 *      },
 *      filter: async (item, { page, request }) => {
 *         return item.mode === input.mode; // for example, only output items that contains the input mode
 *      },
 *      output: async (item, { page, request }) => {
 *         await Apify.pushData(item);
 *      }
 *   });
 *
 *   const payload = {
 *      attached: {
 *         prop: true,
 *         id: '39429835'
 *      },
 *      items: [{
 *         type: 'list',
 *         data: {
 *            // data
 *         }
 *      }]
 *   };
 *
 *   await extendOutputFunction(payload, {
 *     request,
 *     page,
 *   });
 *
 * @template RAW
 * @template {{ [key: string]: any }} INPUT
 * @template MAPPED
 * @template {{ [key: string]: any }} HELPERS
 * @param {{
 *  key: string,
 *  map?: (data: RAW, params: PARAMS<HELPERS>) => Promise<MAPPED>,
 *  output?: (data: MAPPED, params: PARAMS<HELPERS> & { data: RAW, item: MAPPED }) => Promise<void>,
 *  filter?: (obj: { data: RAW, item: MAPPED }, params: PARAMS<HELPERS>) => Promise<boolean>,
 *  input: INPUT,
 *  helpers: HELPERS,
 * }} params
 * @return {Promise<(data: RAW, args?: Record<string, any>) => Promise<void>>}
 */
const extendFunction = async ({
    key,
    output,
    filter,
    map,
    input,
    helpers,
}) => {
    /**
     * @type {PARAMS<HELPERS>}
     */
    const base = {
        ...helpers,
        Apify,
        customData: input.customData || {},
    };

    const evaledFn = (() => {
        // need to keep the same signature for no-op
        if (typeof input[key] !== 'string' || input[key].trim() === '') {
            return new vm.Script('({ item }) => item');
        }

        try {
            return new vm.Script(input[key], {
                lineOffset: 0,
                produceCachedData: false,
                displayErrors: true,
                filename: `${key}.js`,
            });
        } catch (e) {
            throw new Error(`"${key}" parameter must be a function`);
        }
    })();

    /**
     * Returning arrays from wrapper function split them accordingly.
     * Normalize to an array output, even for 1 item.
     *
     * @param {any} value
     * @param {any} [args]
     */
    const splitMap = async (value, args) => {
        const mapped = map ? await map(value, args) : value;

        if (!Array.isArray(mapped)) {
            return [mapped];
        }

        return mapped;
    };

    return async (data, args) => {
        const merged = { ...base, ...args };

        for (const item of await splitMap(data, merged)) {
            if (filter && !(await filter({ data, item }, merged))) {
                continue; // eslint-disable-line no-continue
            }

            const result = await (evaledFn.runInThisContext()({
                ...merged,
                data,
                item,
            }));

            for (const out of (Array.isArray(result) ? result : [result])) {
                if (output) {
                    if (out !== null) {
                        await output(out, { ...merged, data, item });
                    }
                    // skip output
                }
            }
        }
    };
};

module.exports = {
    extendFunction,
};
