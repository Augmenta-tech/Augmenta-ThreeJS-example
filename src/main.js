import { createConnectionController } from './connection.js';
import { createSetupStore } from './setup-store.js';
import { createViewer } from './viewer.js';
import { createDebugPanel } from './debug.js';
import { makeDemoFrame, makeDemoSetup } from './demo.js';
import {
  buildConnectionShareUrl,
  normalizeConnectionOptions,
  readConnectionOptionsFromUrl,
  resolveConnectionOptions
} from './share-link.js';

const DISCONNECT_CLEANUP_DELAY_MS = 500;
const CAMERA_PREFERENCE_SAVE_DELAY_MS = 250;
const QR_COPY_FEEDBACK_DELAY_MS = 1400;
const QR_CODE_LOAD_RETRY_DELAY_MS = 400;
const QR_CODE_LOAD_MAX_RETRIES = 2;
const SIDEBAR_HANDLE_IDLE_DELAY_MS = 3000;
const QR_CODE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/qrcode-generator@2.0.4/dist/qrcode.mjs';
const SIDEBAR_MIN_WIDTH = 320;
const SIDEBAR_MAX_WIDTH = 450;
const SIDEBAR_VIEWPORT_MARGIN = 160;
const MOBILE_MEDIA_QUERY = '(max-width: 900px)';
const SETTINGS_STORAGE_KEY = 'augmenta-threejs-settings:v1';

const $ = (selector) => document.querySelector(selector);

function refreshFavicon() {
  const faviconUrl = new URL('./augmenta-favicon.png?v=4', document.baseURI).href;
  document.querySelectorAll('link[rel~="icon"]').forEach((link) => {
    if (link.href !== faviconUrl) link.href = faviconUrl;
  });
}

refreshFavicon();

const ui = {
  app: $('#app'), sidebar: $('#sidebar'), sidebarResizer: $('#sidebar-resizer'), serverAddress: $('#server-address'), port: $('#port'), protocol: $('#protocol'), downsample: $('#downsample'), connect: $('#connect'),
  demo: $('#demo'), status: $('#status'), note: $('#connection-note'), summary: $('#summary'),
  debug: $('#debug-content'), clear: $('#clear'), resetCamera: $('#reset-camera'), scenes: $('#scenes'),
  sidebarToggle: $('#sidebar-toggle'), connectionQrVisibility: $('.connection-qr-visibility'), connectionQr: $('#connection-qr'), connectionQrCode: $('#connection-qr-code'), connectionQrLabel: $('#connection-qr-label'),
  showClusters: $('#show-clusters'), showPoints: $('#show-points'), showZones: $('#show-zones'), showVectors: $('#show-vectors')
};

const viewer = createViewer($('#canvas-host'));
const debug = createDebugPanel(ui.summary, ui.debug);

let disconnectCleanupTimer;
let cameraPreferenceSaveTimer;
let sidebarHandleIdleTimer;
let qrCodeFactoryPromise;
let qrCodeRetryTimer;
let qrCopyFeedbackTimer;
let qrHovering = false;
let localConnectionPreferences = {};
let demoTimer;
let lastFrame;
let lastControl;
let frameTimes = [];
let scenes = [];
let preferredSceneAddress = 'all';
const setupStore = createSetupStore();

function resetSidebarHandleIdle() {
  if (sidebarHandleIdleTimer) window.clearTimeout(sidebarHandleIdleTimer);
  sidebarHandleIdleTimer = undefined;
  ui.app.classList.remove('sidebar-handle-idle');

  sidebarHandleIdleTimer = window.setTimeout(() => {
    sidebarHandleIdleTimer = undefined;
    ui.app.classList.add('sidebar-handle-idle');
  }, SIDEBAR_HANDLE_IDLE_DELAY_MS);
}

window.addEventListener('mousemove', resetSidebarHandleIdle, { passive: true });
window.addEventListener('keydown', resetSidebarHandleIdle);

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadPreferences() {
  try {
    const value = JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY));
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
}

