import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Container, ContainerType, ShapeType, ZoneParameters
} from 'augmenta-client-sdk';
import { createSetupStore } from '../src/setup-store.js';

function zone(
  address,
  position = [1, 0, 1],
  size = [2, 1, 2],
  rotation = [0, 0, 0]
) {
  return new Container(
    ContainerType.Zone,
    'Zone',
    address,
    position,
    rotation,
    [1, 1, 1, 1],
    new ZoneParameters(ShapeType.Box, { size }),
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

test('Zone geometry updates propagate without changing siblings', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/world/scene', [10, 3, 8], [
    zone('/world/scene/a'),
    zone('/world/scene/b', [2, 0, 2])
  ])]));

  store.applyUpdate(zone(
    '/world/scene/a',
    [4, 0, 5],
    [4, 2, 3],
    [0, 35, 0]
  ));

  const zones = store.getScenes()[0].getChildren();
  assert.deepEqual(zones[0].getPosition(), [4, 0, 5]);
  assert.deepEqual(zones[0].getRotation(), [0, 35, 0]);
  assert.deepEqual(zones[0].getZoneParameters().getBoxShapeParameters().size, [4, 2, 3]);
  assert.deepEqual(zones[1].getPosition(), [2, 0, 2]);
  assert.deepEqual(zones[1].getZoneParameters().getBoxShapeParameters().size, [2, 1, 2]);
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

test('Partial Zone updates are ignored until a hierarchy root exists', () => {
  const store = createSetupStore();

  assert.equal(store.applyUpdate(zone('/world/scene/a', [5, 0, 6])), undefined);
  assert.equal(store.getRoot(), undefined);
  assert.equal(store.getByAddress('/world/scene/a'), undefined);

  store.setRoot(world([scene('/world/scene', [10, 3, 8], [
    zone('/world/scene/a', [1, 0, 1])
  ])]));

  store.applyUpdate(zone('/world/scene/a', [5, 0, 6]));
  assert.deepEqual(store.getByAddress('/world/scene/a').getPosition(), [5, 0, 6]);
});

test('Parent subtree updates replace renamed children without duplicates', () => {
  const store = createSetupStore();
  store.setRoot(world([scene('/children/scene', [10, 3, 8], [
    zone('/children/scene/children/oldZone', [1, 0, 1])
  ])]));

  store.applyUpdate(scene('/children/scene', [10, 3, 8], [
    zone('/children/scene/children/newZone', [1, 0, 1])
  ]));

  const children = store.getScenes()[0].getChildren();
  assert.equal(children.length, 1);
  assert.equal(children[0].getAddress(), '/children/scene/children/newZone');
  assert.equal(store.getByAddress('/children/scene/children/oldZone'), undefined);
});
