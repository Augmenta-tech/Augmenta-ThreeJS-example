import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compressedFixture = Uint8Array.from([
  40, 181, 47, 253, 4, 88, 241, 0, 0, 65, 117, 103, 109, 101, 110, 116,
  97, 32, 90, 115, 116, 100, 32, 105, 110, 116, 101, 103, 114, 97, 116, 105,
  111, 110, 32, 116, 101, 115, 116, 185, 49, 3, 224
]);

test('bundled zstd decoder can decode Augmenta binary payloads synchronously after init', async () => {
  const { ZSTDDecoder } = await import('zstddec');
  const decoder = new ZSTDDecoder();
  await decoder.init();

  const decoded = decoder.decode(compressedFixture);
  assert.equal(new TextDecoder().decode(decoded), 'Augmenta Zstd integration test');

  // The SDK requires a synchronous decompressor once the transport is running.
  const decompressor = (data) => decoder.decode(data);
  assert.equal(
    new TextDecoder().decode(decompressor(compressedFixture)),
    'Augmenta Zstd integration test'
  );
});

test('Three.js runtime requests compression and ships the decoder in the Pages artifact', () => {
  const connection = readFileSync(new URL('../src/connection.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const assemble = readFileSync(new URL('../scripts/assemble-site.mjs', import.meta.url), 'utf8');

  assert.match(connection, /useCompression:\s*true/);
  assert.match(connection, /decompressor,/);
  assert.match(connection, /import\('zstddec'\)/);
  assert.match(index, /zstddec@0\.3\.1\\/\\+esm/);
  assert.match(assemble, /zstdEntrypointRelative/);
});
