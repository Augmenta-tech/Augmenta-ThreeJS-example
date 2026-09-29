import {
  AugmentaWebSocketClient, AxisMode, CoordinateSpace, RotationMode
} from 'augmenta-client-sdk';
import { createViewer } from './viewer.js';
import { createDebugPanel } from './debug.js';
import { makeDemoFrame, makeDemoSetup } from './demo.js';

const RECONNECT_DELAY_MS = 1000;
const DISCONNECT_CLEANUP_DELAY_MS = 500;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 720;
const SIDEBAR_VIEWPORT_MARGIN = 160;
const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('#app'), sidebar: $('#sidebar'), sidebarResizer: $('#sidebar-resizer'), endpoint: $('#endpoint'), protocol: $('#protocol'), downsample: $('#downsample'), connect: $('#connect'),
  demo: $('#demo'), status: $('#status'), note: $('#connection-note'), summary: $('#summary'),
  debug: $('#debug-content'), clear: $('#clear'), resetCamera: $('#reset-camera'), scenes: $('#scenes'),
  sidebarToggle: $('#sidebar-toggle'),
  showClusters: $('#show-clusters'), showPoints: $('#show-points'), showZones: $('#show-zones'), showVectors: $('#show-vectors')
};

const viewer = createViewer($('#canvas-host'));
const debug = createDebugPanel(ui.summary, ui.debug);

