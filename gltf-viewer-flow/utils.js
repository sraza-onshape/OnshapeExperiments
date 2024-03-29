const fetch = require('node-fetch');
const { onshapeAPIRequestProxyInFlow } = require('./config');

module.exports = {

    /**
     * Send a request to the Onshape API, and proxy the response back to the caller.
     * The proxy will be found in `config.onshapeAPIRequestProxyInFlow` variable.
     * 
     * @param {Object} onshapeRequestData An object literal to parametrize the request to Onshape via Flow.
     *      @param {string} httpVerb Expected to be either: "GET", "POST", or "DELETE". See the Onshape docs for which is appropiate for your endpoint of interest: https://cad.onshape.com/glassworks/explorer.
     *      @param {Array<string>} requestUrlParameters A list of strings you wish to be joined (using slashes) to form the path of the request URL.
     *      @param {Object} body a JSON object literal of any additional parameters to send in the request
     *      @param {Response} res The response being proxied.
     */
    forwardRequestToFlow: async (onshapeRequestData) => {
        try {
            // API request
            const flowRequestBody = JSON.stringify({
                "httpVerb": onshapeRequestData.httpVerb,
                "requestUrlParameters": onshapeRequestData.requestUrlParameters,
                "onshapeRequestBody": onshapeRequestData.body ? onshapeRequestData.body : {}
            });
            const resp = await fetch(onshapeAPIRequestProxyInFlow, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: flowRequestBody
            });
            if (!onshapeRequestData.res) {
                return resp;  // let the caller resolve the Promise
            }
            const data = await resp.text();
            const contentType = resp.headers.get('Content-Type');
            console.log(`Content type: ${contentType}`);
            console.log(`Request body passed: ${flowRequestBody}`);
            console.log(`Data returned: ${data}`)
            onshapeRequestData.res.status(resp.status).contentType(contentType).send(data);
        } catch (err) {
            onshapeRequestData.res.status(500).json({ error: err });
        }
    }
}
