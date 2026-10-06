const CONNECTION_QUERY_KEYS = ['address', 'port', 'protocol', 'compression', 'downsample'];

export function normalizeConnectionOptions(settings) {
  const options = {};

  const address = String(settings?.address ?? '').trim();
  if (address) options.address = address;

  const port = Number(settings?.port);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    options.port = String(port);
  }

  const protocol = String(settings?.protocol ?? '');
  if (['auto', '2', '3'].includes(protocol)) {
    options.protocol = protocol;
  }

  const compression = String(settings?.compression ?? '');
  if (['compressed', 'uncompressed'].includes(compression)) {
    options.compression = compression;
  }

  const downsample = Number(settings?.downsample);
  if (Number.isInteger(downsample) && downsample >= 1) {
    options.downsample = String(downsample);
  }

  return options;
}

export function resolveConnectionOptions(localSettings, sharedSettings) {
  return {
    ...normalizeConnectionOptions(localSettings),
    ...normalizeConnectionOptions(sharedSettings)
  };
}

export function buildConnectionShareUrl(baseUrl, settings) {
  const url = new URL(baseUrl);
  url.hash = '';

  for (const key of CONNECTION_QUERY_KEYS) url.searchParams.delete(key);

  const options = normalizeConnectionOptions(settings);
  for (const [key, value] of Object.entries(options)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export function readConnectionOptionsFromUrl(urlValue) {
  const url = new URL(urlValue);
  return normalizeConnectionOptions({
    address: url.searchParams.get('address'),
    port: url.searchParams.get('port'),
    protocol: url.searchParams.get('protocol'),
    compression: url.searchParams.get('compression'),
    downsample: url.searchParams.get('downsample')
  });
}
