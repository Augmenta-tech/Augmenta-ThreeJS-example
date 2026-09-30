import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConnectionTargets } from '../src/connection.js';

function urls(address, protocol = 'http:') {
  return buildConnectionTargets(address, 6060, protocol).map((target) => target.url);
}

test('simple hostnames try useful local-network suffixes before giving up', () => {
  assert.deepEqual(urls('augmenta-WA12031'), [
    'ws://augmenta-WA12031:6060',
    'ws://augmenta-WA12031.local:6060',
    'ws://augmenta-WA12031.home:6060',
    'ws://augmenta-WA12031.home.arpa:6060',
    'wss://augmenta-WA12031:6060',
    'wss://augmenta-WA12031.local:6060',
    'wss://augmenta-WA12031.home:6060',
    'wss://augmenta-WA12031.home.arpa:6060'
  ]);

  assert.equal(urls('surface-david-2')[1], 'ws://surface-david-2.local:6060');
  assert.equal(urls('surface-david-2')[2], 'ws://surface-david-2.home:6060');
});

test('localhost prefers IPv4 and keeps hostname/IPv6 fallbacks', () => {
  assert.deepEqual(urls('localhost'), [
    'ws://127.0.0.1:6060',
    'ws://localhost:6060',
    'ws://[::1]:6060',
    'wss://127.0.0.1:6060',
    'wss://localhost:6060',
    'wss://[::1]:6060'
  ]);
});

test('qualified hostnames and IP addresses are used as-is', () => {
  assert.deepEqual(urls('surface-david-2.home'), [
    'ws://surface-david-2.home:6060',
    'wss://surface-david-2.home:6060'
  ]);
  assert.deepEqual(urls('192.168.1.200'), [
    'ws://192.168.1.200:6060',
    'wss://192.168.1.200:6060'
  ]);
});

test('HTTPS pages prefer secure WebSockets before the ws fallback', () => {
  assert.deepEqual(urls('augmenta-WA12031.local', 'https:'), [
    'wss://augmenta-WA12031.local:6060',
    'ws://augmenta-WA12031.local:6060'
  ]);
});
