# Apify utilities

Why another repo when we already have great [SDK](https://sdk.apify.com/) and many examples? This repo contains either
- New features that may or may not land in the SDK once tested by time
- Simple functions for specific use-cases that are too specific for the SDK (like price parsing)

## How to use

Add this repository to your package.json:

```jsonc
{
    "dependencies": {
        // ...
        "apify-utils": "https://github.com/metalwarrior665/apify-utils.git#1.0.0"
    }
}
```

then access your desired module:

```js
const { storage, browser } = require('apify-utils');

await storage.bufferDataset(await Apify.openDataset());
console.log(browser.userAgent());
```

<!-- REWRITE THIS -->
## Some tricks we provide
- **Error Snaphotter** - Automatically makes snapshots (screenshots + HTML) of unique errors and report how mnay times different errors occured. Very useful!
- **Parallel load of dataset items** (even from multiple datasets) - insanely fast :)
- **Auto-chunked Key Value Store records**
- **Dataset that buffers the items on pushData** - Saves overloading Apify dataset API
- **Rate limited Request Queue** - Adding requests smartly slows itself on high loads instead of overloading Apify API
- **Price filter splitting** - Common functionality for sites that limit number of results
- **Parsing and time functions**

## Versioning

This library don't follow semver, and new versions will follow Apify SDK versions.

* For code compatible with SDK 0.21.11 and below, use the `0.21.11` tag
* For code compatible with SDK 0.22.0 and 1.0.0+, use `1.0.0` tag

## License

Apache 2.0
