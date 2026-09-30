// Velocity itself is provided by Augmenta through the SDK.
// Speed is intentionally a consumer-side derived value, matching the current
// Unity WebSocket and TouchDesigner C++ client integrations.
export function speedFromVelocity(velocity) {
  return Math.hypot(...velocity);
}
