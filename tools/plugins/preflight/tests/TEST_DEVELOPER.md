# Preflight Test Developer Guide

This guide explains how to create new tests for the preflight tool, ensuring consistency and maintainability across all test implementations.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Test Structure](#test-structure)
3. [File Naming Convention](#file-naming-convention)
4. [Required Functions](#required-functions)
5. [Styling Guidelines](#styling-guidelines)
6. [Context Extraction](#context-extraction)
7. [Sub-Test Organization](#sub-test-organization)
8. [Error Handling](#error-handling)
9. [Testing Your Test](#testing-your-test)
10. [Examples](#examples)
11. [Best Practices](#best-practices)

## Quick Start

1. **Copy the template**: `cp tests/templateTest.js tests/yourTestNameTest.js`
2. **Rename the function**: Change `templateTest` to `yourTestName`
3. **Implement your logic**: Replace the example code with your actual test
4. **Follow styling guidelines**: Use consistent highlighting for issues
5. **Test locally**: Run the preflight tool to verify your test works

## Test Structure

Every test must follow this basic structure:

```javascript
export default async function yourTestName(pageSource) {
    // Simulate testing work (optional)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Execute the actual test logic
    return runTest(pageSource);
}

function runTest(pageSource) {
    // Parse page source
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');
    
    // Your test logic here
    
    // Return test result
    return {
        status: 'pass' | 'fail' | 'unknown',
        message: 'Human-readable summary',
        location: 'Where the issue was found',
        remediation: 'How to fix the issue',
        subTests: [/* array of sub-tests */]
    };
}
```

## File Naming Convention

- **Format**: `{testName}Test.js`
- **Examples**: 
  - `special-charactersTest.js`
  - `metadataTest.js`
  - `accessibilityTest.js`
  - `performanceTest.js`

## Required Functions

### Main Export Function
```javascript
export default async function yourTestName(pageSource)
```
- **Must be async**: Even if you don't need async operations
- **Parameter**: `pageSource` - HTML string of the page
- **Return**: Promise that resolves to test result

### Test Logic Function
```javascript
function runTest(pageSource)
```
- **Purpose**: Contains the actual test implementation
- **Parameter**: `pageSource` - HTML string of the page
- **Return**: Test result object

## Styling Guidelines

**IMPORTANT**: All tests must use consistent styling for highlighted terms.

### Highlighting Style
```javascript
// Use this exact HTML structure for highlighted terms
`<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong>`
```

### Location Field Format
```javascript
// Use this format for context around highlighted terms
`"...${beforeTerm} <strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong> ${afterTerm}..."`

// Example output:
// "...content with highlighted term in context..."
```

### Complete Example
```javascript
location: hasIssues ? 
    foundTerms.map(term => {
        const termIndex = context.indexOf(term);
        if (termIndex !== -1) {
            const beforeTerm = context.substring(0, termIndex).trim();
            const afterTerm = context.substring(termIndex + term.length).trim();
            
            let readableContext = '';
            if (beforeTerm) {
                readableContext += `...${beforeTerm} `;
            }
            readableContext += `<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong>`;
            if (afterTerm) {
                readableContext += ` ${afterTerm}...`;
            }
            return readableContext;
        }
        return `"...<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong>..."`;
    }).join('\n• ') : 'No issues found'
```

## Context Extraction

When highlighting terms in context, follow these guidelines:

### 1. Find Word Boundaries
```javascript
// Don't cut through words - extend to complete words
const start = Math.max(0, termIndex - 50);
const end = Math.min(text.length, termIndex + 50);

// Extend to word boundaries
let contextStart = start;
let contextEnd = end;

while (contextStart < termIndex && /\w/.test(text[contextStart])) {
    contextStart++;
}

while (contextEnd > termIndex + term.length && /\w/.test(text[contextEnd - 1])) {
    contextEnd--;
}

const context = text.substring(contextStart, contextEnd).trim();
```

### 2. Create Readable Context
```javascript
const beforeTerm = context.substring(0, termIndex).trim();
const afterTerm = context.substring(termIndex + term.length).trim();

let readableContext = '';
if (beforeTerm) {
    readableContext += `...${beforeTerm} `;
}
readableContext += `<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong>`;
if (afterTerm) {
    readableContext += ` ${afterTerm}...`;
}
```

## Sub-Test Organization

Organize your test into logical sub-tests for better reporting:

```javascript
const subTests = [
    {
        name: 'Sub-Test Name',
        status: 'pass' | 'fail' | 'unknown',
        message: 'What this sub-test checks',
        location: 'Where the issue was found (with highlighting if applicable)',
        remediation: 'How to fix this specific issue'
    }
    // ... more sub-tests
];
```

### Sub-Test Status Values
- **`pass`**: Test passed, no issues found
- **`fail`**: Test failed, issues detected
- **`unknown`**: Test couldn't determine status

## Error Handling

Always include proper error handling:

```javascript
try {
    // Your test logic here
    return {
        status: 'pass',
        message: 'Test completed successfully',
        location: 'All content areas',
        remediation: 'No action needed',
        subTests: subTests
    };
} catch (error) {
    console.error(`Error in ${testName}:`, error);
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
```

## Testing Your Test

### 1. Add to Configuration
Ensure your test is configured in the preflight configuration:
```json
{
    "key": "test",
    "value": "your-test-name"
}
```

### 2. Test Locally
1. Run the preflight tool
2. Click "Scan Now"
3. Check console for any errors
4. Verify the test appears in results
5. Check that highlighting works correctly

### 3. Debug Output
Add console.log statements during development:
```javascript
console.log('Test data:', data);
console.log('Found issues:', issues);
console.log('Context extracted:', context);
```

## Examples

### Example 1: Simple Element Check
```javascript
export default async function simpleElementTest(pageSource) {
    await new Promise(resolve => setTimeout(resolve, 500));
    return runTest(pageSource);
}

function runTest(pageSource) {
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
```

### Example 2: Content Pattern Check
```javascript
export default async function patternCheckTest(pageSource) {
    await new Promise(resolve => setTimeout(resolve, 800));
    return runTest(pageSource);
}

function runTest(pageSource) {
    const patterns = {
        inlineStyles: /style\s*=\s*["'][^"']*["']/gi,
        inlineScripts: /<script[^>]*>.*?<\/script>/gis
    };
    
    const issues = [];
    
    if (patterns.inlineStyles.test(pageSource)) {
        issues.push({
            type: 'inline-styles',
            message: 'Inline styles detected',
            remediation: 'Move inline styles to external CSS files'
        });
    }
    
    if (patterns.inlineScripts.test(pageSource)) {
        issues.push({
            type: 'inline-scripts',
            message: 'Inline scripts detected',
            remediation: 'Move inline scripts to external JS files'
        });
    }
    
    const hasIssues = issues.length > 0;
    
    return {
        status: hasIssues ? 'fail' : 'pass',
        message: hasIssues ? `${issues.length} issues found` : 'No issues detected',
        location: 'HTML structure',
        remediation: hasIssues ? 'Review and fix identified issues' : 'No action needed',
        subTests: issues.map(issue => ({
            name: issue.type.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase()),
            status: 'fail',
            message: issue.message,
            location: 'HTML elements',
            remediation: issue.remediation
        }))
    };
}
```

## Best Practices

### 1. Performance
- **Keep tests fast**: Aim for under 2 seconds execution time
- **Efficient parsing**: Use appropriate selectors and avoid unnecessary DOM traversal
- **Async handling**: Use async/await properly

### 2. Readability
- **Clear naming**: Use descriptive function and variable names
- **Consistent formatting**: Follow the established code style
- **Helpful messages**: Provide clear, actionable feedback

### 3. Maintainability
- **Modular code**: Break complex logic into helper functions
- **Error handling**: Always include try-catch blocks
- **Documentation**: Add comments for complex logic

### 4. User Experience
- **Clear remediation**: Tell users exactly how to fix issues
- **Context highlighting**: Show where issues are located
- **Consistent styling**: Use the established highlighting approach

### 5. Testing
- **Test locally**: Always verify your test works before committing
- **Edge cases**: Consider various page structures and content types
- **Error scenarios**: Test what happens when things go wrong

## Common Patterns

### DOM Parsing
```javascript
const parser = new DOMParser();
const doc = parser.parseFromString(pageSource, 'text/html');
```

### Element Selection
```javascript
// Single element
const element = doc.querySelector('.class-name');

// Multiple elements
const elements = doc.querySelectorAll('h1, h2, h3');

// Check existence
const hasElement = !!element;
```

### Text Content Analysis
```javascript
// Get text content
const textContent = element.textContent;

// Check for patterns
const hasPattern = /pattern/.test(textContent);

// Find matches
const matches = textContent.match(/pattern/g);
```

### Result Object Structure
```javascript
{
    status: 'pass' | 'fail' | 'unknown',
    message: 'Human-readable summary',
    location: 'Where the issue was found (with highlighting)',
    remediation: 'How to fix the issue',
    subTests: [
        {
            name: 'Sub-test name',
            status: 'pass' | 'fail' | 'unknown',
            message: 'Sub-test specific message',
            location: 'Sub-test specific location',
            remediation: 'Sub-test specific remediation'
        }
    ]
}
```

## Getting Help

If you encounter issues while developing tests:

1. **Check the console** for error messages
2. **Review existing tests** for examples
3. **Use the template** as a starting point
4. **Follow the styling guidelines** for consistency
5. **Test incrementally** to isolate issues

## Contributing

When contributing new tests:

1. **Follow the naming convention**
2. **Include proper error handling**
3. **Use consistent styling**
4. **Test thoroughly**
5. **Document any special requirements**

---

**Remember**: The goal is to create tests that are helpful, reliable, and consistent with the existing preflight tool experience.
