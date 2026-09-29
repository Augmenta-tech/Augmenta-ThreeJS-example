import { ClusterState, ShapeType, ZonePropertyType } from 'augmenta-client-sdk';

export function createDebugPanel(summary, content) {
  let lastRender = 0;

  function render(frame, control, fps, force = false) {
    const now = performance.now();
    if (!force && now - lastRender < 120) return;
    lastRender = now;
    if (!frame && !control) return;

    summary.textContent = `${frame?.getObjectCount() ?? 0} objects · ${frame?.getZoneEventCount() ?? 0} zone events · ${fps} fps`;
    const blocks = [];
    if (frame) blocks.push(frameBlock(frame, fps), objectsBlock(frame), zonesBlock(frame));
    if (control) blocks.push(controlBlock(control));
    content.innerHTML = blocks.join('');
  }

  function clear() {
    summary.textContent = 'No data yet';
    content.innerHTML = '<div class="empty-state">Connect to Augmenta or run the demo to inspect the stream.</div>';
  }

  return { render, clear };
}

function frameBlock(frame, fps) {
  const scene = frame.getSceneInfo();
  return `<details open><summary>Frame & scene</summary><div class="debug-block">fps (received)      ${fps}\nbundle timestamp    ${esc(frame.timestamp ?? 'n/a')}\nscene address       ${esc(scene.getAddress() || 'n/a')}\nscene timestamp     ${esc(scene.getTimestamp() ?? 'n/a')}\nobjects             ${frame.getObjectCount()}\nzone events         ${frame.getZoneEventCount()}</div></details>`;
}

function objectsBlock(frame) {
  const objects = frame.getObjects();
  if (!objects.length) return '<details><summary>Objects (0)</summary><div class="debug-block muted">No tracked objects in this frame.</div></details>';

  const rows = objects.map((object) => {
    let cluster = '<span class="muted">No cluster property</span>';
    if (object.hasCluster()) {
      const c = object.getCluster();
      cluster = `state ${esc(ClusterState[c.getState()] ?? c.getState())}<br>centroid ${esc(vec(c.getCentroid()))}<br>velocity ${esc(vec(c.getVelocity()))}<br>box center ${esc(vec(c.getBoundingBoxCenter()))}<br>box size ${esc(vec(c.getBoundingBoxSize()))}<br>rotation ${esc(vec(c.boundingBoxRotation))}<br>weight ${fmt(c.getWeight())}<br>lookAt ${esc(vec(c.getLookAt()))}`;
    }

    let points = '—';
    if (object.hasPointCloud()) {
      const cloud = object.getPointCloud();
      const sample = Array.from(cloud.getPointsData().slice(0, 15));
      points = `${cloud.getPointCount()} pts<br>sample ${esc(vec(sample))}`;
      const intensity = cloud.getIntensityData();
      if (intensity?.length) {
        let min = Infinity, max = -Infinity, sum = 0;
        for (const v of intensity) { min = Math.min(min, v); max = Math.max(max, v); sum += v; }
        points += `<br>intensity min/avg/max ${fmt(min)} / ${fmt(sum / intensity.length)} / ${fmt(max)}`;
      }
    }

    return `<tr><td>${esc(object.getID() ?? '—')}<br><span class="muted">${esc(object.getUUID() ?? '—')}</span></td><td>${cluster}</td><td>${points}</td></tr>`;
  }).join('');

  return `<details open><summary>Objects (${objects.length})</summary><table class="debug-table"><thead><tr><th>ID / UUID</th><th>Cluster</th><th>Point cloud</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function zonesBlock(frame) {
  const zones = frame.getZoneEvents();
  if (!zones.length) return '<details><summary>Zone events (0)</summary><div class="debug-block muted">No zone events in this frame.</div></details>';

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
    return `<tr><td>${esc(zone.getEmitterZoneAddress())}</td><td>enter ${zone.getEnters()}<br>leave ${zone.getLeaves()}<br>presence ${zone.getPresence()}<br>density ${fmt(zone.getDensity())}</td><td>${props}</td></tr>`;
  }).join('');

  return `<details open><summary>Zone events (${zones.length})</summary><table class="debug-table"><thead><tr><th>Address</th><th>Occupancy</th><th>Properties</th></tr></thead><tbody>${rows}</tbody></table></details>`;
}

function controlBlock(message) {
  const lines = [];
  walk(message.getRootObject(), 0, lines);
  return `<details><summary>Last control message · ${esc(message.type)}</summary><div class="debug-block">status              ${esc(message.getStatus())}\nserver protocol     ${esc(message.getServerProtocolVersion())}\nerror               ${esc(message.getErrorMessage() || '—')}\n\n${lines.join('\n')}</div></details>`;
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

function shapeName(value) { return typeof value === 'string' ? value : ShapeType[value] ?? String(value); }
function fmt(value, digits = 3) { return Number.isFinite(value) ? Number(value).toFixed(digits) : '—'; }
function vec(values, digits = 3) { return `[${Array.from(values || [], (v) => fmt(v, digits)).join(', ')}]`; }
function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
