/** Reversible selection display. Geometry, visibility and source materials are retained. */
export function createSelectionAppearance(THREE, objects) {
  const saved=new Map(),sharedDim=new Map(),sharedGhost=new Map(),sharedState={owned:[]};let displayMode='';
  const list=value=>Array.isArray(value)?value:[value];
  function restore(){for(const [object,state]of saved){object.material=state.material;if(object.isInstancedMesh){if(object.instanceColor!==state.instanceColor)object.dispose?.();object.instanceColor=state.instanceColor;}for(const material of state.owned)material.dispose();}for(const material of sharedState.owned)material.dispose();sharedState.owned.length=0;sharedDim.clear();sharedGhost.clear();saved.clear();}
  function capture(object){
    if(saved.has(object))return saved.get(object);
    const state={material:object.material,instanceColor:object.instanceColor,owned:[]};saved.set(object,state);return state;
  }
  function cloneMaterial(source,state){
    const material=source.clone();
    // Material.clone does not copy shader customizations, including copper depth.
    material.onBeforeCompile=source.onBeforeCompile;
    material.customProgramCacheKey=()=>source.customProgramCacheKey();
    state.owned.push(material);return material;
  }
  function dimMaterial(source,state,shared=null,cap=.24){
    if(shared?.has(source))return shared.get(source);
    const material=cloneMaterial(source,shared?sharedState:state);material.transparent=true;
    material.userData.selectionOpacityCap=cap;
    material.opacity=Math.min(Number.isFinite(source.opacity)?source.opacity:1,cap);
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
    shared?.set(source,material);
    return material;
  }
  function ghostMaterials(state,share){
    if(!state.ghost)state.ghost=list(state.material).map(source=>dimMaterial(source,state,share?sharedGhost:null,.14));
    return Array.isArray(state.material)?state.ghost:state.ghost[0];
  }
  function contextInstanceMaterial(source,state){
    const material=cloneMaterial(source,state);
    material.transparent=true;material.depthWrite=false;
    material.onBeforeCompile=function(shader,renderer){
      source.onBeforeCompile?.call(this,shader,renderer);
      // Use an owned instance-color buffer for the flag, leaving the shared
      // geometry and matrices intact for picking, expansion and probe views.
      const vertexColor=THREE.ShaderChunk.color_vertex.replace(/\binstanceColor\b/g,'selectionColor');
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float vNetContext;')
        .replace('#include <color_vertex>',`vNetContext = 0.0;
#ifdef USE_INSTANCING_COLOR
  vNetContext = instanceColor.r < 0.0 ? 1.0 : 0.0;
  vec3 selectionColor = vec3(vNetContext > 0.5 ? -instanceColor.r - 1.0 : instanceColor.r, instanceColor.gb);
#endif
`+vertexColor);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vNetContext;')
        .replace('#include <opaque_fragment>',`if (vNetContext > 0.5) {
  outgoingLight = vec3(dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722)));
  diffuseColor.a *= 0.24;
}
#include <opaque_fragment>`);
    };
    material.customProgramCacheKey=()=>source.customProgramCacheKey()+'|kicad-net-context-instances-v1';
    return material;
  }
  function update(matches,enabled,{translucent=false,netContext=false}={}){
    if(!enabled){restore();displayMode='';return;}
    const mode=translucent?'overlay':netContext?'net':'selection';
    if(displayMode!==mode){restore();displayMode=mode;}
    const displayMatches=record=>netContext
      ? Boolean(record?.net)&&record.type!=='Component'&&typeof record.library!=='string'&&matches(record)
      : matches(record);
    for(const object of objects()){
      if(!object.material)continue;
      const state=capture(object),records=object.userData.records;
      if(translucent){object.material=ghostMaterials(state,!object.isInstancedMesh);if(object.isInstancedMesh&&object.instanceColor!==state.instanceColor){object.dispose?.();object.instanceColor=state.instanceColor;}continue;}
      if(object.isInstancedMesh&&records){
        if(netContext||object.userData.footprintStandIns){
          // Instanced stand-ins need an opacity flag per component so the
          // selected stand-in stays solid while its neighbors match linked models.
          if(!state.instances){state.instances=list(state.material).map(source=>contextInstanceMaterial(source,state));object.instanceColor=state.instanceColor?.clone()||null;}
          object.material=Array.isArray(state.material)?state.instances:state.instances[0];
          const color=new THREE.Color();
          for(let index=0;index<object.count;index++){
            if(state.instanceColor)color.fromArray(state.instanceColor.array,index*3);else color.setRGB(1,1,1);
            if(!displayMatches(records[index]))color.r=-color.r-1;
            object.setColorAt(index,color);
          }
          if(object.instanceColor)object.instanceColor.needsUpdate=true;
          continue;
        }
        if(!state.white){state.white=list(state.material).map(source=>{const material=cloneMaterial(source,state);material.color?.setHex(0xffffff);return material;});object.instanceColor=state.instanceColor?.clone()||null;}
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
      }else if(displayMatches(object.userData.record))object.material=state.material;
      else {if(!state.dim)state.dim=list(state.material).map(source=>dimMaterial(source,state,object.isInstancedMesh?null:sharedDim));object.material=Array.isArray(state.material)?state.dim:state.dim[0];}
    }
  }
  return {update,restore,dispose:restore,stats:()=>({capturedObjects:saved.size,sharedDimMaterials:sharedDim.size})};
}
