import assert from 'node:assert/strict';
import test from 'node:test';
import { makeDemoSetup } from '../src/demo.js';

test('demo setup uses the same World -> Scene hierarchy as live setup', () => {
  const root = makeDemoSetup().getRootObject();

  assert.equal(root.isWorld(), true);
  assert.equal(root.getChildren().length, 1);

  const scene = root.getChildren()[0];
  assert.equal(scene.isScene(), true);
  assert.equal(scene.getAddress(), '/Demo');
  assert.equal(scene.getChildren().length, 2);
  assert.equal(scene.getChildren().every((child) => child.isZone()), true);
});
