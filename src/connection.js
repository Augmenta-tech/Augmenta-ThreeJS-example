import {
  AugmentaWebSocketClient, AxisMode, CoordinateSpace, OriginMode, RotationMode
} from 'augmenta-client-sdk';

const RECONNECT_DELAY_MS = 1000;
const CONNECTION_ATTEMPT_TIMEOUT_MS = 2500;

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
  let targetPlan = [];
  let targetIndex = 0;
  let targetKey = '';
  let attemptTimer;

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

  function clearAttemptTimer() {
    if (attemptTimer) window.clearTimeout(attemptTimer);
    attemptTimer = undefined;
  }

  function ensureTargetPlan(address, port) {
    const key = String(address ?? '').trim() + '\n' + String(port ?? '').trim();
    if (targetPlan.length === 0 || key !== targetKey) {
      targetPlan = buildConnectionTargets(address, port);
      targetIndex = 0;
      targetKey = key;
    }
    return targetPlan;
  }

  function stopTransport(reason = 'User disconnect') {
    clearReconnectTimer();
    clearAttemptTimer();
    socketOpen = false;
    const current = client;
    client = undefined;
    current?.disconnect(1000, reason);
  }

  function selectedVersion(protocol) {
    if (protocol === 'auto') return autoNegotiatedVersion ?? 3;
    return Number(protocol);
  }

  function scheduleReconnect(message = 'Connection closed.', { nextTarget = false } = {}) {
    if (!wantsConnection) return;
    clearReconnectTimer();
    clearAttemptTimer();
    retrying = true;
    socketOpen = false;

    let delay = RECONNECT_DELAY_MS;
    if (nextTarget && targetPlan.length > 0) {
      targetIndex = (targetIndex + 1) % targetPlan.length;
      const wrapped = targetIndex === 0;
      delay = wrapped ? RECONNECT_DELAY_MS : 0;
      publish(
        'retrying',
        wrapped
          ? `${message} No address/WebSocket variant connected; retrying automatically…`
          : `${message} Trying ${targetPlan[targetIndex].label}…`
      );
    } else {
      publish('retrying', `${message} Retrying automatically…`);
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      attemptConnection();
    }, delay);
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
      const targets = ensureTargetPlan(settings.address, settings.port);
      target = targets[targetIndex];
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
    clearAttemptTimer();
    attemptTimer = window.setTimeout(() => {
      if (client !== connection || socketOpen) return;
      client = undefined;
      connection.disconnect(1000, 'Connection attempt timed out');
      scheduleReconnect(`Could not connect to ${target.label}.`, { nextTarget: true });
    }, CONNECTION_ATTEMPT_TIMEOUT_MS);

    connection.on('open', () => {
      if (client !== connection || !wantsConnection) return;
      clearAttemptTimer();
      retrying = false;
      socketOpen = true;
      publish(
        'connected',
        `Connected to ${target.label}. Protocol V${activeVersion}; uncompressed debug stream.`
      );
    });

    connection.on('close', () => {
      if (client !== connection) return;
      clearAttemptTimer();
      const wasOpen = socketOpen;
      client = undefined;
      socketOpen = false;
      scheduleReconnect(
        wasOpen ? 'Connection closed.' : `Could not connect to ${target.label}.`,
        { nextTarget: !wasOpen }
      );
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
      clearAttemptTimer();
      if (client === connection) client = undefined;
      console.error('Augmenta connection failed', error);
      scheduleReconnect(
        error instanceof Error ? error.message : `Could not connect to ${target.label}.`,
        { nextTarget: true }
      );
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

export function buildConnectionTargets(
  address,
  portValue,
  pageProtocol = globalThis.location?.protocol ?? 'http:'
) {
  const host = normalizeServerHost(address);
  const port = Number(portValue);

  if (!host) throw new Error('Enter an IP address or hostname.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Enter a valid port between 1 and 65535.');
  }

  const hosts = hostCandidates(host);
  const schemes = pageProtocol === 'https:' ? ['wss', 'ws'] : ['ws', 'wss'];

  return schemes.flatMap((scheme) => hosts.map((candidateHost) => {
    // IPv6 literals need brackets in a WebSocket URL; IPv4/mDNS names do not.
    const urlHost = candidateHost.includes(':') && !candidateHost.startsWith('[')
      ? `[${candidateHost}]`
      : candidateHost;
    return {
      label: `${scheme}://${urlHost}:${port}`,
      url: `${scheme}://${urlHost}:${port}`
    };
  }));
}

function hostCandidates(host) {
  if (/^localhost$/i.test(host) || host.includes('.') || host.includes(':')) return [host];

  // Keep the literal hostname first, then try the most useful local-network
  // suffixes. .local is mDNS; .home is used by some routers; .home.arpa is the
  // IETF-standard home-network domain.
  return [
    host,
    `${host}.local`,
    `${host}.home`,
    `${host}.home.arpa`
  ];
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

  return host;
}
