/**
 * Content Length Test
 *
 * This test checks content length requirements for SEO and readability:
 * - Title length (optimal: 50-60 characters)
 * - Meta description length (optimal: 150-160 characters)
 * - Body content minimum length
 * - Heading presence and length
 */

const THRESHOLDS = {
  title: {
    min: 30,
    max: 60,
    optimal: { min: 50, max: 60 },
  },
  description: {
    min: 70,
    max: 160,
    optimal: { min: 150, max: 160 },
  },
  bodyContent: {
    minWords: 100,
    recommendedWords: 300,
  },
  heading: {
    maxLength: 100,
  },
};

/**
 * Count words in text
 */
function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter((word) => word.length > 0).length;
}

/**
 * Get character count (excluding extra whitespace)
 */
function getCharCount(text) {
  if (!text) return 0;
  return text.trim().replace(/\s+/g, ' ').length;
}

/**
 * Highlight a term with consistent styling
 */
function highlight(term) {
  return `<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${term}</strong>`;
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

/**
 * Get length status and message for a field
 */
function getLengthStatus(length, thresholds) {
  if (length === 0) {
    return { status: 'fail', level: 'missing' };
  }
  if (length < thresholds.min) {
    return { status: 'fail', level: 'too-short' };
  }
  if (length > thresholds.max) {
    return { status: 'fail', level: 'too-long' };
  }
  if (length >= thresholds.optimal.min && length <= thresholds.optimal.max) {
    return { status: 'pass', level: 'optimal' };
  }
  return { status: 'pass', level: 'acceptable' };
}

function runTest(pageSource) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');

    // Check for metadata div
    const metadataDiv = doc.querySelector('div.metadata');

    // Extract title and description from metadata div
    let titleValue = '';
    let descriptionValue = '';

    if (metadataDiv) {
      const metadataDivs = metadataDiv.children;

      for (let i = 0; i < metadataDivs.length; i += 1) {
        const outerDiv = metadataDivs[i];
        const innerDivs = outerDiv.children;

        if (innerDivs.length === 2) {
          const keyDiv = innerDivs[0];
          const valueDiv = innerDivs[1];

          const key = keyDiv.textContent.trim().toLowerCase();
          const value = valueDiv.textContent.trim();

          if (key === 'title') {
            titleValue = value;
          } else if (key === 'description') {
            descriptionValue = value;
          }
        }
      }
    }

    // Get body content (excluding metadata)
    const bodyClone = doc.body.cloneNode(true);
    const metadataClone = bodyClone.querySelector('div.metadata');
    if (metadataClone) {
      metadataClone.remove();
    }

    const bodyText = bodyClone.textContent || '';
    const bodyWordCount = countWords(bodyText);

    // Get headings
    const headings = bodyClone.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const longHeadings = [];

    headings.forEach((heading) => {
      const text = heading.textContent.trim();
      const charCount = getCharCount(text);
      if (charCount > THRESHOLDS.heading.maxLength) {
        longHeadings.push({
          tag: heading.tagName,
          text: text.length > 60 ? `${text.substring(0, 60)}...` : text,
          length: charCount,
        });
      }
    });

    const subTests = [];

    // Title length sub-test
    const titleLength = getCharCount(titleValue);
    const titleStatus = getLengthStatus(titleLength, THRESHOLDS.title);
    const titleDisplay = titleValue.length > 70 ? `${titleValue.substring(0, 70)}...` : titleValue;

    subTests.push({
      name: 'Title Length',
      status: titleStatus.status,
      message: (() => {
        if (titleStatus.level === 'missing') {
          return 'Title is missing from metadata';
        }
        if (titleStatus.level === 'too-short') {
          return `Title is too short (${titleLength} chars). Minimum: ${THRESHOLDS.title.min}`;
        }
        if (titleStatus.level === 'too-long') {
          return `Title is too long (${titleLength} chars). Maximum: ${THRESHOLDS.title.max}`;
        }
        if (titleStatus.level === 'optimal') {
          return `Title length is optimal (${titleLength} chars)`;
        }
        return `Title length is acceptable (${titleLength} chars)`;
      })(),
      location: titleValue
        ? `"${titleDisplay}" → ${highlight(`${titleLength} characters`)}`
        : 'Metadata section',
      remediation: (() => {
        if (titleStatus.level === 'missing') {
          return 'Add a title in the metadata section';
        }
        if (titleStatus.level === 'too-short') {
          return `Add ${THRESHOLDS.title.min - titleLength} more characters to improve SEO`;
        }
        if (titleStatus.level === 'too-long') {
          return `Remove ${titleLength - THRESHOLDS.title.max} characters to prevent truncation in search results`;
        }
        return 'No action needed';
      })(),
    });

    // Description length sub-test
    const descLength = getCharCount(descriptionValue);
    const descStatus = getLengthStatus(descLength, THRESHOLDS.description);
    const descDisplay = descriptionValue.length > 70 ? `${descriptionValue.substring(0, 70)}...` : descriptionValue;

    subTests.push({
      name: 'Description Length',
      status: descStatus.status,
      message: (() => {
        if (descStatus.level === 'missing') {
          return 'Meta description is missing from metadata';
        }
        if (descStatus.level === 'too-short') {
          return `Description is too short (${descLength} chars). Minimum: ${THRESHOLDS.description.min}`;
        }
        if (descStatus.level === 'too-long') {
          return `Description is too long (${descLength} chars). Maximum: ${THRESHOLDS.description.max}`;
        }
        if (descStatus.level === 'optimal') {
          return `Description length is optimal (${descLength} chars)`;
        }
        return `Description length is acceptable (${descLength} chars)`;
      })(),
      location: descriptionValue
        ? `"${descDisplay}" → ${highlight(`${descLength} characters`)}`
        : 'Metadata section',
      remediation: (() => {
        if (descStatus.level === 'missing') {
          return 'Add a description in the metadata section for better SEO';
        }
        if (descStatus.level === 'too-short') {
          return `Add ${THRESHOLDS.description.min - descLength} more characters for better search visibility`;
        }
        if (descStatus.level === 'too-long') {
          return `Remove ${descLength - THRESHOLDS.description.max} characters to prevent truncation`;
        }
        return 'No action needed';
      })(),
    });

    // Body content length sub-test
    const hasMinContent = bodyWordCount >= THRESHOLDS.bodyContent.minWords;
    const hasRecommendedContent = bodyWordCount >= THRESHOLDS.bodyContent.recommendedWords;

    subTests.push({
      name: 'Body Content Length',
      status: hasMinContent ? 'pass' : 'fail',
      message: (() => {
        if (bodyWordCount === 0) {
          return 'Body content is empty';
        }
        if (!hasMinContent) {
          return `Body content is too short (${bodyWordCount} words). Minimum: ${THRESHOLDS.bodyContent.minWords}`;
        }
        if (!hasRecommendedContent) {
          return `Body content is adequate (${bodyWordCount} words). Recommended: ${THRESHOLDS.bodyContent.recommendedWords}+`;
        }
        return `Body content length is good (${bodyWordCount} words)`;
      })(),
      location: `Body content → ${highlight(`${bodyWordCount} words`)}`,
      remediation: (() => {
        if (bodyWordCount === 0) {
          return 'Add content to the page body';
        }
        if (!hasMinContent) {
          return `Add at least ${THRESHOLDS.bodyContent.minWords - bodyWordCount} more words for minimum content`;
        }
        if (!hasRecommendedContent) {
          return `Consider adding ${THRESHOLDS.bodyContent.recommendedWords - bodyWordCount} more words for better SEO`;
        }
        return 'No action needed';
      })(),
    });

    // Heading presence sub-test
    const hasHeadings = headings.length > 0;
    subTests.push({
      name: 'Heading Presence',
      status: hasHeadings ? 'pass' : 'fail',
      message: hasHeadings
        ? `Found ${headings.length} heading(s) in content`
        : 'No headings found in content',
      location: hasHeadings
        ? `Content has ${highlight(`${headings.length} heading(s)`)}`
        : 'Body content (excluding metadata)',
      remediation: hasHeadings
        ? 'No action needed'
        : 'Add at least one heading (H1, H2, etc.) to structure your content for better SEO and accessibility',
    });

    // Heading length sub-test
    const hasLongHeadings = longHeadings.length > 0;
    subTests.push({
      name: 'Heading Length',
      status: hasLongHeadings ? 'fail' : 'pass',
      message: (() => {
        if (!hasHeadings) {
          return 'No headings to check';
        }
        if (hasLongHeadings) {
          return `Found ${longHeadings.length} heading(s) exceeding ${THRESHOLDS.heading.maxLength} characters`;
        }
        return `All ${headings.length} heading(s) are within recommended length`;
      })(),
      location: (() => {
        if (!hasHeadings) {
          return 'N/A - no headings in content';
        }
        if (hasLongHeadings) {
          return longHeadings.map((h) => `&lt;${h.tag}&gt;: "${h.text}" → ${highlight(`${h.length} chars`)}`).join('\n• ');
        }
        return 'All headings checked';
      })(),
      remediation: (() => {
        if (!hasHeadings) {
          return 'Add headings to your content first';
        }
        if (hasLongHeadings) {
          return `Shorten headings to ${THRESHOLDS.heading.maxLength} characters or less for better readability`;
        }
        return 'No action needed';
      })(),
    });

    const overallStatus = determineOverallStatus(subTests);
    const failedCount = subTests.filter((t) => t.status === 'fail').length;

    return {
      status: overallStatus,
      message: failedCount > 0
        ? `Found ${failedCount} content length issue(s) that may affect SEO`
        : 'All content length requirements are met',
      location: 'Page content and metadata',
      remediation: overallStatus === 'pass'
        ? 'No action needed'
        : 'Review and address the content length issues for better SEO',
      subTests,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `Content length test execution failed: ${error.message}`,
      location: `Error in test execution: ${error.name}`,
      remediation: 'Check console for detailed error information and fix the test implementation',
      subTests: [
        {
          name: 'Execution Error',
          status: 'fail',
          message: `Error: ${error.message}`,
          location: 'Test function execution',
          remediation: 'Review test code and page source for compatibility issues',
        },
      ],
    };
  }
}

export default async function contentLengthTest(pageSource) {
  return runTest(pageSource);
}
