# Media Library Plugin - Local Build Instructions

## Problem
The unbundled `media-library.js` uses bare specifier `da-lit` which requires import maps.
When loaded cross-origin, import maps don't apply → module resolution fails.

## Solution
Create a bundled version that:
1. Bundles Lit and all JS dependencies
2. Uses absolute URLs for CSS/icons pointing to https://da.live/nx/...

## Build Steps (to run in da-nx repo)

```bash
cd /Users/kiranm/MySpace/Franklin/da/da-nx/nx/blocks/media-library

# Create build script
cat > build-plugin.js << 'EOF'
import esbuild from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const resolveDaLitPlugin = {
  name: 'resolve-da-lit',
  setup(build) {
    build.onResolve({ filter: /^da-lit$/ }, () => ({
      path: resolve(__dirname, '../../deps/ml-lit/dist/index.js'),
    }));
  },
};

await esbuild.build({
  entryPoints: [resolve(__dirname, 'media-library.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  outfile: resolve(__dirname, 'media-library-plugin.js'),
  plugins: [resolveDaLitPlugin],
  banner: {
    js: '/* eslint-disable */',
  },
  logLevel: 'info',
});

console.log('✅ Built: media-library-plugin.js');
EOF

# Run build (requires Node.js with esbuild available)
node build-plugin.js

# Copy to plugin folder
cp media-library-plugin.js /Users/kiranm/MySpace/Franklin/da/da-blog-tools/tools/plugins/media-library/
```

## Update HTML

```html
<script type="module">
  import DA_SDK from 'https://da.live/nx/utils/sdk.js';
  import './media-library-plugin.js';

  const { context } = await DA_SDK;
  await customElements.whenDefined('nx-media-library');

  const ml = document.getElementById('ml');
  ml.sitePath = `/${context.org}/${context.repo}`;
</script>
```

## Current Status
- CSS/icons still load from relative paths → need to modify source to use absolute https://da.live/... URLs
- IMS config missing → component expects Nexter environment

##Next Steps
1. Build bundle locally in da-nx
2. Copy to plugin folder
3. Test and iterate
