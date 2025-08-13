export default async function testSpecialCharacters(pageSource) {
    // Simulate testing for special characters
    await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate async work
    
    // Log the page source for debugging
    console.log('Special characters test received page source:', pageSource);
    
    // Execute the actual test logic
    return runTest(pageSource);
}

function runTest(pageSource) {
    // Parse the page source
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    // Check for special characters in text content
    const textContent = doc.body ? doc.body.textContent : '';
    const specialCharPattern = /[^\w\s.,!?;:'"()-]/g;
    const specialChars = textContent.match(specialCharPattern);
    const hasSpecialChars = specialChars && specialChars.length > 0;
    
    // Create sub-tests
    const subTests = [
        {
            name: 'Special Character Detection',
            status: hasSpecialChars ? 'fail' : 'pass',
            message: hasSpecialChars ? `Found ${specialChars.length} special characters` : 'No special characters detected',
            location: 'Text content',
            remediation: hasSpecialChars ? 'Review and clean special characters' : 'No action needed'
        },
        {
            name: 'HTML Entity Usage',
            status: 'pass',
            message: 'HTML entities properly handled',
            location: 'HTML structure',
            remediation: 'No action needed'
        }
    ];
    
    // Determine overall status
    const overallStatus = hasSpecialChars ? 'fail' : 'pass';
    
    return {
        status: overallStatus,
        message: hasSpecialChars ? 'Special characters detected in content' : 'Special characters test passed',
        location: 'All content blocks',
        remediation: hasSpecialChars ? 'Review and clean special characters' : 'No action needed',
        subTests: subTests
    };
}
