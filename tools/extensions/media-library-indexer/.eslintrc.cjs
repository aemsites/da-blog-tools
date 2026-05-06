module.exports = {
  root: true,
  extends: [
    'airbnb-base',
  ],
  env: {
    browser: true,
    webextensions: true, // Chrome extension globals
  },
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  ignorePatterns: ['dist/**'],
  rules: {
    'no-console': 'off', // Console statements are acceptable in extensions
    'no-param-reassign': ['error', { props: false }], // Allow modifying object properties
    'no-use-before-define': ['error', { functions: false }], // Allow function hoisting
    'no-restricted-syntax': 'off', // Allow for-of loops
    'no-await-in-loop': 'off', // Sequential async operations are sometimes needed
    'import/prefer-default-export': 'off', // Named exports are fine
    'import/extensions': ['error', 'always', { ignorePackages: true }],
    'import/no-unresolved': ['error', {
      ignore: ['^https://'], // Allow CDN imports
    }],
    'import/order': ['error', {
      groups: [
        'builtin',
        'external',
        'internal',
        'parent',
        'sibling',
        'index',
      ],
      pathGroups: [
        {
          pattern: 'https://**',
          group: 'external',
          position: 'after',
        },
      ],
      'newlines-between': 'never',
    }],
  },
};
