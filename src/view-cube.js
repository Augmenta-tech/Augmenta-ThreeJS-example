export function createViewCube(root, viewer) {
  if (!root) return { refresh() {} };

  const cube = root.querySelector('.view-cube-object');
  const buttons = [...root.querySelectorAll('[data-view]')];
  const viewIds = new Set(buttons.map((button) => button.dataset.view).filter(Boolean));

  function render(state = {}) {
    if (cube && typeof state.cubeTransform === 'string') {
      cube.style.setProperty('--cube-transform', state.cubeTransform);
    }
    if (cube && Number.isFinite(state.cubeYaw)) {
      cube.style.setProperty('--cube-yaw', `${state.cubeYaw}deg`);
    }

    const activeView = viewIds.has(state.activeView) ? state.activeView : 'home';
    for (const button of buttons) {
      button.classList.toggle('active', button.dataset.view === activeView);
      button.setAttribute('aria-pressed', String(button.dataset.view === activeView));
    }

    root.dataset.projection = state.mode === 'orthographic' ? 'orthographic' : 'perspective';
  }

  root.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-view]');
    if (!button || !root.contains(button)) return;
    const view = button.dataset.view;
    if (view) viewer.setView(view);
  });

  viewer.setViewStateChangeHandler(render);
  return { refresh: render };
}
