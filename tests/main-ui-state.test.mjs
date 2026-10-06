import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('main UI persistence does not reference the removed Display advanced panel', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /ui\.displayAdvanced/);
  assert.doesNotMatch(source, /displayAdvanced:\s*ui\.displayAdvanced/);
});
