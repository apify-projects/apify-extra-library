exports.waiter = async (predicate, { timeout, delay }) => {
    const start = Date.now();
    while (true) {
        if (predicate()) {
            return;
        }
        const waitingFor = Date.now() - start;
        if (waitingFor > timeout) {
            throw new Error(`Timeout reached when waiting for predicate for ${waitingFor} ms`);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
    }
};
