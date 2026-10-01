import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { ShapeType } from 'augmenta-client-sdk';
import { readZoneEventState } from './zone-state.js';

const ZONE_PRESENCE_LABEL_GAP = 0.32;
const ZONE_PRESENCE_LABEL_OPACITY = 0.9;
const ZONE_PRESENCE_LABEL_PULSE_DURATION_MS = 180;
const ZONE_PRESENCE_LABEL_FLASH_DURATION_MS = 220;
const ZONE_FILL_OPACITY = 0.025;
const ZONE_VISUAL_COLOR = new THREE.Color(0x969ba3);
const ZONE_OUTLINE_COLOR = ZONE_VISUAL_COLOR;
const ZONE_ACTIVE_OUTLINE_COLOR = new THREE.Color(0xe4e7ec);
const ZONE_IDLE_OUTLINE_OPACITY = 0.14;
const ZONE_ACTIVE_OUTLINE_OPACITY = 0.62;
const ZONE_ACTIVE_OUTLINE_PULSE_OPACITY = 0.72;
const ZONE_OUTLINE_WIDTH = 1.7;
const ZONE_ACTIVE_OUTLINE_WIDTH = 2.6;
const ROUND_ZONE_EDGE_WIDTH = 1.0;
const ROUND_ZONE_ACTIVE_EDGE_WIDTH = 2.1;
const ZONE_SILHOUETTE_IDLE_WIDTH = 0.16;
const ZONE_SILHOUETTE_ACTIVE_WIDTH = 0.23;
const ZONE_OUTLINE_PULSE_DURATION_MS = 1400;
const ZONE_XY_PAD_FILL_OPACITY = 0.18;
const ZONE_XY_PAD_AXIS_OPACITY = 0.78;
const ZONE_XY_PAD_AXIS_WIDTH = 1.5;
const ZONE_SLIDER_FILL_OPACITY = 0.22;
const ZONE_LABEL_OUTLINE_WIDTH = 4;
const ROUND_OUTLINE_SEGMENTS = 32;

export function createZoneRenderer() {
  const views = new Map();
  const presenceByAddress = new Map();
  const xyPadByAddress = new Map();
  const sliderByAddress = new Map();

  function resetViews() {
    views.clear();
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
        opacity: ZONE_FILL_OPACITY,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
      })
    );
    presenceMesh.name = 'Zone presence';
    presenceMesh.position.copy(outline.position);
    presenceMesh.rotation.copy(outline.rotation);
    presenceMesh.renderOrder = 5;

    outline.renderOrder = 6;
    group.add(presenceMesh, outline);

    const xyPad = params.isBox() ? createBoxXYPad(params) : undefined;
    if (xyPad) group.add(xyPad.group);

    const slider = params.isCylinder() || params.isSphere()
      ? createRoundZoneSlider(params, presenceGeometry)
      : undefined;
    if (slider) {
      slider.mesh.position.copy(outline.position);
      slider.mesh.rotation.copy(outline.rotation);
      group.add(slider.mesh);
    }

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
      outline,
      xyPad,
      slider,
      presenceStartedAt: 0,
      labelPulseStartedAt: 0,
      labelFlashStartedAt: 0,
      labelPulseDirection: 1
    };
    views.set(address, view);
    setPresence(view, presenceByAddress.get(address) ?? 0);

    const xyPadValue = xyPadByAddress.get(address);
    if (xyPadValue) updateBoxXYPad(view.xyPad, xyPadValue.x, xyPadValue.y);

    const sliderValue = sliderByAddress.get(address);
    if (sliderValue !== undefined) updateRoundZoneSlider(view.slider, sliderValue);
  }

  function update(events) {
    for (const event of events) {
      const state = readZoneEventState(event);
      const { address, presence } = state;

      // Cache the complete event before touching the view. Setup/control
      // messages can race live data, so a zone created on the next setup
      // render must still recover its latest presence/slider/XY state.
      presenceByAddress.set(address, presence);
      if (state.slider !== undefined) sliderByAddress.set(address, state.slider);
      if (state.xyPad) xyPadByAddress.set(address, state.xyPad);

      const view = views.get(address);
      if (!view) continue;

      setPresence(view, presence);
      if (state.slider !== undefined) updateRoundZoneSlider(view.slider, state.slider);
      if (state.xyPad) updateBoxXYPad(view.xyPad, state.xyPad.x, state.xyPad.y);
    }
  }

  function clearPresence() {
    presenceByAddress.clear();
    xyPadByAddress.clear();
    sliderByAddress.clear();
    for (const view of views.values()) {
      setPresence(view, 0);
      if (view.xyPad) view.xyPad.group.visible = false;
      if (view.slider) view.slider.mesh.visible = false;
    }
  }

  function pruneState(validAddresses) {
    for (const cache of [presenceByAddress, xyPadByAddress, sliderByAddress]) {
      for (const address of cache.keys()) {
        if (!validAddresses.has(address)) cache.delete(address);
      }
    }
  }

  function animate(now) {
    for (const view of views.values()) {
      if (view.presence > 0) {
        const elapsed = Math.max(0, now - view.presenceStartedAt);
        const phase = (elapsed % ZONE_OUTLINE_PULSE_DURATION_MS) / ZONE_OUTLINE_PULSE_DURATION_MS;
        const pulse = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
        updateOutlineStyle(view, true, pulse);
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

      if (
        view.labelFlashStartedAt > 0
        && now - view.labelFlashStartedAt >= ZONE_PRESENCE_LABEL_FLASH_DURATION_MS
      ) {
        view.labelFlashStartedAt = 0;
        replaceZonePresenceLabelTexture(view.label, view.labelText, false);
      }
    }
  }

  return { addZone, update, clearPresence, pruneState, resetViews, animate };
}

