import assert from 'node:assert/strict';
import test from 'node:test';
import { readZoneEventState } from '../src/zone-state.js';

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
