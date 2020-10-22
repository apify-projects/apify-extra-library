# Apify utilities

Why another repo when we already have great [SDK](https://sdk.apify.com/) and many examples? This repo contains either
- New features that may or may not land in the SDK once tested by time
- Simple functions for specific use-cases that are too specific for the SDK (like price parsing)

## Structure
This repo is split into two folders.
- `copy-paste` are functions that you can directly copy into your `utils.js` file and use them.
- `examples` more complex use-cases that have more moving parts, like parsing sitemaps as streams, having a long-running express server inside Apify platform

## Some tricks we provide
- **Parallel load of dataset items** (even from multiple datasets) - insanely fast :)
- **Dataset that buffers the items on pushData** - Saves overloading Apify dataset API
- **Rate limited Request Queue** - Adding requests smartly slows itself on high loads instead of overloading Apify API
- **Price filter splitting** - Common functionality for sites that limit number of results
- **Parsing and time functions**

## How to use
This repo is not intended as a package. The code here will be updated and restructured as we please.

If you have any code samples that you would like to contribute, you are welcome to make a PR :)
