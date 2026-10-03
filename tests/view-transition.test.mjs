import assert from 'node:assert/strict';
import test from 'node:test';
import { VIEW_TRANSITION, viewTransitionEase } from '../src/view-transition.js';

test('ViewCube transition definition stays internally consistent', () => {
  assert.equal(VIEW_TRANSITION.durationMs, 320);
  assert.equal(
    VIEW_TRANSITION.cssEasing,
    `cubic-bezier(${VIEW_TRANSITION.bezier.join(', ')})`
  );
});

test('ViewCube easing preserves endpoints and stays monotonic', () => {
  const samples = Array.from({ length: 21 }, (_, index) => viewTransitionEase(index / 20));

  assert.equal(samples[0], 0);
  assert.equal(samples.at(-1), 1);

  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index] >= samples[index - 1]);
  }

  assert.ok(viewTransitionEase(0.5) > 0.5);
});
