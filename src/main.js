import { createConnectionController } from './connection.js';
import { createSetupStore } from './setup-store.js';
import { createViewer } from './viewer.js';
import { createDebugPanel } from './debug.js';
import { makeDemoFrame, makeDemoSetup } from './demo.js';

const DISCONNECT_CLEANUP_DELAY_MS = 500;
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 450;
const SIDEBAR_VIEWPORT_MARGIN = 160;
const MOBILE_MEDIA_QUERY = '(max-width: 900px)';

const $ = (selector) => document.querySelector(selector);
const ui = {
  app: $('#app'), sidebar: $('#sidebar'), sidebarResizer: $('#sidebar-resizer'), serverAddress: $('#server-address'), port: $('#port'), protocol: $('#protocol'), downsample: $('#downsample'), connect: $('#connect'),
  demo: $('#demo'), status: $('#status'), note: $('#connection-note'), summary: $('#summary'),
  debug: $('#debug-content'), clear: $('#clear'), resetCamera: $('#reset-camera'), scenes: $('#scenes'),
  sidebarToggle: $('#sidebar-toggle'),
  showClusters: $('#show-clusters'), showPoints: $('#show-points'), showZones: $('#show-zones'), showVectors: $('#show-vectors')
};

const viewer = createViewer($('#canvas-host'));
const debug = createDebugPanel(ui.summary, ui.debug);

let disconnectCleanupTimer;
let demoTimer;
let lastFrame;
let lastControl;
let frameTimes = [];
let scenes = [];
const setupStore = createSetupStore();

function setStatus(text, kind = 'idle') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function handleConnectionState(state) {
  const labels = {
    idle: 'Idle',
    connecting: 'Connecting',
    retrying: 'Retrying',
    connected: 'Connected',
    error: 'Error'
  };
  const kinds = {
    idle: 'idle',
    connecting: 'connecting',
    retrying: 'connecting',
    connected: 'connected',
    error: 'error'
  };

  setStatus(labels[state.phase] ?? 'Idle', kinds[state.phase] ?? 'idle');
  ui.note.textContent = state.note;
  ui.connect.textContent = !state.wantsConnection
    ? 'Connect'
    : state.socketOpen
      ? 'Connected'
      : state.retrying
        ? 'Retrying…'
        : 'Connecting…';
  ui.connect.classList.toggle('active', state.socketOpen);
  ui.connect.setAttribute('aria-pressed', String(state.wantsConnection));
  ui.connect.title = state.wantsConnection ? 'Click to stop the connection' : 'Connect to Augmenta';

  if (state.phase === 'connected') clearDisconnectCleanupTimer();
  else if (state.phase === 'retrying') scheduleDisconnectCleanup();
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

function clearDisconnectCleanupTimer() {
  if (disconnectCleanupTimer) window.clearTimeout(disconnectCleanupTimer);
  disconnectCleanupTimer = undefined;
}

function scheduleDisconnectCleanup() {
  clearDisconnectCleanupTimer();
  disconnectCleanupTimer = window.setTimeout(() => {
    disconnectCleanupTimer = undefined;
    const state = connection.getState();
    if (state.socketOpen || !state.wantsConnection) return;
    clearTracking();
    clearDebugData();
  }, DISCONNECT_CLEANUP_DELAY_MS);
}

function stopConnection() {
  connection.stop();
  clearTracking();
  clearDebugData();
}

function stopSimulation({ quiet = false } = {}) {
  if (demoTimer) window.clearInterval(demoTimer);
  demoTimer = undefined;
  updateSimulationButton();
  if (!quiet && !connection.getState().wantsConnection) {
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
  setupStore.clear();
  scenes = [];
  ui.scenes.innerHTML = '<option value="all">All scenes</option>';
  ui.scenes.value = 'all';
  ui.scenes.disabled = true;
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
  debug.render(
    lastFrame,
    lastControl,
    fps(),
    sceneSizeForFrame(lastFrame),
    zoneNameForAddress,
    force
  );
}

function zoneNameForAddress(address) {
  return setupStore.getByAddress(address)?.getName() || address || '—';
}

function syncSceneSelector() {
  const previous = ui.scenes.value;
  scenes = setupStore.getScenes();

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
}

function setSetup(root) {
  setupStore.setRoot(root);
  syncSceneSelector();
  renderSelectedScenes();
}

function renderSelectedScenes() {
  const root = setupStore.getRoot();
  if (!root) return;
  clearTracking();
  debug.clear();
  viewer.renderSetup(selectedScene() ?? root);
}

function applySetupUpdate(container) {
  const root = setupStore.applyUpdate(container);
  if (!root) return;

  syncSceneSelector();
  viewer.renderSetup(selectedScene() ?? root);
  renderDebug(true);
}

function escapeOption(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function getConnectionSettings() {
  return {
    address: ui.serverAddress.value,
    port: ui.port.value,
    protocol: ui.protocol.value,
    downsample: ui.downsample.value
  };
}

function handleSetup(message) {
  setSetup(message.getRootObject());
  viewer.resetCamera();
}

const connection = createConnectionController({
  getSettings: getConnectionSettings,
  onState: handleConnectionState,
  onControl: (message) => {
    lastControl = message;
    renderDebug(true);
  },
  onSetup: handleSetup,
  onUpdate: (message) => applySetupUpdate(message.getRootObject()),
  onData: trackFrame
});

function toggleConnection() {
  if (connection.getState().wantsConnection) {
    stopConnection();
    return;
  }

  stopSimulation({ quiet: true });
  clearTracking();
  clearDebugData();
  connection.start({ resetProtocol: true });
}

function startSimulation() {
  stopConnection();
  clearTracking();
  viewer.clearSetup();
  setStatus('Simulating', 'demo');
  ui.note.textContent = 'Local synthetic stream using the Augmenta SDK data model. Click Simulating to stop.';
  lastControl = makeDemoSetup();
  setSetup(lastControl.getRootObject());
  viewer.resetCamera();
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
  const isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
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
  if (window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
  setSidebarWidth(window.innerWidth - event.clientX);
}

ui.sidebarResizer.addEventListener('pointerdown', (event) => {
  if (window.matchMedia(MOBILE_MEDIA_QUERY).matches || ui.app.classList.contains('sidebar-hidden')) return;
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
  if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
    setSidebarWidth(ui.sidebar.getBoundingClientRect().width);
  } else {
    syncPanelCamera(false);
  }
});
function restartForServerChange(reason) {
  if (!connection.getState().wantsConnection) return;
  clearTracking();
  clearDebugData();
  connection.restart(reason, { resetProtocol: true });
}

function handleServerFieldEnter(event) {
  if (event.key !== 'Enter') return;
  if (!connection.getState().wantsConnection) {
    toggleConnection();
    return;
  }
  restartForServerChange('Server address changed');
}

ui.serverAddress.addEventListener('keydown', handleServerFieldEnter);
ui.port.addEventListener('keydown', handleServerFieldEnter);
ui.serverAddress.addEventListener('change', () => restartForServerChange('Server address changed'));
ui.port.addEventListener('change', () => restartForServerChange('Server port changed'));
ui.protocol.addEventListener('change', () => connection.restart('Protocol changed', { resetProtocol: true }));
ui.downsample.addEventListener('change', () => connection.restart('Downsample changed'));
[ui.showClusters, ui.showPoints, ui.showZones, ui.showVectors]
  .forEach((input) => input.addEventListener('change', applyVisibility));

applyVisibility();
updateSimulationButton();
resetSceneSelector();
syncPanelCamera(false);
connection.start({ resetProtocol: true });
