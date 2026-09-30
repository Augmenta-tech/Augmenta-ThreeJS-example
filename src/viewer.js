import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { ClusterState, ShapeType } from 'augmenta-client-sdk';
import { speedFromVelocity } from './motion.js';

const FLOOR_Y = 0;
const VELOCITY_DISPLAY_SCALE = 3;
const VELOCITY_MIN_DISPLAY_LENGTH = 0.18;
const ZONE_PRESENCE_LABEL_GAP = 0.32;
const ZONE_PRESENCE_LABEL_COLOR = new THREE.Color(0xaeb4be);
const ZONE_PRESENCE_LABEL_OPACITY = 0.78;
const ZONE_PRESENCE_LABEL_PULSE_DURATION_MS = 180;
const ZONE_PRESENCE_IDLE_OPACITY = 0.025;
const ZONE_PRESENCE_OPACITY = 0.1;
const ZONE_PRESENCE_PULSE_OPACITY = 0.16;
const ZONE_PRESENCE_PULSE_DURATION_MS = 220;
const ZONE_PRESENCE_FADE_DURATION_MS = 180;
const ZONE_VISUAL_COLOR = new THREE.Color(0x969ba3);
const ZONE_OUTLINE_COLOR = ZONE_VISUAL_COLOR;
const ZONE_OUTLINE_WIDTH = 1.7;
const ROUND_OUTLINE_SEGMENTS = 24;
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
  const zoneViews = new Map();
  const zonePresence = new Map();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitBoxEdges = new THREE.EdgesGeometry(unitBox);
  unitBox.dispose();
  const centroidGeometry = new THREE.SphereGeometry(0.045, 12, 8);

  const homePosition = new THREE.Vector3(0, 2.5, 7.5);
  const homeTarget = new THREE.Vector3(0, 1.2, 0);
  let rightInset = 0;
  let insetAnimationFrame;

  function resetCamera() {
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

  function resize() {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    setupGroup.traverse((object) => {
      if (object.material?.isLineMaterial) object.material.resolution.set(width, height);
    });
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
      updateLabel(view, id, uuid);

      if (object.hasCluster()) updateCluster(view, object.getCluster());
      else hideCluster(view);

      if (object.hasPointCloud()) updatePoints(view, object.getPointCloud());
      else view.points.visible = false;
    });

    for (const [key, view] of views) {
      if (view.sceneAddress === sceneAddress && !active.has(key)) {
        disposeView(view);
        views.delete(key);
      }
    }

    updateZonePresence(frame.getZoneEvents());
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
        new THREE.BufferAttribute(data, 3)
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
    zoneViews.clear();
    addContainer(root, setupGroup);
    updateHomeFromSetup();
  }

  function addContainer(container, parent) {
    const group = new THREE.Group();
    group.name = `augmenta:${container.getAddress()}`;

    group.position.fromArray(container.getPosition());
    setSetupRotation(group, container.getRotation());
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
    // AxisTransform returns size as positive magnitudes. In Y-up/right-handed
    // space the original +Z extent points toward local -Z.
    edges.position.set(size[0] / 2, size[1] / 2, -size[2] / 2);
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
    floor.position.set(size[0] / 2, 0.002, -size[2] / 2);
    group.add(floor);
  }

  function addZone(container, group) {
    const params = container.getZoneParameters();
    const geometry = zoneGeometry(params);
    if (!geometry) return;

    const presenceGeometry = geometry.clone();
    const outline = createZoneOutline(params, geometry, ZONE_OUTLINE_COLOR);
    geometry.dispose();

    if (params.isBox()) {
      const size = params.getBoxShapeParameters().size;
      // Box size is a magnitude; preserve the requested right-handed -Z
      // direction for the local [0..size] Augmenta box volume.
      outline.position.set(size[0] / 2, size[1] / 2, -size[2] / 2);
    } else if (params.isCylinder()) {
      outline.position.y = params.getCylinderShapeParameters().height / 2;
    }

    const presenceMesh = new THREE.Mesh(
      presenceGeometry,
      new THREE.MeshBasicMaterial({
        color: ZONE_VISUAL_COLOR,
        transparent: true,
        opacity: ZONE_PRESENCE_IDLE_OPACITY,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      })
    );
    presenceMesh.name = 'Zone presence';
    presenceMesh.position.copy(outline.position);
    presenceMesh.rotation.copy(outline.rotation);
    presenceMesh.renderOrder = 5;
    presenceMesh.visible = true;

    outline.renderOrder = 6;
    group.add(presenceMesh, outline);

    const address = container.getAddress();
    if (!address) return;

    const label = createZonePresenceLabel('');
    label.visible = false;
    positionZoneLabel(label, params);
    group.add(label);

    const view = {
      label,
      labelText: '',
      labelBaseScale: label.scale.clone(),
      presence: 0,
      presenceMesh,
      fillPulseStartedAt: 0,
      fillFadeStartedAt: 0,
      fillFadeFromOpacity: 0,
      labelPulseStartedAt: 0,
      labelPulseDirection: 1
    };
    zoneViews.set(address, view);
    setZonePresence(view, zonePresence.get(address) ?? 0);
  }

  function positionZoneLabel(label, params) {
    let x = 0;
    let y = -ZONE_PRESENCE_LABEL_GAP;
    let z = 0;

    if (params.isBox()) {
      const size = params.getBoxShapeParameters().size;
      x = size[0] / 2;
      z = -size[2] / 2;
    } else if (params.isSphere()) {
      y = -Math.abs(params.getSphereShapeParameters().radius) - ZONE_PRESENCE_LABEL_GAP;
    }

    label.position.set(x, y, z);
  }

  function updateZonePresence(events) {
    for (const event of events) {
      const address = event.getEmitterZoneAddress();
      const presence = event.getPresence();
      zonePresence.set(address, presence);

      const view = zoneViews.get(address);
      if (view) setZonePresence(view, presence, event.getEnters());
    }
  }

  function setZonePresence(view, presence, enters = 0) {
    const nextPresence = Number.isFinite(presence) ? Math.max(0, presence) : 0;
    const previousPresence = view.presence;
    const active = nextPresence > 0;
    const now = performance.now();

    if (active) {
      view.presenceMesh.visible = true;
      view.fillFadeStartedAt = 0;
      view.presenceMesh.material.opacity = ZONE_PRESENCE_OPACITY;
      if (enters > 0) view.fillPulseStartedAt = now;
    } else if (previousPresence > 0 && view.presenceMesh.visible) {
      view.fillPulseStartedAt = 0;
      view.fillFadeStartedAt = now;
      view.fillFadeFromOpacity = Math.max(
        view.presenceMesh.material.opacity,
        ZONE_PRESENCE_OPACITY
      );
    } else {
      view.presenceMesh.visible = true;
      view.presenceMesh.material.opacity = ZONE_PRESENCE_IDLE_OPACITY;
    }

    if (!active) {
      view.label.visible = false;
      view.labelPulseStartedAt = 0;
      view.label.scale.copy(view.labelBaseScale);
      view.label.material.opacity = ZONE_PRESENCE_LABEL_OPACITY;
      view.presence = nextPresence;
      return;
    }

    if (
      nextPresence !== previousPresence
      && nextPresence > 0
      && previousPresence > 0
    ) {
      view.labelPulseStartedAt = now;
      view.labelPulseDirection = nextPresence > previousPresence ? 1 : -1;
    }

    const text = String(nextPresence);
    if (view.labelText !== text) {
      replaceZonePresenceLabelTexture(view.label, text);
      view.labelText = text;
    }
    view.label.visible = true;
    view.presence = nextPresence;
  }

  function updateZonePresenceAnimation(now) {
    for (const view of zoneViews.values()) {
      if (view.presence > 0 && view.presenceMesh.visible) {
        let opacity = ZONE_PRESENCE_OPACITY;
        if (view.fillPulseStartedAt > 0) {
          const elapsed = now - view.fillPulseStartedAt;
          if (elapsed < ZONE_PRESENCE_PULSE_DURATION_MS) {
            const phase = elapsed / ZONE_PRESENCE_PULSE_DURATION_MS;
            opacity +=
              (ZONE_PRESENCE_PULSE_OPACITY - ZONE_PRESENCE_OPACITY)
              * Math.sin(Math.PI * phase);
          } else {
            view.fillPulseStartedAt = 0;
          }
        }
        view.presenceMesh.material.opacity = opacity;
      } else if (view.fillFadeStartedAt > 0 && view.presenceMesh.visible) {
        const phase = Math.min(
          (now - view.fillFadeStartedAt) / ZONE_PRESENCE_FADE_DURATION_MS,
          1
        );
        view.presenceMesh.material.opacity =
          ZONE_PRESENCE_IDLE_OPACITY
          + (view.fillFadeFromOpacity - ZONE_PRESENCE_IDLE_OPACITY)
          * Math.pow(1 - phase, 2);

        if (phase >= 1) {
          view.fillFadeStartedAt = 0;
          view.presenceMesh.material.opacity = ZONE_PRESENCE_IDLE_OPACITY;
          view.presenceMesh.visible = true;
        }
      }

      if (view.labelPulseStartedAt > 0 && view.label.visible) {
        const elapsed = now - view.labelPulseStartedAt;
        if (elapsed < ZONE_PRESENCE_LABEL_PULSE_DURATION_MS) {
          const phase = elapsed / ZONE_PRESENCE_LABEL_PULSE_DURATION_MS;
          const pulse = Math.sin(Math.PI * phase);
          view.label.scale.copy(view.labelBaseScale).multiplyScalar(
            1 + view.labelPulseDirection * pulse * 0.035
          );
          view.label.material.opacity = ZONE_PRESENCE_LABEL_OPACITY;
        } else {
          view.labelPulseStartedAt = 0;
          view.label.scale.copy(view.labelBaseScale);
          view.label.material.opacity = ZONE_PRESENCE_LABEL_OPACITY;
        }
      }
    }
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
        return undefined;
    }
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

    // Keep orbiting around the center of the currently displayed setup without
    // moving the camera position when setup/connect updates arrive.
    controls.target.copy(center);
    controls.update();

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

    zonePresence.clear();
    for (const view of zoneViews.values()) setZonePresence(view, 0);
  }

  function clearSetup() {
    clearGroup(setupGroup);
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
    updateZonePresenceAnimation(performance.now());

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
    resetCamera,
    setRightInset,
    setVisibility
  };
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

