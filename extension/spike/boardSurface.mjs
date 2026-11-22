import {outerCopperPlacement} from "./copperGeometry.mjs";

// Keep both faces within a fixed GPU budget and preserve the world-to-pixel
// scale when rounding the canvas dimensions up to whole pixels.
const maxSilkTextureSize=2048;

export function silkRaster(bounds,maxZoom=32) {
  if(!bounds)return null;
  const width=bounds.maxX-bounds.minX,height=bounds.maxY-bounds.minY;
  if(![width,height].every(n=>Number.isFinite(n)&&n>0))return null;
  const zoom=Math.min(maxZoom,maxSilkTextureSize/Math.max(width,height));
  return {zoom,width:Math.min(maxSilkTextureSize,Math.ceil(width*zoom)),height:Math.min(maxSilkTextureSize,Math.ceil(height*zoom))};
}

// The four corner rays bound the printable area on the board plane. When
// the horizon crosses the view, keep the full-face texture.
export function silkViewRegion(THREE,camera,z,bounds,pixels){
  const ray=new THREE.Raycaster(),point=new THREE.Vector3();
  const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-z);
  const centerX=(bounds.minX+bounds.maxX)/2,centerY=(bounds.minY+bounds.maxY)/2;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const x of [-1,1])for(const y of [-1,1]){
    ray.setFromCamera({x,y},camera);
    if(Math.abs(ray.ray.direction.z)<1e-6||!ray.ray.intersectPlane(plane,point))return null;
    minX=Math.min(minX,point.x+centerX);maxX=Math.max(maxX,point.x+centerX);
    minY=Math.min(minY,centerY-point.y);maxY=Math.max(maxY,centerY-point.y);
  }
  const zoom=Math.min(128,1.5*Math.max(pixels.width/(maxX-minX),pixels.height/(maxY-minY)));
  const view={minX:Math.max(bounds.minX,minX),minY:Math.max(bounds.minY,minY),
    maxX:Math.min(bounds.maxX,maxX),maxY:Math.min(bounds.maxY,maxY),zoom};
  return [view.minX,view.minY,view.maxX,view.maxY,zoom].every(Number.isFinite)&&view.maxX>view.minX&&view.maxY>view.minY?view:null;
}

export function makeSilkscreen(THREE,primitives,bounds,stack,thickness,diagnostics=[],anisotropy=1){
  const raster=silkRaster(bounds),surfaces=[];
  if(!raster){diagnostics.push("Silkscreen omitted because the board bounds are unavailable.");return surfaces;}
  const {Camera,paintBoardPrimitives}=globalThis.KiCadOwnedCanvas;
  function rasterize(artwork,region,sampling,crop=false){
    const canvas=document.createElement("canvas");
    canvas.width=sampling.width;canvas.height=sampling.height;
    const ctx=canvas.getContext("2d");
    if(!ctx)return null;
    const camera=new Camera(canvas.width,canvas.height);
    camera.center.set((region.minX+region.maxX)/2,(region.minY+region.maxY)/2);
    camera.zoom=sampling.zoom;
    paintBoardPrimitives(ctx,camera,artwork,"#f4f1e6",crop);
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,Math.max(1,anisotropy));
    return texture;
  }
  for(const layer of ["F.SilkS","B.SilkS"]){
    const artwork=primitives.filter(p=>p.layer===layer&&!p.hidden&&!p.hitOnly);
    if(!artwork.length)continue;
    const texture=rasterize(artwork,bounds,raster);
    if(!texture){diagnostics.push(layer+" omitted because a 2D texture canvas is unavailable.");continue;}
    const front=layer==="F.SilkS",copper=front?"F.Cu":"B.Cu",saved=stack.get(copper);
    const face=outerCopperPlacement(copper,thickness,saved?.thickness,saved?.z);
    const width=raster.width/raster.zoom,height=raster.height/raster.zoom;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(width,height),
      new THREE.MeshBasicMaterial({map:texture,side:front?THREE.FrontSide:THREE.BackSide,transparent:true,alphaTest:.03,depthWrite:false}));
    mesh.position.z=front?face.base+face.thickness+.004:face.base-.004;
    mesh.userData.record={type:"Silkscreen",layer};
    let detail=null;
    const world=new THREE.Vector3(),cameraPosition=new THREE.Vector3();
    function viewRegion(camera,pixels){
      if(!mesh.visible||mesh.parent?.visible===false)return null;
      mesh.getWorldPosition(world);
      cameraPosition.setFromMatrixPosition(camera.matrixWorld);
      if((cameraPosition.z-world.z)*(front?1:-1)<=0)return null;
      const view=silkViewRegion(THREE,camera,world.z,bounds,pixels);
      return view?.zoom>raster.zoom*1.35?view:null;
    }
    const covers=view=>view&&detail&&view.minX>=detail.minX&&view.maxX<=detail.maxX&&view.minY>=detail.minY&&view.maxY<=detail.maxY;
    const detailMap=view=>covers(view)?detail.texture:null;
    function refresh(view){
      const marginX=(view.maxX-view.minX)*.15,marginY=(view.maxY-view.minY)*.15;
      const region={minX:Math.max(bounds.minX,view.minX-marginX),minY:Math.max(bounds.minY,view.minY-marginY),
        maxX:Math.min(bounds.maxX,view.maxX+marginX),maxY:Math.min(bounds.maxY,view.maxY+marginY)};
      // Trim overscan if it would leave the crop below the desired density.
      const coverage=Math.max(region.maxX-region.minX,region.maxY-region.minY);
      const visibleCoverage=Math.max(view.maxX-view.minX,view.maxY-view.minY);
      const crop=coverage>visibleCoverage*1.15&&coverage*view.zoom>maxSilkTextureSize?view:region;
      const sampling=silkRaster(crop,view.zoom);
      if(sampling.zoom<=raster.zoom*1.25)return false;
      detail?.texture.dispose();
      detail=null;
      const map=rasterize(artwork,crop,sampling,true);
      if(!map)return false;
      const cropWidth=sampling.width/sampling.zoom,cropHeight=sampling.height/sampling.zoom;
      const cropX=(crop.minX+crop.maxX)/2,cropY=(crop.minY+crop.maxY)/2;
      const centerX=(bounds.minX+bounds.maxX)/2,centerY=(bounds.minY+bounds.maxY)/2;
      map.repeat.set(width/cropWidth,height/cropHeight);
      map.offset.set(.5+(centerX-cropX-width/2)/cropWidth,.5+(cropY-centerY-height/2)/cropHeight);
      detail={...crop,texture:map,zoom:sampling.zoom,targetZoom:view.zoom};
      return true;
    }
    surfaces.push({mesh,texture,layer,viewRegion,detailMap,refresh,
      needsRefresh:view=>Boolean(view&&(!covers(view)||view.zoom>detail.targetZoom*1.5)),
      sampling:()=>({layer,basePixelsPerMm:raster.zoom,detailPixelsPerMm:detail?.zoom??null,detailWidth:detail?.texture.image.width??0,detailHeight:detail?.texture.image.height??0}),
      dispose(){texture.dispose();detail?.texture.dispose();detail=null;}});
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
