import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { viewportPixelRatio } from "./renderQuality.mjs";

const MAX_TRIANGLES = 200000;
const MAX_POINTS = 600000;

// Validate before allocating GPU arrays. Unknown values remain holes, never zeroes.
export function validateResultSurface(surface) {
  if (!surface || !Array.isArray(surface.points) || !Array.isArray(surface.triangles) || !Array.isArray(surface.values)) throw new Error("A saved triangular result surface is required.");
  if (surface.points.length > MAX_POINTS || surface.triangles.length > MAX_TRIANGLES) throw new Error("Saved surface exceeds the 200,000 triangle / 600,000 point limit.");
  const nodal = surface.nodal !== false;
  if (surface.values.length !== (nodal ? surface.points.length : surface.triangles.length)) throw new Error("Saved result values do not match the surface.");
  for (const p of surface.points) if (!Array.isArray(p) || p.length !== 3 || !p.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v)))) throw new Error("Saved surface contains an invalid coordinate.");
  for (const t of surface.triangles) if (!Array.isArray(t) || t.length !== 3 || !t.every(i => Number.isSafeInteger(i) && i >= 0 && i < surface.points.length)) throw new Error("Saved surface contains an invalid triangle index.");
  for (const v of surface.values) if (v !== null && !Number.isFinite(v)) throw new Error("Saved surface contains an invalid result value.");
  // Optional host-supplied sRGB samples share an exact 2D/3D colour mapping.
  // They are presentation metadata; scalar values and probe interpolation stay intact.
  if (surface.colors !== undefined) {
    if (!Array.isArray(surface.colors) || surface.colors.length !== surface.values.length) throw new Error("Saved result colours do not match the values.");
    for (let i = 0; i < surface.colors.length; i++) {
      const rgb = surface.colors[i];
      if (rgb === null && surface.values[i] === null) continue;
      if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) throw new Error("Saved result contains an invalid sRGB colour.");
    }
  }
  if (surface.range !== undefined && (!Array.isArray(surface.range) || surface.range.length !== 2 || !surface.range.every(Number.isFinite) || surface.range[0] > surface.range[1])) throw new Error("Invalid result display range.");
  return { ...surface, nodal };
}

function release(object) {
  object.traverse(child => { child.geometry?.dispose(); const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(m => { m?.map?.dispose(); m?.dispose(); }); });
  object.clear();
}

/** Surface coordinates are original solver coordinates; transform is an explicit host mapping. */
export function createResultOverlay(surface, transform = p => p) {
  const data = validateResultSurface(surface);
  const group = new THREE.Group(), pins = new THREE.Group();
  let low = Infinity, high = -Infinity;
  for (const value of data.values) if (value !== null) { low = Math.min(low, value); high = Math.max(high, value); }
  if (data.range) [low, high] = data.range;
  const positions = [], colors = [], faces = [];
  const palette = [new THREE.Color(0x2845bb), new THREE.Color(0x00cbd3), new THREE.Color(0xffe05a), new THREE.Color(0xe73c31)];
  const color = value => { const fraction = Number.isFinite(high - low) ? (value - low) / (high - low) : (value / 2 - low / 2) / (high / 2 - low / 2); const f = high > low ? Math.max(0, Math.min(1, fraction)) : .5; const scaled = f * 3, index = Math.min(2, Math.floor(scaled)); return palette[index].clone().lerp(palette[index + 1], scaled - index); };
  data.triangles.forEach((triangle, index) => {
    const values = data.nodal ? triangle.map(i => data.values[i]) : triangle.map(() => data.values[index]);
    if (values.some(v => v === null)) return;
    const points = triangle.map(i => transform(data.points[i]));
    if (points.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(v => Number.isFinite(v) && Number.isFinite(Math.fround(v))))) throw new Error("Invalid result coordinate mapping.");
    const a = new THREE.Vector3(...points[0]), b = new THREE.Vector3(...points[1]), c = new THREE.Vector3(...points[2]);
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() === 0) return;
    points.forEach((p, i) => { positions.push(...p); const supplied = data.colors?.[data.nodal ? triangle[i] : index]; const rgb = supplied ? new THREE.Color().setRGB(supplied[0] / 255, supplied[1] / 255, supplied[2] / 255, THREE.SRGBColorSpace) : color(values[i]); colors.push(rgb.r, rgb.g, rgb.b); });
    faces.push(index);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide, transparent: true, opacity: .85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geometry, material); group.add(mesh, pins);
  function sample(hit) {
    if (!hit || hit.object !== mesh || hit.faceIndex == null) return null;
    const index = faces[hit.faceIndex], triangle = data.triangles[index];
    if (!triangle) return null;
    const world = triangle.map(i => new THREE.Vector3(...transform(data.points[i])));
    const weights = new THREE.Vector3();
    THREE.Triangle.getBarycoord(hit.point, ...world, weights);
    if (![weights.x, weights.y, weights.z].every(Number.isFinite)) return null;
    const original = triangle.map(i => data.points[i]);
    const blend = component => original[0][component] * weights.x + original[1][component] * weights.y + original[2][component] * weights.z;
    const value = data.nodal ? data.values[triangle[0]] * weights.x + data.values[triangle[1]] * weights.y + data.values[triangle[2]] * weights.z : data.values[index];
    return { x: blend(0), y: blend(1), z: blend(2), value, unit: String(data.unit || ""), method: data.nodal ? "nodal barycentric interpolation" : "saved cell value", triangle: index };
  }
  return { group, mesh, surface: data, min: low, max: high, sample,
    setOpacity(value) { if (Number.isFinite(value)) { material.opacity = Math.max(0, Math.min(1, value)); mesh.visible = material.opacity > 0; } },
    setProbes(probes = []) {
      release(pins);
      if (!Array.isArray(probes)) return;
      const radius = Math.max((geometry.boundingSphere?.radius || 1) * .012, .001);
      for (const probe of probes.slice(0, 100)) {
        if (![probe.x, probe.y, probe.z].every(Number.isFinite)) continue;
        const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
        marker.position.set(...transform([probe.x, probe.y, probe.z])); marker.renderOrder = 10; marker.userData.label = String(probe.label || ""); pins.add(marker);
        if (probe.label) {
          const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 64;
          const context = canvas.getContext("2d");
          if (context) { context.fillStyle = "#101d28"; context.fillRect(0, 0, 256, 64); context.fillStyle = "#fff"; context.font = "bold 32px system-ui"; context.textBaseline = "middle"; context.fillText(String(probe.label).slice(0, 12), 8, 32, 240);
            const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.position.copy(marker.position).add(new THREE.Vector3(0, 0, radius * 4)); sprite.scale.set(radius * 12, radius * 3, 1); sprite.renderOrder = 11; pins.add(sprite); }
        }
      }
    },
    dispose() { release(group); group.removeFromParent(); }
  };
}

