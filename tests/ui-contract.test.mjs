import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('every ui.<name> reference is declared in the main UI map', () => {
  const objectMatch = mainSource.match(/const ui = \{([\s\S]*?)\n\};/);
  assert.ok(objectMatch, 'main.js must define the ui map');

  const declared = new Set(
    [...objectMatch[1].matchAll(/\b([A-Za-z_$][\w$]*):\s*\$\(/g)]
      .map((match) => match[1])
  );
  const used = new Set(
    [...mainSource.matchAll(/\bui\.([A-Za-z_$][\w$]*)/g)]
      .map((match) => match[1])
  );

  const missing = [...used].filter((name) => !declared.has(name));
  assert.deepEqual(missing, []);
});

test('every hard-coded #id selector in the main UI map exists in index.html', () => {
  const ids = [...mainSource.matchAll(/\$\('#([^']+)'\)/g)].map((match) => match[1]);

  const missing = ids.filter((id) => {
    const escaped = id.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    return !new RegExp('id=["\\\']' + escaped + '["\\\']').test(indexSource);
  });

  assert.deepEqual(missing, []);
});


test('Display shows the current World as a read-only field above Scenes', () => {
  const display = indexSource.match(/<details id="display-section"[\s\S]*?<\/details>/)?.[0];
  assert.ok(display, 'Display panel must exist');

  const field = display.match(/<input[^>]*id="world-name"[^>]*>/)?.[0];
  assert.ok(field, 'World field must exist');
  assert.match(field, /\breadonly\b/);
  assert.ok(display.indexOf('id="world-name"') < display.indexOf('id="scenes"'));

  const sync = mainSource.match(/function syncSceneSelector\(\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(sync, 'scene selector synchronization must exist');
  assert.match(sync, /setupStore\.getRoot\(\)/);
  assert.match(sync, /ui\.worldName\.value\s*=/);
  assert.match(sync, /world\.getName\(\)/);
});
