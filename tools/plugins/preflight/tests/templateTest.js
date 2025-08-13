/**
 * Template Test File
 * 
 * This file serves as a template for creating new preflight tests.
 * Copy this file, rename it to {yourTestName}Test.js, and customize the logic.
 * 
 * File Naming Convention: {testName}Test.js
 * Example: special-charactersTest.js, metadataTest.js, accessibilityTest.js
 */

export default async function templateTest(pageSource) {
    // ============================================================================
    // TEST CONFIGURATION
    // ============================================================================
    
    // Test metadata - update these values for your specific test
    const testConfig = {
        testName: 'Template Test',
        description: 'A template demonstrating all test features',
        timeout: 5000, // Maximum time in milliseconds for test to complete
        critical: true  // Whether this test is critical for page functionality
    };
    
    console.log(`Starting ${testConfig.testName}:`, testConfig.description);
    console.log('Page source received:', pageSource ? 'Yes' : 'No');
    
    // ============================================================================
    // TEST EXECUTION
    // ============================================================================
    
    try {
        // Simulate some async work (replace with actual test logic)
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Execute the actual test logic
        return runTest(pageSource, testConfig);
        
    } catch (error) {
        console.error(`Error in ${testConfig.testName}:`, error);
        
        // Return error result
        return {
            status: 'fail',
            message: `Test execution failed: ${error.message}`,
            location: 'Test execution',
            remediation: 'Check console for error details and fix the test implementation',
            subTests: [
                {
                    name: 'Test Execution',
                    status: 'fail',
                    message: `Error: ${error.message}`,
                    location: 'Test function',
                    remediation: 'Review test code for syntax or logic errors'
                }
            ]
        };
    }
}

// ============================================================================
// MAIN TEST LOGIC
// ============================================================================

