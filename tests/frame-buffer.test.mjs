import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ClusterProperty,
  ClusterState,
  DataBlob,
  ObjectPacket,
  PointCloudProperty,
  SceneInfoPacket,
  ZoneEventPacket,
  ZoneEventProperty,
  ZonePropertyType
} from 'augmenta-client-sdk';
import { conflateTrackingFrames } from '../src/frame-buffer.js';

function cluster(state, x = 0) {
  return new ClusterProperty(
    state,
    [x, 0, 0],
    [x, 0, 0],
    [x, 0, 0],
    [1, 1, 1],
    1,
    [0, 0, 0, 1],
    [0, 0, 1]
  );
}

function frame({ objects = [], zones = [] } = {}) {
  return new DataBlob(new SceneInfoPacket('/Scene'), objects, zones, 123);
}

test('conflation keeps newest continuous object data while preserving Entered', () => {
  const oldCloud = new PointCloudProperty(new Float32Array([1, 2, 3, 4, 5, 6]));
  const newCloud = new PointCloudProperty(new Float32Array([7, 8, 9]));

  const previous = frame({
    objects: [new ObjectPacket(7, cluster(ClusterState.Entered, 1), oldCloud, 'uuid-7')]
  });
  const incoming = frame({
    objects: [new ObjectPacket(7, cluster(ClusterState.Updated, 2), newCloud, 'uuid-7')]
  });

  const merged = conflateTrackingFrames(previous, incoming);
  assert.equal(merged.getObjectCount(), 1);

  const object = merged.getObjects()[0];
  assert.equal(object.getCluster().getState(), ClusterState.Entered);
  assert.deepEqual(object.getCluster().getCentroid(), [2, 0, 0]);
  assert.equal(object.getPointCloud(), newCloud);
  assert.notEqual(object.getPointCloud(), oldCloud);
});

test('conflation preserves a leaving object without retaining its old point cloud', () => {
  const previous = frame({
    objects: [
      new ObjectPacket(
        9,
        cluster(ClusterState.WillLeave, 3),
        new PointCloudProperty(new Float32Array(30_000)),
        'uuid-9'
      )
    ]
  });

  const merged = conflateTrackingFrames(previous, frame());
  assert.equal(merged.getObjectCount(), 1);
  assert.equal(merged.getObjects()[0].getCluster().getState(), ClusterState.WillLeave);
  assert.equal(merged.getObjects()[0].hasPointCloud(), false);
});

test('conflation accumulates zone edges but keeps newest continuous zone values', () => {
  const oldProperties = [
    new ZoneEventProperty(ZonePropertyType.Slider, { value: 0.2 })
  ];
  const newProperties = [
    new ZoneEventProperty(ZonePropertyType.Slider, { value: 0.8 })
  ];

  const previous = frame({
    zones: [new ZoneEventPacket('/Scene/Zone', 2, 1, 1, 0.25, oldProperties)]
  });
  const incoming = frame({
    zones: [new ZoneEventPacket('/Scene/Zone', 3, 4, 5, 0.75, newProperties)]
  });

  const merged = conflateTrackingFrames(previous, incoming);
  const zone = merged.getZoneEvents()[0];

  assert.equal(zone.getEnters(), 5);
  assert.equal(zone.getLeaves(), 5);
  assert.equal(zone.getPresence(), 5);
  assert.equal(zone.getDensity(), 0.75);
  assert.equal(zone.getProperties()[0].getSliderParameters().value, 0.8);
});

test('zone edge counters saturate at the protocol byte range', () => {
  const previous = frame({
    zones: [new ZoneEventPacket('/Scene/Zone', 250, 250, 1, 1, [])]
  });
  const incoming = frame({
    zones: [new ZoneEventPacket('/Scene/Zone', 20, 20, 1, 1, [])]
  });

  const zone = conflateTrackingFrames(previous, incoming).getZoneEvents()[0];
  assert.equal(zone.getEnters(), 255);
  assert.equal(zone.getLeaves(), 255);
});