function setPresence(view, presence) {
  const nextPresence = Number.isFinite(presence) ? Math.max(0, presence) : 0;
  const previousPresence = view.presence;
  const active = nextPresence > 0;
  const now = performance.now();

  // Presence changes the outline only. The faint neutral fill stays constant.
  view.presenceMesh.material.opacity = ZONE_FILL_OPACITY;
  if (active && previousPresence <= 0) view.presenceStartedAt = now;
  if (!active) view.presenceStartedAt = 0;
  updateOutlineStyle(view, active, 0);

  if (!active) {
    view.label.visible = false;
    view.labelPulseStartedAt = 0;
    view.labelFlashStartedAt = 0;
    view.label.scale.copy(view.labelBaseScale);
    view.label.material.opacity = ZONE_PRESENCE_LABEL_OPACITY;
    view.presence = nextPresence;
    return;
  }

  const presenceChanged = nextPresence !== previousPresence;
  if (presenceChanged) {
    view.labelPulseStartedAt = now;
    view.labelFlashStartedAt = now;
    view.labelPulseDirection = nextPresence > previousPresence ? 1 : -1;
  }

  const text = String(nextPresence);
  if (view.labelText !== text || presenceChanged) {
    replaceZonePresenceLabelTexture(view.label, text, presenceChanged);
    view.labelText = text;
  }
  view.label.visible = true;
  view.presence = nextPresence;
}