export function mountResultScene(container, options = {}) {
  const host = document.createElement("div"); host.style.cssText = "height:100%;min-height:240px;display:flex;flex-direction:column;position:relative";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.textContent = `:host{font:12px system-ui}*{box-sizing:border-box}.shell{height:100%;min-height:240px;display:flex;flex-direction:column}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px}button{padding:5px 10px;border-radius:4px;border:1px solid #819597;background:transparent;color:inherit;cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #42bd95}.stage{position:relative;flex:1;min-height:200px;overflow:hidden}.stage canvas{display:block;width:100%;height:100%;touch-action:none}.notice{padding:6px 8px}.value{padding:6px 8px;min-height:28px}label{display:flex;gap:4px;align-items:center}.title{font-weight:700}`;
  const shell = document.createElement("div"); shell.className = "shell";
  const bar = document.createElement("div"); bar.className = "bar";
  const title = document.createElement("span"); title.className = "title"; bar.append(title);
  const stage = document.createElement("div"); stage.className = "stage";
  const notice = document.createElement("div"); notice.className = "notice";
  const valueText = document.createElement("div"); valueText.className = "value"; valueText.setAttribute("aria-live", "polite");
  shell.append(bar, stage, notice, valueText); shadow.append(style, shell); container.append(host);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
  catch (error) { notice.textContent = "3D rendering is unavailable on this device. Use the 2D result view."; return { host, unavailable: true, setSurface() {}, setOpacity() {}, setTheme() {}, setProbes() {}, fit() {}, dispose() { host.remove(); } }; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('role', 'img'); renderer.domElement.setAttribute('aria-label', '3D saved result surface'); stage.append(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x101d28);
  const camera = new THREE.PerspectiveCamera(45, 1, .001, 1000000); camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
  let overlay = null, active = true, frame = 0, opacity = .85, probes = [];
  const pointer = new THREE.Vector2(), raycaster = new THREE.Raycaster();
  function fit(top = false) {
    if (!active || !overlay) return;
    const bounds = new THREE.Box3().setFromObject(overlay.mesh), sphere = bounds.getBoundingSphere(new THREE.Sphere());
    if (bounds.isEmpty()) return;
    const radius = Math.max(sphere.radius, .001), distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.25 / Math.min(camera.aspect, 1);
    controls.target.copy(sphere.center); camera.position.copy(sphere.center).add(new THREE.Vector3(...(top ? [0, -.000001, 1] : [1, -1, 1])).normalize().multiplyScalar(distance));
    camera.near = Math.max(radius * .00001, .000001); camera.far = distance + radius * 1000; camera.updateProjectionMatrix(); controls.minDistance = radius * .005; controls.maxDistance = radius * 1000; controls.update();
  }
  function setSurface(surface) {
    if (!active) return;
    const next = createResultOverlay(surface, ([x, y, z]) => [x, -y, z]); // Keep existing valid scene on rejected replacement.
    overlay?.dispose(); overlay = next; scene.add(next.group); next.setOpacity(opacity); next.setProbes(probes);
    title.textContent = String(surface.title || "Saved result surface");
    notice.textContent = `${surface.zKnown ? "Saved surface geometry" : "No saved layer elevation; flat field"} · drag to orbit · right-drag / two fingers to pan · pinch / wheel to zoom${Number.isFinite(next.min) ? ` · ${next.min.toPrecision(5)}–${next.max.toPrecision(5)} ${surface.unit || ""}` : " · no valid samples"}`;
    valueText.textContent = "Click a colored surface to probe."; fit();
  }
  const button = (label, handler) => { const node = document.createElement("button"); node.textContent = label; node.type = "button"; node.addEventListener("click", handler); bar.append(node); };
  button("Fit", () => fit()); button("Top", () => fit(true));
  const label = document.createElement("label"); label.textContent = "Opacity"; const slider = document.createElement("input"); slider.type = "range"; slider.min = "0"; slider.max = "1"; slider.step = ".05"; slider.value = String(opacity); slider.setAttribute("aria-label", "Result surface opacity"); label.append(slider); bar.append(label);
  const setOpacity = value => { if (!active || !Number.isFinite(value)) return; opacity = Math.max(0, Math.min(1, value)); slider.value = String(opacity); overlay?.setOpacity(opacity); };
  slider.addEventListener("input", () => setOpacity(Number(slider.value)));
  function pick(event) {
    if (!overlay || !overlay.mesh.visible) return null;
    const rect = renderer.domElement.getBoundingClientRect(); if (!rect.width || !rect.height) return null;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1); raycaster.setFromCamera(pointer, camera);
    return overlay.sample(raycaster.intersectObject(overlay.mesh, false)[0]);
  }
  let gesture = null;
  const down = event => { gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; };
  const move = event => { if (gesture && (gesture.id !== event.pointerId || Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5)) gesture.moved = true; options.onHover?.(pick(event)); };
  const up = event => { const tap = gesture && gesture.id === event.pointerId && !gesture.moved && (event.button === 0 || event.pointerType === "touch"); gesture = null; if (!tap) return; const result = pick(event); if (result) { valueText.textContent = `${result.value.toPrecision(6)} ${result.unit} at (${result.x.toFixed(3)}, ${result.y.toFixed(3)}, ${result.z.toFixed(3)}) · ${result.method}`; options.onProbe?.(result); } };
  const cancel = () => { gesture = null; }; const leave = () => options.onHover?.(null);
  for (const [name, fn] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["pointerleave", leave]]) renderer.domElement.addEventListener(name, fn);
  const resize = () => { if (!active) return; const w = Math.max(stage.clientWidth, 1), h = Math.max(stage.clientHeight, 1);
    const ratio = viewportPixelRatio(w, h, globalThis.devicePixelRatio, renderer.capabilities.maxTextureSize);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(stage); resize();
  const lost = event => { event.preventDefault(); notice.textContent = "3D graphics context lost. Reopen this view to restore rendering."; active = false; cancelAnimationFrame(frame); };
  renderer.domElement.addEventListener("webglcontextlost", lost);
  const setTheme = dark => { host.style.background = dark ? "#101d28" : "#f3f7f5"; host.style.color = dark ? "#e7f3ef" : "#172e36"; scene.background.setHex(dark ? 0x101d28 : 0xf3f7f5); };
  setTheme(options.dark !== false);
  try { setSurface(options.surface); } catch (error) { observer.disconnect(); controls.dispose(); renderer.dispose(); host.remove(); throw error; }
  const animate = () => { if (!active) return; frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); }; animate();
  return { host, setSurface, setOpacity, setTheme, fit, setProbes(items) { probes = Array.isArray(items) ? items : []; overlay?.setProbes(probes); },
    dispose() { active = false; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose(); overlay?.dispose(); renderer.domElement.removeEventListener("webglcontextlost", lost); for (const [name, fn] of [["pointerdown", down], ["pointermove", move], ["pointerup", up], ["pointercancel", cancel], ["pointerleave", leave]]) renderer.domElement.removeEventListener(name, fn); renderer.dispose(); host.remove(); }
  };
}
