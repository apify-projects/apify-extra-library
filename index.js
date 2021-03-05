/* eslint-disable global-require */

// re-export all libraries
module.exports = {
    browser: require('./src/browser'),
    errorHandling: require('./src/error-handling'),
    pagination: require('./src/pagination'),
    parsing: require('./src/parsing'),
    statePersistance: require('./src/state-persistence'),
    storage: require('./src/storage'),
    time: require('./src/time'),
    validation: require('./src/validation'),
};
