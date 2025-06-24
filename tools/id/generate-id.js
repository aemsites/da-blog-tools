import DA_SDK from "https://da.live/nx/utils/sdk.js";
const AEM_PREVIEW_REQUEST_URL = 'https://admin.hlx.page/preview';

async function init() {
    const { context, token, actions } = await DA_SDK;
    
    // Create UI elements
    const container = document.createElement("div");
    container.style.padding = "20px";
    
    const generateButton = document.createElement("sl-button");
    generateButton.innerHTML = "Generate Ghost ID";
    generateButton.addEventListener("click", async () => {
        try {
            console.log(context);
            // Generate and send the Ghost ID
            const ghostId = generateGhostId();

            const mdTable = document.createElement("table");
            mdTable.innerHTML = `
                <colgroup>
                    <col>
                    <col>
                </colgroup>
                <tbody>
                    <tr>
                        <td colspan="2">
                            <p>metadata</p>
                        </td>
                    </tr>  
                    <tr>
                        <td>awa-asst</td>
                        <td>${ghostId}</td>
                    </tr>
                </tbody>
            `;
            actions.sendHTML(mdTable.outerHTML);
            actions.closeLibrary();
        } catch (error) {
            console.error("Error:", error);
            actions.sendText("Error occurred while generating Ghost ID");
        }
    });
    
    const contextButton = document.createElement("sl-button");
    contextButton.innerHTML = "Show Context Info";
    contextButton.style.marginTop = "10px";
    contextButton.addEventListener("click", () => {
        const contextInfo = JSON.stringify(context, null, 2);
        actions.sendText(`Context keys: ${Object.keys(context).join(', ')}`);
    });
    
    const pathButton = document.createElement("sl-button");
    pathButton.innerHTML = "Send Document Path";
    pathButton.style.marginTop = "10px";
    pathButton.addEventListener("click", () => {
        const pathInfo = `Document: ${context.path} | Org: ${context.org} | Repo: ${context.repo}`;
        actions.sendText(pathInfo);
    });
    
    container.appendChild(generateButton);
    // container.appendChild(contextButton);
    // container.appendChild(pathButton);
    document.body.replaceChildren(container);
}

function generateGhostId() {
    // Generate a random 6-digit number
    const random = Math.floor(Math.random() * 900000) + 100000; // 100000 to 999999
    return random.toString();
}

init();