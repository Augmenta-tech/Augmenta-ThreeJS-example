import { VIEW_TRANSITION } from './view-transition.js';

const DRAG_RADIANS_PER_PIXEL = 0.012;
const DRAG_START_DISTANCE_PX = 3;

export function createViewCube(root, viewer) {
  if (!root) return;

  const scene = root.querySelector('.view-cube-scene');
  const cube = root.querySelector('.view-cube-object');
  const actions = root.querySelector('.view-cube-actions');
  const closeButton = root.querySelector('.view-cube-close');
  const faceButtons = [...root.querySelectorAll('.cube-face[data-view]')];
  const actionButtons = [...(actions?.querySelectorAll('[data-view]') ?? [])];
  const buttons = [...faceButtons, ...actionButtons];
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

    if (visible) {
      window.addEventListener('keydown', handleOrthoKeydown, { capture: true });
    } else {
      window.removeEventListener('keydown', handleOrthoKeydown, { capture: true });
    }

    if (!visible) {
      stopPresetTransition();
      if (actions?.contains(document.activeElement)) document.activeElement.blur();
    }

    // Keep keyboard navigation aligned with what is actually displayed.
    // In Ortho, Tab is reserved for the six method buttons in display order.
    for (const button of faceButtons) button.tabIndex = visible ? -1 : 0;
    for (const button of actionButtons) button.tabIndex = visible ? 0 : -1;
    if (closeButton) closeButton.tabIndex = -1;
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
  });

  scene?.addEventListener('pointermove', (event) => {
    if (event.pointerId !== dragPointerId) return;

    const dx = event.clientX - dragLastX;
    const dy = event.clientY - dragLastY;
    if (!dragMoved) {
      dragMoved = Math.hypot(
        event.clientX - dragStartX,
        event.clientY - dragStartY
      ) >= DRAG_START_DISTANCE_PX;
    }
    if (!dragMoved) return;

    // Capture only after the gesture is actually a drag. Capturing on
    // pointer-down retargets the eventual desktop click to the scene element,
    // which prevents cube-face buttons from receiving their click.
    if (!scene.hasPointerCapture(event.pointerId)) {
      scene.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    scene.classList.add('dragging');

    if (!dragInteractionStarted) {
      // Dragging out of Ortho preserves the current direction/pan/zoom instead
      // of restoring the saved perspective composition. The same pointer move
      // then continues naturally as a perspective orbit.
      if (projection === 'orthographic') viewer.leaveOrthographicFromCurrentView();
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

  function stopPresetTransition() {
    if (presetTransitionTimer) window.clearTimeout(presetTransitionTimer);
    presetTransitionTimer = undefined;
    root.classList.remove('preset-transition');
  }

  function startPresetTransition() {
    root.classList.add('preset-transition');
    if (presetTransitionTimer) window.clearTimeout(presetTransitionTimer);
    presetTransitionTimer = window.setTimeout(stopPresetTransition, VIEW_TRANSITION.durationMs);
  }

  function handleOrthoKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      viewer.returnToPerspective();
      return;
    }

    if (
      event.key !== 'Tab'
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || actionButtons.length === 0
    ) {
      return;
    }

    event.preventDefault();
    const direction = event.shiftKey ? -1 : 1;
    const currentIndex = actionButtons.findIndex(
      (button) => button.dataset.view === renderedActiveView
    );
    const startIndex = currentIndex >= 0
      ? currentIndex
      : (event.shiftKey ? 0 : -1);
    const nextIndex = (startIndex + direction + actionButtons.length) % actionButtons.length;
    const nextButton = actionButtons[nextIndex];
    const nextView = nextButton?.dataset.view;
    if (!nextView) return;

    startPresetTransition();
    viewer.setOrthographicView(nextView);
    nextButton.focus({ preventScroll: true });
  }

  viewer.setViewStateChangeHandler(render);
}
