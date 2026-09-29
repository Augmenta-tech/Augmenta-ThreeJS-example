import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClusterState, ShapeType } from 'augmenta-client-sdk';

const FLOOR_Y = 0;
const SESSION_COLOR_OFFSET = Math.floor(Math.random() * 1000);
const PALETTE = [
  0x4cc9f0, // cyan
  0x4895ef, // blue
  0x4361ee, // indigo
  0x7c5cff, // violet
  0xb15cff, // purple
  0xf15bb5, // pink
  0xff6b6b, // coral
  0xff922b, // orange
  0xf9c74f, // gold
  0x90be6d, // green
  0x43aa8b, // teal
  0x2ec4b6  // aqua
];

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
  configureControls(controls);

  const grid = new THREE.GridHelper(100, 100, 0x4d5668, 0x252b35);
  grid.material.transparent = true;
  grid.material.opacity = 0.52;
  grid.material.depthWrite = false;
  scene.add(grid, new THREE.AxesHelper(1));

  const setupGroup = namedGroup(scene, 'Augmenta scene setup');
  const clusterGroup = namedGroup(scene, 'Tracked clusters');
  const pointGroup = namedGroup(scene, 'Point clouds');
  const vectorGroup = namedGroup(scene, 'Velocity vectors');
  const labelGroup = namedGroup(scene, 'Object IDs');

  const views = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
  const centroidGeometry = new THREE.SphereGeometry(0.045, 12, 8);

  const homePosition = new THREE.Vector3(6.5, 5.5, 7.5);
  const homeTarget = new THREE.Vector3(0, 1.2, 0);

  function resetCamera() {
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
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
      const id = object.getID();
      const uuid = object.getUUID();
      const key = uuid || `id:${id ?? index}`;
      active.add(key);

      const view = views.get(key) || createObjectView(key, id);
      views.set(key, view);
      updateLabel(view, id, uuid);

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

  function createObjectView(key, id) {
    const color = objectColor(key, id);
    const box = new THREE.LineSegments(
      unitBoxEdges,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95
      })
    );

    const centroid = new THREE.Mesh(
      centroidGeometry,
      new THREE.MeshBasicMaterial({ color })
    );

    const velocity = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(),
      0.001,
      color.getHex(),
      0.12,
      0.07
    );
    configureArrow(velocity);

    const points = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color,
        size: 0.03,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.92
      })
    );

    const label = createLabelSprite(id === undefined ? '' : String(id), color);
    label.visible = id !== undefined;

    clusterGroup.add(box, centroid);
    vectorGroup.add(velocity);
    pointGroup.add(points);
    labelGroup.add(label);

    return { box, centroid, velocity, points, label, labelText: id === undefined ? '' : String(id), color };
  }

  function updateLabel(view, id, uuid) {
    const text = id !== undefined ? String(id) : uuid ? uuid.slice(0, 8) : '';
    if (!text) {
      view.label.visible = false;
      return;
    }

    if (view.labelText !== text) {
      replaceLabelTexture(view.label, text, view.color);
      view.labelText = text;
    }
    view.label.visible = true;
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

    updateVelocity(view.velocity, center, velocity, view.color);

    const state = cluster.getState();
    const color = state === ClusterState.Ghost ? new THREE.Color(0x8a909b) : view.color;
    view.box.material.color.copy(color);
    view.centroid.material.color.copy(color);
    setArrowColor(view.velocity, color);
    view.points.material.color.copy(color);

    view.box.material.opacity = state === ClusterState.WillLeave ? 0.35 : 0.95;
    view.points.material.opacity = state === ClusterState.Ghost ? 0.45 : 0.92;

    const top = center[1] + Math.abs(size[1]) * 0.5 + 0.18;
    view.label.position.set(center[0], Math.max(top, FLOOR_Y + 0.16), center[2]);
    view.label.material.opacity = state === ClusterState.Ghost ? 0.55 : 1;
  }

  function updatePoints(view, cloud) {
    const data = cloud.getPointsData();
    const position = view.points.geometry.getAttribute('position');

    if (position && position.array.length === data.length) {
      position.array.set(data);
      position.needsUpdate = true;
    } else {
      view.points.geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(data), 3)
      );
    }

    view.points.geometry.computeBoundingSphere();
    view.points.visible = data.length > 0;

    if (!view.box.visible && view.points.geometry.boundingSphere) {
      const c = view.points.geometry.boundingSphere.center;
      view.label.position.set(c.x, Math.max(c.y + 0.2, FLOOR_Y + 0.16), c.z);
    }
  }

  function hideCluster(view) {
    view.box.visible = false;
    view.centroid.visible = false;
    view.velocity.visible = false;

    if (view.points.geometry.boundingSphere) {
      const c = view.points.geometry.boundingSphere.center;
      view.label.position.set(c.x, Math.max(c.y + 0.2, FLOOR_Y + 0.16), c.z);
    }
  }

  function renderSetup(root) {
    clearGroup(setupGroup);
    addContainer(root, setupGroup);
    updateHomeFromSetup(false);
  }

  function upsertSetup(container) {
    const existing = setupGroup.getObjectByName(`augmenta:${container.getAddress()}`);
    const parent = existing?.parent || setupGroup;
    if (existing) disposeObject(existing);
    addContainer(container, parent);
    updateHomeFromSetup(false);
  }

  function addContainer(container, parent) {
    const group = new THREE.Group();
    group.name = `augmenta:${container.getAddress()}`;
    group.position.fromArray(container.getPosition());

    const r = container.getRotation().map(THREE.MathUtils.degToRad);
    group.rotation.set(r[0], r[1], r[2], 'XYZ');
    parent.add(group);

    if (container.isScene()) {
      addSceneBox(container, group);
    } else if (container.isZone()) {
      addZone(container, group);
    }

    for (const child of container.getChildren()) addContainer(child, group);
  }

  function addSceneBox(container, group) {
    const size = container.getSceneParameters().size;
    const geometry = new THREE.BoxGeometry(...positiveSize(size));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: containerColor(container, 0x8ca6c6),
        transparent: true,
        opacity: 0.85,
        depthWrite: false
      })
    );
    geometry.dispose();

    edges.name = 'Scene bounds';
    edges.position.set(size[0] / 2, size[1] / 2, size[2] / 2);
    edges.renderOrder = 1;
    group.add(edges);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.abs(size[0]), Math.abs(size[2])),
      new THREE.MeshBasicMaterial({
        color: containerColor(container, 0x8ca6c6),
        transparent: true,
        opacity: 0.035,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    floor.name = 'Scene floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(size[0] / 2, 0.002, size[2] / 2);
    group.add(floor);
  }

  function addZone(container, group) {
    const params = container.getZoneParameters();
    const geometry = zoneGeometry(params);
    if (!geometry) return;

    let mesh;
    if (params.isBox()) {
      const edges = new THREE.EdgesGeometry(geometry);
      geometry.dispose();
      mesh = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: containerColor(container, 0xb78cff),
          transparent: true,
          opacity: 0.68,
          depthWrite: false
        })
      );
    } else {
      mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: containerColor(container, 0xb78cff),
          wireframe: true,
          transparent: true,
          opacity: 0.68,
          depthWrite: false
        })
      );
    }

    if (params.isCylinder()) {
      mesh.position.y = params.getCylinderShapeParameters().height / 2;
    }

    group.add(mesh);
  }

  function zoneGeometry(params) {
    switch (params.getShapeType()) {
      case ShapeType.Box:
        return new THREE.BoxGeometry(...positiveSize(params.getBoxShapeParameters().size));

      case ShapeType.Cylinder: {
        const { radius, height } = params.getCylinderShapeParameters();
        return new THREE.CylinderGeometry(
          Math.max(Math.abs(radius), 0.001),
          Math.max(Math.abs(radius), 0.001),
          Math.max(Math.abs(height), 0.001),
          32
        );
      }

      case ShapeType.Sphere:
        return new THREE.SphereGeometry(
          Math.max(Math.abs(params.getSphereShapeParameters().radius), 0.001),
          24,
          16
        );

      default:
        return new THREE.SphereGeometry(0.08, 10, 6);
    }
  }

  function updateHomeFromSetup(moveCamera = true) {
    const bounds = new THREE.Box3().setFromObject(setupGroup);
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = Math.max(span / (2 * Math.tan(fov / 2)) * 1.35, 2);

    homeTarget.copy(center);
    homePosition.copy(center).add(
      new THREE.Vector3(distance * 0.72, distance * 0.52, distance * 0.92)
    );

    if (moveCamera) resetCamera();
  }

  function setVisibility({ clusters, points, zones, vectors }) {
    clusterGroup.visible = clusters;
    pointGroup.visible = points;
    setupGroup.visible = zones;
    vectorGroup.visible = vectors;
    labelGroup.visible = clusters || points;
  }

  function clearTracking() {
    for (const view of views.values()) disposeView(view);
    views.clear();
  }

  function clearSetup() {
    clearGroup(setupGroup);
    homePosition.set(6.5, 5.5, 7.5);
    homeTarget.set(0, 1.2, 0);
  }

  function disposeView(view) {
    clusterGroup.remove(view.box, view.centroid);
    vectorGroup.remove(view.velocity);
    pointGroup.remove(view.points);
    labelGroup.remove(view.label);

    view.box.material.dispose();
    view.centroid.material.dispose();
    view.points.geometry.dispose();
    view.points.material.dispose();

    disposeArrow(view.velocity);
    disposeLabel(view.label);
  }

  resetCamera();
  resize();
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(host);
  renderer.domElement.addEventListener('dblclick', (event) => {
    if (event.button === 0) resetCamera();
  });

  renderer.setAnimationLoop(() => {
    controls.update();

    // Orbiting stays above the world floor. With screenSpacePanning=false,
    // right-drag panning also remains parallel to the floor plane.
    if (camera.position.y < FLOOR_Y + 0.02) {
      camera.position.y = FLOOR_Y + 0.02;
    }

    renderer.render(scene, camera);
  });

  return {
    renderFrame,
    renderSetup,
    upsertSetup,
    clearTracking,
    clearSetup,
    resetCamera,
    setVisibility
  };
}

