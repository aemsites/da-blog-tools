async function runTest(pageSource) {
  // Parse the page source
  const parser = new DOMParser();
  const doc = parser.parseFromString(pageSource, 'text/html');

  // Load dictionary from external file
  let dictionary = new Set();
  let commonMisspellings = {};

  try {
    // Try to load the dictionary file - fix the path to point to tests directory
    const response = await fetch('./tests/dictionary.json');
    if (response.ok) {
      const dictData = await response.json();

      // Combine all word categories into one set
      if (dictData.common) dictData.common.forEach((word) => dictionary.add(word));
      if (dictData.extended) dictData.extended.forEach((word) => dictionary.add(word));
      if (dictData.custom) dictData.custom.forEach((word) => dictionary.add(word));
      if (dictData.frequent) dictData.frequent.forEach((word) => dictionary.add(word));
      if (dictData.technical) dictData.technical.forEach((word) => dictionary.add(word));

      // Check if the external dictionary has basic words - if not, use fallback
      const basicWords = ['the', 'this', 'that', 'and', 'is', 'are', 'was', 'were', 'see', 'saw', 'seen'];
      const hasBasicWords = basicWords.every((word) => dictionary.has(word));

      if (!hasBasicWords) {
        throw new Error('External dictionary inadequate - missing basic vocabulary');
      }
    } else {
      throw new Error(`Failed to load dictionary: ${response.status}`);
    }
  } catch (error) {
    // Comprehensive fallback dictionary with all basic words
    dictionary = new Set([
      // Basic articles and common words
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the', 'to', 'was', 'will', 'with',
      'this', 'these', 'those', 'here', 'there', 'where', 'when', 'why', 'how', 'what', 'which', 'who', 'whom', 'whose',
      'have', 'had', 'do', 'does', 'go', 'went', 'gone', 'see', 'saw', 'seen', 'get', 'got', 'gotten', 'make', 'made', 'take', 'took', 'taken',
      'always', 'never', 'sometimes', 'often', 'usually', 'rarely', 'definitely', 'probably', 'possibly', 'certainly', 'absolutely',
      'not', 'fail', 'sweat', 'should', 'would', 'could', 'might', 'must', 'can', 'will', 'let', 'them', 'me', 'eat', 'vegetables', 'food',
      'metadata', 'preflight', 'aem', 'website', 'content', 'navigation', 'footer', 'header', 'section', 'article', 'component', 'plugin',
      // Personal pronouns
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'him', 'her', 'us', 'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'hers', 'ours', 'theirs',
      // Common verbs
      'am', 'are', 'is', 'was', 'were', 'been', 'being', 'do', 'does', 'did', 'done', 'doing',
      'go', 'goes', 'went', 'going', 'come', 'comes', 'came', 'coming', 'get', 'gets', 'got', 'getting',
      'give', 'gives', 'gave', 'given', 'giving', 'take', 'takes', 'took', 'taken', 'taking',
      'make', 'makes', 'made', 'making', 'see', 'sees', 'saw', 'seen', 'seeing', 'know', 'knows', 'knew', 'known', 'knowing',
      'think', 'thinks', 'thought', 'thinking', 'feel', 'feels', 'felt', 'feeling', 'say', 'says', 'said', 'saying',
      'tell', 'tells', 'told', 'telling', 'let', 'lets', 'letting', 'put', 'puts', 'putting',
      'keep', 'keeps', 'kept', 'keeping', 'bring', 'brings', 'brought', 'bringing',
      'work', 'working', 'worked', 'play', 'playing', 'played', 'sleep', 'sleeping', 'slept',
      'wake', 'waking', 'woke', 'woken', 'run', 'running', 'ran', 'walk', 'walking', 'walked',
      'sit', 'sitting', 'sat', 'stand', 'standing', 'stood', 'look', 'looking', 'looked',
      'watch', 'watching', 'watched', 'listen', 'listening', 'listened', 'hear', 'hearing', 'heard',
      'speak', 'speaking', 'spoke', 'spoken', 'talk', 'talking', 'talked', 'write', 'writing', 'wrote', 'written',
      'read', 'reading', 'learn', 'learning', 'learned', 'teach', 'teaching', 'taught', 'study', 'studying', 'studied',
      'help', 'helping', 'helped', 'give', 'giving', 'gave', 'given', 'take', 'taking', 'took', 'taken',
      'buy', 'buying', 'bought', 'sell', 'selling', 'sold', 'pay', 'paying', 'paid', 'cost', 'costing',
      'start', 'starting', 'started', 'stop', 'stopping', 'stopped', 'begin', 'beginning', 'began', 'begun',
      'end', 'ending', 'ended', 'finish', 'finishing', 'finished', 'complete', 'completing', 'completed',
      'open', 'opening', 'opened', 'close', 'closing', 'closed', 'turn', 'turning', 'turned',
      'move', 'moving', 'moved', 'change', 'changing', 'changed', 'grow', 'growing', 'grew', 'grown',
      'build', 'building', 'built', 'break', 'breaking', 'broke', 'broken', 'fix', 'fixing', 'fixed',
      'clean', 'cleaning', 'cleaned', 'wash', 'washing', 'washed', 'cook', 'cooking', 'cooked',
      'drive', 'driving', 'drove', 'driven', 'fly', 'flying', 'flew', 'flown', 'swim', 'swimming', 'swam', 'swum',
      // Common nouns
      'people', 'person', 'man', 'woman', 'child', 'children', 'boy', 'girl', 'guy', 'lady', 'gentleman', 'friend', 'family',
      'home', 'house', 'room', 'door', 'window', 'car', 'food', 'water', 'book', 'paper', 'pen', 'pencil',
      'phone', 'computer', 'table', 'chair', 'bed', 'clothes', 'shoes', 'money', 'time', 'day', 'night',
      'morning', 'afternoon', 'evening', 'week', 'month', 'year', 'today', 'yesterday', 'tomorrow',
      'hour', 'minute', 'second', 'thing', 'things', 'way', 'ways', 'life', 'lives', 'world', 'hand', 'hands',
      // Common adjectives
      'good', 'bad', 'big', 'small', 'large', 'little', 'high', 'low', 'long', 'short', 'wide', 'narrow',
      'thick', 'thin', 'heavy', 'light', 'strong', 'weak', 'hot', 'cold', 'warm', 'cool', 'new', 'old', 'young',
      'fresh', 'clean', 'dirty', 'wet', 'dry', 'hard', 'soft', 'easy', 'difficult', 'simple', 'complex',
      'beautiful', 'ugly', 'pretty', 'handsome', 'nice', 'mean', 'kind', 'cruel', 'happy', 'sad', 'angry',
      'excited', 'bored', 'tired', 'awake', 'asleep', 'important', 'necessary', 'required', 'optional',
      'available', 'unavailable', 'active', 'inactive', 'enabled', 'disabled', 'visible', 'hidden',
      'public', 'private', 'secure', 'safe', 'dangerous', 'right', 'wrong', 'true', 'false', 'real', 'fake',
      // Common adverbs
      'very', 'really', 'quite', 'rather', 'too', 'so', 'just', 'only', 'even', 'still', 'also', 'well',
      'much', 'more', 'most', 'less', 'least', 'now', 'then', 'here', 'there', 'up', 'down', 'in', 'out',
      'on', 'off', 'over', 'under', 'above', 'below', 'inside', 'outside', 'near', 'far', 'close', 'away',
      'back', 'forward', 'around', 'quickly', 'slowly', 'carefully', 'easily', 'hardly', 'almost', 'nearly',
      'about', 'exactly', 'precisely', 'probably', 'possibly', 'perhaps', 'maybe', 'sometime', 'somewhere',
      'anywhere', 'everyone', 'everybody', 'everything', 'everywhere', 'someone', 'somebody', 'something',
      'somewhere', 'anyone', 'anybody', 'anything', 'anywhere', 'noone', 'nobody', 'nothing', 'nowhere',
      'okay', 'ok', 'yes', 'no', 'maybe', 'sure', 'certainly', 'absolutely', 'definitely', 'probably', 'possibly',
      // Additional common words that were being flagged
      'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred', 'thousand', 'million', 'billion',
      'first', 'last', 'next', 'previous', 'current', 'same', 'different', 'other', 'another', 'each', 'every', 'all', 'some', 'any',
      'many', 'few', 'several', 'most', 'least', 'best', 'worst', 'better', 'worse', 'good', 'bad', 'great', 'terrible',
      'big', 'small', 'large', 'tiny', 'huge', 'enormous', 'giant', 'miniature', 'short', 'tall', 'wide', 'narrow',
      'fast', 'slow', 'quick', 'rapid', 'gradual', 'sudden', 'immediate', 'delayed', 'early', 'late', 'on', 'off',
      'open', 'closed', 'locked', 'unlocked', 'full', 'empty', 'busy', 'free', 'available', 'unavailable',
      'ready', 'ready', 'finished', 'complete', 'incomplete', 'done', 'undone', 'started', 'stopped',
      'working', 'broken', 'fixed', 'clean', 'dirty', 'new', 'old', 'fresh', 'stale', 'hot', 'cold',
      'warm', 'cool', 'wet', 'dry', 'hard', 'soft', 'smooth', 'rough', 'sharp', 'dull', 'bright', 'dark',
      'light', 'heavy', 'strong', 'weak', 'powerful', 'helpless', 'safe', 'dangerous', 'secure', 'vulnerable',
      'private', 'public', 'secret', 'obvious', 'clear', 'confusing', 'simple', 'complicated', 'easy', 'difficult',
      'possible', 'impossible', 'likely', 'unlikely', 'certain', 'uncertain', 'sure', 'unsure', 'confident', 'doubtful',
    ]);
  }

  // Common misspellings and their corrections
  commonMisspellings = {
    teh: 'the',
    recieve: 'receive',
    seperate: 'separate',
    occured: 'occurred',
    accomodate: 'accommodate',
    begining: 'beginning',
    beleive: 'believe',
    calender: 'calendar',
    collegue: 'colleague',
    definately: 'definitely',
    embarass: 'embarrass',
    enviroment: 'environment',
    existance: 'existence',
    foward: 'forward',
    freind: 'friend',
    garentee: 'guarantee',
    happend: 'happened',
    immediatly: 'immediately',
    independant: 'independent',
    knowlege: 'knowledge',
    liase: 'liaise',
    lollypop: 'lollipop',
    neccessary: 'necessary',
    occassion: 'occasion',
    occurence: 'occurrence',
    pavillion: 'pavilion',
    peice: 'piece',
    persistant: 'persistent',
    posession: 'possession',
    priviledge: 'privilege',
    probaly: 'probably',
    proffesional: 'professional',
    promiss: 'promise',
    pronounciation: 'pronunciation',
    prufe: 'proof',
    publically: 'publicly',
    quater: 'quarter',
    questionaire: 'questionnaire',
    reccomend: 'recommend',
    rediculous: 'ridiculous',
    refered: 'referred',
    refering: 'referring',
    religous: 'religious',
    rember: 'remember',
    remind: 'remind',
    resistence: 'resistance',
    sence: 'sense',
    sieze: 'seize',
    similiar: 'similar',
    sincerly: 'sincerely',
    speach: 'speech',
    sucess: 'success',
    sucessful: 'successful',
    suprise: 'surprise',
    tatoo: 'tattoo',
    tendancy: 'tendency',
    therefor: 'therefore',
    threshhold: 'threshold',
    tommorow: 'tomorrow',
    tounge: 'tongue',
    truely: 'truly',
    unfortunatly: 'unfortunately',
    untill: 'until',
    wierd: 'weird',
    wherever: 'wherever',
    wich: 'which',
    whereever: 'wherever',
  };

  // Function to check if a word is spelled correctly
  function isSpelledCorrectly(word) {
    // Remove punctuation and convert to lowercase
    const cleanWord = word.toLowerCase().replace(/[^\w]/g, '');

    // Skip if empty or just punctuation
    if (!cleanWord || cleanWord.length < 2) return true;

    // Check if it's a number
    if (/^\d+$/.test(cleanWord)) return true;

    // Check if it's in our dictionary
    if (dictionary.has(cleanWord)) return true;

    // Check if it's a common misspelling
    if (commonMisspellings[cleanWord]) return true;

    // Check if it's a compound word (e.g., "webpage" = "web" + "page")
    for (let i = 1; i < cleanWord.length; i += 1) {
      const part1 = cleanWord.substring(0, i);
      const part2 = cleanWord.substring(i);
      if (dictionary.has(part1) && dictionary.has(part2)) return true;
    }

    return false;
  }

  // Function to extract words from text
  function extractWords(text) {
    return text.match(/\b\w+\b/g) || [];
  }

  // Check title content
  const title = doc.querySelector('title');
  const titleText = title ? title.textContent : '';
  const titleWords = extractWords(titleText);
  const titleMisspellings = [];

  titleWords.forEach((word) => {
    if (!isSpelledCorrectly(word)) {
      titleMisspellings.push({
        word,
        context: titleText,
        suggestion: commonMisspellings[word.toLowerCase()] || 'Check spelling',
      });
    }
  });

  // Check metadata content (excluding keys)
  const metadataDiv = doc.querySelector('div.metadata');
  const metadataMisspellings = [];

  if (metadataDiv) {
    const metadataDivs = metadataDiv.children;

    for (let i = 0; i < metadataDivs.length; i += 1) {
      const outerDiv = metadataDivs[i];
      const innerDivs = outerDiv.children;

      if (innerDivs.length === 2) {
        const keyDiv = innerDivs[0];
        const valueDiv = innerDivs[1];

        const key = keyDiv.textContent.trim();
        const value = valueDiv.textContent.trim();

        // Skip title row (already checked above)
        if (key.toLowerCase() !== 'title') {
          // Check value for misspellings
          const valueWords = extractWords(value);
          valueWords.forEach((word) => {
            if (!isSpelledCorrectly(word)) {
              metadataMisspellings.push({
                word,
                context: value,
                key,
                suggestion: commonMisspellings[word.toLowerCase()] || 'Check spelling',
              });
            }
          });
        }
      }
    }
  }

  // Check body content (excluding metadata)
  const body = doc.querySelector('body');
  const bodyMisspellings = [];

  if (body) {
    const mainContent = body.querySelector('main') || body;

    // Create a clean copy without metadata div
    const cleanMainContent = mainContent.cloneNode(true);
    const metadataDivInClone = cleanMainContent.querySelector('.metadata');
    if (metadataDivInClone) {
      metadataDivInClone.remove();
    }

    const bodyText = cleanMainContent.textContent;
    const bodyWords = extractWords(bodyText);

    bodyWords.forEach((word) => {
      if (!isSpelledCorrectly(word)) {
        bodyMisspellings.push({
          word,
          context: bodyText.substring(
            Math.max(0, bodyText.indexOf(word) - 20),
            bodyText.indexOf(word) + 30,
          ),
          suggestion: commonMisspellings[word.toLowerCase()] || 'Check spelling',
        });
      }
    });
  }

  // Create sub-tests
  const subTests = [
    {
      name: 'Title Spelling',
      status: titleMisspellings.length === 0 ? 'pass' : 'fail',
      message: titleMisspellings.length === 0
        ? 'Title spelling is correct'
        : `Title contains ${titleMisspellings.length} spelling error(s)`,
      location: titleMisspellings.length === 0 ? 'Page title'
        : titleMisspellings.map((m) => `Title: "...<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${m.word}</strong>..."`).join('\n• '),
      remediation: titleMisspellings.length === 0 ? 'No action needed'
        : 'Correct spelling errors in page title',
    },
    {
      name: 'Metadata Spelling',
      status: metadataMisspellings.length === 0 ? 'pass' : 'fail',
      message: metadataMisspellings.length === 0
        ? 'Metadata spelling is correct'
        : `${metadataMisspellings.length} spelling error(s) found in metadata`,
      location: metadataMisspellings.length === 0 ? 'Metadata section'
        : metadataMisspellings.map((m) => `${m.key}: "...<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${m.word}</strong>..."`).join('\n• '),
      remediation: metadataMisspellings.length === 0 ? 'No action needed'
        : 'Correct spelling errors in metadata values',
    },
    {
      name: 'Body Content Spelling',
      status: bodyMisspellings.length === 0 ? 'pass' : 'fail',
      message: bodyMisspellings.length === 0
        ? 'Body content spelling is correct'
        : `Body content contains ${bodyMisspellings.length} spelling error(s)`,
      location: bodyMisspellings.length === 0 ? 'Main content area'
        : bodyMisspellings.map((m) => {
          // Use the same highlighting style as other tests
          const context = m.context.trim();
          const wordIndex = context.indexOf(m.word);
          if (wordIndex !== -1) {
            const beforeWord = context.substring(0, wordIndex).trim();
            const afterWord = context.substring(wordIndex + m.word.length).trim();

            let readableContext = '';
            if (beforeWord) {
              readableContext += `...${beforeWord} `;
            }
            readableContext += `<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${m.word}</strong>`;
            if (afterWord) {
              readableContext += ` ${afterWord}...`;
            }
            return readableContext;
          }
          return `"...<strong style="background-color: #ffeb3b; padding: 2px 4px; border-radius: 3px;">${m.word}</strong>..."`;
        }).join('\n• '),
      remediation: bodyMisspellings.length === 0 ? 'No action needed'
        : 'Correct spelling errors in body content',
    },
  ];

  // Determine overall status
  const totalMisspellings = titleMisspellings.length
    + metadataMisspellings.length
    + bodyMisspellings.length;
  const overallStatus = totalMisspellings === 0 ? 'pass' : 'fail';

  return {
    status: overallStatus,
    message: totalMisspellings === 0
      ? 'All content spelling is correct'
      : `Found ${totalMisspellings} spelling error(s) across title, metadata, and body content`,
    location: totalMisspellings === 0 ? 'All content areas' : 'Title, metadata, and body content',
    remediation: totalMisspellings === 0 ? 'No action needed'
      : 'Review and correct all spelling errors identified in the sub-tests',
    subTests,
  };
}

export default async function testSpelling(pageSource) {
  // Execute the actual test logic
  return runTest(pageSource);
}
