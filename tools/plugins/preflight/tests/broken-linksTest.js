/**
 * Broken Links Test
 *
 * This test checks for broken or potentially problematic links in page content.
 * It validates:
 * - Empty href attributes
 * - Placeholder links (e.g., #, javascript:void(0))
 * - Malformed URLs
 * - Links pointing to non-existent anchors
 */

/**
 * Check if a URL is a placeholder or invalid link
 */
function isPlaceholderLink(href) {
  if (!href || href.trim() === '') return true;

  const placeholderPatterns = [
    /^#$/,
    /^javascript:/i,
    /^void\(0\)$/i,
    /^about:blank$/i,
    /^\{\{.*\}\}$/, // Template placeholders like {{url}}
    /^\[.*\]$/, // Placeholder like [link]
  ];

  return placeholderPatterns.some((pattern) => pattern.test(href.trim()));
}

/**
 * Check if URL is malformed
 */
function isMalformedUrl(href) {
  if (!href || href.trim() === '') return false;

  // Skip relative paths, anchors, mailto, tel links
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }

  // Check for common URL issues
  const malformedPatterns = [
    /^https?:\/\/$/i, // Just protocol
    /^https?:\/\/\s/i, // Protocol with space
    /\s+https?:\/\//i, // Space before URL
    /^www\.[^.]+$/i, // www.something without TLD
    /^https?:\/\/[^./]+$/i, // Protocol with just domain, no TLD
  ];

  return malformedPatterns.some((pattern) => pattern.test(href.trim()));
}

/**
 * Get context around a link for display
 */
function getLinkContext(anchor) {
  const href = anchor.getAttribute('href') || '';
  const text = anchor.textContent.trim() || '[no text]';
  const displayText = text.length > 40 ? `${text.substring(0, 40)}...` : text;
  const displayHref = href.length > 60 ? `${href.substring(0, 60)}...` : href;

  return {
    href,
    text,
    displayText,
    displayHref,
  };
}

/**
 * Highlight a term with consistent styling
 */
function highlight(term) {
  const style = 'background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;';
  return `<strong style="${style}">${term}</strong>`;
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

function runTest(pageSource) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(pageSource, 'text/html');

    // Get all anchor elements, excluding metadata section
    const metadataDiv = doc.querySelector('div.metadata');
    const bodyClone = doc.body.cloneNode(true);

    if (metadataDiv) {
      const metadataClone = bodyClone.querySelector('div.metadata');
      if (metadataClone) {
        metadataClone.remove();
      }
    }

    const anchors = bodyClone.querySelectorAll('a[href]');
    const emptyLinks = [];
    const placeholderLinks = [];
    const malformedLinks = [];
    const brokenAnchorLinks = [];

    // Collect all IDs in the document for anchor validation
    const documentIds = new Set();
    doc.querySelectorAll('[id]').forEach((el) => {
      documentIds.add(el.id);
    });

    anchors.forEach((anchor) => {
      const href = anchor.getAttribute('href');
      const context = getLinkContext(anchor);

      // Check for empty href
      if (!href || href.trim() === '') {
        emptyLinks.push(context);
        return;
      }

      // Check for placeholder links
      if (isPlaceholderLink(href)) {
        placeholderLinks.push(context);
        return;
      }

      // Check for malformed URLs
      if (isMalformedUrl(href)) {
        malformedLinks.push(context);
        return;
      }

      // Check for broken internal anchor links
      if (href.startsWith('#') && href.length > 1) {
        const anchorId = href.substring(1);
        if (!documentIds.has(anchorId)) {
          brokenAnchorLinks.push({ ...context, anchorId });
        }
      }
    });

    const subTests = [];

    // Empty links sub-test
    const hasEmptyLinks = emptyLinks.length > 0;
    subTests.push({
      name: 'Empty Links',
      status: hasEmptyLinks ? 'fail' : 'pass',
      message: hasEmptyLinks
        ? `Found ${emptyLinks.length} link(s) with empty href attribute`
        : 'No empty links found',
      location: hasEmptyLinks
        ? emptyLinks.map((l) => `Link text: "${highlight(l.displayText)}" → href is empty`).join('\n• ')
        : 'All links have href values',
      remediation: hasEmptyLinks
        ? 'Add valid URLs to empty href attributes or remove unused links'
        : 'No action needed',
    });

    // Placeholder links sub-test
    const hasPlaceholderLinks = placeholderLinks.length > 0;
    subTests.push({
      name: 'Placeholder Links',
      status: hasPlaceholderLinks ? 'fail' : 'pass',
      message: hasPlaceholderLinks
        ? `Found ${placeholderLinks.length} placeholder link(s) (e.g., #, javascript:void(0))`
        : 'No placeholder links found',
      location: hasPlaceholderLinks
        ? placeholderLinks.map((l) => `"${l.displayText}" → ${highlight(l.displayHref)}`).join('\n• ')
        : 'All links have valid destinations',
      remediation: hasPlaceholderLinks
        ? 'Replace placeholder links with actual URLs or remove them'
        : 'No action needed',
    });

    // Malformed URLs sub-test
    const hasMalformedLinks = malformedLinks.length > 0;
    subTests.push({
      name: 'Malformed URLs',
      status: hasMalformedLinks ? 'fail' : 'pass',
      message: hasMalformedLinks
        ? `Found ${malformedLinks.length} malformed URL(s)`
        : 'No malformed URLs found',
      location: hasMalformedLinks
        ? malformedLinks.map((l) => `"${l.displayText}" → ${highlight(l.displayHref)}`).join('\n• ')
        : 'All URLs are properly formatted',
      remediation: hasMalformedLinks
        ? 'Fix malformed URLs to use proper format (e.g., https://example.com)'
        : 'No action needed',
    });

    // Broken anchor links sub-test
    const hasBrokenAnchors = brokenAnchorLinks.length > 0;
    subTests.push({
      name: 'Broken Anchor Links',
      status: hasBrokenAnchors ? 'fail' : 'pass',
      message: hasBrokenAnchors
        ? `Found ${brokenAnchorLinks.length} link(s) pointing to non-existent anchors`
        : 'No broken anchor links found',
      location: hasBrokenAnchors
        ? brokenAnchorLinks.map((l) => `"${l.displayText}" → ${highlight(`#${l.anchorId}`)} (anchor not found)`).join('\n• ')
        : 'All anchor links point to valid targets',
      remediation: hasBrokenAnchors
        ? 'Add missing anchor IDs to target elements or update links to valid anchors'
        : 'No action needed',
    });

    const overallStatus = determineOverallStatus(subTests);
    const totalIssues = emptyLinks.length + placeholderLinks.length
      + malformedLinks.length + brokenAnchorLinks.length;

    return {
      status: overallStatus,
      message: totalIssues > 0
        ? `Found ${totalIssues} link issue(s) that need attention`
        : 'All links are valid and properly formatted',
      location: 'Page content links',
      remediation: overallStatus === 'pass'
        ? 'No action needed'
        : 'Review and fix the identified link issues',
      subTests,
    };
  } catch (error) {
    return {
      status: 'fail',
      message: `Broken links test execution failed: ${error.message}`,
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

export default async function brokenLinksTest(pageSource) {
  return runTest(pageSource);
}