function savePreferences() {
  const sidebarWidth = Number.parseFloat(
    getComputedStyle(ui.app).getPropertyValue('--sidebar-width')
  );

  const value = {
    connection: localConnectionPreferences,
    display: {
      clusters: ui.showClusters.checked,
      points: ui.showPoints.checked,
      zones: ui.showZones.checked,
      vectors: ui.showVectors.checked,
      scene: preferredSceneAddress
    },
    ui: {
      sidebarHidden: ui.app.classList.contains('sidebar-hidden'),
      sidebarWidth: Number.isFinite(sidebarWidth) ? sidebarWidth : SIDEBAR_MAX_WIDTH,
      cameraView: viewer.getCameraView()
    }
  };

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function applyConnectionSettings(settings) {
  if (typeof settings.address === 'string') ui.serverAddress.value = settings.address;
  if (typeof settings.port === 'string') ui.port.value = settings.port;
  if (typeof settings.protocol === 'string') ui.protocol.value = settings.protocol;
  if (typeof settings.downsample === 'string') ui.downsample.value = settings.downsample;
}

function rememberLocalConnectionSetting(key, value) {
  localConnectionPreferences = normalizeConnectionOptions({
    ...localConnectionPreferences,
    [key]: value
  });
}

function restorePreferences() {
  const savedPreferences = loadPreferences();
  const connection = isObject(savedPreferences.connection) ? savedPreferences.connection : {};
  const sharedConnection = readConnectionOptionsFromUrl(window.location.href);
  const display = isObject(savedPreferences.display) ? savedPreferences.display : {};
  const uiPreferences = isObject(savedPreferences.ui) ? savedPreferences.ui : {};

  applyConnectionSettings(normalizeConnectionOptions(connection));
  // Persist only this browser's own connection defaults. Shared/QR values are
  // a tab-local override and must not leak back into localStorage just because
  // camera/sidebar state is saved.
  localConnectionPreferences = normalizeConnectionOptions(getConnectionSettings());
  applyConnectionSettings(resolveConnectionOptions(localConnectionPreferences, sharedConnection));

  if (typeof display.clusters === 'boolean') ui.showClusters.checked = display.clusters;
  if (typeof display.points === 'boolean') ui.showPoints.checked = display.points;
  if (typeof display.zones === 'boolean') ui.showZones.checked = display.zones;
  if (typeof display.vectors === 'boolean') ui.showVectors.checked = display.vectors;
  if (typeof display.scene === 'string' && display.scene) preferredSceneAddress = display.scene;

  const sidebarWidth = Number(uiPreferences.sidebarWidth);
  if (Number.isFinite(sidebarWidth)) setSidebarWidth(sidebarWidth);
  setSidebarHidden(uiPreferences.sidebarHidden === true, false);
  viewer.setCameraView(uiPreferences.cameraView);
}

function scheduleCameraPreferenceSave() {
  if (cameraPreferenceSaveTimer) {
    window.clearTimeout(cameraPreferenceSaveTimer);
  }
  cameraPreferenceSaveTimer = window.setTimeout(() => {
    cameraPreferenceSaveTimer = undefined;
    savePreferences();
  }, CAMERA_PREFERENCE_SAVE_DELAY_MS);
}

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

function stopSimulation() {
  if (demoTimer) window.clearInterval(demoTimer);
  demoTimer = undefined;
  updateSimulationButton();
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
  const knownName = setupStore.getByAddress(address)?.getName();
  if (knownName) return knownName;

  // A zone rename changes its control address immediately, while the current
  // Pleiades WebSocket setup is only refreshed on reconnect. Keep the debug
  // table readable until then by showing the leaf short name, not the full path.
  const parts = String(address ?? '').split('/').filter((part) => part && part !== 'children');
  return parts.at(-1) || address || '—';
}

function syncSceneSelector() {
  const previous = ui.scenes.value;
  scenes = setupStore.getScenes();

  ui.scenes.innerHTML = [
    '<option value="all">All scenes</option>',
    ...scenes.map((scene, index) => {
      const name = scene.getName() || scene.getAddress() || `Scene ${index + 1}`;
      return `<option value="${escapeOption(scene.getAddress())}">${escapeOption(name)}</option>`;
    })
  ].join('');

  const requested = previous !== 'all' ? previous : preferredSceneAddress;
  const stillAvailable = requested === 'all'
    || scenes.some((scene) => scene.getAddress() === requested);
  ui.scenes.value = stillAvailable ? requested : 'all';
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
  viewer.renderSetup(root, selectedScene()?.getAddress());
}

function applySetupUpdate(container) {
  const root = setupStore.applyUpdate(container);
  if (!root) return;

  syncSceneSelector();
  viewer.renderSetup(root, selectedScene()?.getAddress());
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

function getQrCodeFactory() {
  if (!qrCodeFactoryPromise) {
    qrCodeFactoryPromise = import(QR_CODE_MODULE_URL)
      .then((module) => module.qrcode)
      .catch((error) => {
        // A transient first-load CDN failure must not poison all later retries.
        qrCodeFactoryPromise = undefined;
        throw error;
      });
  }
  return qrCodeFactoryPromise;
}

async function refreshConnectionQr(attempt = 0) {
  const shareUrl = buildConnectionShareUrl(window.location.href, getConnectionSettings());
  ui.connectionQr.href = shareUrl;

  try {
    const qrcode = await getQrCodeFactory();
    // Connection fields may have changed while the module was loading.
    if (ui.connectionQr.href !== shareUrl) return;

    const qr = qrcode(0, 'M');
    qr.addData(shareUrl);
    qr.make();
    ui.connectionQrCode.innerHTML = qr.createSvgTag({
      cellSize: 4,
      margin: 8,
      scalable: true
    });

    if (qrCodeRetryTimer) {
      window.clearTimeout(qrCodeRetryTimer);
      qrCodeRetryTimer = undefined;
    }
    ui.connectionQr.hidden = false;
  } catch {
    if (attempt < QR_CODE_LOAD_MAX_RETRIES) {
      if (qrCodeRetryTimer) window.clearTimeout(qrCodeRetryTimer);
      qrCodeRetryTimer = window.setTimeout(() => {
        qrCodeRetryTimer = undefined;
        refreshConnectionQr(attempt + 1);
      }, QR_CODE_LOAD_RETRY_DELAY_MS * (attempt + 1));
      return;
    }

    // QR sharing is optional; keep the viewer usable if the CDN stays down.
    ui.connectionQr.hidden = true;
  }
}

function copyTextFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }

  textarea.remove();
  return copied;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers/contexts where Clipboard API permission fails.
    }
  }

  return copyTextFallback(text);
}