function runTest(pageSource, testConfig) {
    try {
        // Example: Parse the page source (you can use DOMParser or regex)
        const parser = new DOMParser();
        const doc = parser.parseFromString(pageSource, 'text/html');
        
        // Example: Check for specific elements
        const titleElement = doc.querySelector('title');
        const hasTitle = !!titleElement;
        
        // Example: Validate content
        const contentValidation = validateContent(doc);
        
        // Example: Check for specific patterns
        const patternValidation = checkPatterns(pageSource);
        
        // ============================================================================
        // SUB-TEST RESULTS
        // ============================================================================
        
        // Create sub-tests for granular reporting
        const subTests = [
            {
                name: 'Page Title',
                status: hasTitle ? 'pass' : 'fail',
                message: hasTitle ? 'Page title found' : 'Page title missing',
                location: 'HTML <head> section',
                remediation: hasTitle ? 'No action needed' : 'Add a <title> tag to the page'
            },
            {
                name: 'Content Validation',
                status: contentValidation.overallStatus,
                message: contentValidation.message,
                location: contentValidation.location,
                remediation: contentValidation.remediation
            },
            {
                name: 'Pattern Check',
                status: patternValidation.overallStatus,
                message: patternValidation.message,
                location: patternValidation.location,
                remediation: patternValidation.remediation
            }
        ];
        
        // ============================================================================
        // OVERALL TEST RESULT
        // ============================================================================
        
        // Determine overall test status based on sub-test results
        const overallStatus = determineOverallStatus(subTests);
        
        // Return the complete test result
        return {
            status: overallStatus,
            message: `${testConfig.testName} completed with ${overallStatus} status`,
            location: 'Entire page content',
            remediation: overallStatus === 'pass' ? 'No action needed' : 'Review failed sub-tests above',
            subTests: subTests,
            metadata: {
                testName: testConfig.testName,
                description: testConfig.description,
                executionTime: Date.now(),
                pageSize: pageSource ? pageSource.length : 0
            }
        };
        
    } catch (error) {
        console.error(`Error in runTest for ${testConfig.testName}:`, error);
        
        return {
            status: 'fail',
            message: `Test logic failed: ${error.message}`,
            location: 'Test execution',
            remediation: 'Check console for error details and fix the test implementation',
            subTests: [
                {
                    name: 'Test Logic',
                    status: 'fail',
                    message: `Error: ${error.message}`,
                    location: 'runTest function',
                    remediation: 'Review test logic for syntax or logic errors'
                }
            ]
        };
    }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Example helper function for content validation
 */
function validateContent(doc) {
    try {
        const body = doc.querySelector('body');
        const hasBody = !!body;
        const bodyContent = body ? body.textContent.trim() : '';
        const hasContent = bodyContent.length > 0;
        
        if (!hasBody) {
            return {
                overallStatus: 'fail',
                message: 'Body element missing',
                location: 'HTML structure',
                remediation: 'Ensure page has a <body> element'
            };
        }
        
        if (!hasContent) {
            return {
                overallStatus: 'fail',
                message: 'Body content is empty',
                location: 'Page content',
                remediation: 'Add content to the page body'
            };
        }
        
        return {
            overallStatus: 'pass',
            message: 'Content validation passed',
            location: 'Page content',
            remediation: 'No action needed'
        };
        
    } catch (error) {
        return {
            overallStatus: 'fail',
            message: `Content validation error: ${error.message}`,
            location: 'Content validation',
            remediation: 'Check content validation logic'
        };
    }
}

/**
 * Example helper function for pattern checking
 */
function checkPatterns(pageSource) {
    try {
        // Example: Check for common issues
        const hasInlineStyles = /style\s*=\s*["'][^"']*["']/i.test(pageSource);
        const hasInlineScripts = /<script[^>]*>.*?<\/script>/is.test(pageSource);
        
        if (hasInlineStyles) {
            return {
                overallStatus: 'fail',
                message: 'Inline styles detected',
                location: 'HTML elements',
                remediation: 'Move inline styles to external CSS files'
            };
        }
        
        if (hasInlineScripts) {
            return {
                overallStatus: 'fail',
                message: 'Inline scripts detected',
                location: 'HTML elements',
                remediation: 'Move inline scripts to external JS files'
            };
        }
        
        return {
            overallStatus: 'pass',
            message: 'No inline styles or scripts found',
            location: 'HTML structure',
            remediation: 'No action needed'
        };
        
    } catch (error) {
        return {
            overallStatus: 'fail',
            message: `Pattern check error: ${error.message}`,
            location: 'Pattern validation',
            remediation: 'Check pattern validation logic'
        };
    }
}

/**
 * Determine overall test status based on sub-test results
 */
function determineOverallStatus(subTests) {
    if (!subTests || subTests.length === 0) {
        return 'unknown';
    }
    
    const hasFailures = subTests.some(test => test.status === 'fail');
    const hasUnknown = subTests.some(test => test.status === 'unknown');
    
    if (hasFailures) {
        return 'fail';
    } else if (hasUnknown) {
        return 'unknown';
    } else {
        return 'pass';
    }
}

// ============================================================================
// USAGE EXAMPLES
// ============================================================================

/*
EXAMPLE 1: Simple Element Check
--------------------------------
export default async function simpleElementTest(pageSource) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    const targetElement = doc.querySelector('.important-class');
    const hasElement = !!targetElement;
    
    return {
        status: hasElement ? 'pass' : 'fail',
        message: hasElement ? 'Important element found' : 'Important element missing',
        location: 'CSS class .important-class',
        remediation: hasElement ? 'No action needed' : 'Add element with class .important-class',
        subTests: [
            {
                name: 'Element Presence',
                status: hasElement ? 'pass' : 'fail',
                message: hasElement ? 'Element exists' : 'Element not found',
                location: 'DOM structure',
                remediation: hasElement ? 'No action needed' : 'Create the required element'
            }
        ]
    };
}

EXAMPLE 2: Content Validation
-----------------------------
export default async function contentValidationTest(pageSource) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const hasHeadings = headings.length > 0;
    const headingCount = headings.length;
    
    return {
        status: hasHeadings ? 'pass' : 'fail',
        message: `Found ${headingCount} heading elements`,
        location: 'Page structure',
        remediation: hasHeadings ? 'No action needed' : 'Add heading elements for better structure',
        subTests: [
            {
                name: 'Heading Count',
                status: hasHeadings ? 'pass' : 'fail',
                message: `${headingCount} headings found`,
                location: 'Page content',
                remediation: hasHeadings ? 'No action needed' : 'Add at least one heading'
            },
            {
                name: 'Heading Hierarchy',
                status: headingCount > 1 ? 'pass' : 'unknown',
                message: headingCount > 1 ? 'Multiple heading levels' : 'Single heading level',
                location: 'Page structure',
                remediation: headingCount > 1 ? 'No action needed' : 'Consider adding more heading levels'
            }
        ]
    };
}

EXAMPLE 3: Performance Check
---------------------------
export default async function performanceTest(pageSource) {
    // Check for performance-related issues
    const hasLargeImages = /<img[^>]*src\s*=\s*["'][^"']*["'][^>]*>/gi.test(pageSource);
    const hasExternalResources = /(https?:\/\/[^\s"']+)/g.test(pageSource);
    
    const issues = [];
    if (hasLargeImages) issues.push('Large images detected');
    if (hasExternalResources) issues.push('External resources detected');
    
    const overallStatus = issues.length === 0 ? 'pass' : 'fail';
    
    return {
        status: overallStatus,
        message: issues.length === 0 ? 'No performance issues found' : `${issues.length} performance issues detected`,
        location: 'Page resources',
        remediation: issues.length === 0 ? 'No action needed' : 'Review and optimize resource usage',
        subTests: [
            {
                name: 'Image Optimization',
                status: hasLargeImages ? 'fail' : 'pass',
                message: hasLargeImages ? 'Large images may impact performance' : 'Images appear optimized',
                location: 'Image elements',
                remediation: hasLargeImages ? 'Optimize image sizes and formats' : 'No action needed'
            },
            {
                name: 'External Resources',
                status: hasExternalResources ? 'unknown' : 'pass',
                message: hasExternalResources ? 'External resources detected' : 'No external resources',
                location: 'Resource references',
                remediation: hasExternalResources ? 'Monitor external resource performance' : 'No action needed'
            }
        ]
    };
}
*/
