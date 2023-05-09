const cookieParser = require('cookie-parser');

const WebhookService = require('./services/webhook-service');
const { 
    onshapeApiUrl,
    onshapeExportToExternalSystemFlow,
    onshapeTriggerTranslationsFlow,
    webhookCallbackRootUrl 
} = require('./config');
const { 
    clearDataStore,
    forwardRequestToFlow,
    GOOGLE_DRIVE_EXPORT_DESTINATION,
    ONSHAPE_WORKFLOW_EVENT,
    ONSHAPE_RELEASE_OBJECT_TYPE,
    ONSHAPE_RELEASE_STATE_COMPLETED,
    ONSHAPE_MODEL_TRANSLATION_COMPLETED_EVENT,
    ONSHAPE_MODEL_TRANSLATION_STATE_IN_PROGRESS,
    ONSHAPE_WEBHOOK_PING_EVENT,
    ONSHAPE_WEBHOOK_REGISTRATION_EVENT
} = require('./utils');
const { appSettings, translatedFiles } = require('./raza-client');
    
const apiRouter = require('express').Router();

/**
 * Get the email of the current user (amongst other profile info) from Onshape.
 * 
 * GET /api/users/sessioninfo
 *      -> 200, [ ...email ]
 *      -or-
 *      -> 500, { error: '...' }
 */
apiRouter.get('/email', (req, res) => {
    forwardRequestToFlow({
        httpVerb: "GET",
        requestUrlParameters: "users/sessioninfo",
        res: res
    });
});

/**
 * Register webhook notification of the latest completed release package.
 * 
 * GET /api/notifications?documentId=...&workspaceId=...&companyId=...
 *      -> 200, { ..., id: '...' }
 *      -or-
 *      -> 500, { error: '...' }
 */
apiRouter.get('/notifications', async (req, res) => {
    // Extract the necessary IDs from the querystring
    const cid = req.query.companyId, 
          exportDestination = req.query.exportDestination ? req.query.exportDestination: "",
          emailAddress = req.query.emailAddress ? req.query.emailAddress: "",
          emailMessage = req.query.emailMessage ? req.query.emailMessage: "";

    // TODO[Zain]: pass the vars above to the webhook(s) "data" property, in the Flow(s)
    const webhookParams = {
        companyId: cid,
        webhookCallbackRootUrl: webhookCallbackRootUrl
    };

    // save the query string data - will come in useful later
    // Object.defineProperty(appSettings, "exportDestination", {
    //     value: exportDestination,
    //     writable: true
    // });
    // Object.defineProperty(appSettings, "emailAddress", {
    //     value: emailAddress,
    //     writable: true
    // });
    // Object.defineProperty(appSettings, "emailMessage", {
    //     value: emailMessage,
    //     writable: true
    // });
    // res.cookie("exportDestination", exportDestination);
    // res.cookie("emailAddress", emailAddress);
    // res.cookie("emailMessage", emailMessage);

    WebhookService.registerWebhook(webhookParams, res)
        // provide the client with the webhook ID, so they know it was register
        .then((webhookId) => res.status(200).send({ "webhookId": webhookId }))
        .catch((err) => {
            console.error(`Failed to register webhook: ${err}`);
            res.status(500).json({ error: err });
        }
    );
});

/**
 * Receive a webhook event.
 * 
 * POST /api/event
 *      -> 200
 */