function updateQrLabel() {
  ui.connectionQrLabel.textContent = qrCopyFeedbackTimer
    ? 'Link copied!'
    : qrHovering
      ? 'Copy link?'
      : 'Launch it';
}

function showQrCopyFeedback() {
  if (qrCopyFeedbackTimer) window.clearTimeout(qrCopyFeedbackTimer);

  ui.connectionQr.classList.remove('copy-confirmed');
  void ui.connectionQr.offsetWidth;
  ui.connectionQr.classList.add('copy-confirmed');

  qrCopyFeedbackTimer = window.setTimeout(() => {
    qrCopyFeedbackTimer = undefined;
    ui.connectionQr.classList.remove('copy-confirmed');
    updateQrLabel();
  }, QR_COPY_FEEDBACK_DELAY_MS);

  updateQrLabel();
}

async function handleConnectionQrClick(event) {
  event.preventDefault();
  if (await copyTextToClipboard(ui.connectionQr.href)) {
    showQrCopyFeedback();
  }
}

function handleSetup(message) {
  setSetup(message.getRootObject());
  if (!viewer.isCameraUserControlled()) viewer.resetCamera();
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

  stopSimulation();
  clearTracking();
  clearDebugData();
  connection.start();
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
  if (!demoTimer) {
    startSimulation();
    return;
  }

  stopSimulation();
  setStatus('Idle');
  ui.note.textContent = 'Simulation stopped.';
}

function applyVisibility() {
  viewer.setVisibility({
    clusters: ui.showClusters.checked,
    points: ui.showPoints.checked,
    zones: ui.showZones.checked,
    vectors: ui.showVectors.checked
  });
}

viewer.setCameraChangeHandler(scheduleCameraPreferenceSave);

ui.connectionQr.addEventListener('click', handleConnectionQrClick);
ui.connectionQr.addEventListener('mouseenter', () => {
  qrHovering = true;
  updateQrLabel();
});
ui.connectionQr.addEventListener('mouseleave', () => {
  qrHovering = false;
  updateQrLabel();
});
ui.connect.addEventListener('click', toggleConnection);
ui.demo.addEventListener('click', toggleSimulation);
ui.clear.addEventListener('click', clearDebugData);
ui.resetCamera.addEventListener('click', viewer.resetCamera);
ui.scenes.addEventListener('change', () => {
  preferredSceneAddress = ui.scenes.value;
  savePreferences();
  renderSelectedScenes();
});

// The panel overlays the renderer. Shift the camera projection by the visible
// panel width so the orbit target stays centered in the unobscured viewport.
function syncPanelCamera(animate = false) {
  const isMobile = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  const hidden = ui.app.classList.contains('sidebar-hidden');
  const inset = isMobile || hidden ? 0 : ui.sidebar.getBoundingClientRect().width;
  viewer.setRightInset(inset, animate);
}

