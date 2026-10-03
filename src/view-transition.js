export const VIEW_TRANSITION = Object.freeze({
  durationMs: 320,
  bezier: Object.freeze([0.2, 0.8, 0.2, 1]),
  cssEasing: 'cubic-bezier(.2, .8, .2, 1)'
});

export function viewTransitionEase(progress) {
  if (progress <= 0 || progress >= 1) return progress;

  const [x1, y1, x2, y2] = VIEW_TRANSITION.bezier;
  let lower = 0;
  let upper = 1;
  let parameter = progress;

  // CSS cubic-bezier easing is defined by x -> y, so invert x numerically.
  for (let i = 0; i < 12; i += 1) {
    parameter = (lower + upper) / 2;
    if (cubicBezierCoordinate(parameter, x1, x2) < progress) lower = parameter;
    else upper = parameter;
  }

  return cubicBezierCoordinate(parameter, y1, y2);
}

function cubicBezierCoordinate(t, control1, control2) {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * control1
    + 3 * inverse * t * t * control2
    + t * t * t;
}
