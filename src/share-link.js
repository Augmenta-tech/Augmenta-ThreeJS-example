const CONNECTION_QUERY_KEYS = ['address', 'port', 'protocol', 'downsample'];

export function buildConnectionShareUrl(baseUrl, settings) {
  const url = new URL(baseUrl);
  url.hash = '';

  for (const key of CONNECTION_QUERY_KEYS) url.searchParams.delete(key);

  const address = String(settings?.address ?? '').trim();
  const port = Number(settings?.port);
  const protocol = String(settings?.protocol ?? '');
  const downsample = Number(settings?.downsample);

  if (address) url.searchParams.set('address', address);
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    url.searchParams.set('port', String(port));
  }
  if (['auto', '2', '3'].includes(protocol)) {
    url.searchParams.set('protocol', protocol);
  }
  if (Number.isInteger(downsample) && downsample >= 1) {
    url.searchParams.set('downsample', String(downsample));
  }

  return url.toString();
}

export function readConnectionOptionsFromUrl(urlValue) {
  const url = new URL(urlValue);
  const options = {};

  const address = url.searchParams.get('address');
  if (address?.trim()) options.address = address.trim();

  const port = Number(url.searchParams.get('port'));
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    options.port = String(port);
  }

  const protocol = url.searchParams.get('protocol');
  if (protocol && ['auto', '2', '3'].includes(protocol)) {
    options.protocol = protocol;
  }

  const downsample = Number(url.searchParams.get('downsample'));
  if (Number.isInteger(downsample) && downsample >= 1) {
    options.downsample = String(downsample);
  }

  return options;
}