function updateOutlineStyle(view, active, pulse) {
  const color = active ? ZONE_ACTIVE_OUTLINE_COLOR : ZONE_OUTLINE_COLOR;
  const opacity = active
    ? THREE.MathUtils.lerp(
        ZONE_ACTIVE_OUTLINE_OPACITY,
        ZONE_ACTIVE_OUTLINE_PULSE_OPACITY,
        pulse
      )
    : ZONE_IDLE_OUTLINE_OPACITY;

  view.outline.traverse((object) => {
    const material = object.material;
    if (!material) return;

    if (material.isShaderMaterial && material.uniforms?.outlineColor) {
      material.uniforms.outlineColor.value.copy(color);
      material.uniforms.outlineOpacity.value = opacity;
      material.uniforms.edgeWidth.value = active
        ? THREE.MathUtils.lerp(
            ZONE_SILHOUETTE_ACTIVE_WIDTH,
            ZONE_SILHOUETTE_ACTIVE_WIDTH * 1.06,
            pulse
          )
        : ZONE_SILHOUETTE_IDLE_WIDTH;
    } else if (material.isLineMaterial) {
      material.color.copy(color);
      material.opacity = opacity;
      const idleWidth = object.userData.idleWidth ?? material.linewidth;
      const activeWidth = object.userData.activeWidth ?? idleWidth;
      material.linewidth = active
        ? THREE.MathUtils.lerp(activeWidth, activeWidth * 1.05, pulse)
        : idleWidth;
    }
  });
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

function createZoneOutline(params, sourceGeometry, color) {
  const outline = new THREE.Group();
  outline.name = 'Zone outline';

  // Round zones keep the camera-dependent silhouette. Boxes use explicit edges.
  if (!params.isBox()) {
    const silhouette = new THREE.Mesh(
      sourceGeometry.clone(),
      createSilhouetteMaterial(color)
    );
    silhouette.name = 'Zone silhouette';
    silhouette.renderOrder = 6;
    outline.add(silhouette);
  }

  if (params.isBox()) {
    const edges = new THREE.EdgesGeometry(sourceGeometry);
    const positions = Array.from(edges.attributes.position.array);
    edges.dispose();

    const boxEdges = createWideLineSegments(
      positions,
      color,
      ZONE_OUTLINE_WIDTH,
      'Zone edges',
      ZONE_IDLE_OUTLINE_OPACITY
    );
    boxEdges.userData.idleWidth = ZONE_OUTLINE_WIDTH;
    boxEdges.userData.activeWidth = ZONE_ACTIVE_OUTLINE_WIDTH;
    boxEdges.renderOrder = 7;
    outline.add(boxEdges);
    return outline;
  }

  let guidePositions = [];
  if (params.isCylinder()) {
    const { radius, height } = params.getCylinderShapeParameters();
    guidePositions = cylinderRingPositions(
      Math.max(Math.abs(radius), 0.001),
      Math.max(Math.abs(height), 0.001)
    );
  } else if (params.isSphere()) {
    guidePositions = sphereEquatorPositions(
      Math.max(Math.abs(params.getSphereShapeParameters().radius), 0.001)
    );
  }

  if (guidePositions.length) {
    const guides = createWideLineSegments(
      guidePositions,
      color,
      ROUND_ZONE_EDGE_WIDTH,
      'Zone guide',
      ZONE_IDLE_OUTLINE_OPACITY
    );
    guides.userData.idleWidth = ROUND_ZONE_EDGE_WIDTH;
    guides.userData.activeWidth = ROUND_ZONE_ACTIVE_EDGE_WIDTH;
    guides.renderOrder = 7;
    outline.add(guides);
  }

  return outline;
}

function createSilhouetteMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      outlineColor: { value: color.clone() },
      outlineOpacity: { value: ZONE_IDLE_OUTLINE_OPACITY },
      edgeWidth: { value: ZONE_SILHOUETTE_IDLE_WIDTH }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 outlineColor;
      uniform float outlineOpacity;
      uniform float edgeWidth;
      varying vec3 vNormal;
      varying vec3 vViewDirection;

      void main() {
        float facing = abs(dot(normalize(vNormal), normalize(vViewDirection)));
        float alpha = 1.0 - smoothstep(0.0, edgeWidth, facing);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(outlineColor, alpha * outlineOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function createWideLineSegments(positions, color, width, name, opacity = 0.99) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new LineMaterial({
    color: color.getHex(),
    linewidth: width,
    transparent: true,
    opacity,
    depthTest: false,
    depthWrite: false
  });
  material.resolution.set(
    Math.max(window.innerWidth, 1),
    Math.max(window.innerHeight, 1)
  );

  const lines = new LineSegments2(geometry, material);
  lines.name = name;
  lines.renderOrder = 7;
  return lines;
}

function cylinderRingPositions(radius, height) {
  const positions = [];
  const halfHeight = height / 2;

  for (const y of [-halfHeight, halfHeight]) {
    addCircleSegments(positions, ROUND_OUTLINE_SEGMENTS, (angle) => [
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius
    ]);
  }

  return positions;
}

function sphereEquatorPositions(radius) {
  const positions = [];
  addCircleSegments(positions, ROUND_OUTLINE_SEGMENTS, (angle) => [
    Math.cos(angle) * radius,
    0,
    Math.sin(angle) * radius
  ]);
  return positions;
}

function addCircleSegments(target, segments, pointAt) {
  for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2;
    const b = (i + 1) / segments * Math.PI * 2;
    target.push(...pointAt(a), ...pointAt(b));
  }
}

function createBoxXYPad(params) {
  const size = params.getBoxShapeParameters().size;
  const width = Math.max(Math.abs(size[0]), 0.001);
  const depth = Math.max(Math.abs(size[2]), 0.001);
  const y = 0.008;

  const axes = createWideLineSegments(
    [0, y, 0, 0, y, -depth, 0, y, 0, width, y, 0],
    ZONE_ACTIVE_OUTLINE_COLOR,
    ZONE_XY_PAD_AXIS_WIDTH,
    'Zone XY pad axes'
  );
  axes.material.opacity = ZONE_XY_PAD_AXIS_OPACITY;
  axes.renderOrder = 8;

  const fillGeometry = new THREE.BufferGeometry();
  fillGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(12), 3)
  );
  fillGeometry.setIndex([0, 1, 2, 2, 1, 3]);

  const fill = new THREE.Mesh(
    fillGeometry,
    new THREE.MeshBasicMaterial({
      color: ZONE_ACTIVE_OUTLINE_COLOR,
      transparent: true,
      opacity: ZONE_XY_PAD_FILL_OPACITY,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false
    })
  );
  fill.name = 'Zone XY pad quadrant';
  fill.renderOrder = 7;

  const group = new THREE.Group();
  group.name = 'Zone XY pad';
  group.visible = false;
  group.add(fill, axes);

  return { group, axes, fill, width, depth, y };
}

