import {
  ClusterProperty,
  ClusterState,
  DataBlob,
  ObjectPacket,
  ZoneEventPacket
} from 'augmenta-client-sdk';

const MAX_ZONE_EDGE_COUNT = 255;

function objectIdentity(object) {
  const uuid = object.getUUID();
  if (uuid) return `uuid:${uuid}`;

  const id = object.getID();
  return id === undefined ? undefined : `id:${id}`;
}

function isTransientClusterState(state) {
  return state === ClusterState.Entered
    || state === ClusterState.WillLeave
    || state === ClusterState.Ghost;
}

function cloneClusterWithState(cluster, state) {
  return new ClusterProperty(
    state,
    cluster.getCentroid(),
    cluster.getVelocity(),
    cluster.getBoundingBoxCenter(),
    cluster.getBoundingBoxSize(),
    cluster.getWeight(),
    cluster.boundingBoxRotation,
    cluster.getLookAt()
  );
}

function objectWithClusterState(object, state) {
  const cluster = cloneClusterWithState(object.getCluster(), state);
  return new ObjectPacket(
    object.getID(),
    cluster,
    object.hasPointCloud() ? object.getPointCloud() : undefined,
    object.getUUID()
  );
}

function transientOnlyObject(object) {
  return new ObjectPacket(
    object.getID(),
    object.getCluster(),
    undefined,
    object.getUUID()
  );
}

function saturatingAdd(a, b) {
  return Math.min(MAX_ZONE_EDGE_COUNT, Math.max(0, Number(a) || 0) + Math.max(0, Number(b) || 0));
}

/**
 * Conflate two tracking frames from the same scene.
 *
 * Continuous state comes from the newest frame. Cluster transition states and
 * zone enter/leave counters from the replaced frame are preserved without
 * retaining its point clouds.
 */
export function conflateTrackingFrames(previous, incoming) {
  if (!previous) return incoming;
  if (!incoming) return previous;

  const previousScene = previous.getSceneInfo().getAddress() || '';
  const incomingScene = incoming.getSceneInfo().getAddress() || '';
  if (previousScene !== incomingScene) return incoming;

  const objects = [...incoming.getObjects()];
  const incomingByIdentity = new Map();

  objects.forEach((object, index) => {
    const key = objectIdentity(object);
    if (key) incomingByIdentity.set(key, index);
  });

  for (const previousObject of previous.getObjects()) {
    if (!previousObject.hasCluster()) continue;

    const previousState = previousObject.getCluster().getState();
    if (!isTransientClusterState(previousState)) continue;

    const key = objectIdentity(previousObject);
    if (!key) continue;

    const incomingIndex = incomingByIdentity.get(key);
    if (incomingIndex === undefined) {
      // Keep the edge state for one render tick, but explicitly drop the old
      // point cloud so conflation never retains a stale heavy buffer.
      objects.push(transientOnlyObject(previousObject));
      continue;
    }

    const incomingObject = objects[incomingIndex];
    if (!incomingObject.hasCluster()) continue;

    const incomingState = incomingObject.getCluster().getState();
    if (!isTransientClusterState(incomingState)) {
      // Keep the newest transform/velocity/point cloud while carrying the
      // transition state across the skipped frame.
      objects[incomingIndex] = objectWithClusterState(incomingObject, previousState);
    }
  }

  const zoneEvents = [...incoming.getZoneEvents()];
  const incomingZoneIndex = new Map(
    zoneEvents.map((event, index) => [event.getEmitterZoneAddress(), index])
  );

  for (const previousEvent of previous.getZoneEvents()) {
    const enters = previousEvent.getEnters();
    const leaves = previousEvent.getLeaves();
    if (enters <= 0 && leaves <= 0) continue;

    const address = previousEvent.getEmitterZoneAddress();
    const incomingIndex = incomingZoneIndex.get(address);

    if (incomingIndex === undefined) {
      zoneEvents.push(new ZoneEventPacket(
        address,
        enters,
        leaves,
        previousEvent.getPresence(),
        previousEvent.getDensity(),
        []
      ));
      continue;
    }

    const current = zoneEvents[incomingIndex];
    zoneEvents[incomingIndex] = new ZoneEventPacket(
      address,
      saturatingAdd(enters, current.getEnters()),
      saturatingAdd(leaves, current.getLeaves()),
      current.getPresence(),
      current.getDensity(),
      current.getProperties()
    );
  }

  return new DataBlob(
    incoming.getSceneInfo(),
    objects,
    zoneEvents,
    incoming.timestamp
  );
}