function configureControls(controls) {
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.rotateSpeed = 0.6;
  controls.panSpeed = 0.72;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 0.05;
  controls.maxDistance = 500;
  controls.zoomToCursor = false;
  controls.minPolarAngle = THREE.MathUtils.degToRad(2);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(88.5);
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
}

function configureArrow(arrow) {
  arrow.line.material.transparent = true;
  arrow.line.material.opacity = 0.95;
  arrow.line.material.depthTest = false;
  arrow.line.renderOrder = 8;

  arrow.cone.material.transparent = true;
  arrow.cone.material.opacity = 0.95;
  arrow.cone.material.depthTest = false;
  arrow.cone.renderOrder = 8;
}

function updateVelocity(arrow, origin, velocity, color) {
  const vector = new THREE.Vector3().fromArray(velocity);
  const speed = vector.length();

  if (!Number.isFinite(speed) || speed < 0.001) {
    arrow.visible = false;
    return;
  }

  arrow.visible = true;
  arrow.position.fromArray(origin);
  arrow.setDirection(vector.normalize());

  const headLength = Math.min(Math.max(speed * 0.28, 0.08), 0.28);
  const headWidth = Math.min(Math.max(headLength * 0.55, 0.05), 0.16);
  arrow.setLength(speed, headLength, headWidth);
  setArrowColor(arrow, color);
}

