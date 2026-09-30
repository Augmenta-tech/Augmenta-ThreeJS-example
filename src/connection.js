import {
  AugmentaWebSocketClient, AxisMode, CoordinateSpace, OriginMode, RotationMode
} from 'augmenta-client-sdk';

const RECONNECT_DELAY_MS = 1000;

// Three.js is Y-up, right-handed and metre-based. Ask Augmenta/Pleiades to
// deliver tracking and setup data directly in that convention.
const THREE_JS_AXIS_TRANSFORM = Object.freeze({
  axis: AxisMode.YUpRightHanded,
  origin: OriginMode.BottomLeft,
  flipX: false,
  flipY: false,
  flipZ: false,
  coordinateSpace: CoordinateSpace.Absolute
});

export function createConnectionController({
  getSettings,
  onState,
  onControl,
  onSetup,
  onUpdate,
  onData
}) {
  let client;
  let reconnectTimer;
  let wantsConnection = false;
  let socketOpen = false;
  let retrying = false;
  let autoNegotiatedVersion;
  let activeVersion;
  let phase = 'idle';
  let note = '';

  function getState() {
    return { wantsConnection, socketOpen, retrying, activeVersion, phase, note };
  }

  function publish(nextPhase, nextNote) {
    phase = nextPhase;
    note = nextNote;
    onState?.(getState());
  }

  function clearReconnectTimer() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }

  function stopTransport(reason = 'User disconnect') {
    clearReconnectTimer();
    socketOpen = false;
    const current = client;
    client = undefined;
    current?.disconnect(1000, reason);
  }

  function selectedVersion(protocol) {
    if (protocol === 'auto') return autoNegotiatedVersion ?? 3;
    return Number(protocol);
  }

  function scheduleReconnect(message = 'Connection closed.') {
    if (!wantsConnection) return;
    clearReconnectTimer();
    retrying = true;
    socketOpen = false;
    publish('retrying', `${message} Retrying automatically…`);
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
    publish('connecting', `Server uses protocol V${version}. Reconnecting with the matching parser…`);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      attemptConnection();
    }, 0);
  }

  function attemptConnection() {
    if (!wantsConnection) return;

    clearReconnectTimer();

    let target;
    let protocol;
    let downSample;
    try {
      const settings = getSettings();
      target = connectionTarget(settings.address, settings.port);
      protocol = String(settings.protocol);
      downSample = Math.max(1, Math.floor(Number(settings.downsample) || 1));
    } catch (error) {
      wantsConnection = false;
      retrying = false;
      autoNegotiatedVersion = undefined;
      stopTransport('Invalid connection settings');
      publish('error', error instanceof Error ? error.message : 'Invalid server address.');
      return;
    }

    const version = selectedVersion(protocol);
    activeVersion = version;
    socketOpen = false;

    if (!retrying) {
      publish('connecting', `Connecting to ${target.label} with protocol V${version}…`);
    }

    const connection = new AugmentaWebSocketClient(target.url, {
      clientName: 'Augmenta Three.js Debug Viewer',
      applicationName: 'Augmenta ThreeJS Example',
      applicationVersion: '1.0.0',
      options: {
        version,
        downSample,
        streamClouds: true,
        streamClusters: true,
        streamClusterPoints: true,
        streamZonePoints: true,
        useCompression: false,
        displayPointIntensity: true,
        // Quaternions preserve Pleiades' exact OBB orientation. The viewer
        // performs the left-handed -> right-handed basis reflection explicitly.
        boxRotationMode: RotationMode.Quaternions,
        axisTransform: THREE_JS_AXIS_TRANSFORM
      }
    });

    client = connection;

    connection.on('open', () => {
      if (client !== connection || !wantsConnection) return;
      retrying = false;
      socketOpen = true;
      publish(
        'connected',
        `Connected to ${target.label}. Protocol V${activeVersion}; uncompressed debug stream.`
      );
    });

    connection.on('close', () => {
      if (client !== connection) return;
      client = undefined;
      socketOpen = false;
      scheduleReconnect('Connection closed.');
    });

    connection.on('error', (error) => {
      if (client !== connection) return;
      console.error('Augmenta WebSocket/data error', error);

      if (socketOpen) {
        publish(
          'connected',
          error instanceof Error
            ? `Connected, but a message could not be parsed: ${error.message}`
            : 'Connected, but a WebSocket/data error occurred.'
        );
        return;
      }

      retrying = true;
      publish(
        'retrying',
        location.protocol === 'https:' && target.url.startsWith('ws://')
          ? 'Connection failed. This HTTPS page may block an insecure ws:// endpoint; retrying automatically…'
          : 'Connection failed; retrying automatically…'
      );
    });

    connection.on('controlMessage', (message) => {
      if (client === connection) onControl?.(message);
    });

    connection.on('setup', (message) => {
      if (client !== connection) return;
      const serverVersion = message.getServerProtocolVersion();
      if (
        protocol === 'auto'
        && Number.isInteger(serverVersion)
        && serverVersion >= 2
        && serverVersion < activeVersion
      ) {
        restartForProtocol(serverVersion);
        return;
      }
      onSetup?.(message);
    });

    connection.on('update', (message) => {
      if (client === connection) onUpdate?.(message);
    });

    connection.on('data', (frame) => {
      if (client === connection) onData?.(frame);
    });

    try {
      connection.connect();
    } catch (error) {
      if (client === connection) client = undefined;
      console.error('Augmenta connection failed', error);
      scheduleReconnect(error instanceof Error ? error.message : 'Connection failed.');
    }
  }

  function start({ resetProtocol = true } = {}) {
    if (resetProtocol) autoNegotiatedVersion = undefined;
    wantsConnection = true;
    retrying = false;
    attemptConnection();
  }

  function stop() {
    wantsConnection = false;
    retrying = false;
    autoNegotiatedVersion = undefined;
    stopTransport();
    publish('idle', 'Connection stopped. Scene and zones are kept visible.');
  }

  function restart(reason, { resetProtocol = false } = {}) {
    if (!wantsConnection) return;
    retrying = false;
    if (resetProtocol) autoNegotiatedVersion = undefined;
    stopTransport(reason);
    attemptConnection();
  }

  return { getState, start, stop, restart };
}

function connectionTarget(address, portValue) {
  const host = normalizeServerHost(address);
  const port = Number(portValue);

  if (!host) throw new Error('Enter an IP address or hostname.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Enter a valid port between 1 and 65535.');
  }

  // IPv6 literals need brackets in a WebSocket URL; IPv4/mDNS names do not.
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return {
    label: `${host}:${port}`,
    url: `ws://${urlHost}:${port}`
  };
}

function normalizeServerHost(value) {
  const host = String(value ?? '').trim();
  if (!host) return '';

  if (host.includes('://') || /[/?#]/.test(host)) {
    throw new Error('Enter an IP address or hostname only.');
  }

  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount === 1 && !host.startsWith('[')) {
    throw new Error('Enter the port in the Port field.');
  }

  // IPv4/qualified hostnames already contain a dot; IPv6 contains a colon.
  return !host.includes('.') && !host.includes(':') ? `${host}.local` : host;
}
