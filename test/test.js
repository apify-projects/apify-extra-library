const assert = require('assert');

const { calculateLocalOffsetLimit } = require('../src/storage');

describe('calculateLocalOffsetLimit', () => {
    it('calculates correct local limit and offset', () => {
        let result = calculateLocalOffsetLimit({
            offset: 0,
            limit: 100,
            localStart: 50,
            batchSize: 50,
        });
        let expected = { offset: 50, limit: 50 };
        assert.deepStrictEqual(result, expected);

        result = calculateLocalOffsetLimit({
            offset: 60,
            limit: 10,
            localStart: 50,
            batchSize: 50,
        });
        expected = { offset: 60, limit: 10 };
        assert.deepStrictEqual(result, expected);

        // Next two are continuoes batches
        result = calculateLocalOffsetLimit({
            offset: 140,
            limit: 30,
            localStart: 100,
            batchSize: 50,
        });
        expected = { offset: 140, limit: 10 };
        assert.deepStrictEqual(result, expected);

        result = calculateLocalOffsetLimit({
            offset: 140,
            limit: 30,
            localStart: 150,
            batchSize: 50,
        });
        expected = { offset: 150, limit: 20 };
        assert.deepStrictEqual(result, expected);

        // Off the batch
        result = calculateLocalOffsetLimit({
            offset: 220,
            limit: 30,
            localStart: 150,
            batchSize: 50,
        });
        expected = null;
        assert.deepStrictEqual(result, expected);
    });
});
