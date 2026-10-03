import { VIEW_TRANSITION } from './view-transition.js';

const DRAG_RADIANS_PER_PIXEL = 0.012;
const DRAG_START_DISTANCE_PX = 3;

export function createViewCube(root, viewer) {
  if (!root) return { refresh() {} };

  const scene = root.querySelector('.view-cube-scene');
  const cube = root.querySelector('.view-cube-object');
  const actions = root.querySelector('.view-cube-actions');
  const buttons = [...root.querySelectorAll('[data-view]')];
  const viewIds = new Set(buttons.map((button) => button.dataset.view).filter(Boolean));

  root.style.setProperty('--view-transition-duration', `${VIEW_TRANSITION.durationMs}ms`);
  root.style.setProperty('--view-transition-easing', VIEW_TRANSITION.cssEasing);

  let dragPointerId;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragMoved = false;
  let dragInteractionStarted = false;
  let dragExitTransitioning = false;
  let suppressNextClick = false;
  let presetTransitionTimer;
  let renderedActiveView = null;
  let projection = 'perspective';
  let controlsVisible;

  function syncControlsVisibility() {
    const visible = projection === 'orthographic';
    if (visible === controlsVisible) return;

    controlsVisible = visible;
    root.classList.toggle('controls-visible', visible);
    actions?.toggleAttribute('aria-hidden', !visible);
    if (actions) actions.inert = !visible;
  }

  function render(state = {}) {
    if (cube && typeof state.cubeTransform === 'string') {
      cube.style.setProperty('--cube-transform', state.cubeTransform);
    }
    if (cube && Number.isFinite(state.cubeYaw)) {
      cube.style.setProperty('--cube-yaw', `${state.cubeYaw}deg`);
    }

    const activeView = viewIds.has(state.activeView) ? state.activeView : undefined;
    if (activeView !== renderedActiveView) {
      for (const button of buttons) {
        const active = button.dataset.view === activeView;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      renderedActiveView = activeView;
    }

    projection = state.mode === 'orthographic' ? 'orthographic' : 'perspective';
    root.classList.toggle('camera-interacting', state.interacting === true);
    syncControlsVisibility();
  }

  scene?.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;

    dragPointerId = event.pointerId;
    dragStartX = dragLastX = event.clientX;
    dragStartY = dragLastY = event.clientY;
    dragMoved = false;
    dragInteractionStarted = false;
    scene.setPointerCapture(event.pointerId);
  });

  scene?.addEventListener('pointermove', (event) => {
    if (event.pointerId !== dragPointerId || !scene.hasPointerCapture(event.pointerId)) return;

    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    if (!dragMoved) {
      dragMoved = Math.hypot(
        event.clientX - dragStartX,
        event.clientY - dragStartY
      ) >= DRAG_START_DISTANCE_PX;
    }
    if (!dragMoved) return;

    event.preventDefault();
    scene.classList.add('dragging');

    // Exit Ortho through the viewer's single transition path. If the pointer
    // is still held when it completes, the same drag can continue orbiting.
    if (!dragInteractionStarted && !dragExitTransitioning && projection === 'orthographic') {
      const exitingPointerId = dragPointerId;
      dragExitTransitioning = true;
      startPresetTransition();
      viewer.returnToPerspective({
        onComplete: (completed) => {
          dragExitTransitioning = false;
          if (!completed || dragPointerId !== exitingPointerId || !dragMoved) return;
          dragInteractionStarted = true;
          viewer.beginCameraInteraction();
        }
      });
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      return;
    }

    if (dragExitTransitioning) {
      dragLastX = event.clientX;
      dragLastY = event.clientY;
      return;
    }

    if (!dragInteractionStarted) {
      dragInteractionStarted = true;
      viewer.beginCameraInteraction();
    }

    // Match OrbitControls exactly: dragging right decreases azimuth and
    // dragging down decreases polar angle.
    viewer.orbitCamera(
      -dx * DRAG_RADIANS_PER_PIXEL,
      -dy * DRAG_RADIANS_PER_PIXEL
    );
    dragLastX = event.clientX;
    dragLastY = event.clientY;
  });

  function endDrag(event) {
    if (event.pointerId !== dragPointerId) return;

    if (scene?.hasPointerCapture(event.pointerId)) {
      scene.releasePointerCapture(event.pointerId);
    }
    scene?.classList.remove('dragging');

    if (dragInteractionStarted) viewer.endCameraInteraction();
    if (dragMoved) {
      suppressNextClick = true;
      window.setTimeout(() => { suppressNextClick = false; }, 0);
    }
    dragPointerId = undefined;
    dragMoved = false;
    dragInteractionStarted = false;
  }

  scene?.addEventListener('pointerup', endDrag);
  scene?.addEventListener('pointercancel', endDrag);

  root.addEventListener('click', (event) => {
    if (suppressNextClick) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = false;
      return;
    }
    if (!(event.target instanceof Element)) return;

    if (event.target.closest('.view-cube-close')) {
      startPresetTransition();
      viewer.returnToPerspective();
      return;
    }

    const button = event.target.closest('[data-view]');
    if (!button || !root.contains(button)) return;
    const view = button.dataset.view;
    if (!view) return;

    if (projection === 'orthographic' && view !== renderedActiveView) {
      startPresetTransition();
    }

    viewer.setOrthographicView(view);
  });

  function startPresetTransition() {
    root.classList.add('preset-transition');
    if (presetTransitionTimer) window.clearTimeout(presetTransitionTimer);
    presetTransitionTimer = window.setTimeout(() => {
      presetTransitionTimer = undefined;
      root.classList.remove('preset-transition');
    }, VIEW_TRANSITION.durationMs);
  }

  viewer.setViewStateChangeHandler(render);
  return { refresh: render };
}
