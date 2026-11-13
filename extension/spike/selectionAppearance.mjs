/** Reversible selection display. Geometry, visibility and source materials are retained. */
export function createSelectionAppearance(THREE, objects) {
  const saved=new Map();let translucentMode=false;
  const list=value=>Array.isArray(value)?value:[value];
  function restore(){for(const [object,state]of saved){object.material=state.material;if(object.isInstancedMesh){if(object.instanceColor!==state.instanceColor)object.dispose?.();object.instanceColor=state.instanceColor;}for(const material of state.owned)material.dispose();}saved.clear();}
  function capture(object){
    if(saved.has(object))return saved.get(object);
    const state={material:object.material,instanceColor:object.instanceColor,owned:[]};saved.set(object,state);return state;
  }
  function dimMaterial(source,state){
    const material=source.clone();material.transparent=true;
    material.opacity=Math.min(Number.isFinite(source.opacity)?source.opacity:1,.24);
    material.depthWrite=false;
    // Desaturate the final shaded output, including maps and instance colors.
    // Keep saved materials untouched so clearing selection restores them exactly.
    const sourceCompile=source.onBeforeCompile;
    material.onBeforeCompile=function(shader,renderer){
      sourceCompile?.call(this,shader,renderer);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
        'outgoingLight = vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)));\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey=()=>source.customProgramCacheKey()+'|kicad-gray-context-v1';
    state.owned.push(material);return material;
  }
  function ghostMaterials(state){
    if(!state.ghost)state.ghost=list(state.material).map(source=>{const material=dimMaterial(source,state);material.opacity=Math.min(material.opacity,.14);return material;});
    return Array.isArray(state.material)?state.ghost:state.ghost[0];
  }
  function update(matches,enabled,{translucent=false}={}){
    if(!enabled){restore();translucentMode=false;return;}
    if(translucentMode!==translucent){restore();translucentMode=translucent;}
    for(const object of objects()){
      if(!object.material)continue;
      const state=capture(object),records=object.userData.records;
      if(translucent){object.material=ghostMaterials(state);if(object.isInstancedMesh&&object.instanceColor!==state.instanceColor){object.dispose?.();object.instanceColor=state.instanceColor;}continue;}
      if(object.isInstancedMesh&&records){
        if(!state.white){state.white=list(state.material).map(source=>{const material=source.clone();material.color?.setHex(0xffffff);state.owned.push(material);return material;});object.instanceColor=state.instanceColor?.clone()||null;}
        object.material=Array.isArray(state.material)?state.white:state.white[0];
        const base=list(state.material)[0].color||new THREE.Color(0xffffff),color=new THREE.Color();
        for(let index=0;index<records.length;index++){
          if(state.instanceColor)color.fromArray(state.instanceColor.array,index*3).multiply(base);else color.copy(base);
          // Three.js has one opacity per instanced mesh; attenuate only the
          // unselected instance colors so selected instances stay fully vivid.
          if(!matches(records[index])){const grey=(color.r*.2126+color.g*.7152+color.b*.0722)*.24;color.setRGB(grey,grey,grey);}
          object.setColorAt(index,color);
        }
        if(object.instanceColor)object.instanceColor.needsUpdate=true;
      }else if(matches(object.userData.record))object.material=state.material;
      else {if(!state.dim)state.dim=list(state.material).map(source=>dimMaterial(source,state));object.material=Array.isArray(state.material)?state.dim:state.dim[0];}
    }
  }
  return {update,restore,dispose:restore};
}
