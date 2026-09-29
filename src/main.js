import {
  AugmentaWebSocketClient, AxisMode, CoordinateSpace, OriginMode, RotationMode
} from 'augmenta-client-sdk';
import { createViewer } from './viewer.js';
import { createDebugPanel } from './debug.js';
import { makeDemoFrame, makeDemoSetup } from './demo.js';

const RECONNECT_DELAY_MS = 1000;
const DISCONNECT_CLEANUP_DELAY_MS = 500;
const $ = (selector) => document.querySelector(selector);
const ui = {
  endpoint: $('#endpoint'), protocol: $('#protocol'), downsample: $('#downsample'), connect: $('#connect'),
  demo: $('#demo'), status: $('#status'), note: $('#connection-note'), summary: $('#summary'),
  debug: $('#debug-content'), clear: $('#clear'), resetCamera: $('#reset-camera'), world: $('#world'),
  showClusters: $('#show-clusters'), showPoints: $('#show-points'), showZones: $('#show-zones'), showVectors: $('#show-vectors')
};

const viewer = createViewer($('#canvas-host'));
const debug = createDebugPanel(ui.summary, ui.debug);

let augmenta;
let reconnectTimer;
let disconnectCleanupTimer;
let demoTimer;
let wantsConnection = false;
let socketOpen = false;
let autoNegotiatedVersion;
let activeVersion;
let lastFrame;
let lastControl;
let setupRoot;
let displayTargets = [];
let frameTimes = [];

function setStatus(text, kind = 'idle') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function updateConnectionButton() {
  ui.connect.textContent = !wantsConnection ? 'Connect' : socketOpen ? 'Connected' : 'Connecting…';
  ui.connect.classList.toggle('active', wantsConnection);
  ui.connect.setAttribute('aria-pressed', String(wantsConnection));
  ui.connect.title = wantsConnection ? 'Click to stop the connection' : 'Connect to Augmenta';
}

function updateSimulationButton() {
  const running = Boolean(demoTimer);
  ui.demo.textContent = running ? 'Simulating' : 'Simulate data';
  ui.demo.classList.toggle('active', running);
  ui.demo.setAttribute('aria-pressed', String(running));
  ui.demo.title = running ? 'Click to stop simulation' : 'Simulate Augmenta data locally';
}

function fps() { return frameTimes.length; }

function trackFrame(frame) {
  const target = selectedDisplayTarget();
  if (target?.isScene?.()) {
    const sceneAddress = frame.getSceneInfo().getAddress();
    if (sceneAddress && sceneAddress !== target.getAddress()) {
      viewer.clearTracking();
      return;
    }
  }

  lastFrame = frame;
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((time) => time >= now - 1000);
  viewer.renderFrame(frame);
  debug.render(lastFrame, lastControl, fps());
}

function clearReconnectTimer() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function clearDisconnectCleanupTimer() {
  if (disconnectCleanupTimer) window.clearTimeout(disconnectCleanupTimer);
  disconnectCleanupTimer = undefined;
}

function scheduleDisconnectCleanup() {
  clearDisconnectCleanupTimer();
  disconnectCleanupTimer = window.setTimeout(() => {
    disconnectCleanupTimer = undefined;
    if (socketOpen || !wantsConnection) return;
    clearDisplay();
  }, DISCONNECT_CLEANUP_DELAY_MS);
}

function stopTransport(reason = 'User disconnect') {
  clearReconnectTimer();
  clearDisconnectCleanupTimer();
  socketOpen = false;
  const client = augmenta;
  augmenta = undefined;
  client?.disconnect(1000, reason);
  updateConnectionButton();
}

function stopConnection({ quiet = false } = {}) {
  wantsConnection = false;
  autoNegotiatedVersion = undefined;
  stopTransport();
  clearDisplay();
  if (!quiet) {
    setStatus('Idle');
    ui.note.textContent = 'Connection stopped.';
  }
}

function stopSimulation({ quiet = false } = {}) {
  if (demoTimer) window.clearInterval(demoTimer);
  demoTimer = undefined;
  updateSimulationButton();
  if (!quiet && !wantsConnection) {
    setStatus('Idle');
    ui.note.textContent = 'Simulation stopped.';
  }
}

function clearTracking() {
  viewer.clearTracking();
  lastFrame = undefined;
  frameTimes = [];
}

function clearDebugData() {
  lastFrame = undefined;
  lastControl = undefined;
  frameTimes = [];
  debug.clear();
}

function clearDisplay() {
  clearTracking();
  viewer.clearSetup();
  clearDebugData();
  resetWorldSelector();
}

