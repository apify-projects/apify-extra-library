const Apify = require('apify');
const express = require('express');
const cors = require('cors');

const { log } = Apify.utils;

Apify.main(async () => {
    const { containerPort, containerUrl } = Apify.getEnv();

    const app = express();
    app.use(express.json());
    app.use(cors());

    app.listen(Apify.isAtHome() && containerPort ? containerPort : 8000, () => {
        log.info(`Listening on ${containerUrl || 'http://localhost:8000'}`);
    });

    app.use((req, res) => {
        // log those for security purposes
        log.warning('Request to non-endpoint', {
            url: req.url,
            ip: req.ip,
            method: req.method,
            qs: req.query,
            body: req.body,
        });

        res.status(410).end();
    });

    await new Promise(() => {});
});