function createZoneOutline(params, sourceGeometry, color) {
  let positions;

  if (params.isBox()) {
    const edges = new THREE.EdgesGeometry(sourceGeometry);
    positions = Array.from(edges.attributes.position.array);
    edges.dispose();
  } else if (params.isCylinder()) {
    const { radius, height } = params.getCylinderShapeParameters();
    positions = cylinderOutlinePositions(
      Math.max(Math.abs(radius), 0.001),
      Math.max(Math.abs(height), 0.001)
    );
  } else if (params.isSphere()) {
    positions = sphereOutlinePositions(
      Math.max(Math.abs(params.getSphereShapeParameters().radius), 0.001)
    );
  } else {
    positions = [];
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new LineMaterial({
    color: color.getHex(),
    linewidth: ZONE_OUTLINE_WIDTH,
    transparent: true,
    opacity: 0.99,
    depthTest: false,
    depthWrite: false
  });
  material.resolution.set(
    Math.max(window.innerWidth, 1),
    Math.max(window.innerHeight, 1)
  );

  const outline = new LineSegments2(geometry, material);
  outline.name = 'Zone outline';
  return outline;
}

function cylinderOutlinePositions(radius, height) {
  const positions = [];
  const halfHeight = height / 2;

  for (const y of [-halfHeight, halfHeight]) {
    addCircleSegments(positions, radius, ROUND_OUTLINE_SEGMENTS, (angle) => [
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius
    ]);
  }

  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, -halfHeight, z, x, halfHeight, z);
  }

  return positions;
}