function updateBoxXYPad(xyPad, rawX, rawY) {
  if (!xyPad || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return;

  const x = THREE.MathUtils.clamp(rawX, 0, 1);
  const y = THREE.MathUtils.clamp(rawY, 0, 1);
  const px = x * xyPad.width;
  const pz = -y * xyPad.depth;
  const floorY = xyPad.y;

  xyPad.axes.geometry.setPositions([
    px, floorY, 0,
    px, floorY, -xyPad.depth,
    0, floorY, pz,
    xyPad.width, floorY, pz
  ]);
  xyPad.axes.geometry.computeBoundingBox();
  xyPad.axes.geometry.computeBoundingSphere();

  const positions = xyPad.fill.geometry.getAttribute('position');
  positions.array.set([
    0, floorY, 0,
    px, floorY, 0,
    0, floorY, pz,
    px, floorY, pz
  ]);
  positions.needsUpdate = true;
  xyPad.fill.geometry.computeBoundingBox();
  xyPad.fill.geometry.computeBoundingSphere();
  xyPad.group.visible = true;
}

function createRoundZoneSlider(params, sourceGeometry) {
  const axisName = params.getLocalSliderAxis();
  const axis = axisName === 'y'
    ? new THREE.Vector3(0, 1, 0)
    : axisName === 'z'
      ? new THREE.Vector3(0, 0, 1)
      : new THREE.Vector3(1, 0, 0);

  let min = -0.5;
  let max = 0.5;
  if (params.isCylinder()) {
    const { radius, height } = params.getCylinderShapeParameters();
    const r = Math.max(Math.abs(radius), 0.001);
    const h = Math.max(Math.abs(height), 0.001);
    min = axisName === 'y' ? -h / 2 : -r;
    max = axisName === 'y' ? h / 2 : r;
  } else if (params.isSphere()) {
    const radius = Math.max(Math.abs(params.getSphereShapeParameters().radius), 0.001);
    min = -radius;
    max = radius;
  }

  const material = new THREE.ShaderMaterial({
    uniforms: {
      fillColor: { value: ZONE_ACTIVE_OUTLINE_COLOR.clone() },
      fillOpacity: { value: ZONE_SLIDER_FILL_OPACITY },
      sliderAxis: { value: axis },
      sliderMin: { value: min },
      sliderMax: { value: max },
      sliderValue: { value: 0 }
    },
    vertexShader: `
      varying vec3 vLocalPosition;

      void main() {
        vLocalPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 fillColor;
      uniform float fillOpacity;
      uniform vec3 sliderAxis;
      uniform float sliderMin;
      uniform float sliderMax;
      uniform float sliderValue;
      varying vec3 vLocalPosition;

      void main() {
        float span = max(sliderMax - sliderMin, 0.0001);
        float coordinate = dot(vLocalPosition, sliderAxis);
        float normalizedCoordinate = (coordinate - sliderMin) / span;
        if (normalizedCoordinate > sliderValue) discard;
        gl_FragColor = vec4(fillColor, fillOpacity);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const mesh = new THREE.Mesh(sourceGeometry.clone(), material);
  mesh.name = 'Zone slider fill';
  mesh.visible = false;
  mesh.renderOrder = 6;

  return { mesh };
}

function updateRoundZoneSlider(slider, rawValue) {
  if (!slider || !Number.isFinite(rawValue)) return;

  // The WebSocket slider value is normalized by default in Pleiades. Clamp to
  // the drawable range so malformed/out-of-range values cannot overfill.
  slider.mesh.material.uniforms.sliderValue.value = THREE.MathUtils.clamp(rawValue, 0, 1);
  slider.mesh.visible = true;
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

function replaceZonePresenceLabelTexture(sprite, text, flash = false) {
  sprite.material.map?.dispose();
  sprite.material.map = makeZonePresenceLabelTexture(text, flash);
  sprite.material.needsUpdate = true;
}

function makeZonePresenceLabelTexture(text, flash = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;

  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);

  const outlineColor = `#${ZONE_ACTIVE_OUTLINE_COLOR.getHexString()}`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  roundedRect(ctx, 28, 16, 200, 64, 21);
  ctx.fillStyle = flash
    ? 'rgba(70, 76, 88, 0.96)'
    : 'rgba(10, 13, 18, 0.94)';
  ctx.fill();

  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = ZONE_LABEL_OUTLINE_WIDTH;
  ctx.stroke();

  ctx.fillStyle = '#d7dbe1';
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

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function positiveSize(size) {
  return size.map((v) => Math.max(Math.abs(v), 0.001));
}
