/* eslint-disable global-require */

// re-export all libraries
module.exports = {
    browser: require('./src-js/browser'),
    errorHandling: require('./src-js/error-handling'),
    pagination: require('./src-js/pagination'),
    parsing: require('./src-js/parsing'),
    statePersistance: require('./src-js/state-persistence'),
    storage: require('./src-js/storage'),
    time: require('./src-js/time'),
    validation: require('./src-js/validation'),
};