function setArrowColor(arrow, color) {
  arrow.setColor(color);
}

function disposeArrow(arrow) {
  arrow.line.geometry.dispose();
  arrow.line.material.dispose();
  arrow.cone.geometry.dispose();
  arrow.cone.material.dispose();
  arrow.parent?.remove(arrow);
}

function createLabelSprite(text, color) {
  const material = new THREE.SpriteMaterial({
    map: makeLabelTexture(text, color),
    transparent: true,
    depthTest: false,
    depthWrite: false
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.72, 0.28, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function replaceLabelTexture(sprite, text, color) {
  sprite.material.map?.dispose();
  sprite.material.map = makeLabelTexture(text, color);
  sprite.material.needsUpdate = true;
}

function makeLabelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const cssColor = `#${color.getHexString()}`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(ctx, 24, 16, 208, 64, 22);
  ctx.fillStyle = 'rgba(10, 13, 18, 0.88)';
  ctx.fill();

  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '600 38px Inter, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 49);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function disposeLabel(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
  sprite.parent?.remove(sprite);
}

function namedGroup(scene, name) {
  const group = new THREE.Group();
  group.name = name;
  scene.add(group);
  return group;
}

function objectColor(key, id) {
  const seed = Number.isInteger(id) ? id : hashString(key);
  const index = Math.abs(seed * 5 + SESSION_COLOR_OFFSET) % PALETTE.length;
  return new THREE.Color(PALETTE[index]);
}

function hashString(value) {
  let hash = 0;
  for (const char of value) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return hash;
}

function positiveSize(size) {
  return size.map((v) => Math.max(Math.abs(v), 0.001));
}

function containerColor(container, fallback) {
  const [r, g, b] = container.getColor();
  if (r === 0 && g === 0 && b === 0) return fallback;
  return new THREE.Color().setRGB(r, g, b);
}

function clearGroup(group) {
  while (group.children.length) disposeObject(group.children[0]);
}

function disposeObject(object) {
  for (const child of [...object.children]) disposeObject(child);
  object.geometry?.dispose();

  if (object.material) {
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  }

  object.parent?.remove(object);
}
