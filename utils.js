const fetch = require('node-fetch');
const { onshapeApiUrl } = require('./config');
const config = require("./config");

module.exports = {

    /**
     * Send a request to the Onshape API, and proxy the response back to the caller.
     * 
     * @param {string} apiPath The API path to be called. This can be absolute or a path fragment.
     * @param {Request} req The request being proxied.
     * @param {Response} res The response being proxied.
     */
    forwardRequestToOnshape: async (apiPath, req, res) => {
        try {
            // API request authorization
            const normalizedUrl = apiPath.indexOf(onshapeApiUrl) === 0 ? apiPath : `${onshapeApiUrl}/${apiPath}`;
            const encodedString = Buffer.from(`${config.accessKey}:${config.secretKey}`).toString('base64');
            const resp = await fetch(normalizedUrl, { headers: { 
                Authorization: `Basic ${encodedString}`,
            }});
            const data = await resp.text();
            const contentType = resp.headers.get('Content-Type');
            res.status(resp.status).contentType(contentType).send(data);
        } catch (err) {
            res.status(500).json({ error: err });
        }
    }
}