function syncSidebarAccessibility() {
  const foldedOnDesktop = ui.app.classList.contains('sidebar-hidden')
    && !window.matchMedia(MOBILE_MEDIA_QUERY).matches;

  ui.sidebar.inert = foldedOnDesktop;
  ui.connectionQrVisibility.inert = foldedOnDesktop;

  if (foldedOnDesktop) {
    ui.sidebar.setAttribute('aria-hidden', 'true');
    ui.connectionQrVisibility.setAttribute('aria-hidden', 'true');
  } else {
    ui.sidebar.removeAttribute('aria-hidden');
    ui.connectionQrVisibility.removeAttribute('aria-hidden');
  }
}

function setSidebarHidden(hidden, animate = true) {
  if (!animate) ui.app.classList.add('sidebar-no-transition');

  ui.app.classList.toggle('sidebar-hidden', hidden);
  ui.sidebarToggle.textContent = hidden ? '<' : '>';
  ui.sidebarToggle.title = hidden ? 'Show panel' : 'Hide panel';
  ui.sidebarToggle.setAttribute('aria-expanded', String(!hidden));
  syncSidebarAccessibility();
  syncPanelCamera(animate);

  resetSidebarHandleIdle();

  if (!animate) {
    // Commit the restored layout while transitions are disabled. Re-enabling
    // them afterwards keeps user-triggered open/close animation unchanged,
    // without replaying it when a persisted hidden panel is loaded.
    void ui.sidebar.offsetWidth;
    ui.app.classList.remove('sidebar-no-transition');
  }
}

ui.sidebarToggle.addEventListener('click', () => {
  setSidebarHidden(!ui.app.classList.contains('sidebar-hidden'));
  savePreferences();
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
    savePreferences();
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
  savePreferences();
});

window.addEventListener('pagehide', savePreferences);

window.addEventListener('resize', () => {
  syncSidebarAccessibility();
  if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) {
    setSidebarWidth(ui.sidebar.getBoundingClientRect().width);
  } else {
    syncPanelCamera(false);
  }
});
function restartConnection(reason) {
  if (!connection.getState().wantsConnection) return;
  clearTracking();
  clearDebugData();
  connection.restart(reason);
}

function handleServerFieldEnter(event) {
  if (event.key !== 'Enter') return;
  if (!connection.getState().wantsConnection) {
    toggleConnection();
    return;
  }
  restartConnection('Server address changed');
}

function saveConnectionField(key, value) {
  rememberLocalConnectionSetting(key, value);
  savePreferences();
  refreshConnectionQr();
}

ui.serverAddress.addEventListener('keydown', handleServerFieldEnter);
ui.port.addEventListener('keydown', handleServerFieldEnter);

ui.serverAddress.addEventListener('input', () => {
  saveConnectionField('address', ui.serverAddress.value);
});
ui.port.addEventListener('input', () => {
  saveConnectionField('port', ui.port.value);
});
ui.downsample.addEventListener('input', () => {
  saveConnectionField('downsample', ui.downsample.value);
});

ui.serverAddress.addEventListener('change', () => {
  restartConnection('Server address changed');
});
ui.port.addEventListener('change', () => {
  restartConnection('Server port changed');
});
ui.protocol.addEventListener('change', () => {
  saveConnectionField('protocol', ui.protocol.value);
  restartConnection('Protocol changed');
});
ui.downsample.addEventListener('change', () => {
  restartConnection('Downsample changed');
});
[ui.showClusters, ui.showPoints, ui.showZones, ui.showVectors]
  .forEach((input) => input.addEventListener('change', () => {
    applyVisibility();
    savePreferences();
  }));

function syncPreferencesToUi() {
  restorePreferences();
  applyVisibility();
  syncPanelCamera(false);
  refreshConnectionQr();
}

syncPreferencesToUi();
updateSimulationButton();
connection.start();

// Browsers can restore form controls after module initialization. Reapply the
// persisted settings on pageshow so the visible controls always match the
// values used by the viewer/connection logic.
window.addEventListener('pageshow', () => {
  refreshFavicon();
  syncPreferencesToUi();
  // Do not clear setupStore here: on fast local connections the initial
  // Pleiades setup may already have arrived before pageshow. Clearing it would
  // orphan subsequent partial updates from their Scene/parent transforms.
  syncSceneSelector();
});
