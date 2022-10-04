import { Actor } from 'apify';
import { log, sleep } from 'crawlee';

export interface ParallelPersistedPushDataOptions {
    uploadBatchSize?: number,
    uploadSleepMs?: number,
    outputDatasetIdOrName?: string,
    parallelPushes?: number,
}
/**
 * Useful for pushing a large number of items at once
 * where migration could introduce duplicates and consume extra CUs
 * Only first param is mandatory
 */
export const parallelPersistedPushData = async (items: Record<string, any>[], options: ParallelPersistedPushDataOptions = {}) => {
    const {
        uploadBatchSize = 5000,
        uploadSleepMs = 500,
        outputDatasetIdOrName = '',
        parallelPushes = 1,
    } = options;
    let isMigrating = false;
    Actor.on('migrating', () => { isMigrating = true; });
    Actor.on('aborting', () => { isMigrating = true; });

    const kvRecordName = `STATE-PUSHED-COUNT-${outputDatasetIdOrName}`;
    let pushedItemsCount: number = (await Actor.getValue(kvRecordName)) || 0;
    const dataset = await Actor.openDataset(outputDatasetIdOrName);

    for (let i = pushedItemsCount; i < items.length; i += uploadBatchSize) {
        if (isMigrating) {
            log.info('Forever sleeping until migration');
            // Do nothing
            await new Promise(() => {});
        }
        const itemsToPush = items.slice(i, i + uploadBatchSize);

        const pushPromises: Promise<void>[] = [];
        const parallelizedBatchSize = Math.ceil(itemsToPush.length / parallelPushes);
        for (let j = 0; j < parallelPushes; j++) {
            const start = j * parallelizedBatchSize;
            const end = (j + 1) * parallelizedBatchSize;
            const parallelPushChunk = itemsToPush.slice(start, end);
            pushPromises.push(dataset.pushData(parallelPushChunk));
        }
        // We must update it before awaiting the promises because the push can take time
        // and migration can cut us off but the items will already be on the way to dataset
        pushedItemsCount += itemsToPush.length;
        await Actor.setValue(kvRecordName, pushedItemsCount);
        await Promise.all(pushPromises);
        await sleep(uploadSleepMs);
    }
};