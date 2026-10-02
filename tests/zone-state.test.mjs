import assert from 'node:assert/strict';
import test from 'node:test';
import { collectZoneAddresses, isZoneStreamFresh, readZoneEventState, zonePresencePulseDirection, ZONE_STREAM_STALE_MS } from '../src/zone-state.js';

function slider(value) {
  return {
    isSlider: () => true,
    isXYPad: () => false,
    getSliderParameters: () => ({ value })
  };
}

function xyPad(x, y) {
  return {
    isSlider: () => false,
    isXYPad: () => true,
    getXYPadParameters: () => ({ x, y })
  };
}

test('zone event state is complete before a renderer view exists', () => {
  const state = readZoneEventState({
    getEmitterZoneAddress: () => '/scene/zone',
    getPresence: () => 3,
    getProperties: () => [slider(0.42), xyPad(0.25, 0.75)]
  });

  assert.deepEqual(state, {
    address: '/scene/zone',
    presence: 3,
    slider: 0.42,
    xyPad: { x: 0.25, y: 0.75 }
  });
});

test('missing optional zone properties stay undefined', () => {
  const state = readZoneEventState({
    getEmitterZoneAddress: () => '/scene/zone',
    getPresence: () => 0,
    getProperties: () => []
  });

  assert.equal(state.slider, undefined);
  assert.equal(state.xyPad, undefined);
});


test('zone address collection follows the full setup hierarchy', () => {
  const node = (address, zone, children = []) => ({
    isZone: () => zone,
    getAddress: () => address,
    getChildren: () => children
  });

  const root = node('', false, [
    node('/scene-a', false, [
      node('/scene-a/zone-1', true),
      node('/scene-a/group', false, [
        node('/scene-a/group/zone-2', true)
      ])
    ]),
    node('/scene-b', false, [
      node('/scene-b/zone-3', true)
    ])
  ]);

  assert.deepEqual(
    [...collectZoneAddresses(root)].sort(),
    ['/scene-a/group/zone-2', '/scene-a/zone-1', '/scene-b/zone-3']
  );
});


test('zone stream stale grace period stays at 50 ms', () => {
  assert.equal(ZONE_STREAM_STALE_MS, 50);
});

test('zone stream stays visible only within the stale grace period', () => {
  const lastSeenAt = 1000;

  assert.equal(isZoneStreamFresh(lastSeenAt, lastSeenAt), true);
  assert.equal(
    isZoneStreamFresh(lastSeenAt, lastSeenAt + ZONE_STREAM_STALE_MS),
    true
  );
  assert.equal(
    isZoneStreamFresh(lastSeenAt, lastSeenAt + ZONE_STREAM_STALE_MS + 1),
    false
  );
  assert.equal(isZoneStreamFresh(undefined, lastSeenAt), false);
});


test('presence pop direction follows increases and decreases including zero', () => {
  assert.equal(zonePresencePulseDirection(0, 1), 1);
  assert.equal(zonePresencePulseDirection(1, 2), 1);
  assert.equal(zonePresencePulseDirection(2, 1), -1);
  assert.equal(zonePresencePulseDirection(1, 0), -1);
  assert.equal(zonePresencePulseDirection(2, 2), 0);
});
