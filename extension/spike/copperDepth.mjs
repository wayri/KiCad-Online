/* Copyright (c) 2026 wayri. SPDX-License-Identifier: MPL-2.0 */

const logMaterials = new WeakMap();
const rendererDepth = new WeakMap();
const renderTargetMargin = 4 / (2 ** 24 - 1);

/** The composer uses 24-bit depth. Direct canvas draws can have fewer bits. */
export function registerCopperDepthPrecision(renderer, scene) {
  const gl = renderer.getContext();
  const bits = gl.getParameter(gl.DEPTH_BITS);
  const directMargin = bits > 0 ? Math.max(renderTargetMargin, 1 / (2 ** bits - 1)) : renderTargetMargin;
  const existing = rendererDepth.get(renderer);
  if (existing) {
    existing.directMargin = directMargin;
    return;
  }
  const precision = {directMargin, uniform:{value:directMargin}};
  rendererDepth.set(renderer, precision);
  const inherited = scene.onBeforeRender;
  scene.onBeforeRender = function(activeRenderer, activeScene, camera, target) {
    inherited?.call(this, activeRenderer, activeScene, camera, target);
    if (activeRenderer === renderer) precision.uniform.value = target ? renderTargetMargin : precision.directMargin;
  };
}

/** Resolve depth precedence without moving saved geometry or biasing extruded walls. */
export function copperDepthPolicy(role, surface = 'all') {
  const rank = {zone:1, track:-1, pad:-2, via:-3, selection:-8}[role];
  if (typeof rank !== 'number') throw Error('Unknown copper surface role.');
  if (!['all', 'cap', 'wall'].includes(surface)) throw Error('Unknown copper surface kind.');
  return {
    polygonOffset: surface !== 'wall',
    // A slope bias can lift a grazing cap through a physically closer plane.
    polygonOffsetFactor: 0,
    polygonOffsetUnits: surface === 'wall' ? 0 : rank * 2
  };
}

/** Configure a material for the primary renderer's fragment-written log depth. */
export function configureCopperDepth(material, role, surface = 'all') {
  const policy = copperDepthPolicy(role, surface);
  Object.assign(material, policy, {polygonOffset:false});
  if (!policy.polygonOffset) return material;

  const inheritedCompile = material.onBeforeCompile;
  const inheritedKey = material.customProgramCacheKey;
  const baseKey = inheritedKey.call(material);
  const units = policy.polygonOffsetUnits.toFixed(1);
  const chunk = '#include <logdepthbuf_fragment>';
  logMaterials.set(material, {policy, inheritedCompile, inheritedKey});
  material.onBeforeCompile = function(shader, renderer) {
    inheritedCompile?.call(this, shader, renderer);
    if (!shader.fragmentShader.includes(chunk)) throw Error('Unsupported copper depth shader.');
    shader.uniforms.kicadCopperDepthMargin = rendererDepth.get(renderer)?.uniform || {value:renderTargetMargin};
    shader.fragmentShader = '#ifdef USE_LOGDEPTHBUF\nuniform float kicadCopperDepthMargin;\n#endif\n' +
      shader.fragmentShader.replace(chunk, chunk +
        '\n#ifdef USE_LOGDEPTHBUF\n gl_FragDepth = clamp(gl_FragDepth + ' + units + ' * kicadCopperDepthMargin, 0.0, 1.0);\n#endif');
  };
  material.customProgramCacheKey = () => baseKey + '|copper-log-depth-v2:' + role + ':' + surface;
  return material;
}

/** Three.js ExtrudeGeometry assigns material 0 to lids and 1 to side walls. */
export function copperCapMaterials(THREE, role, parameters, {logarithmicDepth = false} = {}) {
  return ['cap', 'wall'].map(surface => logarithmicDepth
    ? configureCopperDepth(new THREE.MeshStandardMaterial(parameters), role, surface)
    : new THREE.MeshStandardMaterial({...parameters, ...copperDepthPolicy(role, surface)}));
}

/** Probes share source geometry and use their own fixed-function copper offsets. */
export function createLinearCopperMaterials() {
  const variants = new Map();
  let arrays = new WeakMap();

  function forMaterial(source) {
    if (Array.isArray(source)) {
      if (!arrays.has(source)) {
        const entries = source.map(forMaterial);
        arrays.set(source, entries.every((material, index) => material === source[index]) ? source : entries);
      }
      return arrays.get(source);
    }
    const entry = logMaterials.get(source);
    if (!entry) return source;
    if (!variants.has(source)) {
      const material = source.clone();
      Object.assign(material, entry.policy);
      material.onBeforeCompile = entry.inheritedCompile;
      material.customProgramCacheKey = entry.inheritedKey;
      variants.set(source, material);
    }
    return variants.get(source);
  }

  return {
    forMaterial,
    sync() {
      for (const [source, material] of variants) {
        material.copy(source);
        Object.assign(material, logMaterials.get(source).policy);
      }
    },
    dispose() {
      for (const material of variants.values()) material.dispose();
      variants.clear();
      arrays = new WeakMap();
    }
  };
}
