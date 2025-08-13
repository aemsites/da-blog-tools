const fs = require('fs');
const https = require('https');

console.log('Building comprehensive English dictionary...');

// Download a comprehensive English dictionary
https.get('https://raw.githubusercontent.com/dwyl/english-words/master/words_dictionary.json', (response) => {
    let data = '';
    
    response.on('data', (chunk) => {
        data += chunk;
    });
    
    response.on('end', () => {
        try {
            const rawDict = JSON.parse(data);
            const words = Object.keys(rawDict).filter(word => word.length > 1);
            
            console.log(`Downloaded ${words.length} words from source`);
            
            // Organize into categories
            const dictionary = {
                common: words.slice(0, 15000),      // Most common words
                extended: words.slice(15000, 50000), // Extended vocabulary
                custom: [                           // Your domain-specific words
                    'metadata', 'preflight', 'aem', 'website', 'content', 'navigation',
                    'footer', 'header', 'section', 'article', 'component', 'plugin',
                    'configuration', 'testing', 'validation', 'quality', 'accessibility',
                    'always', 'never', 'sometimes', 'often', 'usually', 'rarely',
                    'definitely', 'probably', 'possibly', 'certainly', 'absolutely',
                    'not', 'fail', 'sweat', 'should', 'would', 'could', 'might', 'must', 'can', 'will',
                    'let', 'them', 'me', 'eat', 'vegetables', 'food', 'work', 'play', 'sleep',
                    'run', 'walk', 'sit', 'stand', 'look', 'watch', 'listen', 'hear',
                    'speak', 'talk', 'write', 'read', 'learn', 'teach', 'study',
                    'help', 'give', 'take', 'buy', 'sell', 'pay', 'cost',
                    'start', 'stop', 'begin', 'end', 'finish', 'complete',
                    'open', 'close', 'turn', 'move', 'change', 'grow',
                    'build', 'break', 'fix', 'clean', 'wash', 'cook',
                    'drive', 'fly', 'swim', 'okay', 'ok', 'yes', 'no', 'maybe', 'sure'
                ]
            };
            
            // Save to file
            fs.writeFileSync('dictionary.json', JSON.stringify(dictionary, null, 2));
            
            console.log('\n✅ Dictionary created successfully!');
            console.log('Categories:', {
                common: dictionary.common.length,
                extended: dictionary.extended.length,
                custom: dictionary.custom.length
            });
            console.log(`Total words: ${Object.values(dictionary).flat().length}`);
            console.log('\n📁 Files created:');
            console.log('  - dictionary.json (your comprehensive dictionary)');
            console.log('\n🚀 Next steps:');
            console.log('  1. Update spellingTest.js to use this dictionary');
            console.log('  2. Run your spelling test again');
            
        } catch (error) {
            console.error('❌ Error processing dictionary:', error.message);
        }
    });
}).on('error', (error) => {
    console.error('❌ Error downloading dictionary:', error.message);
    console.log('\n💡 Alternative: You can manually download from:');
    console.log('   https://raw.githubusercontent.com/dwyl/english-words/master/words_dictionary.json');
});
