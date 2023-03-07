// TODO: Check if this even works, I just copy-pasted it with some simplications

// Using Apify proxy is not needed so feel free to remove the dependency
import { Actor, log } from 'apify';
import { PuppeteerCrawler, Session } from 'crawlee';
import ProxyChain from 'proxy-chain';

/**
 * @param port
 * @param calculateStats
 * @param verbose
 * @param primaryProxyGroups
 * @param otherProxyGroups
 * @param primaryHosts
 * @return {Promise<server>}
 */
const createFilterProxy = async ({
    port = 8000,
    calculateStats = true,
    verbose = false,
    primaryProxyGroups = ['RESIDENTIAL'],
    otherProxyGroups = undefined,
    primaryHosts = [],
}) => {
    // Create as many proxy configurations as you need.
    const proxyConfigurationResidential = await Actor.createProxyConfiguration({
        groups: primaryProxyGroups,
        countryCode: 'US',
    });
    const proxyConfigurationDatacenter = await Actor.createProxyConfiguration({
        groups: otherProxyGroups,
    });

    const server = new ProxyChain.Server({
        port,
        verbose,
        prepareRequestFunction: ({ username, hostname }) => {
            let proxyUrl;
            const session = username.replace('session-', '');

            // Have arbitrary logic to decide which proxy to use
            if (primaryHosts.find((host) => RegExp(host, 'i').test(hostname))) {
                proxyUrl = proxyConfigurationResidential.newUrl(session);
            } else {
                proxyUrl = proxyConfigurationDatacenter.newUrl(session);
            }

            // Return a proxy URL of the chosen (Apify) proxy
            return {
                upstreamProxyUrl: proxyUrl,
            };
        },
    });

    if (calculateStats) {
        server.on('connectionClosed', ({ connectionId, stats }) => {
            connectionsStats[connectionId] = stats;
        });

        server.persistTrafficStatistics = async () => {
            // store arbitrary stats
        };
    }

    return new Promise((resolve) => {
        server.listen(() => {
            log.info(`Proxy server is listening on port ${server.port}`);
            resolve(server);
        });
    });
};

const proxyServer = await createFilterProxy();

// Create a proxy configuration that uses the local proxy server
const proxyConfiguration = await Actor.createProxyConfiguration({
    newUrlFunction: (sessionId) => `http://session-${sessionId}:@localhost:${proxyServer.port}`,
});

const crawler = new PuppeteerCrawler({
    // ... other options
    proxyConfiguration,
    sessionPoolOptions: {
        createSessionFunction: async ({ sessionOptions }) => {
            // Create session ID dynamically if needed
            return new Session(sessionOptions);
        }
    }
});

await crawler.run();
