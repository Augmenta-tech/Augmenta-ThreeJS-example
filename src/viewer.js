import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClusterState, ShapeType } from 'augmenta-client-sdk';

export function createViewer(host) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0f14);
  scene.fog = new THREE.FogExp2(0x0c0f14, 0.014);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.02, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;

  const grid = new THREE.GridHelper(20, 20, 0x4d5668, 0x252b35);
  grid.material.transparent = true;
  grid.material.opacity = 0.65;
  scene.add(grid, new THREE.AxesHelper(1));

  const setupGroup = namedGroup(scene, 'Augmenta scene setup');
  const clusterGroup = namedGroup(scene, 'Tracked clusters');
  const pointGroup = namedGroup(scene, 'Point clouds');
  const vectorGroup = namedGroup(scene, 'Velocity vectors');
  const views = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const centroidGeometry = new THREE.SphereGeometry(0.045, 12, 8);

  function resetCamera() {
    camera.position.set(6.5, 5.5, 7.5);
    controls.target.set(0, 1.2, 0);
    controls.update();
  }

  function resize() {
    const width = host.clientWidth;
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = Math.max(width / height, 0.1);
    camera.updateProjectionMatrix();
  }

  function renderFrame(frame) {
    const active = new Set();
    frame.getObjects().forEach((object, index) => {
      const key = object.getUUID() || `id:${object.getID() ?? index}`;
      active.add(key);
      const view = views.get(key) || createObjectView(key);
      views.set(key, view);

      if (object.hasCluster()) updateCluster(view, object.getCluster());
      else hideCluster(view);

      if (object.hasPointCloud()) updatePoints(view, object.getPointCloud());
      else view.points.visible = false;
    });

    for (const [key, view] of views) {
      if (!active.has(key)) {
        disposeView(view);
        views.delete(key);
      }
    }
  }

  function createObjectView(key) {
    const color = keyColor(key);
    const box = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.9 }));
    const centroid = new THREE.Mesh(centroidGeometry, new THREE.MeshBasicMaterial({ color }));
    const velocity = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })
    );
    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color, size: 0.025, sizeAttenuation: true, transparent: true, opacity: 0.85 })
    );
    clusterGroup.add(box, centroid);
    vectorGroup.add(velocity);
    pointGroup.add(points);
    return { box, centroid, velocity, points, color };
  }

  function updateCluster(view, cluster) {
    const center = cluster.getBoundingBoxCenter();
    const size = cluster.getBoundingBoxSize();
    const centroid = cluster.getCentroid();
    const velocity = cluster.getVelocity();
    const rotation = cluster.getBoundingBoxRotationQuaternions();

    view.box.visible = true;
    view.box.position.fromArray(center);
    view.box.scale.set(...size.map((v) => Math.max(Math.abs(v), 0.001)));
    view.box.quaternion.set(...rotation).normalize();
    view.centroid.visible = true;
    view.centroid.position.fromArray(centroid);

    const p = view.velocity.geometry.attributes.position.array;
    p.set(centroid, 0);
    p.set(centroid.map((v, i) => v + velocity[i]), 3);
    view.velocity.geometry.attributes.position.needsUpdate = true;
    view.velocity.geometry.computeBoundingSphere();
    view.velocity.visible = true;

    const color = cluster.getState() === ClusterState.Ghost ? new THREE.Color(0x8a909b) : view.color;
    view.box.material.color.copy(color);
    view.centroid.material.color.copy(color);
    view.velocity.material.color.copy(color);
    view.box.material.opacity = cluster.getState() === ClusterState.WillLeave ? 0.35 : 0.9;
  }

  function updatePoints(view, cloud) {
    const data = cloud.getPointsData();
    const position = view.points.geometry.getAttribute('position');
    if (position && position.array.length === data.length) {
      position.array.set(data);
      position.needsUpdate = true;
    } else {
      view.points.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(data), 3));
    }
    view.points.geometry.computeBoundingSphere();
    view.points.visible = data.length > 0;
  }

  function hideCluster(view) {
    view.box.visible = false;
    view.centroid.visible = false;
    view.velocity.visible = false;
  }

  function renderSetup(root) {
    clearGroup(setupGroup);
    addContainer(root, setupGroup);
  }

  function upsertSetup(container) {
    const existing = setupGroup.getObjectByName(`augmenta:${container.getAddress()}`);
    const parent = existing?.parent || setupGroup;
    if (existing) disposeObject(existing);
    addContainer(container, parent);
  }

  function addContainer(container, parent) {
    const group = new THREE.Group();
    group.name = `augmenta:${container.getAddress()}`;
    group.position.fromArray(container.getPosition());
    const r = container.getRotation().map(THREE.MathUtils.degToRad);
    group.rotation.set(r[0], r[1], r[2], 'XYZ');
    parent.add(group);

    const material = new THREE.MeshBasicMaterial({
      color: containerColor(container),
      wireframe: true,
      transparent: true,
      opacity: container.isScene() ? 0.22 : 0.62,
      depthWrite: false
    });

    if (container.isScene()) {
      const size = container.getSceneParameters().size;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...positiveSize(size)), material);
      mesh.position.set(size[0] / 2, size[1] / 2, size[2] / 2);
      group.add(mesh);
    } else if (container.isZone()) {
      const params = container.getZoneParameters();
      const geometry = zoneGeometry(params);
      if (geometry) {
        const mesh = new THREE.Mesh(geometry, material);
        if (params.isCylinder()) mesh.position.y = params.getCylinderShapeParameters().height / 2;
        group.add(mesh);
      } else material.dispose();
    } else material.dispose();

    for (const child of container.getChildren()) addContainer(child, group);
  }

  function zoneGeometry(params) {
    switch (params.getShapeType()) {
      case ShapeType.Box:
        return new THREE.BoxGeometry(...positiveSize(params.getBoxShapeParameters().size));
      case ShapeType.Cylinder: {
        const { radius, height } = params.getCylinderShapeParameters();
        return new THREE.CylinderGeometry(Math.max(radius, 0.001), Math.max(radius, 0.001), Math.max(height, 0.001), 32);
      }
      case ShapeType.Sphere:
        return new THREE.SphereGeometry(Math.max(params.getSphereShapeParameters().radius, 0.001), 24, 16);
      default:
        return new THREE.SphereGeometry(0.08, 10, 6);
    }
  }

  function setVisibility({ clusters, points, zones, vectors }) {
    clusterGroup.visible = clusters;
    pointGroup.visible = points;
    setupGroup.visible = zones;
    vectorGroup.visible = vectors;
  }

  function clearTracking() {
    for (const view of views.values()) disposeView(view);
    views.clear();
  }

  function clearSetup() { clearGroup(setupGroup); }

  function disposeView(view) {
    clusterGroup.remove(view.box, view.centroid);
    vectorGroup.remove(view.velocity);
    pointGroup.remove(view.points);
    for (const object of [view.box, view.centroid, view.velocity, view.points]) {
      if (object.geometry !== unitBox && object.geometry !== centroidGeometry) object.geometry.dispose();
      object.material.dispose();
    }
  }

  resetCamera();
  resize();
  window.addEventListener('resize', resize);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return { renderFrame, renderSetup, upsertSetup, clearTracking, clearSetup, resetCamera, setVisibility };
}

function namedGroup(scene, name) {
  const group = new THREE.Group();
  group.name = name;
  scene.add(group);
  return group;
}

function keyColor(key) {
  let hash = 0;
  for (const c of key) hash = ((hash << 5) - hash + c.charCodeAt(0)) | 0;
  return new THREE.Color().setHSL((Math.abs(hash) % 360) / 360, 0.72, 0.58);
}

function positiveSize(size) { return size.map((v) => Math.max(Math.abs(v), 0.001)); }

function containerColor(container) {
  const [r, g, b] = container.getColor();
  if (r === 0 && g === 0 && b === 0) return container.isScene() ? 0x7b8798 : 0xb78cff;
  return new THREE.Color().setRGB(r, g, b);
}

function clearGroup(group) {
  while (group.children.length) disposeObject(group.children[0]);
}

function disposeObject(object) {
  for (const child of [...object.children]) disposeObject(child);
  object.geometry?.dispose();
  if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
  object.parent?.remove(object);
}
