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
    'unconditional', 'unquestionable', 'indisputable', 'irrefutable',
  ];

  // Create regex pattern for absolute terms with proper word boundaries
  // Handle special characters like % by escaping them and using lookahead/lookbehind
  const escapedTerms = absoluteTerms.map((term) => {
    // Escape special regex characters
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // For terms that start/end with word characters, use word boundaries
    if (/^\w/.test(term) && /\w$/.test(term)) {
      return `\\b${escaped}\\b`;
    }
    // For terms with special characters, use space/punctuation boundaries
    return `(?<!\\w)${escaped}(?!\\w)`;
  });

  const absolutePattern = new RegExp(`(${escapedTerms.join('|')})`, 'gi');

  // Check metadata div in body for absolute terms
  const metadataDiv = doc.querySelector('div.metadata');
  const hasMetadataDiv = !!metadataDiv;

  // Extract metadata content and title separately
  let metadataTitleText = '';
  let metadataTitleMatches = [];
  const metaMatches = [];

  if (metadataDiv) {
    // Parse the actual HTML structure: <div><div><p>key</p></div><div><p>value</p></div></div>
    // We need the OUTER divs that contain the key-value pairs, not the inner divs with <p> elements
    const metadataDivs = metadataDiv.children; // Get direct children (the outer divs)

    const metadataItems = [];
    let foundTitle = false;
    let titleValue = '';

    // Process each outer div (each contains a key-value pair)
    for (let i = 0; i < metadataDivs.length; i += 1) {
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
        } else if (foundTitle && value === titleValue) {
          // Double-check: if we already found title, make sure this isn't the title value
        } else {
          // Check if value contains absolute terms
          const valueHasAbsolutes = value.match(absolutePattern);
          if (valueHasAbsolutes) {
            metadataItems.push({ key, value });
          }
        }

        // Check if value contains absolute terms
        const valueHasAbsolutes = value.match(absolutePattern);
        if (valueHasAbsolutes) {
          metadataItems.push({ key, value });
        }
      }
    }

    // Build metadata text from non-title items only (for potential future use)
    // metadataText = metadataItems.map((item) => item.value).join(' ');

    // Create detailed metadata matches for display
    metadataItems.forEach((item) => {
      const matches = item.value.match(absolutePattern) || [];
      matches.forEach((match) => {
        const matchIndex = item.value.indexOf(match);
        const start = Math.max(0, matchIndex - 25);
        const end = Math.min(item.value.length, matchIndex + match.length + 25);
        let context = item.value.substring(start, end).trim();

        // Extend to word boundaries for better readability
        if (start > 0) {
          const beforeMatch = item.value.substring(0, matchIndex);
          const lastSpaceIndex = beforeMatch.lastIndexOf(' ');
          if (lastSpaceIndex > start - 25) {
            context = item.value.substring(lastSpaceIndex + 1, end).trim();
          }
        }
        if (end < item.value.length) {
          const afterMatch = item.value.substring(matchIndex + match.length);
          const nextSpaceIndex = afterMatch.indexOf(' ');
          if (nextSpaceIndex > 0 && nextSpaceIndex < 25) {
            const endIndex = matchIndex + match.length + nextSpaceIndex;
            context = item.value.substring(start, endIndex).trim();
          }
        }

        // Limit context length for display
        if (context.length > 150) {
          context = context.substring(0, 150).trim();
        }

        metaMatches.push({
          term: match,
          key: item.key,
          context,
        });
      });
    });
  }

  // Check body content (excluding metadata div) for absolute terms
  let bodyText = '';
  const bodyMatches = [];

  if (doc.body) {
    // Clone the body to avoid modifying the original
    const bodyClone = doc.body.cloneNode(true);

    // Remove the metadata div from the clone if it exists
    const metadataDivClone = bodyClone.querySelector('div.metadata');
    if (metadataDivClone) {
      metadataDivClone.remove();
    }

    bodyText = bodyClone.textContent || '';

    // Find all matches in body content
    const allMatches = bodyText.match(absolutePattern) || [];
    const uniqueMatches = [...new Set(allMatches)];

    uniqueMatches.forEach((uniqueMatch) => {
      // Find context for each unique match
      const matchIndex = bodyText.indexOf(uniqueMatch);
      const start = Math.max(0, matchIndex - 25);
      const end = Math.min(bodyText.length, matchIndex + uniqueMatch.length + 25);
      let context = bodyText.substring(start, end).trim();

      // Extend to word boundaries for better readability
      if (start > 0) {
        const beforeMatch = bodyText.substring(0, matchIndex);
        const lastSpaceIndex = beforeMatch.lastIndexOf(' ');
        if (lastSpaceIndex > start - 25) {
          context = bodyText.substring(lastSpaceIndex + 1, end).trim();
        }
      }
      if (end < bodyText.length) {
        const afterMatch = bodyText.substring(matchIndex + uniqueMatch.length);
        const nextSpaceIndex = afterMatch.indexOf(' ');
        if (nextSpaceIndex > 0 && nextSpaceIndex < 25) {
          const endIndex = matchIndex + uniqueMatch.length + nextSpaceIndex;
          context = bodyText.substring(start, endIndex).trim();
        }
      }

      // Limit context length for display
      if (context.length > 150) {
        context = context.substring(0, 150).trim();
      }

      bodyMatches.push({
        term: uniqueMatch,
        context,
      });
    });
  }

  // Create sub-tests
  const subTests = [
    {
      name: 'Title',
      status: (() => {
        if (!hasMetadataDiv) return 'fail';
        return metadataTitleMatches.length > 0 ? 'fail' : 'pass';
      })(),
      message: (() => {
        if (!hasMetadataDiv) return 'No metadata present';
        if (metadataTitleMatches.length > 0) {
          return `Title contains ${metadataTitleMatches.length} absolute terms`;
        }
        return 'Title is properly qualified';
      })(),
      location: (() => {
        if (!hasMetadataDiv) return 'Metadata div missing';
        if (metadataTitleMatches.length > 0) {
          return `Title: "${metadataTitleText}"\n• Found: ${metadataTitleMatches.map((term) => `<strong>${term}</strong>`).join(', ')}`;
        }
        return 'Metadata title';
      })(),
      remediation: (() => {
        if (!hasMetadataDiv) return 'Add metadata div to page';
        return metadataTitleMatches.length > 0 ? 'Review title for accuracy and qualification' : 'No action needed';
      })(),
    },
    {
      name: 'Meta Tags',
      status: (() => {
        if (!hasMetadataDiv) return 'fail';
        return metaMatches.length > 0 ? 'fail' : 'pass';
      })(),
      message: (() => {
        if (!hasMetadataDiv) return 'No metadata present';
        return `${metaMatches.length} metadata sections contain absolute terms`;
      })(),
      location: (() => {
        if (!hasMetadataDiv) return 'Metadata div missing';
        if (metaMatches.length > 0) {
          return metaMatches.map((m) => {
            const context = m.context.length > 80
              ? `${m.context.substring(0, 80)}...`
              : m.context;
            // Use the same format as special characters test: "... term in context ..."
            const termIndex = context.indexOf(m.term);
            if (termIndex !== -1) {
              const beforeTerm = context.substring(0, termIndex).trim();
              const afterTerm = context.substring(termIndex + m.term.length).trim();

              // Format: "... term in context ..."
              let readableContext = '';
              if (beforeTerm) {
                readableContext += `...${beforeTerm} `;
              }
              const strongStyle = 'background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;';
              readableContext += `<strong style="${strongStyle}">${m.term}</strong>`;
              if (afterTerm) {
                readableContext += ` ${afterTerm}...`;
              }

              return `${m.key}: "${readableContext}"`;
            }
            return `${m.key}: "${context}"`;
          }).join('\n• ');
        }
        return 'Metadata section';
      })(),
      remediation: (() => {
        if (!hasMetadataDiv) return 'Add metadata div to page';
        return 'Review metadata content for accuracy';
      })(),
    },
    {
      name: 'Body Content',
      status: bodyMatches.length > 0 ? 'fail' : 'pass',
      message: `Body contains ${bodyMatches.length} absolute terms`,
      location: bodyMatches.length > 0
        ? bodyMatches.map((m) => {
          const context = m.context.trim();

          // Use the same format as special characters test: "... term in context ..."
          const termIndex = context.indexOf(m.term);

          if (termIndex !== -1) {
            // Create clean context similar to special characters test
            const beforeTerm = context.substring(0, termIndex).trim();
            const afterTerm = context.substring(termIndex + m.term.length).trim();

            // Format: "... term in context ..."
            let readableContext = '';
            if (beforeTerm) {
              readableContext += `...${beforeTerm} `;
            }
            const strongStyle = 'background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;';
            readableContext += `<strong style="${strongStyle}">${m.term}</strong>`;
            if (afterTerm) {
              readableContext += ` ${afterTerm}...`;
            }

            return readableContext;
          }
          return context;
        }).join('\n• ') : 'Main content area',
      remediation: bodyMatches.length > 0 ? 'Review body content for accuracy' : 'No action needed',
    },
  ];

  // Determine overall status
  const hasAbsolutes = metadataTitleMatches.length > 0
    || metaMatches.length > 0
    || bodyMatches.length > 0;

  const overallStatus = (hasAbsolutes || !hasMetadataDiv) ? 'fail' : 'pass';

  return {
    status: overallStatus,
    message: (() => {
      if (!hasMetadataDiv) return 'No metadata div present - test cannot complete';
      if (hasAbsolutes) {
        const totalMatches = metadataTitleMatches.length + metaMatches.length + bodyMatches.length;
        const msg = `Found ${totalMatches} absolute terms in metadata, title, and body content`;
        return msg;
      }
      return 'No absolute terms detected in key content areas';
    })(),
    location: !hasMetadataDiv ? 'Page structure' : 'Title, meta tags, and body content',
    remediation: (() => {
      if (!hasMetadataDiv) return 'Add metadata div to page before running absolutes test';
      if (hasAbsolutes) {
        const message = 'Review and qualify absolute statements in title, meta tags, and body content';
        return message;
      }
      return 'No action needed';
    })(),
    subTests,
  };
}

export default async function testAbsolutes(pageSource) {
  // Execute the actual test logic
  return runTest(pageSource);
}
