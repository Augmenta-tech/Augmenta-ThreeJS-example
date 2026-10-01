import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClusterState } from 'augmenta-client-sdk';
import { speedFromVelocity } from './motion.js';
import { createZoneRenderer } from './zones.js';

const FLOOR_Y = 0;
const GHOST_COLOR = new THREE.Color(0x8a909b);
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
  const zoneRenderer = createZoneRenderer();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
  unitBox.dispose();
  const centroidGeometry = new THREE.SphereGeometry(0.045, 12, 8);

  const homePosition = new THREE.Vector3(0, 2.5, 7.5);
  const homeTarget = new THREE.Vector3(0, 1.2, 0);
  let rightInset = 0;
  let insetAnimationFrame;
  let cameraChangeHandler;
  let cameraUserControlled = false;

  function getCameraView() {
    return {
      position: camera.position.toArray(),
      target: controls.target.toArray()
    };
  }

  function setCameraView(view) {
    const position = validVector3(view?.position);
    const target = validVector3(view?.target);
    if (!position || !target) return false;

    camera.position.fromArray(position);
    controls.target.fromArray(target);
    cameraUserControlled = true;
    controls.update();
    return true;
  }

  function setCameraChangeHandler(handler) {
    cameraChangeHandler = typeof handler === 'function' ? handler : undefined;
  }

  function isCameraUserControlled() {
    return cameraUserControlled;
  }

  controls.addEventListener('start', () => {
    cameraUserControlled = true;
  });
  controls.addEventListener('change', () => {
    cameraChangeHandler?.(getCameraView());
  });

  function resetCamera() {
    cameraUserControlled = false;
    camera.position.copy(homePosition);
    controls.target.copy(homeTarget);
    controls.update();
  }

  function updateCameraProjection() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    camera.clearViewOffset();

    if (rightInset > 0 && width > rightInset + 80) {
      const virtualWidth = width + rightInset;
      camera.aspect = Math.max(virtualWidth / height, 0.1);
      camera.setViewOffset(virtualWidth, height, rightInset, 0, width, height);
    } else {
      camera.aspect = Math.max(width / height, 0.1);
      camera.updateProjectionMatrix();
    }
  }

  function updateLineMaterialResolution(
    width = Math.max(host.clientWidth, 1),
    height = Math.max(host.clientHeight, 1)
  ) {
    setupGroup.traverse((object) => {
      if (object.material?.isLineMaterial) object.material.resolution.set(width, height);
    });
  }

  function resize() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    updateLineMaterialResolution(width, height);
    updateCameraProjection();
  }

  function setRightInset(value, animate = false) {
    const target = Math.max(0, Number(value) || 0);
    if (insetAnimationFrame) cancelAnimationFrame(insetAnimationFrame);

    if (!animate) {
      rightInset = target;
      updateCameraProjection();
      return;
    }

    const start = rightInset;
    const startedAt = performance.now();
    const duration = 220;

    const tick = (now) => {
      const t = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      rightInset = start + (target - start) * eased;
      updateCameraProjection();
      if (t < 1) insetAnimationFrame = requestAnimationFrame(tick);
      else insetAnimationFrame = undefined;
    };

    insetAnimationFrame = requestAnimationFrame(tick);
  }

  function renderFrame(frame) {
    const sceneAddress = frame.getSceneInfo().getAddress() || '';
    const active = new Set();

    frame.getObjects().forEach((object, index) => {
      const id = object.getID();
      const uuid = object.getUUID();
      // IDs can repeat across scenes. Prefix by scene so "All scenes" can keep
      // multiple live scenes visible without one frame deleting another.
      const objectKey = uuid || `id:${id ?? index}`;
      const key = `${sceneAddress}|${objectKey}`;
      active.add(key);

      const view = views.get(key) || createObjectView(key, id, sceneAddress);
      views.set(key, view);

      if (object.hasCluster()) {
        updateLabel(view, id, uuid);
        updateCluster(view, object.getCluster());
      } else {
        view.label.visible = false;
        hideCluster(view);
      }

      if (object.hasPointCloud()) updatePoints(view, object.getPointCloud());
      else view.points.visible = false;
    });

    for (const [key, view] of views) {
      if (view.sceneAddress === sceneAddress && !active.has(key)) {
        disposeView(view);
        views.delete(key);
      }
    }

    zoneRenderer.update(frame.getZoneEvents());
  }

  function createObjectView(key, id, sceneAddress) {
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
    // Point-only packets have no cheap spatial bound. Avoid Three.js scanning
    // every point to derive one; cluster-backed clouds get a cheap box bound.
    points.frustumCulled = false;

    const label = createLabelSprite(id === undefined ? '' : String(id), color);
    label.visible = id !== undefined;

    clusterGroup.add(box, centroid);
    vectorGroup.add(velocity);
    pointGroup.add(points);
    labelGroup.add(label);

    return { box, centroid, velocity, points, label, labelText: id === undefined ? '' : String(id), color, sceneAddress };
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
    view.box.scale.set(
      Math.max(Math.abs(size[0]), 0.001),
      Math.max(Math.abs(size[1]), 0.001),
      Math.max(Math.abs(size[2]), 0.001)
    );
    // Pleiades sends its native Y-up/left-handed quaternion. Reflect it across
    // Z to express the exact same orientation in Three.js' right-handed space.
    setLeftHandedQuaternion(view.box.quaternion, rotation);

    view.centroid.visible = true;
    view.centroid.position.fromArray(centroid);

    updateVelocity(view.velocity, center, velocity, view.color);

    const state = cluster.getState();
    const color = state === ClusterState.Ghost ? GHOST_COLOR : view.color;
    view.box.material.color.copy(color);
    view.centroid.material.color.copy(color);
    view.velocity.setColor(color);
    view.points.material.color.copy(color);

    view.box.material.opacity = state === ClusterState.WillLeave ? 0.35 : 0.95;
    view.points.material.opacity = state === ClusterState.Ghost ? 0.45 : 0.92;

    const pointBounds = view.points.geometry.boundingSphere ?? new THREE.Sphere();
    pointBounds.center.fromArray(center);
    pointBounds.radius = Math.max(
      Math.hypot(Math.abs(size[0]), Math.abs(size[1]), Math.abs(size[2])) * 0.5,
      0.001
    );
    view.points.geometry.boundingSphere = pointBounds;
    view.points.frustumCulled = true;

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
      const nextPosition = new THREE.BufferAttribute(data, 3);
      nextPosition.setUsage(THREE.DynamicDrawUsage);
      view.points.geometry.setAttribute('position', nextPosition);
    }

    view.points.visible = data.length > 0;
  }

  function hideCluster(view) {
    view.box.visible = false;
    view.centroid.visible = false;
    view.velocity.visible = false;
    view.points.frustumCulled = false;
  }

  function renderSetup(root, selectedSceneAddress) {
    clearGroup(setupGroup);
    zoneRenderer.resetViews();
    addContainer(root, setupGroup, selectedSceneAddress, false);
    zoneRenderer.pruneState(collectZoneAddresses(root));
    updateLineMaterialResolution();
    updateHomeFromSetup();
  }

  function addContainer(container, parent, selectedSceneAddress, insideSelectedScene) {
    const address = container.getAddress();
    const isSelectedScene = Boolean(selectedSceneAddress && address === selectedSceneAddress);
    const renderContents = !selectedSceneAddress || insideSelectedScene || isSelectedScene;

    // Keep ancestors of the selected Scene so their transforms are preserved,
    // but skip unrelated branches entirely.
    if (
      selectedSceneAddress
      && !renderContents
      && !containsAddress(container, selectedSceneAddress)
    ) {
      return;
    }

    const group = new THREE.Group();
    group.name = `augmenta:${address}`;

    group.position.fromArray(container.getPosition());
    setSetupRotation(group, container.getRotation());
    parent.add(group);

    if (renderContents) {
      if (container.isScene()) {
        addSceneBox(container, group);
      } else if (container.isZone()) {
        zoneRenderer.addZone(container, group);
      }
    }

    for (const child of container.getChildren()) {
      addContainer(
        child,
        group,
        selectedSceneAddress,
        renderContents
      );
    }
  }

  function containsAddress(container, targetAddress) {
    if (container.getAddress() === targetAddress) return true;
    return container.getChildren().some((child) => containsAddress(child, targetAddress));
  }

  function addSceneBox(container, group) {
    const size = container.getSceneParameters().size;
    const geometry = new THREE.BoxGeometry(...positiveSize(size));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x7f858e,
        transparent: true,
        opacity: 0.55,
        depthWrite: false
      })
    );
    geometry.dispose();

    edges.name = 'Scene bounds';
    // AxisTransform returns size as positive magnitudes. In Y-up/right-handed
    // space the original +Z extent points toward local -Z.
    edges.position.set(size[0] / 2, size[1] / 2, -size[2] / 2);
    edges.renderOrder = 1;
    group.add(edges);
  }

  function updateHomeFromSetup() {
    const bounds = new THREE.Box3().setFromObject(setupGroup);
    if (bounds.isEmpty()) return;

    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distance = Math.max(span / (2 * Math.tan(fov / 2)) * 1.35, 2);

    homeTarget.copy(center);
    // A centered, slightly elevated front view similar to Pleiades' default,
    // rather than an oblique corner view.
    homePosition.copy(center).add(
      new THREE.Vector3(0, distance * 0.14, distance * 1.08)
    );

    // Before the user has chosen a view, keep orbiting around the setup
    // center. A restored/panned/orbited camera keeps its own target so setup
    // refreshes cannot overwrite the persisted view.
    if (!cameraUserControlled) {
      controls.target.copy(center);
      controls.update();
    }
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

    zoneRenderer.clearPresence();
  }

  function clearSetup() {
    clearGroup(setupGroup);
    zoneRenderer.clearPresence();
    zoneRenderer.resetViews();
    homePosition.set(0, 2.5, 7.5);
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
  new ResizeObserver(resize).observe(host);
  renderer.domElement.addEventListener('dblclick', (event) => {
    if (event.button === 0) resetCamera();
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    zoneRenderer.animate(performance.now());

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
    clearTracking,
    clearSetup,
    getCameraView,
    isCameraUserControlled,
    resetCamera,
    setCameraChangeHandler,
    setCameraView,
    setRightInset,
    setVisibility
  };
}

function validVector3(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every((component) => Number.isFinite(component))
    ? value
    : undefined;
}

function setSetupRotation(object, mappedRotationDegrees) {
  const [x, y, mappedZ] = mappedRotationDegrees.map(THREE.MathUtils.degToRad);

  // Setup JSON has already been component-mapped by Pleiades from Y-up/left-
  // handed to Y-up/right-handed, so its Z Euler component is negated. Recover
  // the native Pleiades Z->Y->X rotation, then reflect the orientation itself.
  const leftHanded = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(x, y, -mappedZ, 'ZYX')
  );
  setLeftHandedQuaternion(object.quaternion, [
    leftHanded.x,
    leftHanded.y,
    leftHanded.z,
    leftHanded.w
  ]);
}

function setLeftHandedQuaternion(target, [x, y, z, w]) {
  // Reflection M=diag(1,1,-1): R_rh = M * R_lh * M.
  target.set(-x, -y, z, w).normalize();
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
  const speed = speedFromVelocity(velocity);

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
  ctx.font = '500 38px Inter, Arial, sans-serif';
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

// Scene dimensions are magnitudes. Placement above preserves the requested
// Y-up/right-handed direction while this helper keeps geometry sizes valid.
function positiveSize(size) {
  return size.map((v) => Math.max(Math.abs(v), 0.001));
}

function collectZoneAddresses(container, result = new Set()) {
  if (!container) return result;
  if (container.isZone?.()) {
    const address = container.getAddress?.();
    if (address) result.add(address);
  }
  for (const child of container.getChildren?.() ?? []) {
    collectZoneAddresses(child, result);
  }
  return result;
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