function resetWorldSelector() {
  setupRoot = undefined;
  displayTargets = [];
  ui.world.innerHTML = '<option value="">Waiting for setup…</option>';
  ui.world.disabled = true;
}

function collectScenes(container, scenes = []) {
  if (!container) return scenes;
  if (container.isScene?.()) scenes.push(container);
  for (const child of container.getChildren?.() ?? []) collectScenes(child, scenes);
  return scenes;
}

function selectedDisplayTarget() {
  return displayTargets[Number(ui.world.value)] ?? setupRoot;
}

function refreshWorldSelector(root) {
  const previous = selectedDisplayTarget();
  const previousKey = previous ? `${previous.getType?.()}|${previous.getAddress?.()}|${previous.getName?.()}` : '';

  setupRoot = root;
  const scenes = collectScenes(root);
  displayTargets = root.isWorld?.() ? [root, ...scenes] : scenes.length ? scenes : [root];

  ui.world.innerHTML = displayTargets.map((target, index) => {
    const type = target.isWorld?.() ? 'World' : target.isScene?.() ? 'Scene' : 'Scope';
    const name = target.getName?.() || target.getAddress?.() || `${type} ${index + 1}`;
    return `<option value="${index}">${escapeOption(type)} — ${escapeOption(name)}</option>`;
  }).join('');

  const preservedIndex = previousKey
    ? displayTargets.findIndex((target) =>
        `${target.getType?.()}|${target.getAddress?.()}|${target.getName?.()}` === previousKey)
    : -1;

  ui.world.value = String(preservedIndex >= 0 ? preservedIndex : 0);
  ui.world.disabled = displayTargets.length <= 1;
  renderSelectedWorld();
}

function renderSelectedWorld() {
  const selected = selectedDisplayTarget();
  if (!selected) return;
  viewer.clearTracking();
  viewer.renderSetup(selected);
}

function updateBelongsToSelectedTarget(container) {
  const selected = selectedDisplayTarget();
  if (!selected || selected.isWorld?.()) return true;
  const selectedAddress = selected.getAddress?.() || '';
  const updateAddress = container.getAddress?.() || '';
  return updateAddress === selectedAddress || updateAddress.startsWith(`${selectedAddress}/`);
}

function escapeOption(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function selectedVersion() {
  if (ui.protocol.value === 'auto') return autoNegotiatedVersion ?? 3;
  return Number(ui.protocol.value);
}

function scheduleReconnect(message = 'Connection closed.') {
  if (!wantsConnection) return;
  clearReconnectTimer();
  socketOpen = false;
  updateConnectionButton();
  setStatus('Retrying', 'connecting');
  ui.note.textContent = `${message} Retrying in ${RECONNECT_DELAY_MS / 1000} s…`;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    attemptConnection();
  }, RECONNECT_DELAY_MS);
}

function restartForProtocol(version) {
  if (!wantsConnection || version === activeVersion) return;
  autoNegotiatedVersion = version;
  stopTransport('Protocol negotiation');
  setStatus('Connecting', 'connecting');
  ui.note.textContent = `Server uses protocol V${version}. Reconnecting with the matching parser…`;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    attemptConnection();
  }, 0);
}

