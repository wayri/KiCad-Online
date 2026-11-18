import {outerCopperPlacement} from "./copperGeometry.mjs";

// Keep both faces within a fixed GPU budget and preserve the world-to-pixel
// scale when rounding the canvas dimensions up to whole pixels.
export function silkRaster(bounds) {
  if(!bounds)return null;
  const width=bounds.maxX-bounds.minX,height=bounds.maxY-bounds.minY;
  if(![width,height].every(n=>Number.isFinite(n)&&n>0))return null;
  const zoom=Math.min(32,2048/Math.max(width,height));
  return {zoom,width:Math.ceil(width*zoom),height:Math.ceil(height*zoom)};
}

export function makeSilkscreen(THREE,primitives,bounds,stack,thickness,diagnostics=[]){
  const raster=silkRaster(bounds),surfaces=[];
  if(!raster){diagnostics.push("Silkscreen omitted because the board bounds are unavailable.");return surfaces;}
  for(const layer of ["F.SilkS","B.SilkS"]){
    const artwork=primitives.filter(p=>p.layer===layer&&!p.hidden&&!p.hitOnly);
    if(!artwork.length)continue;
    const canvas=document.createElement("canvas");
    canvas.width=raster.width;canvas.height=raster.height;
    const {Camera,paintBoardPrimitives}=globalThis.KiCadOwnedCanvas;
    const camera=new Camera(canvas.width,canvas.height);
    camera.center.set((bounds.minX+bounds.maxX)/2,(bounds.minY+bounds.maxY)/2);
    camera.zoom=raster.zoom;
    const ctx=canvas.getContext("2d");
    if(!ctx){diagnostics.push(layer+" omitted because a 2D texture canvas is unavailable.");continue;}
    paintBoardPrimitives(ctx,camera,artwork,"#f4f1e6");
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const front=layer==="F.SilkS",copper=front?"F.Cu":"B.Cu",saved=stack.get(copper);
    const face=outerCopperPlacement(copper,thickness,saved?.thickness,saved?.z);
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(canvas.width/raster.zoom,canvas.height/raster.zoom),
      new THREE.MeshBasicMaterial({map:texture,side:front?THREE.FrontSide:THREE.BackSide,transparent:true,alphaTest:.03,depthWrite:false}));
    mesh.position.z=front?face.base+face.thickness+.004:face.base-.004;
    mesh.userData.record={type:"Silkscreen",layer};
    surfaces.push({mesh,texture,layer});
  }
  return surfaces;
}

export function updateSubstrateMaterials(original,displayed,expanded,opacity){
  for(const material of original){
    if(material.transparent!==expanded)material.needsUpdate=true;
    material.transparent=expanded;material.opacity=opacity;material.depthWrite=!expanded;
  }
  if(displayed!==original)for(const material of displayed){
    material.opacity=Math.min(opacity,material.userData.selectionOpacityCap??1);
  }
}
