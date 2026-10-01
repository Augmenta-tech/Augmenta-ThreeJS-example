import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Client,
  ZonePropertyType
} from '../vendor/AugmentaClientSDK-JS/dist/esm/index.js';

const concat = (...parts) => {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};

const i32 = (value) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setInt32(0, value, true);
  return bytes;
};

const f32 = (value) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return bytes;
};

const u8 = (value) => Uint8Array.of(value);
const str = (value) => new TextEncoder().encode(value);

function packet(type, payload) {
  return concat(i32(5 + payload.length), u8(type), payload);
}

test('Pleiades multi-value slider property keeps the current average value', () => {
  const address = str('/world/scene/zone');
  // Pleiades writes slider average first, followed by max/min when
  // "Send Min and Max slider values" is enabled.
  const sliderPayload = concat(f32(0.42), f32(0.9), f32(0.1));
  const slider = concat(
    i32(5 + sliderPayload.length),
    u8(ZonePropertyType.Slider),
    sliderPayload
  );

  const zone = packet(1, concat(
    i32(address.length), address,
    u8(0), u8(0), i32(1), f32(0),
    i32(1), slider
  ));

  const bundle = packet(255, concat(i32(1), zone));

  const client = new Client();
  client.initialize('slider-regression', {
    version: 2,
    useCompression: false
  });

  const event = client.parseDataBlob(bundle).getZoneEvents()[0];
  const property = event.getProperties().find((item) => item.isSlider());

  assert.ok(property);
  assert.ok(Math.abs(property.getSliderParameters().value - 0.42) < 1e-6);
});
