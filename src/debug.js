import { ClusterState, ShapeType, ZonePropertyType } from 'augmenta-client-sdk';
import { speedFromVelocity } from './motion.js';

export function createDebugPanel(summary, content) {
  let lastRender = 0;

  function render(frame, control, fps, sceneSize, zoneNameForAddress, force = false) {
    const now = performance.now();
    if (!force && now - lastRender < 120) return;
    lastRender = now;
    if (!frame && !control) return;

    summary.textContent = frame
      ? `${frame.getObjectCount()} objects · ${frame.getZoneEventCount()} zones · ${fps} fps`
      : 'Waiting for tracking data';
    const blocks = [];
    if (frame) blocks.push(frameBlock(sceneSize), objectsBlock(frame), zonesBlock(frame, zoneNameForAddress));
    if (control) blocks.push(controlBlock(control));
    content.innerHTML = blocks.join('');
  }

  function clear() {
    lastRender = 0;
    summary.textContent = 'No data yet';
    content.innerHTML = '<div class="empty-state">Connect to Augmenta or run the demo to inspect the stream.</div>';
  }

  return { render, clear };
}

function frameBlock(sceneSize) {
  return `<details open><summary>Frame</summary><div class="debug-block">scene size          ${sceneSizeText(sceneSize)}</div></details>`;
}

function objectsBlock(frame) {
  const objects = frame.getObjects();
  if (!objects.length) return '<details><summary>Objects (0)</summary><div class="debug-block muted">No tracked objects in this frame.</div></details>';

  const rows = objects.map((object) => {
    let cluster = '<span class="muted">No cluster property</span>';
    if (object.hasCluster()) {
      const c = object.getCluster();
      const velocity = c.getVelocity();
      const speed = speedFromVelocity(velocity);
      cluster = `state ${esc(ClusterState[c.getState()] ?? c.getState())}<br>centroid ${esc(vec(c.getCentroid()))}<br>velocity ${esc(vec(velocity))}<br>speed ${fmt(speed)} m/s<br>box center ${esc(vec(c.getBoundingBoxCenter()))}<br>box size ${esc(vec(c.getBoundingBoxSize()))}<br>rotation ${esc(vec(c.getBoundingBoxRotationEuler()))}`;
    }

    let points = '—';
    if (object.hasPointCloud()) {
      const cloud = object.getPointCloud();
      const data = cloud.getPointsData();
      const sampleCount = Math.min(5, cloud.getPointCount());
      const sampleLines = [];
      for (let i = 0; i < sampleCount; i++) {
        sampleLines.push(`p${i + 1} ${esc(vec(data.slice(i * 3, i * 3 + 3)))}`);
      }

      points = [`${cloud.getPointCount()} pts`, ...sampleLines].join('<br>');
      const intensity = cloud.getIntensityData();
      if (intensity?.length) {
        let min = Infinity, max = -Infinity, sum = 0;
        for (const v of intensity) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
        points += `<br>intensity ${fmt(min)} / ${fmt(sum / intensity.length)} / ${fmt(max)}`;
      }
    }

    return `<tr><td>${esc(object.getID() ?? '—')}<br><span class="muted">${esc(object.getUUID() ?? '—')}</span></td><td>${cluster}</td><td>${points}</td></tr>`;
  }).join('');

  return `<details open><summary>Objects (${objects.length})</summary><table class="debug-table objects-table"><colgroup><col class="id-column"><col class="cluster-column"><col class="points-column"></colgroup><thead><tr><th>ID / UUID</th><th>Cluster</th><th>Point cloud</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function zonesBlock(frame, zoneNameForAddress) {
  const zones = frame.getZoneEvents();
  if (!zones.length) return '<details><summary>Zones (0)</summary><div class="debug-block muted">No zone data in this frame.</div></details>';

  const rows = zones.map((zone) => {
    const props = zone.getProperties().map((p) => {
      const name = ZonePropertyType[p.getType()] ?? p.getType();
      if (p.isSlider()) return `${name}: ${fmt(p.getSliderParameters().value)}`;
      if (p.isXYPad()) {
        const value = p.getXYPadParameters();
        return `${name}: [${fmt(value.x)}, ${fmt(value.y)}]`;
      }
      if (p.isPointCloud()) {
        const cloud = p.getPointCloudParameters();
        return `${name}: ${cloudSummary(cloud)}`;
      }
      return name;
    }).join('<br>') || '—';
    const address = zone.getEmitterZoneAddress();
    const name = zoneNameForAddress?.(address) || address || '—';
    return `<tr><td>${esc(name)}</td><td>enter ${zone.getEnters()}<br>leave ${zone.getLeaves()}<br>presence ${zone.getPresence()}</td><td>${props}</td></tr>`;
  }).join('');

  return `<details open><summary>Zones (${zones.length})</summary><table class="debug-table"><thead><tr><th>Zone</th><th>Occupancy</th><th>Properties</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function controlBlock(message) {
  const lines = [];
  walk(message.getRootObject(), 0, lines);
  const type = message.isSetup() ? 'setup' : message.isUpdate() ? 'update' : 'unknown';
  return `<details><summary>Last control message · ${esc(type)}</summary><div class="debug-block">status              ${esc(message.getStatus())}\nserver protocol     ${esc(message.getServerProtocolVersion())}\nerror               ${esc(message.getErrorMessage() || '—')}\n\n${esc(lines.join('\n'))}</div></details>`;
}

function walk(container, depth, lines) {
  const indent = '  '.repeat(depth);
  let extra = '';
  if (container.isScene()) extra = ` size=${vec(container.getSceneParameters().size)}`;
  if (container.isZone()) extra = ` ${zoneParameters(container.getZoneParameters())}`;
  lines.push(`${indent}${container.getType()} ${container.getName() || '(unnamed)'}\n${indent}  address=${container.getAddress() || '—'} pos=${vec(container.getPosition())} rot°=${vec(container.getRotation())} color=${vec(container.getColor())}${extra}`);
  for (const child of container.getChildren()) walk(child, depth + 1, lines);
}

function zoneParameters(params) {
  const shape = shapeName(params.getShapeType());
  if (params.isBox()) return `shape=${shape} size=${vec(params.getBoxShapeParameters().size)}`;
  if (params.isCylinder()) {
    const { radius, height } = params.getCylinderShapeParameters();
    return `shape=${shape} radius=${fmt(radius)} height=${fmt(height)}`;
  }
  if (params.isSphere()) return `shape=${shape} radius=${fmt(params.getSphereShapeParameters().radius)}`;
  return `shape=${shape}`;
}

function cloudSummary(cloud) {
  const sample = Array.from(cloud.getPointsData().slice(0, 15));
  let value = `${cloud.getPointCount()} pts; sample ${vec(sample)}`;
  const intensity = cloud.getIntensityData();
  if (intensity?.length) {
    let min = Infinity, max = -Infinity, sum = 0;
    for (const v of intensity) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
    value += `; intensity min/avg/max ${fmt(min)} / ${fmt(sum / intensity.length)} / ${fmt(max)}`;
  }
  return value;
}

function sceneSizeText(size) {
  if (!size || size.length < 3) return '—';

  // The stream is requested Y-up. Present dimensions as width × depth × height.
  const [x, y, z] = size;
  return [x, z, y].map((value) => `${compact(Math.abs(value))}m`).join(' × ');
}

function compact(value) {
  if (!Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function shapeName(value) { return typeof value === 'string' ? value : ShapeType[value] ?? String(value); }
function fmt(value, digits = 3) { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }
function vec(values, digits = 3) { return `[${Array.from(values || [], (v) => fmt(v, digits)).join(', ')}]`; }
function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
