/** Read-only bridge from the live board scene to saved copper coordinates. */
export function dcBoardLayerZ(byLayer, explode, layer) {
  const saved = byLayer.get(layer);
  return saved && Number.isFinite(saved.z) ? saved.z + explode.offset(layer) : NaN;
}

/** An opt-in result is flat in its saved copper layer's local plane. */
export function dcBoardLayerOverlay(surface, byLayer, explode, centerX, centerY) {
  const layer = surface?.layer, saved = byLayer.get(layer);
  if (!saved || !Number.isFinite(saved.z) || !Array.isArray(surface.points) || surface.points.some(point => !Array.isArray(point) || point[2] !== 0)) return null;
  return {
    transform: ([x, y]) => [x - centerX, centerY - y, saved.z],
    update: group => { group.position.z = explode.offset(layer); group.updateMatrixWorld(); },
    layer
  };
}

export function createDCCopperViewport(THREE, { canvas, getCamera, getCopperMeshes, getLayerZ, centerX, centerY, isActive }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const visible = mesh => { for (let node = mesh; node; node = node.parent) if (!node.visible) return false; return true; };
  const rect = () => canvas.getBoundingClientRect();

  function pick(clientX, clientY) {
    if (!isActive() || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
    const bounds = rect();
    if (!(bounds.width > 0 && bounds.height > 0) || clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) return [];
    const candidates = getCopperMeshes().filter(({ mesh, layer }) => mesh?.isMesh && typeof layer === 'string' && visible(mesh));
    if (!candidates.length) return [];
    const layers = new Map(candidates.map(({ mesh, layer }) => [mesh, layer]));
    const camera = getCamera();
    camera.updateMatrixWorld();
    for (const { mesh } of candidates) mesh.updateWorldMatrix(true, false);
    pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(candidates.map(({ mesh }) => mesh), false);
    const result = [];
    for (const hit of hits) {
      const record = hit.object.userData.records?.[hit.instanceId] || hit.object.userData.record;
      const layer = layers.get(hit.object);
      if (!record || !layer) continue;
      const item = { x: hit.point.x + centerX, y: centerY - hit.point.y, layer, record };
      if (typeof record.net === 'string') item.netName = record.net;
      if (Number.isSafeInteger(record.netId)) item.netId = record.netId;
      result.push(item);
      if (result.length === 16) break;
    }
    return result;
  }

  function project(position) {
    if (!isActive() || !position || ![position.x, position.y].every(Number.isFinite)) return null;
    const z = getLayerZ(position.layer), bounds = rect();
    if (!Number.isFinite(z) || !(bounds.width > 0 && bounds.height > 0)) return null;
    const camera = getCamera();
    camera.updateMatrixWorld();
    const world = new THREE.Vector3(position.x - centerX, centerY - position.y, z);
    const cameraPoint = world.clone().applyMatrix4(camera.matrixWorldInverse);
    if (camera.isPerspectiveCamera && cameraPoint.z >= 0) return null;
    const clip = world.project(camera);
    if (![clip.x, clip.y, clip.z].every(Number.isFinite) || Math.abs(clip.x) > 1 || Math.abs(clip.y) > 1 || Math.abs(clip.z) > 1) return null;
    return { x: (clip.x + 1) * bounds.width / 2, y: (1 - clip.y) * bounds.height / 2 };
  }

  return { canvas, pick, project };
}
