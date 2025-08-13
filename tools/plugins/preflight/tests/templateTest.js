/**
 * Template Test File
 *
 * This file serves as a template for creating new preflight tests.
 * Copy this file, rename it to {yourTestName}Test.js, and customize the logic.
 *
 * File Naming Convention: {testName}Test.js
 * Example: special-charactersTest.js, metadataTest.js, accessibilityTest.js
 */

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
        remediation: 'Ensure page has a <body> element',
      };
    }

    if (!hasContent) {
      return {
        overallStatus: 'fail',
        message: 'Body content is empty',
        location: 'Page content',
        remediation: 'Add content to the page body',
      };
    }

    return {
      overallStatus: 'pass',
      message: 'Content validation passed',
      location: 'Page content',
      remediation: 'No action needed',
    };
  } catch (error) {
    return {
      overallStatus: 'fail',
      message: `Content validation error: ${error.message}`,
      location: 'Content validation',
      remediation: 'Check content validation logic',
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
        remediation: 'Move inline styles to external CSS files',
      };
    }

    if (hasInlineScripts) {
      return {
        overallStatus: 'fail',
        message: 'Inline scripts detected',
        location: 'HTML elements',
        remediation: 'Move inline scripts to external JS files',
      };
    }

    return {
      overallStatus: 'pass',
      message: 'No inline styles or scripts found',
      location: 'HTML structure',
      remediation: 'No action needed',
    };
  } catch (error) {
    return {
      overallStatus: 'fail',
      message: `Pattern check error: ${error.message}`,
      location: 'Pattern validation',
      remediation: 'Check pattern validation logic',
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

  const hasFailures = subTests.some((test) => test.status === 'fail');
  const hasUnknown = subTests.some((test) => test.status === 'unknown');

  if (hasFailures) {
    return 'fail';
  }
  if (hasUnknown) {
    return 'unknown';
  }
  return 'pass';
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
        remediation: hasTitle ? 'No action needed' : 'Add a <title> tag to the page',
      },
      {
        name: 'Content Validation',
        status: contentValidation.overallStatus,
        message: contentValidation.message,
        location: contentValidation.location,
        remediation: contentValidation.remediation,
      },
      {
        name: 'Pattern Check',
        status: patternValidation.overallStatus,
        message: patternValidation.message,
        location: patternValidation.location,
        remediation: patternValidation.remediation,
      },
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
      subTests,
      metadata: {
        testName: testConfig.testName,
        description: testConfig.description,
        executionTime: Date.now(),
        pageSize: pageSource ? pageSource.length : 0,
      },
    };
  } catch (error) {
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
          remediation: 'Review test logic for syntax or logic errors',
        },
      ],
    };
  }
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export default async function templateTest(pageSource) {
  // ============================================================================
  // TEST CONFIGURATION
  // ============================================================================

  // Test metadata - update these values for your specific test
  const testConfig = {
    testName: 'Template Test',
    description: 'A template demonstrating all test features',
    timeout: 5000, // Maximum time in milliseconds for test to complete
    critical: true, // Whether this test is critical for page functionality
  };

  // ============================================================================
  // TEST EXECUTION
  // ============================================================================

  try {
    // Execute the actual test logic
    return runTest(pageSource, testConfig);
  } catch (error) {
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
          remediation: 'Review test code for syntax or logic errors',
        },
      ],
    };
  }
}