function sphereOutlinePositions(radius) {
  const positions = [];

  addCircleSegments(positions, radius, ROUND_OUTLINE_SEGMENTS, (angle) => [
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius
  ]);
  addCircleSegments(positions, radius, ROUND_OUTLINE_SEGMENTS, (angle) => [
    Math.cos(angle) * radius,
    Math.sin(angle) * radius,
    0
  ]);
  addCircleSegments(positions, radius, ROUND_OUTLINE_SEGMENTS, (angle) => [
    0,
    Math.sin(angle) * radius,
    Math.cos(angle) * radius
  ]);

  return positions;
}

function addCircleSegments(target, _radius, segments, pointAt) {
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    const b = (i + 1) / segments * Math.PI * 2;
    target.push(...pointAt(a), ...pointAt(b));
  }
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

  const displayLength = Math.max(speed * VELOCITY_DISPLAY_SCALE, VELOCITY_MIN_DISPLAY_LENGTH);
  const headLength = Math.min(Math.max(displayLength * 0.22, 0.09), 0.32);
  const headWidth = Math.min(Math.max(headLength * 0.55, 0.055), 0.18);
  arrow.setLength(displayLength, headLength, headWidth);
  arrow.setColor(color);
}

function disposeArrow(arrow) {
  arrow.line.geometry.dispose();
  arrow.line.material.dispose();
  arrow.cone.geometry.dispose();
  arrow.cone.material.dispose();
  arrow.parent?.remove(arrow);
}

function createZonePresenceLabel(text) {
  const material = new THREE.SpriteMaterial({
    map: makeZonePresenceLabelTexture(text),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: ZONE_PRESENCE_LABEL_OPACITY
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.63, 0.24, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function replaceZonePresenceLabelTexture(sprite, text) {
  sprite.material.map?.dispose();
  sprite.material.map = makeZonePresenceLabelTexture(text);
  sprite.material.needsUpdate = true;
}

function makeZonePresenceLabelTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(ctx, 28, 16, 200, 64, 21);
  ctx.fillStyle = 'rgba(55, 59, 67, 0.62)';
  ctx.fill();

  ctx.strokeStyle = '#9ba1aa';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = '#c2c6cc';
  ctx.font = '700 36px Inter, Arial, sans-serif';
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

// Scene/zone dimensions are magnitudes. Geometry placement above preserves
// the requested Y-up/right-handed direction while this helper keeps sizes valid.
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
