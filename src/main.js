import {
  AugmentaWebSocketClient, AxisMode, CoordinateSpace, OriginMode, RotationMode
} from 'augmenta-client-sdk';
import { createViewer } from './viewer.js';
import { createDebugPanel } from './debug.js';
import { makeDemoFrame, makeDemoSetup } from './demo.js';

const $ = (selector) => document.querySelector(selector);
const ui = {
  endpoint: $('#endpoint'), protocol: $('#protocol'), downsample: $('#downsample'), connect: $('#connect'),
  demo: $('#demo'), status: $('#status'), note: $('#connection-note'), summary: $('#summary'),
  debug: $('#debug-content'), clear: $('#clear'), resetCamera: $('#reset-camera'),
  showClusters: $('#show-clusters'), showPoints: $('#show-points'), showZones: $('#show-zones'), showVectors: $('#show-vectors')
};

const viewer = createViewer($('#canvas-host'));
const debug = createDebugPanel(ui.summary, ui.debug);
let augmenta;
let demoTimer;
let lastFrame;
let lastControl;
let frameTimes = [];

function setStatus(text, kind = 'idle') {
  ui.status.textContent = text;
  ui.status.className = `status ${kind}`;
}

function fps() { return frameTimes.length; }
function trackFrame(frame) {
  lastFrame = frame;
  const now = performance.now();
  frameTimes.push(now);
  frameTimes = frameTimes.filter((time) => time >= now - 1000);
  viewer.renderFrame(frame);
  debug.render(lastFrame, lastControl, fps());
}

function disconnect() {
  const client = augmenta;
  augmenta = undefined;
  client?.disconnect(1000, 'User disconnect');
  if (demoTimer) window.clearInterval(demoTimer);
  demoTimer = undefined;
}

function clearTracking() {
  viewer.clearTracking();
  lastFrame = undefined;
  frameTimes = [];
}

function clearAll() {
  disconnect();
  clearTracking();
  viewer.clearSetup();
  lastControl = undefined;
  debug.clear();
  setStatus('Idle');
}

function connect() {
  disconnect();
  clearTracking();
  viewer.clearSetup();
  lastControl = undefined;

  const url = ui.endpoint.value.trim();
  const version = Number(ui.protocol.value);
  const downSample = Math.max(1, Math.floor(Number(ui.downsample.value) || 1));
  if (!url) return;

  setStatus('Connecting', 'connecting');
  ui.note.textContent = 'Connecting with maximum debug stream enabled…';
  const connection = new AugmentaWebSocketClient(url, {
    clientName: 'Augmenta Three.js Debug Viewer',
    applicationName: 'Augmenta ThreeJS Example',
    applicationVersion: '1.0.0',
    options: {
      version, downSample,
      streamClouds: true, streamClusters: true, streamClusterPoints: true, streamZonePoints: true,
      useCompression: false, displayPointIntensity: true, boxRotationMode: RotationMode.Quaternions,
      axisTransform: { axis: AxisMode.YUpRightHanded, origin: OriginMode.BottomLeft, coordinateSpace: CoordinateSpace.Absolute }
    }
  });

  augmenta = connection;

  connection.on('open', () => {
    if (augmenta !== connection) return;
    setStatus('Connected', 'connected');
    ui.note.textContent = `Connected to ${url}. Protocol V${version}; uncompressed debug stream.`;
  });
  connection.on('close', () => {
    if (augmenta !== connection) return;
    augmenta = undefined;
    setStatus('Closed');
  });
  connection.on('error', (error) => {
    if (augmenta !== connection) return;
    console.error('Augmenta WebSocket error', error);
    setStatus('Error', 'error');
    ui.note.textContent = location.protocol === 'https:' && url.startsWith('ws://')
      ? 'This HTTPS page may block an insecure ws:// endpoint. Use wss:// or run the example locally over HTTP.'
      : 'Connection error. Check the WebSocket URL, protocol version and Augmenta WebSocket Output.';
  });
  connection.on('controlMessage', (message) => {
    if (augmenta !== connection) return;
    lastControl = message;
    debug.render(lastFrame, lastControl, fps(), true);
  });
  connection.on('setup', (message) => { if (augmenta === connection) viewer.renderSetup(message.getRootObject()); });
  connection.on('update', (message) => { if (augmenta === connection) viewer.upsertSetup(message.getRootObject()); });
  connection.on('data', (frame) => { if (augmenta === connection) trackFrame(frame); });

  try { connection.connect(); }
  catch (error) {
    console.error('Augmenta connection failed', error);
    setStatus('Error', 'error');
    ui.note.textContent = error instanceof Error ? error.message : String(error);
  }
}

function runDemo() {
  disconnect();
  clearTracking();
  viewer.clearSetup();
  setStatus('Demo', 'demo');
  ui.note.textContent = 'Local synthetic stream using the Augmenta SDK data model. Use Connect for a real Augmenta server.';
  lastControl = makeDemoSetup();
  viewer.renderSetup(lastControl.getRootObject());
  const start = performance.now();
  const tick = () => trackFrame(makeDemoFrame((performance.now() - start) / 1000));
  tick();
  demoTimer = window.setInterval(tick, 33);
}

function applyVisibility() {
  viewer.setVisibility({
    clusters: ui.showClusters.checked, points: ui.showPoints.checked,
    zones: ui.showZones.checked, vectors: ui.showVectors.checked
  });
}

ui.connect.addEventListener('click', connect);
ui.demo.addEventListener('click', runDemo);
ui.clear.addEventListener('click', clearAll);
ui.resetCamera.addEventListener('click', viewer.resetCamera);
ui.endpoint.addEventListener('keydown', (event) => { if (event.key === 'Enter') connect(); });
[ui.showClusters, ui.showPoints, ui.showZones, ui.showVectors].forEach((input) => input.addEventListener('change', applyVisibility));
applyVisibility();

if (location.protocol === 'https:' && ui.endpoint.value.startsWith('ws://')) {
  ui.note.textContent = 'GitHub Pages uses HTTPS. A ws:// Augmenta endpoint may be blocked by mixed-content/private-network rules; use wss:// or run locally over HTTP.';
}
