import {
  ClusterProperty, ClusterState, Container, ContainerType, ControlMessage, ControlMessageStatus,
  ControlMessageType, DataBlob, ObjectPacket, PointCloudProperty, SceneInfoPacket, ShapeType,
  ZoneEventPacket, ZoneEventProperty, ZoneParameters, ZonePropertyType
} from 'augmenta-client-sdk';

// Synthetic packets mimic the live stream consumed by the viewer: positions
// are Y-up/right-handed, while setup Euler rotations and OBB quaternions retain
// the Pleiades wire conventions corrected by viewer.js.
export function makeDemoSetup() {
  const zoneA = new Container(ContainerType.Zone, 'Welcome zone', '/Demo/Welcome', [2.9, 0.01, -2.8], [0, -12, 0], [0.42, 0.69, 1, 1], new ZoneParameters(ShapeType.Box, { size: [2.8, 0.05, 2.4] }), []);
  const zoneB = new Container(ContainerType.Zone, 'Interaction zone', '/Demo/Interaction', [6.7, 0, -5.3], [0, 0, 0], [0.75, 0.48, 1, 1], new ZoneParameters(ShapeType.Cylinder, { radius: 1.2, height: 1.6 }), []);
  const root = new Container(ContainerType.Scene, 'Three.js demo scene', '/Demo', [-5, 0, 4], [0, 0, 0], [0.35, 0.4, 0.5, 1], { size: [10, 4, 8] }, [zoneA, zoneB]);
  return new ControlMessage(ControlMessageType.Setup, root, ControlMessageStatus.Ok, '', 3);
}

export function makeDemoFrame(t) {
  const objects = [0, 1, 2].map((index) => demoObject(index, t));
  const zones = [
    new ZoneEventPacket('/Demo/Welcome', 0, 0, 1, 0.31, [new ZoneEventProperty(ZonePropertyType.XYPad, { x: (Math.sin(t * 0.8) + 1) / 2, y: (Math.cos(t * 0.6) + 1) / 2 })]),
    new ZoneEventPacket('/Demo/Interaction', 0, 0, 2, 0.67, [new ZoneEventProperty(ZonePropertyType.Slider, { value: (Math.sin(t) + 1) / 2 })])
  ];
  const timestamp = Math.floor(t * 1000);
  return new DataBlob(new SceneInfoPacket('/Demo', timestamp), objects, zones, timestamp);
}

function demoObject(index, t) {
  const angularSpeed = 0.45 + index * 0.08;
  const radiusX = 1.5 + index * 0.45;
  const radiusZ = 1.25 + index * 0.35;
  const phase = t * angularSpeed + index * 2.1;
  const centroid = [Math.cos(phase) * radiusX, 0.9, Math.sin(phase) * radiusZ];
  const velocity = [
    -Math.sin(phase) * radiusX * angularSpeed,
    0,
    Math.cos(phase) * radiusZ * angularSpeed
  ];
  const size = [0.5 + index * 0.05, 1.65 + index * 0.08, 0.48 + index * 0.04];
  const yaw = phase * 0.35;
  const cluster = new ClusterProperty(
    index === 2 && Math.sin(t * 0.7) < -0.75 ? ClusterState.Ghost : ClusterState.Updated,
    centroid, velocity, [centroid[0], size[1] / 2, centroid[2]], size, 0.82 + index * 0.06,
    [0, -Math.sin(yaw / 2), 0, Math.cos(yaw / 2)],
    [Math.sin(yaw), 0, Math.cos(yaw)]
  );
  return new ObjectPacket(index + 1, cluster, demoCloud(centroid, size, index, t), `00000000-0000-4000-8000-00000000000${index + 1}`);
}

function demoCloud(centroid, size, index, t) {
  const count = 120;
  const points = new Float32Array(count * 3);
  const intensity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 10 + t * 0.25;
    const h = ((i * 37) % count) / (count - 1);
    const radius = (0.18 + ((i * 17) % 31) / 31 * 0.16) * (0.9 + index * 0.05);
    points[i * 3] = centroid[0] + Math.cos(angle) * radius;
    points[i * 3 + 1] = h * size[1];
    points[i * 3 + 2] = centroid[2] + Math.sin(angle) * radius;
    intensity[i] = 0.2 + 0.8 * Math.abs(Math.sin(angle * 0.3));
  }
  return new PointCloudProperty(points, intensity);
}
