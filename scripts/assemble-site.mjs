import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, '_site');
const rev = (process.env.GITHUB_SHA || 'local').slice(0, 12);
const threeRoot = join(root, '.pages-runtime', 'node_modules', 'three');
const sdkOut = join(out, 'vendor', 'AugmentaClientSDK-JS', rev, 'dist', 'esm');

function requirePath(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

function replaceRequired(source, search, replacement) {
  if (!source.includes(search)) {
    throw new Error(`Missing expected build token: ${search}`);
  }
  return source.replaceAll(search, replacement);
}

requirePath(join(root, 'vendor', 'AugmentaClientSDK-JS', 'dist', 'esm'), 'built Augmenta SDK');
requirePath(join(root, 'vendor', 'qrcode-generator', 'qrcode.js'), 'vendored QR generator');
requirePath(join(threeRoot, 'build', 'three.module.js'), 'Three.js runtime');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'src'), { recursive: true });
mkdirSync(sdkOut, { recursive: true });
mkdirSync(join(out, 'vendor', 'qrcode-generator'), { recursive: true });

copyFileSync(join(root, 'index.html'), join(out, 'index.html'));
copyFileSync(join(root, 'augmenta-favicon.png'), join(out, 'augmenta-favicon.png'));

for (const name of readdirSync(join(root, 'src'))) {
  if (!name.endsWith('.js') && name !== 'styles.css') continue;
  copyFileSync(join(root, 'src', name), join(out, 'src', name));
}

// Put the SDK under a revisioned directory rather than versioning only its
// entrypoint with a query string. Its internal relative imports then inherit
// the revisioned path too, so a deployment cannot mix old/new SDK modules.
cpSync(
  join(root, 'vendor', 'AugmentaClientSDK-JS', 'dist', 'esm'),
  sdkOut,
  { recursive: true }
);
copyFileSync(
  join(root, 'vendor', 'qrcode-generator', 'qrcode.js'),
  join(out, 'vendor', 'qrcode-generator', 'qrcode.js')
);

// Keep the live Pages app runtime self-contained. A full refresh with an empty
// browser cache must not wait on jsDelivr before the app/QR can initialize.
const threeOut = join(out, 'vendor', 'three', rev);
mkdirSync(threeOut, { recursive: true });
mkdirSync(join(threeOut, 'examples', 'jsm'), { recursive: true });
cpSync(join(threeRoot, 'build'), join(threeOut, 'build'), { recursive: true });
cpSync(
  join(threeRoot, 'examples', 'jsm', 'controls'),
  join(threeOut, 'examples', 'jsm', 'controls'),
  { recursive: true }
);
cpSync(
  join(threeRoot, 'examples', 'jsm', 'lines'),
  join(threeOut, 'examples', 'jsm', 'lines'),
  { recursive: true }
);

const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
html = replaceRequired(
  html,
  '  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n',
  ''
);
html = replaceRequired(
  html,
  'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js',
  `./vendor/three/${rev}/build/three.module.js`
);
html = replaceRequired(
  html,
  'https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/',
  `./vendor/three/${rev}/examples/jsm/`
);
html = replaceRequired(
  html,
  './vendor/AugmentaClientSDK-JS/dist/esm/index.js',
  `./vendor/AugmentaClientSDK-JS/${rev}/dist/esm/index.js`
);
html = replaceRequired(html, './src/styles.css', `./src/styles.css?v=${rev}`);
html = replaceRequired(html, './src/qr.js', `./src/qr.js?v=${rev}`);
html = replaceRequired(html, './src/main.js', `./src/main.js?v=${rev}`);

if (html.includes('cdn.jsdelivr.net')) {
  throw new Error('Built Pages index still contains a runtime CDN dependency.');
}
writeFileSync(indexPath, html);

for (const name of readdirSync(join(out, 'src')).filter((name) => name.endsWith('.js'))) {
  const path = join(out, 'src', name);
  const source = readFileSync(path, 'utf8').replace(
    /(from\s+['"])(\.\.?(?:\/[^'"]+)+\.js)(['"])/g,
    `$1$2?v=${rev}$3`
  );
  writeFileSync(path, source);
}

writeFileSync(join(out, '.nojekyll'), '');
console.log(`Assembled self-contained Pages artifact for revision ${rev}`);
