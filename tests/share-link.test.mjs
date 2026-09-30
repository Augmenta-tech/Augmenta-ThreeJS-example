import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildConnectionShareUrl,
  readConnectionOptionsFromUrl
} from '../src/share-link.js';

test('connection share URL preserves the page and embeds current connection options', () => {
  const url = buildConnectionShareUrl(
    'https://augmenta-tech.github.io/Augmenta-ThreeJS-example/?foo=bar#debug',
    {
      address: '192.168.1.42',
      port: '6060',
      protocol: '3',
      downsample: '2'
    }
  );

  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://augmenta-tech.github.io/Augmenta-ThreeJS-example/');
  assert.equal(parsed.searchParams.get('foo'), 'bar');
  assert.equal(parsed.searchParams.get('address'), '192.168.1.42');
  assert.equal(parsed.searchParams.get('port'), '6060');
  assert.equal(parsed.searchParams.get('protocol'), '3');
  assert.equal(parsed.searchParams.get('downsample'), '2');
  assert.equal(parsed.hash, '');
});

test('connection options in a shared URL are validated', () => {
  assert.deepEqual(
    readConnectionOptionsFromUrl(
      'https://example.test/?address=augmenta-WA12031.local&port=6060&protocol=auto&downsample=4'
    ),
    {
      address: 'augmenta-WA12031.local',
      port: '6060',
      protocol: 'auto',
      downsample: '4'
    }
  );

  assert.deepEqual(
    readConnectionOptionsFromUrl(
      'https://example.test/?address=%20&port=70000&protocol=9&downsample=0'
    ),
    {}
  );
});

test('regenerating a share URL replaces stale connection query values', () => {
  const url = buildConnectionShareUrl(
    'https://example.test/?address=old&port=1&protocol=2&downsample=99',
    {
      address: '10.0.0.5',
      port: 6060,
      protocol: 'auto',
      downsample: 1
    }
  );

  assert.deepEqual(readConnectionOptionsFromUrl(url), {
    address: '10.0.0.5',
    port: '6060',
    protocol: 'auto',
    downsample: '1'
  });
});
