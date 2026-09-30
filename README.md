# Augmenta Three.js Example

A small, dependency-light Three.js application showing how to consume Augmenta real-time tracking data with the official [Augmenta Client JavaScript SDK](https://github.com/Augmenta-tech/AugmentaClientSDK-JS).

The example is deliberately both a **reference integration** and a **debug viewer**: it visualizes tracking data in 3D while exposing the main values received from Augmenta in a readable side panel. The inspector keeps the live view concise by omitting transport timestamps and labels zone packets simply as **Zones**. The Scene selector defaults to **All scenes**. The Frame inspector also reports the current Scene size in metres.

## Live demo

**GitHub Pages:** https://augmenta-tech.github.io/Augmenta-ThreeJS-example/

The page includes a **Simulate data** toggle, so the UI and rendering can be tested without an Augmenta server. While active, the button reads **Simulating** and clicking it again stops the simulation.

> GitHub Pages is served over HTTPS while this example intentionally connects with local `ws://`. Browser security rules can therefore block access to a local Augmenta server. Running the same example locally over HTTP is the reference workflow for real local-network streams.

## What it shows

The viewer requests the richest practical uncompressed stream from the Augmenta WebSocket Output:

- automatic protocol selection: try V3 first, then reconnect with the server-reported V2/V3 parser when needed;
- clusters and stable IDs / UUIDs;
- centroid, velocity, speed, state, bounding-box size and rotation;
- velocity is received directly from Augmenta through the SDK; the pinned SDK has explicit non-zero V2/V3 velocity parsing regression tests, while speed is derived client-side as the velocity magnitude;
- bounding-box center, size and rotation;
- object point clouds and point-intensity data when present;
- scene dimensions from setup data;
- zone enter, leave and presence values, shown by Zone name rather than protocol address;
- slider, XY pad and zone point-cloud properties;
- setup/update hierarchy with scene and zone position, rotation, color and supported shapes.

Three.js renders:

- cluster bounding boxes, centroids and readable IDs;
- velocity vectors with arrow heads, drawn at 3× visual scale for readability while debug values remain unmodified;
- cluster/point-cloud pairs in distinct colors chosen from a curated palette;
- point clouds;
- scene bounds, scene floor and box/cylinder/sphere zones, with live presence labels shown below occupied zones;
- a Pleiades-style orbit camera, 1 × 1 m floor grid and axes.

Mouse navigation follows the Pleiades viewer philosophy: left-drag orbits, right-drag pans parallel to the floor, middle-drag/wheel zooms, and the orbit is constrained above the floor plane. A successful connection setup and **Simulate data** both initialize the camera with the exact same centered framing used by **Reset camera**. **Reset camera** or a left-button double-click reframes the displayed setup. The Display panel exposes **All scenes** plus every Scene received in the current World. On desktop, the translucent panel overlays the 3D view: use the edge arrow to hide/show it, or drag its left edge to resize it. The camera projection follows the panel width so the orbit target remains centered in the unobscured part of the view.

Partial setup updates are merged into the cached hierarchy before rendering, so a Scene update that omits its Zone children does not erase them. Scene selection and scene-size debug information therefore always use the latest merged setup.

The JavaScript SDK is included as a **Git submodule** in `vendor/AugmentaClientSDK-JS` and pinned to commit `808e0b2e`, which is also the current SDK `main`, for reproducible builds. The inspector exposes the main fields useful for this example; raw point arrays are rendered in full in Three.js but only sampled in the text panel to keep the DOM responsive.

## Clone and run locally

Requirements:

- Git
- Node.js 22 or newer (only needed to build the SDK submodule; matches CI)
- any local static HTTP server

Clone with the submodule:

```bash
git clone --recurse-submodules https://github.com/Augmenta-tech/Augmenta-ThreeJS-example.git
cd Augmenta-ThreeJS-example
```

If the repository was already cloned without submodules:

```bash
git submodule update --init --recursive
```

Build the SDK:

```bash
npm install --prefix vendor/AugmentaClientSDK-JS --no-audit --no-fund
npm run build --prefix vendor/AugmentaClientSDK-JS
```

Serve the repository root. For example with Python:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Do not open `index.html` directly with `file://`; ES modules need to be served over HTTP(S).

## Connect to Augmenta

1. Enable the Augmenta **WebSocket Output**.
2. Enter the Augmenta server IP address or hostname and port. An IP address or already-qualified hostname is used as-is; a simple hostname such as `augmenta-server` automatically becomes `augmenta-server.local`. The default port is `6060`. The address field intentionally accepts only a host: enter the port in its separate field and do not add `ws://`.
3. Keep **Auto** unless you are testing a specific protocol version. Auto starts with V3 and automatically reconnects with the server-reported V2/V3 parser when required.
4. The viewer starts in **Connecting…** mode automatically and keeps retrying every second until a connection succeeds. While active, the button becomes **Connected**; click it to stop all reconnect attempts.


The example requests:

```js
{
  version: 3,
  streamClouds: true,
  streamClusters: true,
  streamClusterPoints: true,
  streamZonePoints: true,
  useCompression: false,
  displayPointIntensity: true,
  boxRotationMode: RotationMode.Radians,
  axisTransform: {
    axis: AxisMode.YUpRightHanded,
    origin: OriginMode.BottomLeft,
    flipX: false,
    flipY: false,
    flipZ: false,
    coordinateSpace: CoordinateSpace.Absolute
  }
}
```

Compression is disabled because the browser example intentionally stays dependency-free. Applications that need compressed streams can provide the SDK with a Zstd decompressor.

The JS SDK parses velocity directly from the binary cluster property at the same offset as the C++ and C# SDKs. It does not reconstruct velocity from positions; if Augmenta sends a zero vector, the example intentionally displays that zero vector rather than inventing a replacement.

The example explicitly requests the Three.js convention from Augmenta: **Y up, right handed, bottom-left origin, absolute coordinates, no extra flips**, so one coordinate unit remains one meter. Pleiades applies that transform to live tracking and setup positions before transmission. Scene and box-zone sizes are unsigned magnitudes, so the renderer places their local depth toward **-Z** to preserve the requested right-handed direction. Bounding-box rotation is requested in **radians**, allowing Pleiades to apply the same axis conversion before Three.js consumes it.

## SDK / example boundary

The example intentionally keeps protocol responsibilities out of the Three.js layer:

- **SDK:** registration options, WebSocket transport, V2/V3 parsing, typed Augmenta packets, control/setup hierarchy.
- **Connection controller:** WebSocket lifecycle, retry policy, protocol fallback and Augmenta stream options.
- **Setup store:** immutable setup cache that merges partial Scene/Zone updates while preserving unchanged children.
- **Example controller:** UI wiring, Scene selection, demo mode and live/debug presentation state.
- **Three.js viewer:** rendering, camera behavior, labels/colors and direct presentation of the SDK values already transformed by Pleiades.

This separation keeps the SDK reusable by non-Three.js applications and keeps rendering/UI decisions out of the protocol library.

## Project structure

```text
.
├── .github/workflows/pages.yml        # Build SDK + deploy GitHub Pages
├── index.html                          # Static entry point + import map
├── augmenta-favicon.png                # White Augmenta symbol used by the page
├── src/
│   ├── main.js                         # Application/UI orchestration
│   ├── connection.js                   # WebSocket/retry/protocol controller
│   ├── setup-store.js                  # Setup cache + partial update merging
│   ├── motion.js                       # Consumer-side velocity → speed helper
│   ├── viewer.js                       # Three.js scene + Augmenta rendering
│   ├── debug.js                        # Live debug inspector
│   ├── demo.js                         # SDK-based synthetic test stream
│   └── styles.css                      # Debug UI
├── tests/
│   └── setup-store.test.mjs            # Partial setup update regression tests
├── vendor/AugmentaClientSDK-JS         # Git submodule
├── LICENSE
├── THIRD_PARTY_LICENSES
└── README.md
```

Three.js is loaded as an ES module from jsDelivr and pinned to `0.186.1`. The Augmenta SDK is built from the submodule and imported directly from its generated ESM output.

## GitHub Pages deployment

Every push to `main` triggers `.github/workflows/pages.yml`.

The workflow:

1. checks out this repository and its submodule;
2. installs, builds and tests the pinned SDK submodule;
3. validates the example and runs setup-update regression tests;
4. assembles a minimal static `_site` artifact;
5. deploys that artifact with GitHub Pages.

GitHub Pages must use **Settings → Pages → Source: GitHub Actions**. The workflow assumes Pages is already enabled and only builds and deploys the site.

## Updating the SDK submodule

To move the example to a newer SDK revision:

```bash
cd vendor/AugmentaClientSDK-JS
git fetch origin
git checkout main
git pull --ff-only
cd ../..
git add vendor/AugmentaClientSDK-JS
git commit -m "chore: update Augmenta JS SDK submodule"
```

Run the example again after each SDK update and verify automatic protocol negotiation plus explicit V2/V3 modes if backwards compatibility matters for the release.

### Reconnection behavior

The connection field accepts an IP address or hostname. A hostname without a suffix automatically gets `.local` appended.

The low-level `AugmentaWebSocketClient` transport currently performs one connection attempt per `connect()` call. This example intentionally adds a lightweight 1-second retry loop at the application level, matching the auto-reconnect behavior used by Augmenta client integrations such as the Unity client. Clicking **Connected** / **Connecting…** stops that loop cleanly.

## Browser / networking notes

- the UI accepts only an IP address/hostname and port; it constructs the local `ws://` URL internally.
- browser mixed-content and private-network protections can prevent the public HTTPS page from opening a local `ws://` endpoint;
- CORS does not govern WebSocket framing itself, but the server/browser can still apply Origin, TLS and local-network security rules.

If GitHub Pages cannot reach the Augmenta server, the local HTTP workflow above is the reference way to test the exact same application code.

## License

Augmenta-authored example code is distributed under the Augmenta SDK license in [LICENSE](LICENSE). Third-party notices, including the Three.js MIT license, are in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).


## Live viewer behavior

If the server-side WebSocket connection disappears unexpectedly, live clusters, point clouds, velocity vectors and debug data are cleared after 500 ms while the application keeps retrying. The static scene/zones remain visible. Clicking **Connected** to disconnect manually stops retries and immediately removes only live tracking/debug data; the scene/zones remain visible. The **Clear** button only clears the debug inspector.
