export default async function testAbsolutes(pageSource) {
    // Simulate testing for absolutes
    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate async work
    
    // Execute the actual test logic
    return runTest(pageSource);
}

function runTest(pageSource) {
    // Parse the page source
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    // Define absolute terms to look for
    const absoluteTerms = [
        'all', 'every', '100%', 'never', 'always', 'none', 'nothing',
        'everything', 'everyone', 'everybody', 'everywhere', 'everytime',
        'completely', 'totally', 'absolutely', 'definitely', 'certainly',
        'guaranteed', 'impossible', 'perfect', 'worst', 'best', 'forever',
        'permanent', 'eternal', 'infinite', 'unlimited', 'boundless',
        'unconditional', 'unquestionable', 'indisputable', 'irrefutable'
    ];
    
    // Create regex pattern for absolute terms (case insensitive)
    const absolutePattern = new RegExp(`(${absoluteTerms.join('|')})`, 'gi');
    
    // Check metadata div in body for absolute terms
    const metadataDiv = doc.querySelector('div.metadata');
    const hasMetadataDiv = !!metadataDiv;
    
    // Extract metadata content and title separately
    let metadataTitleText = '';
    let metadataTitleMatches = [];
    let metadataText = '';
    let metadataMatches = [];
    let metaMatches = [];
    
    if (metadataDiv) {
        // Parse the actual HTML structure: <div><div><p>key</p></div><div><p>value</p></div></div>
        // We need the OUTER divs that contain the key-value pairs, not the inner divs with <p> elements
        const metadataDivs = metadataDiv.children; // Get direct children (the outer divs)
        
        const metadataItems = [];
        let foundTitle = false;
        let titleValue = '';
        
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
                
                // Skip if this is the title row
                if (key.toLowerCase() === 'title') {
                    metadataTitleText = value;
                    metadataTitleMatches = value.match(absolutePattern) || [];
                    foundTitle = true;
                    titleValue = value;
                    continue; // Skip to next pair
                }
                
                // Double-check: if we already found title, make sure this isn't the title value
                if (foundTitle && value === titleValue) {
                    continue;
                }
                
                // Check if value contains absolute terms
                const valueHasAbsolutes = value.match(absolutePattern);
                if (valueHasAbsolutes) {
                    metadataItems.push({ key, value });
                }
            }
        }
        
        // Build metadata text from non-title items only
        metadataText = metadataItems.map(item => item.value).join(' ');
        metadataMatches = metadataText.match(absolutePattern) || [];
        
        // Create detailed metadata matches for location display
        if (metadataMatches.length > 0) {
            metadataItems.forEach(item => {
                const itemMatches = item.value.match(absolutePattern);
                if (itemMatches) {
                    itemMatches.forEach(match => {
                        metaMatches.push({
                            term: match,
                            context: item.value,
                            key: item.key
                        });
                    });
                }
            });
        }
    }
    
    // Check body content (excluding metadata div completely)
    const bodyMatches = [];
    const body = doc.querySelector('body');
    
    if (body) {
        // Get main content area
        const mainContent = body.querySelector('main') || body;
        
        // Create a clean copy of main content without metadata div
        const cleanMainContent = mainContent.cloneNode(true);
        const metadataDivInClone = cleanMainContent.querySelector('.metadata');
        if (metadataDivInClone) {
            metadataDivInClone.remove();
        }
        
        // Get clean text content
        const cleanTextContent = cleanMainContent.textContent;
        
        // Find absolute terms in clean body content using a fresh regex instance
        const bodyPattern = new RegExp(`(${absoluteTerms.join('|')})`, 'gi');
        let match;
        while ((match = bodyPattern.exec(cleanTextContent)) !== null) {
            bodyMatches.push({
                term: match[0],
                index: match.index,
                context: cleanTextContent.substring(Math.max(0, match.index - 20), match.index + 30)
            });
        }
        
    }
    
    // Create sub-tests
    const subTests = [
        {
            name: 'Title',
            status: hasMetadataDiv ? (metadataTitleMatches.length > 0 ? 'fail' : 'pass') : 'fail',
            message: hasMetadataDiv ? 
                (metadataTitleMatches.length > 0 ? `Title contains ${metadataTitleMatches.length} absolute terms` : 'Title is free of absolute terms') :
                'No metadata present',
            location: hasMetadataDiv ? 
                (metadataTitleMatches.length > 0 ? `"${metadataTitleText.length > 50 ? metadataTitleText.substring(0, 50) + '...' : metadataTitleText}"` : 'Metadata title') :
                'Metadata div missing',
            remediation: hasMetadataDiv ? 
                (metadataTitleMatches.length > 0 ? 'Review title for accuracy and qualification' : 'No action needed') :
                'Add metadata div to page'
        },
        {
            name: 'Meta Tags',
            status: hasMetadataDiv ? (metaMatches.length > 0 ? 'fail' : 'pass') : 'fail',
            message: hasMetadataDiv ? 
                `${metaMatches.length} metadata sections contain absolute terms` :
                'No metadata present',
            location: hasMetadataDiv ? 
                (metaMatches.length > 0 ? 
                    metaMatches.map(m => 
                        `${m.key}: "${m.context.length > 40 ? m.context.substring(0, 40) + '...' : m.context}"`
                    ).join('\n• ') : 'Metadata section') :
                'Metadata div missing',
            remediation: hasMetadataDiv ? 
                'No action needed' : 'Add metadata div to page'
        },
        {
            name: 'Body Content',
            status: bodyMatches.length > 0 ? 'fail' : 'pass',
            message: `Body contains ${bodyMatches.length} absolute terms`,
            location: bodyMatches.length > 0 ? 
                bodyMatches.map(m => {
                    const context = m.context.trim();
                    return context.length > 60 ? context.substring(0, 60) + '...' : context;
                }).join('\n• ') : 'Main content area',
            remediation: bodyMatches.length > 0 ? 'Review body content for accuracy' : 'No action needed'
        }
    ];
    
    // Determine overall status
    const hasAbsolutes = metadataTitleMatches.length > 0 || metaMatches.length > 0 || bodyMatches.length > 0;
    const overallStatus = (hasAbsolutes || !hasMetadataDiv) ? 'fail' : 'pass';
    
    return {
        status: overallStatus,
        message: !hasMetadataDiv ? 
            'No metadata div present - test cannot complete' :
            (hasAbsolutes ? 
                `Found ${metadataTitleMatches.length + metaMatches.length + bodyMatches.length} absolute terms in metadata, title, and body content` : 
                'No absolute terms detected in key content areas'),
        location: !hasMetadataDiv ? 'Page structure' : 'Title, meta tags, and body content',
        remediation: !hasMetadataDiv ? 
            'Add metadata div to page before running absolutes test' : 
            (hasAbsolutes ? 
                'Review and qualify absolute statements in title, meta tags, and body content' : 
                'No action needed'),
        subTests: subTests
    };
}
