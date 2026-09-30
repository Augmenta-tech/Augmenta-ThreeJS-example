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
