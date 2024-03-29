const { forwardRequestToFlow } = require('../utils');
const { onshapeApiUrl } = require('../config');

/**
 * The default body contents for translation requests. Request-specific
 * information is appended to a copy of this and submitted as the body
 * for that particular request.
 */
const defaultBody = Object.freeze({
    includeExportIds: false,
    formatName: "GLTF",
    flattenAssemblies: false,
    yAxisIsUp: false,
    triggerAutoDownload: false,
    storeInDocument: false,
    connectionId: '',
    versionString: '',
    grouping: true,
    destinationName: '',
    configuration: 'default',
    cloudStorageAccountId: null,
    emailLink: false,
    emailTo: null,
    emailSubject: null,
    emailMessage: null,
    sendCopyToMe: null,
    passwordRequired: null,
    password: null,
    validForDays: null,
    fromUserId: null
});

/**
 * Trigger the translation of the given element or part to GLTF.
 * @param {string} url The URL to be requested.
 * @param {object} jsonBodyToAdd The parameters to be added to the default parameters to pass to the translation engine.
 *      @param {string} jsonBodyToAdd.workspaceId The ID of the current workspace.
 *      @param {string} jsonBodyToAdd.gltfElementId The ID of the element/part to be translated.
 *      @param {string} jsonBodyToAdd.partId The ID of the part to be translated.
 *      @param {string} jsonBodyToAdd.resolution The resolution of the translation.
 *      @param {string} jsonBodyToAdd.distanceTolerance The distance tolerance of the translation.
 *      @param {string} jsonBodyToAdd.angularTolerance The angular tolerance of the translation.
 *      @param {string} jsonBodyToAdd.maximumChordLength The max chord length of the translation.
 * @param {Response} res The response being proxied.
 * 
 * @returns {Promise<object,string>} Resolves with an object with properties `contentType` (string)
 *      and `data` (string), containing the Content-Type and response body of the translation trigger,
 *      or rejects with a string error message.
 */
const startTranslation = async (url, jsonBodyToAdd, res) => {
    const body = Object.assign(Object.assign({}, defaultBody), jsonBodyToAdd);
    try {
        const resp = await forwardRequestToFlow({
            httpVerb: "POST",
            requestUrlParameters: url,
            body: body,
        });
        console.log("just finished triggering the translation!")
        const text = await resp.text();
        console.log(`Received text: ${JSON.stringify(text)}`);
        if (resp.ok) {
            return { contentType: resp.headers.get('Content-Type'), data: text };
        }
    } catch (err) {
        console.log(`Error in Onshape API call (for translations): ${err}`);
    }
};

module.exports = {
    
    /**
     * Trigger the translation of the given element to GLTF.
     * @param {string} elementId The ID of the element to be translated.
     * @param {object} translationParams The parameters to pass to the translation engine.
     *      @param {string} translationParams.workspaceId The ID of the current workspace.
     *      @param {string} translationParams.resolution The resolution of the translation.
     *      @param {string} translationParams.distanceTolerance The distance tolerance of the translation.
     *      @param {string} translationParams.angularTolerance The angular tolerance of the translation.
     *      @param {string} translationParams.maximumChordLength The max chord length of the translation.
     * @param {Response} res The response being proxied.
     * 
     * @returns {Promise<object,object>} Resolves or rejects with an object with properties `contentType` (string)
     *      and `data` (string), containing the Content-Type and response body of the translation trigger
     */
    translateElement: async (elementId, translationParams, res) => {
        const transUrl = `assemblies/d/${translationParams.documentId}/w/${translationParams.workspaceId}/e/${elementId}/translations`;
        const bodyAdditions = {
            linkDocumentWorkspaceId: translationParams.workspaceId,
            elementId: elementId,
            resolution: translationParams.resolution,
            distanceTolerance: translationParams.distanceTolerance,
            angularTolerance: translationParams.angularTolerance,
            maximumChordLength: translationParams.maximumChordLength
        }
        return await startTranslation(transUrl, bodyAdditions, res);
    },
    
    /**
     * Trigger the translation of the given part to GLTF.
     * @param {string} elementId The ID of the element.
     * @param {string} partId The ID of the part to be translated.
     * @param {object} translationParams The parameters to pass to the translation engine.
     *      @param {string} translationParams.workspaceId The ID of the current workspace.
     *      @param {string} translationParams.resolution The resolution of the translation.
     *      @param {string} translationParams.distanceTolerance The distance tolerance of the translation.
     *      @param {string} translationParams.angularTolerance The angular tolerance of the translation.
     *      @param {string} translationParams.maximumChordLength The max chord length of the translation.
     * @param {Response} res The response being proxied.
     * 
     * @returns {Promise<object,object>} Resolves or rejects with an object with properties `contentType` (string)
     *      and `data` (string), containing the Content-Type and response body of the translation trigger
     */
    translatePart: async (elementId, partId, translationParams, res) => {
        const transUrl = `partstudios/d/${translationParams.documentId}/w/${translationParams.workspaceId}/e/${elementId}/translations`
        const bodyAdditions = {
            linkDocumentWorkspaceId: translationParams.workspaceId,
            partIds: partId,
            resolution: translationParams.resolution,
            distanceTolerance: translationParams.distanceTolerance,
            angularTolerance: translationParams.angularTolerance,
            maximumChordLength: translationParams.maximumChordLength
        };
        return await startTranslation(transUrl, bodyAdditions, res);
    }
}