function attemptConnection() {
  if (!wantsConnection) return;

  clearReconnectTimer();
  const url = ui.endpoint.value.trim();
  const version = selectedVersion();
  const downSample = Math.max(1, Math.floor(Number(ui.downsample.value) || 1));
  if (!url) {
    stopConnection({ quiet: true });
    setStatus('Error', 'error');
    ui.note.textContent = 'Enter a WebSocket URL.';
    return;
  }

  activeVersion = version;
  socketOpen = false;
  updateConnectionButton();
  setStatus('Connecting', 'connecting');
  ui.note.textContent = `Connecting to ${url} with protocol V${version}…`;

  const connection = new AugmentaWebSocketClient(url, {
    clientName: 'Augmenta Three.js Debug Viewer',
    applicationName: 'Augmenta ThreeJS Example',
    applicationVersion: '1.0.0',
    options: {
      version, downSample,
      streamClouds: true, streamClusters: true, streamClusterPoints: true, streamZonePoints: true,
      useCompression: false, displayPointIntensity: true, boxRotationMode: RotationMode.Quaternions,
      axisTransform: {
        axis: AxisMode.YUpRightHanded,
        origin: OriginMode.BottomLeft,
        coordinateSpace: CoordinateSpace.Absolute
      }
    }
  });

  augmenta = connection;

  connection.on('open', () => {
    if (augmenta !== connection || !wantsConnection) return;
    clearDisconnectCleanupTimer();
    socketOpen = true;
    updateConnectionButton();
    setStatus('Connected', 'connected');
    ui.note.textContent = `Connected to ${url}. Protocol V${activeVersion}; uncompressed debug stream.`;
  });

  connection.on('close', () => {
    if (augmenta !== connection) return;
    augmenta = undefined;
    socketOpen = false;
    updateConnectionButton();
    scheduleDisconnectCleanup();
    scheduleReconnect('Connection closed.');
  });

  connection.on('error', (error) => {
    if (augmenta !== connection) return;
    console.error('Augmenta WebSocket/data error', error);
    if (socketOpen) {
      setStatus('Connected', 'connected');
      ui.note.textContent = error instanceof Error
        ? `Connected, but a message could not be parsed: ${error.message}`
        : 'Connected, but a WebSocket/data error occurred.';
    } else {
      setStatus('Retrying', 'connecting');
      ui.note.textContent = location.protocol === 'https:' && url.startsWith('ws://')
        ? 'Connection failed. This HTTPS page may block an insecure ws:// endpoint; retrying automatically…'
        : 'Connection failed; retrying automatically…';
    }
  });

  connection.on('controlMessage', (message) => {
    if (augmenta !== connection) return;
    lastControl = message;
    debug.render(lastFrame, lastControl, fps(), true);
  });

  connection.on('setup', (message) => {
    if (augmenta !== connection) return;
    const serverVersion = message.getServerProtocolVersion();
    if (ui.protocol.value === 'auto' && Number.isInteger(serverVersion) && serverVersion >= 2 && serverVersion < activeVersion) {
      restartForProtocol(serverVersion);
      return;
    }
    refreshWorldSelector(message.getRootObject());
  });

  connection.on('update', (message) => {
    if (augmenta !== connection) return;
    const container = message.getRootObject();
    if (updateBelongsToSelectedTarget(container)) viewer.upsertSetup(container);
  });

  connection.on('data', (frame) => {
    if (augmenta === connection) trackFrame(frame);
  });

  try {
    connection.connect();
  } catch (error) {
    if (augmenta === connection) augmenta = undefined;
    console.error('Augmenta connection failed', error);
    scheduleReconnect(error instanceof Error ? error.message : 'Connection failed.');
  }
}

function toggleConnection() {
  if (wantsConnection) {
    stopConnection();
    return;
  }

  stopSimulation({ quiet: true });
  clearDisplay();
  autoNegotiatedVersion = undefined;
  wantsConnection = true;
  updateConnectionButton();
  attemptConnection();
}

function startSimulation() {
  stopConnection({ quiet: true });
  clearTracking();
  viewer.clearSetup();
  setStatus('Simulating', 'demo');
  ui.note.textContent = 'Local synthetic stream using the Augmenta SDK data model. Click Simulating to stop.';
  lastControl = makeDemoSetup();
  refreshWorldSelector(lastControl.getRootObject());
  const start = performance.now();
  const tick = () => trackFrame(makeDemoFrame((performance.now() - start) / 1000));
  tick();
  demoTimer = window.setInterval(tick, 33);
  updateSimulationButton();
}

function toggleSimulation() {
  if (demoTimer) stopSimulation();
  else startSimulation();
}

function applyVisibility() {
  viewer.setVisibility({
    clusters: ui.showClusters.checked,
    points: ui.showPoints.checked,
    zones: ui.showZones.checked,
    vectors: ui.showVectors.checked
  });
}

ui.connect.addEventListener('click', toggleConnection);
ui.demo.addEventListener('click', toggleSimulation);
ui.clear.addEventListener('click', clearDebugData);
ui.resetCamera.addEventListener('click', viewer.resetCamera);
ui.world.addEventListener('change', renderSelectedWorld);
ui.endpoint.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!wantsConnection) {
    toggleConnection();
    return;
  }
  autoNegotiatedVersion = undefined;
  stopTransport('Endpoint changed');
  attemptConnection();
});
ui.protocol.addEventListener('change', () => {
  if (!wantsConnection) return;
  autoNegotiatedVersion = undefined;
  stopTransport('Protocol changed');
  attemptConnection();
});
ui.downsample.addEventListener('change', () => {
  if (!wantsConnection) return;
  stopTransport('Downsample changed');
  attemptConnection();
});
[ui.showClusters, ui.showPoints, ui.showZones, ui.showVectors]
  .forEach((input) => input.addEventListener('change', applyVisibility));

applyVisibility();
updateConnectionButton();
updateSimulationButton();
resetWorldSelector();

if (location.protocol === 'https:' && ui.endpoint.value.startsWith('ws://')) {
  ui.note.textContent = 'GitHub Pages uses HTTPS. If your browser blocks ws://, use wss:// or run the same example locally over HTTP.';
}
