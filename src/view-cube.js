const DRAG_RADIANS_PER_PIXEL = 0.012;
const DRAG_START_DISTANCE_PX = 3;

export function createViewCube(root, viewer) {
  if (!root) return { refresh() {} };

  const scene = root.querySelector('.view-cube-scene');
  const cube = root.querySelector('.view-cube-object');
  const buttons = [...root.querySelectorAll('[data-view]')];
  const viewIds = new Set(buttons.map((button) => button.dataset.view).filter(Boolean));

  let dragPointerId;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragLastX = 0;
  let dragLastY = 0;
  let dragMoved = false;
  let suppressNextClick = false;

  function render(state = {}) {
    if (cube && typeof state.cubeTransform === 'string') {
      cube.style.setProperty('--cube-transform', state.cubeTransform);
    }
    if (cube && Number.isFinite(state.cubeYaw)) {
      cube.style.setProperty('--cube-yaw', `${state.cubeYaw}deg`);
    }

    const activeView = viewIds.has(state.activeView) ? state.activeView : undefined;
    for (const button of buttons) {
      button.classList.toggle('active', button.dataset.view === activeView);
      button.setAttribute('aria-pressed', String(button.dataset.view === activeView));
    }

    root.dataset.projection = state.mode === 'orthographic' ? 'orthographic' : 'perspective';
  }

  scene?.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;

    dragPointerId = event.pointerId;
    dragStartX = dragLastX = event.clientX;
    dragStartY = dragLastY = event.clientY;
    dragMoved = false;
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

    // Camera azimuth is the inverse of the cube's visible yaw, so horizontal
    // drag feels like grabbing and turning the cube itself.
    viewer.orbitCamera(
      -dx * DRAG_RADIANS_PER_PIXEL,
      dy * DRAG_RADIANS_PER_PIXEL
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

    if (dragMoved) {
      suppressNextClick = true;
      window.setTimeout(() => { suppressNextClick = false; }, 0);
    }
    dragPointerId = undefined;
    dragMoved = false;
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
    const button = event.target.closest('[data-view]');
    if (!button || !root.contains(button)) return;
    const view = button.dataset.view;
    if (view) viewer.setView(view);
  });

  viewer.setViewStateChangeHandler(render);
  return { refresh: render };
}
