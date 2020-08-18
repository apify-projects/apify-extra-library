// Some random tests
const Apify = require('apify');

const { bufferDataset } = require('./copy-paste/storage');

Apify.main(async () => {
    const dataset = await Apify.openDataset();
    const buffered = bufferDataset(dataset, { verboseLog: true });
    await buffered.pushData({ test: 'hello' });
    console.log(buffered.bufferSize());
    await buffered.pushData({ test: 'hello' });
    console.log(buffered.bufferSize());
    await buffered.flush();
    console.log(buffered.bufferSize());
    for (let i = 0; i < 1200; i++) {
        await buffered.pushData({ test: i });
    }
    console.log(buffered.bufferSize());
    await buffered.flush();
    console.log(buffered.bufferSize());
})
