export function readZoneEventState(event) {
  const state = {
    address: event.getEmitterZoneAddress(),
    presence: event.getPresence(),
    slider: undefined,
    xyPad: undefined
  };

  for (const property of event.getProperties()) {
    if (property.isSlider()) {
      state.slider = property.getSliderParameters().value;
    } else if (property.isXYPad()) {
      const value = property.getXYPadParameters();
      state.xyPad = { x: value.x, y: value.y };
    }
  }

  return state;
}


export function collectZoneAddresses(container, result = new Set()) {
  if (!container) return result;

  if (container.isZone?.()) {
    const address = container.getAddress?.();
    if (address) result.add(address);
  }

  for (const child of container.getChildren?.() ?? []) {
    collectZoneAddresses(child, result);
  }

  return result;
}
