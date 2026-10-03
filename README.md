# Augmenta Three.js Example

A small, dependency-light Three.js application showing how to consume Augmenta real-time tracking data with the official [Augmenta Client JavaScript SDK](https://github.com/Augmenta-tech/AugmentaClientSDK-JS).

The example is deliberately both a **reference integration** and a **debug viewer**: it visualizes tracking data in 3D while exposing the main values received from Augmenta in a readable side panel. The inspector keeps the live view concise by omitting transport timestamps and labels zone packets simply as **Zones**. The Scene selector defaults to **All scenes**. The Frame inspector also reports the current Scene size in metres.

## Live demo

**GitHub Pages:** https://augmenta-tech.github.io/Augmenta-ThreeJS-example/

The page includes a **Simulate data** toggle, so the UI and rendering can be tested without an Augmenta server. The synthetic setup uses the same World → Scene → Zone hierarchy as a live setup. While active, the button reads **Simulating** and clicking it again stops the simulation.

Connection settings, display toggles, the preferred Scene, sidebar state, section/Advanced fold state, and the current camera position/orbit target are stored in browser `localStorage` and restored on refresh. The bottom-left QR code opens the same page with the current Augmenta address, port, protocol and downsample embedded in the URL. Those shared URL values are a tab-local override. Editing one connection field updates only that field in this browser's saved defaults; the other QR-provided values stay temporary and independent. Transient runtime state such as connection status, simulation state, received tracking data, and debug contents is intentionally not persisted.

> GitHub Pages is served over HTTPS. The example still tries `ws://` first, then `wss://`, because local Augmenta outputs commonly expose a plain WebSocket endpoint.

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

- cluster bounding boxes, centroids and readable IDs, with the received look-at direction shown as a faint lower-edge chevron when **Velocity vectors** are enabled;
- velocity vectors with arrow heads at the received velocity magnitude;
- cluster/point-cloud pairs in distinct colors chosen from a curated palette;
- point clouds;
- scene bounds and box/cylinder/sphere zones, with live presence labels shown below occupied zones and slider-volume fill on round zones;
- a Pleiades-style orbit camera, 1 × 1 m floor grid and axes;
- the Pleiades-style view cube: a bare draggable cube in perspective and an **Ortho** panel with Front/Back/Left/Right/Top/Bottom shortcuts in orthographic mode. The panel × returns to the remembered perspective view. Its labels follow the Three.js world axes directly: Front = +Z, Back = -Z, Right = +X, Left = -X, Top = +Y, Bottom = -Y.

Mouse navigation follows the Pleiades viewer philosophy: left-drag orbits, right-drag pans parallel to the floor, middle-drag/wheel zooms, and the free perspective orbit is constrained above the floor plane. The ViewCube itself can also be dragged to orbit the camera directly with the same horizontal/vertical drag directions as the main Three.js orbit controls; a short click on a cube face switches to the matching orthographic view, while pointer capture begins only after the gesture becomes a drag. The ViewCube follows one simple projection rule: perspective uses only the bare cube, while orthographic mode uses the full **Ortho** panel and view shortcuts. With the menu unfolded, the perspective cube remains visible; with the menu folded, it appears only after the camera actually starts moving during a drag and fades out gently afterward, so a simple click never flashes the cube. The Ortho panel stays visible regardless of menu state. Switching between orthographic presets updates the camera and selected button immediately, while the cube keeps a short 3D rotation animation for orientation feedback. Entering Ortho from perspective follows Pleiades' direct position/target framing motion, with the same 320 ms cubic-bezier timing as the cube and a projection-scale interpolation that starts from the current perspective framing. While Ortho is active, **Tab** cycles through the method views in their displayed order — Top, Front, Right, Left, Back, Bottom — while **Shift+Tab** goes in reverse; **Escape** exits Ortho without folding the main menu. There is no separate ISO shortcut anymore: the panel × exits orthographic mode and returns to the remembered perspective composition. Dragging out of Ortho is different by design: it keeps the current camera radius, target and direction and matches the orthographic framing with perspective optical zoom. This mirrors Pleiades' radius-based orthographic framing and avoids moving the camera in or out during the projection switch. In Ortho, pan and zoom stay orthographic. Dragging the ViewCube or main 3D view out of Ortho converts the current view to matching perspective framing as soon as the drag becomes a real orbit, then continues the same drag in perspective. Folding the menu still hides the QR code. The Ortho panel × returns to the last perspective composition (including its orbit, pan and zoom) rather than resetting it; **Reset camera** explicitly replaces that remembered perspective view with the automatic home framing, so a later full setup can frame its new bounds normally. The selected projection, orthographic zoom, camera position and orbit target are persisted after navigation and restored on refresh; setup updates do not overwrite a restored/user-controlled view. Without a saved/user-controlled view, a successful connection setup initializes the same centered framing used by **Reset camera**. **Simulate data**, **Reset camera**, or a left-button double-click reframes the displayed setup. The sidebar uses two lightweight levels of disclosure: each main section can be folded to a compact status row, and each section can expose a denser **Advanced** subsection for less-used controls. In **Connection**, the server address, Connect/Simulate controls, and live connection log stay primary while Port, Protocol and Point downsample live under Advanced. **Display** keeps the Scene plus common visibility toggles primary, with **Reset camera** beside the Scene label and Velocity vectors under Advanced. **Live debug data** stays readable as the main content with a lightweight **Clear data** action above the inspector. While the Live debug data section is folded, only its compact summary is refreshed; the detailed debug HTML is not rebuilt until the section is opened again. While interacting with Frame / Objects / Zones / Control disclosures, debug DOM refreshes briefly pause so a live 4 Hz update cannot replace the clicked disclosure between pointer-down and click. The Display panel exposes **All scenes** plus every Scene received in the current World, with independent **Scenes** and **Zones** visibility toggles. On desktop, the translucent panel overlays the 3D view: use the edge arrow to hide/show it, or drag its left edge to resize it. On phone/touch layouts, the same control becomes a small horizontal handle at the viewer/menu boundary; folding the menu expands the viewer to the full viewport while keeping the handle available to reopen it. **Escape** folds the panel. **H** toggles the viewer title/subtitle as a transient display shortcut; unlike the other UI/display preferences, this title visibility is intentionally not persisted. On desktop, after 3 seconds without mouse movement or keyboard input, the handle fades whether the panel is unfolded or folded; activity brings it back quickly. On phone/touch layouts, the handle stays visible so the folded menu can always be reopened. When folded, the sidebar and QR code are hidden and removed from interaction; the ViewCube follows the contextual perspective/orthographic rules above. The camera projection follows the panel width so the orbit target remains centered in the unobscured part of the view.

Partial setup updates are merged into the cached hierarchy before rendering, so a Scene update that omits its Zone children does not erase them. Updates that race ahead of the initial full setup are ignored rather than promoted to an incomplete root. When a specific Scene is selected, live setup updates still render from the World root so ancestor transforms remain intact. Zone-event caches are pruned against the latest setup hierarchy so renamed/removed addresses do not accumulate stale visual state. A zone stops rendering 50 ms after its live event heartbeat disappears, so disabled zones vanish quickly while their setup definition remains available. Scene selection and scene-size debug information therefore always use the latest valid merged setup.

The live debug inspector is throttled and preserves the user's open/closed section state across refreshes. Cluster debug values include the received OBB quaternion and `lookAt` vector so the rendered direction marker can be checked against the wire data. Using **Clear data** preserves the inspector layout and sidebar scroll position while the live stream repopulates, so clearing data does not jump the panel. The JavaScript SDK is included as a **Git submodule** in `vendor/AugmentaClientSDK-JS` and pinned to SDK `1.0.0-beta.1` commit `115b77c1` for reproducible builds. The SDK lockfile is committed, so CI and local reproducible builds use `npm ci`. The pinned SDK includes bulk point-cloud parsing, packet-boundary validation, protocol V2/V3 guards and stale-WebSocket-event protection. The inspector exposes the main fields useful for this example; raw point arrays are rendered in full in Three.js while the text panel is throttled and point-intensity statistics are bounded to a representative sample to stay responsive with large clouds.

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
npm ci --prefix vendor/AugmentaClientSDK-JS --no-audit --no-fund
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
2. Enter the Augmenta server IP address or hostname and port. An IP address or already-qualified hostname is used as-is. For a simple hostname such as `augmenta-server`, the example tries the literal name first, then `.local`, `.home`, and the standard `.home.arpa`, stopping at the first successful connection. `localhost` prefers `127.0.0.1` and keeps hostname/IPv6 fallbacks. Both HTTP and HTTPS pages try `ws://` first and then `wss://`. The default port is `6060`. Enter only the host in the address field; the port stays in its separate field.
3. Keep **Auto** unless you are testing a specific protocol version. Auto starts with V3 and automatically reconnects with the server-reported V2/V3 parser when required.
4. The viewer starts in **Connecting…** mode automatically, moves through the fallback candidates as they fail, and retries the full set after one second until a connection succeeds. While active, the button becomes **Connected**; click it to stop all reconnect attempts.


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
  boxRotationMode: RotationMode.Quaternions,
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

The example explicitly requests the Three.js convention from Augmenta: **Y up, right handed, bottom-left origin, absolute coordinates, no extra flips**, so one coordinate unit remains one meter. Pleiades applies that transform to live tracking and setup positions before transmission. Scene and box-zone sizes are unsigned magnitudes, so the renderer places their local depth toward **-Z** to preserve the requested right-handed direction. Tracked bounding-box rotation is explicitly requested as **quaternions** (also the SDK default) and converted from Augmenta/Pleiades' Y-up left-handed basis to Three.js' Y-up right-handed basis in the viewer. Setup Scene/Zone rotations are currently transported as Euler vectors by the control/setup protocol, so the viewer reconstructs the Pleiades Z-Y-X orientation and applies the same handedness conversion before rendering.

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
├── .github/workflows/ci.yml           # Pull-request validation
├── .github/workflows/pages.yml        # Build SDK + deploy GitHub Pages
├── AGENTS.md                           # Concise architecture + behavior invariants
├── index.html                          # Static entry point + import map
├── augmenta-favicon.png                # White Augmenta symbol used by the page
├── src/
│   ├── main.js                         # Application/UI orchestration
│   ├── connection.js                   # WebSocket/retry/protocol controller
│   ├── setup-store.js                  # Setup cache + partial update merging
│   ├── motion.js                       # Consumer-side velocity → speed helper
│   ├── qr.js                           # QR rendering + copy interaction
│   ├── view-cube.js                    # ViewCube UI, Ortho shortcuts + keyboard navigation
│   ├── view-transition.js              # Shared camera/ViewCube transition timing + easing
│   ├── viewer.js                       # Three.js scene, camera, clusters + points
│   ├── zones.js                        # Zone geometry, presence + XY pad rendering
│   ├── zone-state.js                   # Pure zone-event state extraction/cache input
│   ├── share-link.js                   # Shareable connection URL encode/decode
│   ├── debug.js                        # Throttled live debug inspector
│   ├── demo.js                         # SDK-based synthetic test stream
│   └── styles.css                      # Debug UI
├── tests/
│   ├── connection-targets.test.mjs     # Hostname/IP fallback ordering
│   ├── demo.test.mjs                   # Synthetic World/Scene hierarchy
│   ├── setup-store.test.mjs            # Partial setup update regression tests
│   ├── share-link.test.mjs             # Shared connection URL regression tests
│   ├── view-transition.test.mjs        # Shared ViewCube transition regression tests
│   ├── zone-slider-parser.test.mjs     # Current Pleiades slider wire-shape regression
│   └── zone-state.test.mjs             # Zone event state regression tests
├── scripts/assemble-site.mjs            # Self-contained Pages artifact assembly
├── vendor/AugmentaClientSDK-JS          # Git submodule
├── vendor/qrcode-generator/qrcode.js    # Vendored QR generator
├── LICENSE
├── THIRD_PARTY_LICENSES
└── README.md
```

For local development, Three.js is loaded as an ES module from jsDelivr and pinned to `0.186.1`. The GitHub Pages build copies that same pinned Three.js runtime into the revisioned static artifact, so the deployed viewer has no runtime CDN dependency. The QR overlay uses the vendored MIT-licensed `qrcode-generator` module pinned to `2.0.4`, with QR contents generated entirely in the browser. The Augmenta SDK is built from the submodule and its complete ESM graph is copied under a revisioned Pages path to avoid mixed-version browser caches.

## GitHub Pages deployment

Every push to `main` triggers `.github/workflows/pages.yml`.

The workflow:

1. checks out this repository and its submodule;
2. installs, builds and tests the pinned SDK submodule;
3. validates the example JavaScript and runs the full example regression test suite;
4. assembles a minimal static `_site` artifact;
5. deploys that artifact with GitHub Pages.

GitHub Pages must use **Settings → Pages → Source: GitHub Actions**. The workflow assumes Pages is already enabled and only builds and deploys the site.

Pull requests also run `.github/workflows/ci.yml`, which builds/tests the pinned SDK and runs the example regression tests without deploying Pages.

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

The connection field accepts an IP address or hostname. Simple hostnames are tried as entered, then with `.local`, `.home`, and `.home.arpa`; `localhost` prefers IPv4 (`127.0.0.1`) with hostname/IPv6 fallbacks, while IP addresses and already-qualified names are used as-is.

The low-level `AugmentaWebSocketClient` transport currently performs one connection attempt per `connect()` call. This example intentionally adds a lightweight 1-second retry loop at the application level, matching the auto-reconnect behavior used by Augmenta client integrations such as the Unity client. Clicking **Connected** / **Connecting…** stops that loop cleanly.

## Browser / networking notes

- the UI accepts only an IP address/hostname and port; it constructs WebSocket candidates internally and tries `ws://` before `wss://`.
- browser mixed-content and private-network protections may block the `ws://` fallback from an HTTPS page depending on browser policy;
- CORS does not govern WebSocket framing itself, but the server/browser can still apply Origin, TLS and local-network security rules.

If GitHub Pages cannot reach the Augmenta server, the local HTTP workflow above is the reference way to test the exact same application code.

## License

Augmenta-authored example code is distributed under the Augmenta SDK license in [LICENSE](LICENSE). Third-party notices, including the Three.js MIT license, are in [THIRD_PARTY_LICENSES](THIRD_PARTY_LICENSES).


## Live viewer behavior

If the server-side WebSocket connection disappears unexpectedly, live clusters, point clouds, velocity vectors and debug data are cleared after 500 ms while the application keeps retrying. The static scene/zones remain visible. Clicking **Connected** to disconnect manually stops retries and immediately removes only live tracking/debug data; the scene/zones remain visible. The **Clear data** button only clears the debug inspector.
