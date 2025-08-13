export default async function testMetadata(pageSource) {
    // Simulate testing for metadata
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate async work
    
    // Execute the actual test logic
    return runTest(pageSource);
}

function runTest(pageSource) {
    // Parse the page source
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    // Check for metadata div presence
    const metadataDiv = doc.querySelector('div.metadata');
    const hasMetadataDiv = !!metadataDiv;
    
    // Check for title key-value pair in metadata
    let hasTitleKey = false;
    let titleValue = '';
    let titleKeyPresent = false;
    
    if (hasMetadataDiv) {
        // Parse the HTML structure: <div><div><p>key</p></div><div><p>value</p></div></div>
        const metadataDivs = metadataDiv.children; // Get direct children (the outer divs)
        
        // Process each outer div (each contains a key-value pair)
        for (let i = 0; i < metadataDivs.length; i++) {
            const outerDiv = metadataDivs[i];
            
            // Each outer div should contain exactly 2 inner divs (key and value)
            const innerDivs = outerDiv.children;
            if (innerDivs.length === 2) {
                const keyDiv = innerDivs[0];
                const valueDiv = innerDivs[1];
                
                const key = keyDiv.textContent.trim();
                const value = valueDiv.textContent.trim();
                
                // Check if this is the title row
                if (key.toLowerCase() === 'title') {
                    hasTitleKey = true;
                    titleValue = value;
                    titleKeyPresent = true;
                    break;
                }
            }
        }
    }
    
    // Create sub-tests
    const subTests = [
        {
            name: 'Metadata Div Presence',
            status: hasMetadataDiv ? 'pass' : 'fail',
            message: hasMetadataDiv ? 'Metadata div is present' : 'Metadata div is missing',
            location: hasMetadataDiv ? 'Page structure' : 'Page structure',
            remediation: hasMetadataDiv ? 'No action needed' : 'Add metadata div to page'
        },
        {
            name: 'Title Key Present',
            status: hasTitleKey ? 'pass' : 'fail',
            message: hasTitleKey ? 'Title key is present in metadata' : 'Title key is missing from metadata',
            location: hasTitleKey ? 'Metadata div' : 'Page Metadata',
            remediation: hasTitleKey ? 'No action needed' : 'Add title key-value pair to metadata'
        },
        {
            name: 'Title Value Set',
            status: hasTitleKey && titleValue.length > 0 ? 'pass' : 'fail',
            message: hasTitleKey && titleValue.length > 0 ? 
                `Title value is set: "${titleValue.length > 50 ? titleValue.substring(0, 50) + '...' : titleValue}"` :
                (hasTitleKey ? 'Title key exists but has no value' : 'Title key is missing'),
            location: hasTitleKey && titleValue.length > 0 ? 'Metadata div' : 'Metadata div',
            remediation: hasTitleKey && titleValue.length > 0 ? 'No action needed' : 
                (hasTitleKey ? 'Set a value for the title key' : 'Add title key-value pair to metadata')
        }
    ];
    
    // Determine overall status
    const overallStatus = (hasMetadataDiv && hasTitleKey && titleValue.length > 0) ? 'pass' : 'fail';
    
    return {
        status: overallStatus,
        message: !hasMetadataDiv ? 
            'Metadata div is missing from page' :
            (!hasTitleKey ? 
                'Metadata div exists but title key is missing' :
                (titleValue.length === 0 ? 
                    'Title key exists but has no value' : 
                    'Metadata div and title are properly configured')),
        location: !hasMetadataDiv ? 'Page structure' : 'Metadata div',
        remediation: !hasMetadataDiv ? 
            'Add metadata div to page' : 
            (!hasTitleKey ? 
                'Add title key-value pair to metadata' :
                (titleValue.length === 0 ? 
                    'Set a value for the title key' : 
                    'No action needed')),
        subTests: subTests
    };
}
