# Repository guidance

Keep this example small, browser-native, and easy to inspect.

## Architecture

- Keep protocol parsing and transport behavior in the Augmenta JavaScript SDK or `src/connection.js`; do not reimplement protocol parsing in the Three.js viewer.
- Keep setup merging in `src/setup-store.js`, presentation state in `src/main.js`, and rendering/camera behavior in `src/viewer.js`.
- The viewer consumes Augmenta data in the requested Three.js convention: Y-up, right-handed, bottom-left origin, absolute coordinates, meters.

## Camera and ViewCube invariants

- The Ortho **×** restores the remembered perspective composition.
- Dragging/orbiting out of Ortho must **not** restore that saved composition. It converts the current Ortho direction, pan, and zoom to equivalent perspective framing and continues from there.
- Ortho preset changes are immediate for the camera; only the ViewCube uses the short preset orientation animation.
- Keep shared ViewCube transition timing/easing in `src/view-transition.js`; do not duplicate those values in CSS or other JavaScript.
- In Ortho, Tab order follows the displayed method order: Top, Front, Right, Left, Back, Bottom. Shift+Tab reverses it. Escape exits Ortho without folding the sidebar.
- Preserve persisted camera-state compatibility when changing stored field names or view identifiers.
- Perspective orbit intentionally extends below the floor to nearly the opposite pole; do not reintroduce a floor-height clamp. Keep broad but finite min/max camera distance and zoom limits.

## Runtime and dependencies

- GitHub Pages output must be self-contained at runtime. Keep Three.js and the built SDK copied into the assembled artifact by `scripts/assemble-site.mjs`.
- Keep application-side tracking buffering bounded: one pending frame per Scene, continuous state latest-wins, transient cluster/zone edges conflated rather than queued as full frames.
- Keep Three.js point-cloud buffers owned by the renderer. Do not attach SDK point arrays directly because they may be views into a complete decompressed WebSocket payload; reuse capacity and dispose replaced geometries.
- Avoid adding dependencies for behavior that can stay simple and local.

## Validation

Before considering a change ready:

1. Validate JavaScript syntax for `src/*.js`, `tests/*.mjs`, and `scripts/*.mjs`.
2. Run the example tests with `node --test tests/*.test.mjs`.
3. Build and test the pinned SDK submodule when SDK-facing behavior changes.
4. Assemble the Pages artifact and verify it contains no runtime CDN dependency.
5. For camera/ViewCube changes, manually qualify mouse drag, click, wheel/pan, Ortho ×, Escape, Tab/Shift+Tab, folded sidebar behavior, and mobile sizing.
