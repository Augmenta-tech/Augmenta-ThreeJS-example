import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Container, ContainerType, ShapeType, ZoneParameters
} from 'augmenta-client-sdk';
import { createSetupStore } from '../src/setup-store.js';

function zone(address, position = [1, 0, 1]) {
  return new Container(
    ContainerType.Zone,
    'Zone',
    address,
    position,
    [0, 0, 0],
    [1, 1, 1, 1],
    new ZoneParameters(ShapeType.Box, { size: [2, 1, 2] }),
    []
  );
}

function scene(address, size = [10, 3, 8], children = []) {
  return new Container(
    ContainerType.Scene,
    'Scene',
    address,
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1, 1],
    { size },
    children
  );
}

function world(children) {
  return new Container(
    ContainerType.World,
    'World',
    '',
    [0, 0, 0],
    [0, 0, 0],
    [1, 1, 1, 1],
    {},
    children
  );
}

test('Scene updates preserve existing Zone children', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/world/scene', [10, 3, 8], [zone('/world/scene/zone')])]));

  store.applyUpdate(scene('/world/scene', [12, 4, 9]));

  const updatedScene = store.getScenes()[0];
  assert.deepEqual(updatedScene.getSceneParameters().size, [12, 4, 9]);
  assert.equal(updatedScene.getChildren().length, 1);
  assert.equal(updatedScene.getChildren()[0].getAddress(), '/world/scene/zone');
});

test('Zone updates replace only the matching Zone', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/world/scene', [10, 3, 8], [
    zone('/world/scene/a', [1, 0, 1]),
    zone('/world/scene/b', [2, 0, 2])
  ])]));

  store.applyUpdate(zone('/world/scene/a', [5, 0, 6]));

  const zones = store.getScenes()[0].getChildren();
  assert.deepEqual(zones[0].getPosition(), [5, 0, 6]);
  assert.deepEqual(zones[1].getPosition(), [2, 0, 2]);
});

test('New Zone updates attach to the deepest matching parent', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/world/scene')]));

  store.applyUpdate(zone('/world/scene/new-zone', [3, 0, 4]));

  const zones = store.getScenes()[0].getChildren();
  assert.equal(zones.length, 1);
  assert.equal(zones[0].getAddress(), '/world/scene/new-zone');
});


test('Address index follows merged setup updates', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/world/scene', [10, 3, 8], [
    zone('/world/scene/a', [1, 0, 1])
  ])]));

  assert.equal(store.getByAddress('/world/scene/a').getName(), 'Zone');

  store.applyUpdate(zone('/world/scene/a', [7, 0, 8]));

  assert.deepEqual(
    store.getByAddress('/world/scene/a').getPosition(),
    [7, 0, 8]
  );
});