apiRouter.post('/event', async (req, res) => {
    console.log(`I received a webhook notification! Here: ${JSON.stringify(req.body)}`);
    let finalResStatus = 404, finalResBody = {}; // assume no workflow was sent in the notification,
                                                 // and no data will be sent
    const eventJson = req.body;

    // notification handler for the "trial" notification, which Onshape sends at the time of registering a webhook
    if (eventJson.event === ONSHAPE_WEBHOOK_REGISTRATION_EVENT
        || eventJson.event === ONSHAPE_WEBHOOK_PING_EVENT) {
        console.log(`Sending a 200 response for the trial notification!`);
        finalResBody = {'output': `Ready to receive webhook notifications!`};
        finalResStatus = 200;  // this is status that the docs require us to send: https://onshape-public.github.io/docs/webhook/#webhook-registration

    // notification handler for release management related events
    } else if (eventJson.event === ONSHAPE_WORKFLOW_EVENT) {
        finalResBody = {'output': `Found a workflow package: ${eventJson}`};
        finalResStatus = 200;  // a workflow was sent, so this is at least a HTTP 200
        /**
         * Save in memory so we can return to client later (& unregister the webhook).
         * TODO[Zain][4] - use a better memory store - e.g., see these links to do using cookies:
         *      --> https://stackoverflow.com/questions/34674326/node-express-storage-and-retrieval-of-authentication-tokens
         *      --> https://stackoverflow.com/questions/16209145/how-can-i-set-cookie-in-node-js-using-express-framework
         */
        if (eventJson.objectType === ONSHAPE_RELEASE_OBJECT_TYPE) {
            const rpId = eventJson.objectId;

            // use the rpID to get the audit log, get the entries, and see if 
            // any has workflowState === RELEASED
            // check if this release is all done, if so forward to flow
            const releasePackageAuditData = await forwardRequestToFlow({
                httpVerb: "GET",
                requestUrlParameters: `workflow/obj/${rpId}/auditlog`,
            });
            
            const releasePackageAuditLog = await releasePackageAuditData.json();
            const releasePackageLogMessage =  `Found an audit log: ${JSON.stringify(releasePackageAuditLog)}`;
            
            // output handling
            finalResBody = { 'output': releasePackageAuditLog };
            console.log(releasePackageLogMessage);

            // are we ready to export?
            const audits = releasePackageAuditLog.entries.filter(entry => {
                return entry.workflowState === ONSHAPE_RELEASE_STATE_COMPLETED
            });
            const isReadyToStartTranslation = audits.length > 0;
            if (isReadyToStartTranslation) {
                console.log(`Invoking a flow to trigger the translations!`);
                // save the release package metadata for later - will be useful for cloud storage exports
                const releasePackageRes = await forwardRequestToFlow({
                    httpVerb: "GET",
                    requestUrlParameters: `releasepackages/${rpId}?detailed=true`,
                });
                const releasePackageJson = await releasePackageRes.json();
                translatedFiles["exportFolderName"] = `Release-${releasePackageJson.name}-Export`;
                translatedFiles["releasePackageId"] = rpId;

                // now, post all the needed params to the translation trigger Flow
                const triggerFlowParams = {
                    webhookCallbackUrl: `${webhookCallbackRootUrl}/api/event`,
                    releasePackageId: rpId
                };
                console.log(`Found these export options: ${JSON.stringify(triggerFlowParams)}`);
                const translationTriggerFlowResp = await fetch(onshapeTriggerTranslationsFlow, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(triggerFlowParams)
                });
                // parse out the translation Ids - save them, set their status as in-progress
                const flowResJson = await translationTriggerFlowResp.json();
                console.log(`Parsed the following translation IDs from Flow: ${JSON.stringify(flowResJson)}`);
                for (const translationRequestRes of flowResJson.data.translationRequestResults) {
                    translatedFiles[translationRequestRes.id] = ONSHAPE_MODEL_TRANSLATION_STATE_IN_PROGRESS;
                    console.log(`Reached the translation trigger for loop! Resulting data store: ${JSON.stringify(Object.entries(translatedFiles))}`);
                }
                finalResStatus = translationTriggerFlowResp.success === "true" ? 200: 400;
                finalResBody = flowResJson;
                console.log(`Requested all the translation webhooks!`);
            }
        }
    } else if (eventJson.event === ONSHAPE_MODEL_TRANSLATION_COMPLETED_EVENT) {
        console.log(`Invoking a flow to retrieve the completed translation!`);
        // unregister the *translation* webhook - using its ^ID
        WebhookService.unregisterWebhook(eventJson.webhookId);
        // translated data is ready - let's grab it, via the translation ID found in the webhook event
        const reqUrl = `translations/${eventJson.translationId}`;
        const transResp = await forwardRequestToFlow({
            httpVerb: "GET",
            requestUrlParameters: reqUrl,
            // res: res
        });
        // in the data store - update it's value to the webhook ID
        const transJson = await transResp.json();
        console.log(`Found the following translation JSON (tesxt): ${JSON.stringify(transResp)}`);
        console.log(`Found the following translation JSON (json): ${JSON.stringify(transJson)}`);
        if (transJson.requestState === 'FAILED') {
            Object.defineProperty(translatedFiles, eventJson.translationId, {
                value: transJson.failureReason,
                writable: true   //  until we have the webhook id, it's "in-progress"
            });
            console.log(`Your translation failed, sorry. Onshape said: ${transJson.failureReason}`);
        } else {
            const translatedAssetPath = [
                "documents",
                "d",
                `${transJson.documentId}`,
                "externaldata",
                `${transJson.resultExternalDataIds[0]}`, 
            ].join("/");
            Object.defineProperty(translatedFiles, eventJson.translationId, {
                value: translatedAssetPath,
                writable: true
            });
            console.log(`Your translation worked! Find it here: ${translatedAssetPath}`);
        }
        // conditional step - for the final export!
        const numTranslationsIncomplete = Object.values(translatedFiles).filter(status => status === ONSHAPE_MODEL_TRANSLATION_STATE_IN_PROGRESS).length; 
        console.log(`number of 'in-progress' translations remaining: ${numTranslationsIncomplete}`);
        console.log(`current state of 'appSettings': ${JSON.stringify(appSettings)}`);
        if (numTranslationsIncomplete === 0) { 
            finalResStatus = 302;
            const exportFlowConfig = req.cookies;
            // use an async Flow to handle the export to whatever external system
            // TODO[Zain]: debug if the 'translatedFiles' var is actually defined?
            const exportFlowParams = {
                exportDestination: exportFlowConfig["exportDestination"],
                email: exportFlowConfig["emailAddress"],
                emailMessage: exportFlowConfig["emailMessage"],
                translatedFiles: JSON.stringify(translatedFiles)
            };
            try {
                console.log(`Invoking the export Flow! Process will continue async...`);
                fetch(onshapeExportToExternalSystemFlow, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(exportFlowParams)
                });
                // update the final result body
                finalResBody = {'result': 'Flow has been requested to process your export!'};
            } catch(err) {
                finalResBody = {'error': err};
                console.log(`Export Flow invocation error - Flow said: ${err}`);
            }
            // reset the translatedFiles to an empty 
            clearDataStore(translatedFiles);
            console.log(`translatedFiles should be empty: ${JSON.stringify(translatedFiles)}`);
        }     
    }
    console.log(`Webhook notification example: ${JSON.stringify(req.body)}`);
    res.status(finalResStatus).send(finalResBody);
});

module.exports = apiRouter;