let augmenta;
let reconnectTimer;
let disconnectCleanupTimer;
let demoTimer;
let wantsConnection = true;
let socketOpen = false;
let autoNegotiatedVersion;
let activeVersion;
let lastFrame;
let lastControl;
let setupRoot;
let scenes = [];
let retrying = false;
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
  const scene = selectedScene();
  if (scene) {
    const frameSceneAddress = frame.getSceneInfo().getAddress();
    if (frameSceneAddress && frameSceneAddress !== scene.getAddress()) return;
  }

  lastFrame = frame;
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((time) => time >= now - 1000);
  viewer.renderFrame(frame);
  renderDebug();
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
    clearTracking();
    clearDebugData();
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
  retrying = false;
  autoNegotiatedVersion = undefined;
  stopTransport();
  clearTracking();
  clearDebugData();
  if (!quiet) {
    setStatus('Idle');
    ui.note.textContent = 'Connection stopped. Scene and zones are kept visible.';
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

function resetSceneSelector() {
  setupRoot = undefined;
  scenes = [];
  ui.scenes.innerHTML = '<option value="all">All scenes</option>';
  ui.scenes.value = 'all';
  ui.scenes.disabled = true;
}

function collectScenes(container, output = []) {
  if (!container) return output;
  if (container.isScene?.()) output.push(container);
  for (const child of container.getChildren?.() ?? []) collectScenes(child, output);
  return output;
}

function selectedScene() {
  const address = ui.scenes.value;
  return address === 'all' ? undefined : scenes.find((scene) => scene.getAddress() === address);
}

function sceneSizeForFrame(frame) {
  const address = frame?.getSceneInfo().getAddress();
  const scene = scenes.find((candidate) => candidate.getAddress() === address)
    ?? selectedScene()
    ?? (scenes.length === 1 ? scenes[0] : undefined);
  return scene?.getSceneParameters().size;
}

function renderDebug(force = false) {
  debug.render(lastFrame, lastControl, fps(), sceneSizeForFrame(lastFrame), force);
}

function refreshSceneSelector(root) {
  const previous = ui.scenes.value;
  setupRoot = root;
  scenes = collectScenes(root);

  ui.scenes.innerHTML = [
    '<option value="all">All scenes</option>',
    ...scenes.map((scene, index) => {
      const name = scene.getName?.() || scene.getAddress?.() || `Scene ${index + 1}`;
      return `<option value="${escapeOption(scene.getAddress())}">${escapeOption(name)}</option>`;
    })
  ].join('');

  const stillAvailable = previous === 'all' || scenes.some((scene) => scene.getAddress() === previous);
  ui.scenes.value = stillAvailable ? previous : 'all';
  ui.scenes.disabled = scenes.length === 0;
  renderSelectedScenes();
}

function renderSelectedScenes() {
  if (!setupRoot) return;
  clearTracking();
  debug.clear();
  const scene = selectedScene();
  viewer.renderSetup(scene ?? setupRoot);
}

function updateBelongsToSelectedScene(container) {
  const scene = selectedScene();
  if (!scene) return true;
  const sceneAddress = scene.getAddress?.() || '';
  const updateAddress = container.getAddress?.() || '';
  return updateAddress === sceneAddress || updateAddress.startsWith(`${sceneAddress}/`);
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

// AugmentaWebSocketClient performs one transport attempt. Reconnect policy is
// deliberately owned by this application rather than hidden inside the SDK.
function scheduleReconnect(message = 'Connection closed.') {
  if (!wantsConnection) return;
  clearReconnectTimer();
  retrying = true;
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
  retrying = false;
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
  if (!retrying) {
    setStatus('Connecting', 'connecting');
    ui.note.textContent = `Connecting to ${url} with protocol V${version}…`;
  }

  const connection = new AugmentaWebSocketClient(url, {
    clientName: 'Augmenta Three.js Debug Viewer',
    applicationName: 'Augmenta ThreeJS Example',
    applicationVersion: '1.0.0',
    options: {
      version, downSample,
      streamClouds: true, streamClusters: true, streamClusterPoints: true, streamZonePoints: true,
      useCompression: false, displayPointIntensity: true, boxRotationMode: RotationMode.Radians,
      axisTransform: {
        axis: AxisMode.YUpRightHanded,
        flipX: false,
        flipY: false,
        flipZ: false,
        coordinateSpace: CoordinateSpace.Absolute
      }
    }
  });

  augmenta = connection;

  connection.on('open', () => {
    if (augmenta !== connection || !wantsConnection) return;
    clearDisconnectCleanupTimer();
    retrying = false;
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
    renderDebug(true);
  });

  connection.on('setup', (message) => {
    if (augmenta !== connection) return;
    const serverVersion = message.getServerProtocolVersion();
    if (ui.protocol.value === 'auto' && Number.isInteger(serverVersion) && serverVersion >= 2 && serverVersion < activeVersion) {
      restartForProtocol(serverVersion);
      return;
    }
    refreshSceneSelector(message.getRootObject());
  });

  connection.on('update', (message) => {
    if (augmenta !== connection) return;
    const container = message.getRootObject();
    if (updateBelongsToSelectedScene(container)) viewer.upsertSetup(container);
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
  clearTracking();
  clearDebugData();
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
  refreshSceneSelector(lastControl.getRootObject());
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
ui.scenes.addEventListener('change', renderSelectedScenes);

// The panel overlays the renderer. Shift the camera projection by the visible
// panel width so the orbit target stays centered in the unobscured viewport.
function syncPanelCamera(animate = false) {
  const isMobile = window.matchMedia('(max-width: 900px)').matches;
  const hidden = ui.app.classList.contains('sidebar-hidden');
  const inset = isMobile || hidden ? 0 : ui.sidebar.getBoundingClientRect().width;
  viewer.setRightInset(inset, animate);
}

ui.sidebarToggle.addEventListener('click', () => {
  const hidden = ui.app.classList.toggle('sidebar-hidden');
  ui.sidebarToggle.textContent = hidden ? '<' : '>';
  ui.sidebarToggle.title = hidden ? 'Show panel' : 'Hide panel';
  ui.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
  syncPanelCamera(true);
});

function sidebarWidthBounds() {
  return {
    min: SIDEBAR_MIN_WIDTH,
    max: Math.max(
      SIDEBAR_MIN_WIDTH,
      Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - SIDEBAR_VIEWPORT_MARGIN)
    )
  };
}

function setSidebarWidth(width) {
  const { min, max } = sidebarWidthBounds();
  const clamped = Math.min(max, Math.max(min, width));
  ui.app.style.setProperty('--sidebar-width', `${clamped}px`);
  ui.sidebarResizer.setAttribute('aria-valuenow', String(Math.round(clamped)));
  syncPanelCamera(false);
}

function resizeSidebar(event) {
  if (window.matchMedia('(max-width: 900px)').matches) return;
  setSidebarWidth(window.innerWidth - event.clientX);
}

ui.sidebarResizer.addEventListener('pointerdown', (event) => {
  if (window.matchMedia('(max-width: 900px)').matches || ui.app.classList.contains('sidebar-hidden')) return;
  event.preventDefault();
  ui.sidebarResizer.setPointerCapture(event.pointerId);
  ui.app.classList.add('sidebar-resizing');
});

ui.sidebarResizer.addEventListener('pointermove', (event) => {
  if (!ui.sidebarResizer.hasPointerCapture(event.pointerId)) return;
  resizeSidebar(event);
});

function stopSidebarResize(event) {
  if (ui.sidebarResizer.hasPointerCapture(event.pointerId)) {
    ui.sidebarResizer.releasePointerCapture(event.pointerId);
  }
  ui.app.classList.remove('sidebar-resizing');
}
ui.sidebarResizer.addEventListener('pointerup', stopSidebarResize);
ui.sidebarResizer.addEventListener('pointercancel', stopSidebarResize);
ui.sidebarResizer.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 40 : 16;
  const current = ui.sidebar.getBoundingClientRect().width;
  setSidebarWidth(current + (event.key === 'ArrowLeft' ? step : -step));
});

window.addEventListener('resize', () => {
  if (!window.matchMedia('(max-width: 900px)').matches) {
    setSidebarWidth(ui.sidebar.getBoundingClientRect().width);
  } else {
    syncPanelCamera(false);
  }
});
ui.endpoint.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if (!wantsConnection) {
    toggleConnection();
    return;
  }
  retrying = false;
  autoNegotiatedVersion = undefined;
  stopTransport('Endpoint changed');
  attemptConnection();
});
ui.protocol.addEventListener('change', () => {
  if (!wantsConnection) return;
  retrying = false;
  autoNegotiatedVersion = undefined;
  stopTransport('Protocol changed');
  attemptConnection();
});
ui.downsample.addEventListener('change', () => {
  if (!wantsConnection) return;
  retrying = false;
  stopTransport('Downsample changed');
  attemptConnection();
});
[ui.showClusters, ui.showPoints, ui.showZones, ui.showVectors]
  .forEach((input) => input.addEventListener('change', applyVisibility));

applyVisibility();
updateConnectionButton();
updateSimulationButton();
resetSceneSelector();
syncPanelCamera(false);
attemptConnection();
