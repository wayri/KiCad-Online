import {createSelectionGeometry} from './selectionGeometry.mjs';
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLLoader } from "three/addons/loaders/VRMLLoader.js";
import {prepareVRMLSource,restoreVRMLNames} from "./vrmlSource.mjs";
import {createBoardLighting,lightingName} from './lighting.mjs';
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import "../design-diff.js";
import "../repo-models.js";
import fzstd from "../vendor/fzstd/fzstd.js";
import padLabels from "../pad-labels.js";
import "../embedded-models.js";
import "../step-decoder.js";
import { parseKicadBoard } from "@spike/boardParser";
import "../layer-colors.js";
const layerThreeColor = name => Number.parseInt(globalThis.KiCadLayerColors.hexFor(name).slice(1), 16);
import { viewportSceneIdentity } from "@spike/viewportScenePolicy";
import { populationMask, uniqueComponentIndexes } from "./componentState.mjs";
import { footprintProxies } from "./footprintProxies.mjs";
import {createAnchorProjector} from "./projectAnchor.mjs";
import {sourceCopperPlan} from "./copperStack.mjs";
import {createNetInspection} from "./netInspection.mjs";
import {createSelectionAppearance} from "./selectionAppearance.mjs";
import { createExplodeView } from './explodeView.mjs';
import { selectionMatcher, selectableRecord, selectionGesture, holdGesture } from "./selectionState.mjs";
import { sphereFitDistance,boxFitDistance } from "./fitPolicy.mjs";
import { qualityName, qualityViewport, graphicsProfile, boardOcclusion, boardClipRange, studioMaterials, padHasMaskOpening, physicalColors, copperDepthPolicy, copperCapMaterials } from "./renderQuality.mjs";
import { createResultOverlay } from "./result3d.js";
import { sourceZoneGeometry,drillLoopInsideBoard } from "./sourceGeometry.mjs";
import { padSourceDetails } from "./padGeometry.mjs";
import {sourceSelectionRecords} from './sourceSelection.mjs';
import {drillWallGeometry,copperStrokeBatches,smoothPadOutline,smoothDrillOutline,outerCopperPlacement,zoneSurfaceZ,substrateEnvelope,refineCopperTracks} from './copperGeometry.mjs';
import {createProbeRegistry,createSharedProbeViewport} from './probeViewport.mjs';
import {createTerminalAnnotations,createTerminalLabelController} from './terminalLabels.mjs';
import { MeasurementSession,distanceLabel,snapProjectedEdges } from "./measurement3d.mjs";
import {projectionCamera,resizeProjection,fitProjection} from "./cameraProjection.mjs";
import { boardViewPresets,boardViewPreset } from "./viewPresets.mjs";
export { mountResultScene } from "./result3d.js";

const STYLE = `
.explode-control{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px}.explode-control input{width:90px;min-width:60px;accent-color:#68b6ec}.explode-control output{min-width:32px;font-variant-numeric:tabular-nums}.explode-control[hidden]{display:none}

  :host{display:block;width:100%;height:100%;font:12px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;
    --ink:#e6e9ef;--surface:#151820;--bar:#1e2128;--border:#343944;--accent:#91b9ff;
    --muted:#9ca5b5;--button:#292d36;--button-border:#343944;--button-ink:#e6e9ef;
    --hint:#1e2128e8;--panel:#1e2128f2;--menu:#252a34;--notice:#1e2128;color:var(--ink)}
  :host([data-theme="light"]){--ink:#252c38;--surface:#e7ebf1;--bar:#fff;--border:#d9dee7;
    --accent:#336ac2;--muted:#616d80;--button:#edf0f5;--button-border:#d9dee7;--button-ink:#252c38;
    --hint:#ffffffed;--panel:#fffffff2;--menu:#fff;--notice:#fff}
  *{box-sizing:border-box}.shell{display:flex;flex-direction:column;width:100%;height:100%;min-height:0;background:var(--surface)}
  .bar{display:flex;align-items:center;gap:6px;min-height:40px;padding:5px 10px;background:var(--bar);border-bottom:1px solid var(--border);flex-wrap:nowrap;flex-shrink:0;min-width:0}
  .title{font-size:10px;font-weight:650;letter-spacing:.07em;color:var(--muted);white-space:nowrap}.detail{font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}.spacer{flex:1;min-width:0}
  button,select{background:var(--button);border:1px solid var(--button-border);color:var(--button-ink);padding:4px 8px;border-radius:5px;font:500 11px/1.4 system-ui;min-height:28px;cursor:pointer;flex-shrink:0}
  button:hover,select:hover{border-color:var(--accent)}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .bar button{display:inline-flex;align-items:center;justify-content:center;gap:5px;background:transparent;border-color:transparent}.bar button:hover,.bar button[aria-expanded=true]{background:var(--button);border-color:var(--button-border)}.bar svg{width:15px;height:15px;flex-shrink:0}.view-select{max-width:105px;background:transparent}.bar .divider{width:1px;height:18px;background:var(--border);flex-shrink:0}
  label{display:flex;align-items:center;gap:7px;white-space:nowrap;color:var(--muted);font-size:11px}input{accent-color:var(--accent)}.visibility-options{position:absolute;right:10px;top:10px;z-index:6;width:min(260px,calc(100% - 20px));max-height:calc(100% - 20px);overflow:auto;padding:12px;background:var(--menu);border:1px solid var(--border);border-radius:8px;box-shadow:0 8px 24px #0004;display:grid;gap:12px}.visibility-options[hidden]{display:none}.visibility-options fieldset{min-width:0;margin:0;padding:0;border:0;display:grid;gap:9px}.visibility-options fieldset+fieldset{border-top:1px solid var(--border);padding-top:12px}.visibility-options legend{padding:0 0 8px;color:var(--muted);font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase}.visibility-options select{min-width:0;width:130px;margin-left:auto}.visibility-options input{width:16px;height:16px;margin:0}.display-heading{display:flex;align-items:center;justify-content:space-between;font-weight:600}.display-heading button{min-height:24px;padding:1px 6px}.quality-help{margin:0;color:var(--muted);font-size:10px;line-height:1.5}
  .stage{position:relative;flex:1;min-height:0;overflow:hidden}.canvas{position:absolute;inset:0}.canvas canvas{display:block;width:100%;height:100%}
  .hint{padding:4px 10px;color:var(--muted);background:var(--bar);font-size:10px;border-top:1px solid var(--border);flex-shrink:0}
  .inspector{position:absolute;right:12px;bottom:12px;width:min(280px,45%);max-height:50%;overflow:auto;background:var(--panel);border:1px solid var(--border);border-radius:7px;padding:10px;box-shadow:0 8px 28px #0005}
  .inspector[hidden],.menu[hidden]{display:none}.inspector h2{font-size:13px;margin:0 0 6px;color:var(--accent)}.inspector dl{display:grid;grid-template-columns:auto 1fr;gap:3px 8px;margin:0}.inspector dt{color:var(--muted)}.inspector dd{margin:0;overflow-wrap:anywhere}
  .menu{position:absolute;z-index:4;display:grid;gap:3px;padding:5px;border:1px solid var(--border);border-radius:5px;background:var(--menu);box-shadow:0 7px 25px #0005}
  .notice{padding:3px 9px;background:var(--notice);color:var(--muted);font-size:10px;border-top:1px solid var(--border);flex-shrink:0}.notice details{display:inline;margin-left:8px}.notice summary{display:inline;cursor:pointer;color:var(--accent)}.notice details[open]{display:block;margin:6px 0 0}.notice ul{max-height:120px;overflow:auto;margin:6px 0;padding-left:16px;line-height:1.6}.quality-notice{position:absolute;left:12px;right:12px;top:10px;z-index:7;padding:10px 12px;border:1px solid #bf725c;border-radius:7px;background:var(--panel);color:var(--ink);font-size:12px;max-width:560px}.quality-notice[hidden]{display:none}.quality-notice button{margin:6px 0 0 8px}
  button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.measurement-panel{position:absolute;bottom:10px;left:10px;z-index:5;width:min(350px,calc(100% - 20px));padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--panel);box-shadow:0 4px 18px #0003;display:grid;gap:6px}.measurement-panel[hidden],.measurement-label[hidden]{display:none}.measurement-heading{display:flex;align-items:center;gap:6px}.measurement-heading strong{font-size:12px;margin-right:auto}.measurement-panel output{font:600 18px/1.3 system-ui;color:var(--ink);font-variant-numeric:tabular-nums}.measurement-panel small{color:var(--muted);font-size:10px}.measurement-panel .measurement-tools{display:flex;align-items:center;gap:6px}.measurement-panel .measurement-tools select{min-width:0;flex:1}.measurement-panel p{margin:0;color:var(--muted);font-size:11px}.measurement-label{position:absolute;z-index:4;pointer-events:none;padding:4px 7px;border:1px solid #c5a35f;border-radius:5px;background:var(--panel);color:var(--ink);font:600 12px/1.4 system-ui;white-space:nowrap;box-shadow:0 2px 8px #0004}:host([data-measuring=true]) .hint{display:none}
  @media(max-width:700px){.detail{display:none}.bar{gap:4px;padding-inline:6px}.hint{display:none}.inspector{width:min(260px,65%)}}@media(max-width:380px){.title{display:none}.bar{gap:2px}.bar button{padding-inline:5px}.view-select{max-width:90px}}
  @media(pointer:coarse){button,select{min-height:40px}.bar{min-height:50px}.visibility-options label{min-height:32px}}
`;

// The scene filter changes visibility only; saved geometry and cameras stay intact.
export function objectVisibilityPolicy(input = {}) {
  const supportedTypes = ['arcs','pads','vias','tracks','fills','polygons','bodies'];
  const hiddenTypes = [...new Set((Array.isArray(input.hiddenTypes)?input.hiddenTypes:[]).filter(type=>typeof type==='string'&&type.length<=40).slice(0,64))];
  const side = ['top','bottom'].includes(input.side)?input.side:'all';
  return {hiddenTypes,side,supportedTypes,unsupportedTypes:hiddenTypes.filter(type=>!supportedTypes.includes(type)),
    visible(type,layer){return !hiddenTypes.includes(type)&&!(side==='top'&&layer?.startsWith('B.'))&&!(side==='bottom'&&layer?.startsWith('F.'));}};
}

function pathFor(points, transform) {
  const path = new THREE.Path();
  points.forEach((point, index) => {
    const [x, y] = transform(point);
    if (index === 0) path.moveTo(x, y); else path.lineTo(x, y);
  });
  return path;
}

function boardShape(board, transform) {
  const loops = board.outlineLoops?.filter((loop) => loop.length >= 3) || [];
  const outer = loops[0] || [
    [board.bounds.minX, board.bounds.minY], [board.bounds.maxX, board.bounds.minY],
    [board.bounds.maxX, board.bounds.maxY], [board.bounds.minX, board.bounds.maxY]
  ];
  const shape = new THREE.Shape();
  pathFor(outer, transform).getPoints().forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y); else shape.lineTo(point.x, point.y);
  });
  for (const loop of loops.slice(1)) shape.holes.push(pathFor(loop, transform));
  return shape;
}

function makeInstanced(group, geometry, material, records, place, identity) {
  if (!records.length) return null;
  const mesh = new THREE.InstancedMesh(geometry, material, records.length);
  const object = new THREE.Object3D();
  records.forEach((item, index) => {
    place(object, item);
    object.updateMatrix();
    mesh.setMatrixAt(index, object.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.records = records;
  mesh.userData.identity = identity;
  group.add(mesh);
  return mesh;
}

export function mechanicalCaptureFrame(bounds,camera,width,height,origin={x:0,y:0}) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){const point=new THREE.Vector3(x,y,z).applyMatrix4(camera.matrixWorldInverse);minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);}
  const nativeWidth=Math.max(1,width),nativeHeight=Math.max(1,height),scale=Math.min(1,1800/nativeWidth,1800/nativeHeight),pixelWidth=Math.max(1,Math.floor(nativeWidth*scale)),pixelHeight=Math.max(1,Math.floor(nativeHeight*scale)),aspect=pixelWidth/pixelHeight;
  const worldHeight=Math.max((maxY-minY)/.9,(maxX-minX)/aspect/.9,.01),worldWidth=worldHeight*aspect,center=bounds.getCenter(new THREE.Vector3());
  return {width:pixelWidth,height:pixelHeight,worldWidth,worldHeight,bounds:{x:origin.x+center.x-worldWidth/2,y:origin.y-center.y-worldHeight/2,width:worldWidth,height:worldHeight}};
}

export function mountBoard3D(container, source, options = {}) {
  options ||= {};
  const mechanical = options.mechanical === true;
  const captureAbort = new AbortController();
  const initialDark = mechanical ? options.dark === true : options.dark !== false;
  const board = parseKicadBoard(source);
  const sourceAST=globalThis.KiCadDesignDiff.parse(source),savedZones=sourceZoneGeometry(sourceAST);
  const sourceRecords=sourceSelectionRecords(sourceAST,board);board.components=sourceRecords.components;
  const padDetails=padSourceDetails(sourceAST),nativePads=sourceRecords.pads.map(pad=>({...pad,...padDetails.get(pad.uuid||pad.id)}));board.pads=nativePads;
  const geometryDiagnostics=[];
  if (!board?.bounds || !Number.isFinite(board.width) || !Number.isFinite(board.height)) {
    throw new Error("SPIKE could not parse this PCB layout.");
  }
  const host = document.createElement("div");
  host.dataset.theme = initialDark ? "dark" : "light";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style"); style.textContent = STYLE;
  const shell = document.createElement("div"); shell.className = "shell";
  const bar = document.createElement("div"); bar.className = "bar";
  const stage = document.createElement("div"); stage.className = "stage";
  const canvasHost = document.createElement("div"); canvasHost.className = "canvas";
  const hint = document.createElement("div"); hint.className = "hint";
  hint.textContent = "Drag to orbit · right-drag to pan · wheel to zoom · click to inspect";
  const inspector = document.createElement("div"); inspector.className = "inspector"; inspector.hidden = true;
  const menu = document.createElement("div"); menu.className = "menu"; menu.hidden = true;
  const notice = document.createElement("div"); notice.className = "notice";
  notice.textContent = "Material preview · mask openings follow saved pad layer flags · footprint stand-ins where linked models are unavailable.";
  const qualityNotice=document.createElement('div');qualityNotice.className='quality-notice';qualityNotice.hidden=true;qualityNotice.setAttribute('role','status');stage.append(qualityNotice);
  stage.append(canvasHost, inspector, menu); shell.append(bar, stage, hint, notice); shadow.append(style, shell); container.append(host);

  const title = document.createElement("strong"); title.className = "title"; title.textContent = "3D VIEW";
  const detail = document.createElement("span"); detail.className = "detail";
  detail.textContent = `${board.width.toFixed(1)} × ${board.height.toFixed(1)} mm · ${board.components.length} parts · ${board.tracks.length} tracks`;
  const spacer = document.createElement("span"); spacer.className = "spacer";
  function action(label, handler, path, tooltip=label) {
    const button = document.createElement("button"); button.type = "button"; button.title=tooltip;button.setAttribute('aria-label',tooltip);
    if(path){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');shape.setAttribute('d',path);svg.append(shape);button.append(svg);}
    const caption=document.createElement('span');caption.textContent=label;button.append(caption);
    button.addEventListener("click",()=>{handler();invalidate();}); bar.append(button); return button;
  }
  const visibilityOptions=document.createElement('section');visibilityOptions.className='visibility-options';visibilityOptions.id='display-options';visibilityOptions.hidden=true;visibilityOptions.setAttribute('aria-label','3D display settings');stage.append(visibilityOptions);
  const displayHeading=document.createElement('div');displayHeading.className='display-heading';displayHeading.append(document.createTextNode('Display'));
  const displayClose=document.createElement('button');displayClose.type='button';displayClose.textContent='×';displayClose.title='Close display settings';displayClose.setAttribute('aria-label','Close display settings');displayClose.onclick=()=>setDisplayOpen(false,true);displayHeading.append(displayClose);
  const renderingOptions=document.createElement('fieldset'),renderingLegend=document.createElement('legend');renderingLegend.textContent='Rendering';renderingOptions.append(renderingLegend);
  const layerOptions=document.createElement('fieldset'),layerLegend=document.createElement('legend');layerLegend.textContent='Visible geometry';layerOptions.append(layerLegend);visibilityOptions.append(displayHeading,renderingOptions,layerOptions);
  function setDisplayOpen(open,restoreFocus=false){visibilityOptions.hidden=!open;displayButton.setAttribute('aria-expanded',String(open));if(restoreFocus)displayButton.focus();}
  function toggle(label, initial, handler) {
    const wrapper = document.createElement("label"), input = document.createElement("input");
    input.type = "checkbox"; input.checked = initial; input.addEventListener("change", () => {handler(input.checked);invalidate();});
    wrapper.append(input, document.createTextNode(label)); layerOptions.append(wrapper); return input;
  }
  bar.append(title, detail, spacer);
  const qualityKey='pocket-kivi:3d-quality:v1';let initialQuality='balanced',savedQuality=false;
  try{const saved=localStorage.getItem(qualityKey);if(['low','balanced','sharp','high'].includes(saved)){initialQuality=saved;savedQuality=true;}}catch{}
  if(options.quality)initialQuality=qualityName(options.quality);
  const qualityLabel=document.createElement('label');qualityLabel.className='quality-label';const qualityCaption=document.createElement('span');qualityCaption.textContent='Quality';
  const qualitySelect=document.createElement('select');qualitySelect.setAttribute('aria-label','3D rendering quality');qualitySelect.title='Sharp: higher-resolution antialiased edges without ambient occlusion. High: Studio ambient occlusion. Balanced: responsive native antialiasing. Low: reduced memory.';
  for(const [value,label]of [['low','Low'],['balanced','Balanced'],['sharp','Sharp · edges'],['high','High · AO']]){const option=document.createElement('option');option.value=value;option.textContent=label;qualitySelect.append(option);}qualitySelect.value=initialQuality;qualityLabel.append(qualityCaption,qualitySelect);

  const lightingKey='pocket-kivi:3d-lighting:v1';let lighting='studio';
  try{lighting=lightingName(localStorage.getItem(lightingKey));}catch{}
  if(mechanical)lighting='universal';
  if(options.lighting!==undefined)lighting=lightingName(options.lighting);
  const lightingLabel=document.createElement('label');lightingLabel.className='quality-label';const lightingCaption=document.createElement('span');lightingCaption.textContent='Lighting';
  const lightingSelect=document.createElement('select');lightingSelect.setAttribute('aria-label','3D lighting');lightingSelect.title='Universal: even neutral lighting on all sides, without shadows or ambient occlusion. Studio: directional depth and reflections.';
  for(const [value,label]of [['studio','Studio'],['universal','Universal']]){const option=document.createElement('option');option.value=value;option.textContent=label;lightingSelect.append(option);}lightingSelect.value=lighting;lightingLabel.append(lightingCaption,lightingSelect);

  const centerX = (board.bounds.minX + board.bounds.maxX) / 2;
  const centerY = (board.bounds.minY + board.bounds.maxY) / 2;
  const world = ([x, y]) => [x - centerX, centerY - y];
  const localPadPoint=([x,y])=>[x,-y];
  const padShape=outline=>{const shape=new THREE.Shape();pathFor(outline.outline,localPadPoint).getPoints().forEach((point,index)=>index?shape.lineTo(point.x,point.y):shape.moveTo(point.x,point.y));if(outline.drill)shape.holes.push(pathFor(outline.drill,localPadPoint));return shape;};
  const width = Math.max(1, board.width), height = Math.max(1, board.height), extent = Math.max(width, height);
  const thickness = board.stackup?.filter((layer) => Number.isFinite(layer.thickness))
    .reduce((sum, layer) => sum + layer.thickness, 0) || 1.6;
  const top = thickness / 2, bottom = -top;
  const copperPlan=sourceCopperPlan(board,sourceAST,thickness);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(initialDark ? 0x151820 : mechanical ? 0xffffff : 0xe7ebf1);
  let camera = new THREE.PerspectiveCamera(45, 1, 0.1, Math.max(3000, extent * 30));
  // OrbitControls captures its up basis at construction. Use the board's
  // thickness axis consistently for orbiting and all fitted camera presets.
  camera.up.set(0,0,1);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  const gl=renderer.getContext(),graphics=graphicsProfile({maxTextureSize:renderer.capabilities.maxTextureSize,maxRenderbufferSize:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),deviceMemory:globalThis.navigator?.deviceMemory,hardwareConcurrency:globalThis.navigator?.hardwareConcurrency,floatTargets:renderer.extensions.has('EXT_color_buffer_float'),android:/Android/i.test(globalThis.navigator?.userAgent||'')});
  if(!savedQuality&&!options.quality)initialQuality=graphics.defaultQuality;
  let active=true,frame=0,contextLost=false,renderCount=0,pipeline=null,quality=initialQuality,shaderFailure=false;
  function invalidate(){if(!active||contextLost||frame)return;frame=requestAnimationFrame(drawFrame);}
  function graphicsNotice(message,retry=false){qualityNotice.replaceChildren(document.createTextNode(message));qualityNotice.hidden=false;
    const close=document.createElement('button');close.type='button';close.textContent='Dismiss';close.onclick=()=>{qualityNotice.hidden=true;};qualityNotice.append(close);
    if(retry){const button=document.createElement('button');button.type='button';button.textContent='Retry graphics';button.onclick=()=>renderer.forceContextRestore();qualityNotice.append(button);}
  }
  function disposePipeline(){if(!pipeline)return;for(const pass of pipeline.passes){pass.dispose?.();if(pass instanceof GTAOPass){pass.gtaoMaterial.dispose();pass.blendMaterial.dispose();pass.depthTexture?.dispose();}}pipeline.composer.dispose();pipeline=null;}
  function createPipeline(){
    disposePipeline();if(quality==='sharp'){
      const target=new THREE.WebGLRenderTarget(1,1,{type:renderer.extensions.has('EXT_color_buffer_float')?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:true,stencilBuffer:false});
      const composer=new EffectComposer(renderer,target),passes=[new RenderPass(scene,camera),new OutputPass(),new ShaderPass(FXAAShader)];pipeline={composer,passes,fxaa:passes[2]};for(const pass of passes)composer.addPass(pass);return;
    }if(quality!=='high')return;
    if(!renderer.extensions.has('EXT_color_buffer_float'))throw Error('Floating-point render targets are unavailable.');
    const target=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:true,stencilBuffer:false});
    const composer=new EffectComposer(renderer,target),passes=[];pipeline={composer,passes};
    const base=new RenderPass(scene,camera),ao=new GTAOPass(scene,camera,1,1,undefined,boardOcclusion(thickness));
    ao.enabled=lighting!=='universal';ao.blendIntensity=.65;ao.updatePdMaterial({radius:4,rings:2,samples:12});
    // Translucent solder zones, glass and result overlays must not become
    // opaque occluders when the normal/depth pass substitutes its material.
    const inheritedVisibility=ao.overrideVisibility.bind(ao);ao.overrideVisibility=()=>{inheritedVisibility();scene.traverse(object=>{const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(material=>material&&(material.transparent||material.depthTest===false)))object.visible=false;});};
    const output=new OutputPass(),smaa=new SMAAPass(1,1);
    for(const texture of [smaa.areaTexture,smaa.searchTexture])texture.image?.addEventListener?.('load',invalidate,{once:true});
    passes.push(base,ao,output,smaa);for(const pass of passes)composer.addPass(pass);
  }
  function fallbackQuality(message){disposePipeline();quality='balanced';qualitySelect.value=quality;host.dataset.quality=quality;shaderFailure=false;lightingRig.set(lighting,quality);renderer.setRenderTarget(null);graphicsNotice(message);sizeViewport();}
  function applyQuality(value,persist=true){quality=qualityName(value);qualitySelect.value=quality;host.dataset.quality=quality;qualityNotice.hidden=true;shaderFailure=false;
    if(persist)try{localStorage.setItem(qualityKey,quality);}catch{}
    lightingRig.set(lighting,quality);
    try{createPipeline();}catch{fallbackQuality('The selected rendering quality is unavailable on this graphics device. Balanced rendering is active.');}
    sizeViewport();invalidate();return quality;
  }
  qualitySelect.onchange=()=>applyQuality(qualitySelect.value);
  renderer.debug.onShaderError=()=>{shaderFailure=true;};
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // Two bounded, cached maps add contact/depth cues without redrawing shadow
  // geometry every orbit frame. Geometry/visibility changes invalidate them.
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
  // A small, generated neutral studio supplies reflections to metallic STEP /
  // glTF materials. No network environment map or model-material rewrite.
  function createEnvironment(){if(!renderer.extensions.has('EXT_color_buffer_float'))return null;let room,generator;try{room=new RoomEnvironment();generator=new THREE.PMREMGenerator(renderer);return generator.fromScene(room,.04,.1,100);}catch{graphicsNotice('Studio reflections are unavailable on this graphics device. Direct lighting remains active.');return null;}finally{room?.dispose();generator?.dispose();}}
  let environment=createEnvironment();
  scene.environment = environment?.texture||null; scene.environmentIntensity = .65;
  canvasHost.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  let userAdjustedCamera = false;
  const cameraInteraction = () => { userAdjustedCamera = true; };
  controls.addEventListener("start", cameraInteraction);
  controls.addEventListener('change',invalidate);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.screenSpacePanning = true;
  controls.minDistance = Math.max(2, extent * .04); controls.maxDistance = extent * 8;
  const lightingRig=createBoardLighting(THREE,{scene,renderer,extent});
  function applyLighting(value,persist=true){lighting=lightingName(value);lightingSelect.value=lighting;host.dataset.lighting=lighting;const state=lightingRig.set(lighting,quality);
    for(const pass of pipeline?.passes||[])if(pass instanceof GTAOPass)pass.enabled=state.occlusion;
    if(persist)try{localStorage.setItem(lightingKey,lighting);}catch{}
    invalidate();return state;
  }
  lightingSelect.onchange=()=>applyLighting(lightingSelect.value);
  applyLighting(lighting,false);
  const boardGroup = new THREE.Group(); scene.add(boardGroup);
  const probeRegistry=createProbeRegistry(2),probeMaterials=new WeakMap(),probeInstanceColors=new WeakMap();
  function rememberProbeResources(group){group.traverse(object=>{if(object.material&&!probeMaterials.has(object))probeMaterials.set(object,object.material);if(object.isInstancedMesh&&!probeInstanceColors.has(object))probeInstanceColors.set(object,object.instanceColor);});}
  const copperGroups = new Map(), pickables = [];
  const explode=createExplodeView(THREE,copperPlan),viaExplode=[];
  let objectVisibility=objectVisibilityPolicy();
  const visibilityRecords=[];
  const visibilityRecord=(mesh,type,layer)=>{visibilityRecords.push({mesh,type,layer});mesh.visible=!mechanical&&objectVisibility.visible(type,layer);return mesh;};
  const arcIds=new Set(sourceAST.filter(node=>Array.isArray(node)&&node[0]==='arc').map(node=>{const id=node.find(value=>Array.isArray(value)&&['uuid','tstamp'].includes(value[0]))?.[1];return typeof id==='object'?id?.quoted:id;}).filter(Boolean));
  const isArc=track=>arcIds.has(track.id)||arcIds.has(track.id?.replace(/:\d+$/,''))||/^track-\d+:\d+$/.test(track.id||'');
  const appearanceRecords=[];let realistic=true,selectionAppearanceReady=false;
  const appearanceLabel=document.createElement('label');appearanceLabel.append(document.createTextNode('Appearance'));
  const appearanceSelect=document.createElement('select');appearanceSelect.setAttribute('aria-label','3D board appearance');
  for(const [value,label]of [['realistic','Realistic'],['layers','Layer colors']]){const option=document.createElement('option');option.value=value;option.textContent=label;appearanceSelect.append(option);}appearanceLabel.append(appearanceSelect);
  const qualityHelp=document.createElement('p');qualityHelp.className='quality-help';qualityHelp.textContent='Sharp prioritizes crisp copper and model edges without ambient occlusion. High adds Studio ambient occlusion at a lower pixel budget. Universal evenly lights both faces and edges without shadows. Linked model availability is shown below the viewport.';const qualityStats=document.createElement('small');qualityStats.setAttribute('aria-label','3D render sampling');qualityStats.className='quality-help';renderingOptions.append(appearanceLabel,qualityLabel,lightingLabel,qualityHelp,qualityStats);
  function applyAppearance(){if(selectionAppearanceReady)selectionAppearance.restore();for(const record of appearanceRecords){const {mesh,role,layer}=record;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(role==='pads'){for(const material of materials)material.color.setHex(0xffffff);record.pads.forEach((pad,index)=>mesh.setColorAt(index,new THREE.Color(realistic?(padHasMaskOpening(pad,layer)?physicalColors.exposedCopper:physicalColors.coatedCopper):layerThreeColor(layer))));if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    else for(const material of materials)material.color.setHex(realistic?physicalColors.coatedCopper:layerThreeColor(layer));
    for(const material of materials){material.metalness=realistic&&role!=='pads'?.08:studioMaterials.copper.metalness;material.roughness=realistic&&role!=='pads'?.52:studioMaterials.copper.roughness;}
  }if(selectionAppearanceReady)setSelection(externalSelection);invalidate();}
  appearanceSelect.onchange=()=>{realistic=appearanceSelect.value==='realistic';applyAppearance();};
  const groupFor = (layer) => {
    if (!copperGroups.has(layer)) { const group = new THREE.Group(); group.name = layer; boardGroup.add(group); copperGroups.set(layer, group); group.visible=!mechanical; }
    return copperGroups.get(layer);
  };
  const refinedTracks=mechanical?{tracks:[],warnings:[]}:refineCopperTracks(board.tracks,sourceAST);geometryDiagnostics.push(...refinedTracks.warnings);
  const substratePose=substrateEnvelope(thickness,copperPlan.byLayer);
  if(substratePose.missingOuterDepths)geometryDiagnostics.push('Outer copper inner-face depths are incomplete; missing substrate faces use the nominal board envelope.');
  const shape = boardShape(board, world);
  // Saved pad/via drill loops cut the substrate itself; NPTH does not need a
  // copper annulus. Cap triangulation work and disclose omissions explicitly.
  const drilled=new Set();let drillCount=0,drillPoints=0,omittedDrills=0;
  const inside=(point,loop)=>{let result=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const [a,b]=[loop[i],loop[j]];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
  const outer=board.outlineLoops?.[0],outlineHoles=board.outlineLoops?.slice(1)||[];
  for(const item of [...nativePads,...(mechanical?[]:board.vias.filter(via=>copperPlan.viaSpans.get(via.id)?.through).map(via=>({...via,shape:'circle',width:via.size,height:via.size,drillShape:'circle',rotation:0})))]){
    if(!(item.drill>0))continue;const loop=smoothDrillOutline(item);if(!loop){omittedDrills++;continue;}
    const angle=(item.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),[cx,cy]=world(item.at);
    if(outlineHoles.some(hole=>inside(item.at,hole)))continue;
    const points=loop.map(([x,y])=>[cx+x*c+y*s,cy+x*s-y*c]);
    const key=JSON.stringify(points.map(point=>point.map(value=>Math.round(value*10000)/10000)));if(drilled.has(key))continue;
    if(drillCount>=1024||drillPoints+points.length>100000||!outer||!drillLoopInsideBoard(points.map(([x,y])=>[x+centerX,centerY-y]),outer,outlineHoles)){omittedDrills++;continue;}
    drilled.add(key);drillCount++;drillPoints+=points.length;shape.holes.push(pathFor(points,point=>point));
  }
  if(omittedDrills)geometryDiagnostics.push(`${omittedDrills} drill loops could not be cut within the saved-geometry/triangulation budget.`);
  const substrate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: substratePose.depth, bevelEnabled: false, curveSegments: 8 }),
    [new THREE.MeshPhysicalMaterial(studioMaterials.solderMask),
      new THREE.MeshStandardMaterial(studioMaterials.substrateEdge)]);
  substrate.position.z = substratePose.bottom;
  substrate.receiveShadow = true;
  substrate.userData.record = { type: "Board", name: "Substrate", layer: "Edge.Cuts", id: "board" };
  substrate.userData.identity = viewportSceneIdentity("substrate", "Edge.Cuts", "board");
  boardGroup.add(substrate); pickables.push(substrate);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(substrate.geometry, 20),
    new THREE.LineBasicMaterial({ color: 0x9bb7ac, transparent: true, opacity: .42 }));
  edges.position.z = substratePose.bottom; boardGroup.add(edges);

  if(!mechanical){
  for (const {name:layer} of copperPlan.layers) {
    const color=layerThreeColor(layer);
    const saved=copperPlan.byLayer.get(layer),placement=['F.Cu','B.Cu'].includes(layer)?outerCopperPlacement(layer,thickness,saved?.thickness||.035,saved?.z):{center:saved.z,base:saved.z-saved.thickness/2,thickness:saved.thickness},z=placement.center;
    for(const category of ['tracks','arcs']){
    const candidates=refinedTracks.tracks.filter(item=>item.layer===layer&&(isArc(item)?'arcs':'tracks')===category),stroke=copperStrokeBatches(THREE,candidates,{world,z,thickness:placement.thickness});
    if(stroke.invalid)geometryDiagnostics.push(`${layer}: invalid saved track widths or positions omitted.`);
    if(stroke.plan?.limited)geometryDiagnostics.push(`${layer}: large track caps exceed the ${stroke.plan.tolerance} mm tessellation tolerance at the 128-segment display limit.`);
    const trackMaterial=new THREE.MeshStandardMaterial({color,...studioMaterials.copper,...copperDepthPolicy('track')});
    for(const batch of stroke.batches){const mesh=makeInstanced(groupFor(layer),batch.geometry,trackMaterial,batch.records,batch.place,viewportSceneIdentity('copper-track',layer,category+'-'+batch.part));if(mesh){visibilityRecord(mesh,category,layer);pickables.push(mesh);appearanceRecords.push({mesh,role:'tracks',layer});}}
    if(!stroke.batches.length)trackMaterial.dispose();
    }
    const pads = nativePads.filter((item) => item.layer === layer || item.layers?.includes(layer)||item.layers?.includes('*.Cu'));
    const batches=new Map();let omittedPads=0;
    for(const pad of pads){const key=JSON.stringify([pad.shape,pad.width,pad.height,pad.roundrectRatio,pad.drill,pad.drillShape,pad.drillWidth,pad.drillHeight,pad.drillOffset]);if(!batches.has(key)){const outline=smoothPadOutline(pad);if(!outline||batches.size>=256){omittedPads++;continue;}if(outline.tessellation.limited)geometryDiagnostics.push(`${layer}: a pad contour retains validated geometry because the 0.0025 mm tolerance could not be met within hole-containment/display limits.`);batches.set(key,{outline,pads:[]});}batches.get(key).pads.push(pad);}
    if(omittedPads)geometryDiagnostics.push(`${layer}: ${omittedPads} unsupported/ambiguous pad shapes omitted; no rectangular stand-ins were substituted.`);
    const padMaterial=batches.size?copperCapMaterials(THREE,'pad',{color:0xffffff,...studioMaterials.copper}):null;
    for(const [key,batch]of batches){const geometry=new THREE.ExtrudeGeometry(padShape(batch.outline),{depth:placement.thickness,bevelEnabled:false,curveSegments:8});
      const padMesh=makeInstanced(groupFor(layer),geometry,padMaterial,batch.pads,(object,pad)=>{const[x,y]=world(pad.at);object.position.set(x,y,placement.base);object.rotation.z=(pad.rotation||0)*Math.PI/180;},viewportSceneIdentity('copper-pad',layer,key));
      if(padMesh){visibilityRecord(padMesh,'pads',layer);pickables.push(padMesh);appearanceRecords.push({mesh:padMesh,role:'pads',layer,pads:batch.pads});}
    }
    for (const zone of savedZones.records.filter((item) => item.layer === layer)) {
      if (zone.points.length < 3) continue;
      if(!zone.filled){const geometry=new THREE.BufferGeometry().setFromPoints(zone.points.map(point=>{const [x,y]=world(point);return new THREE.Vector3(x,y,z);}));const boundary=new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:layerThreeColor(layer),transparent:true,opacity:.6}));groupFor(layer).add(boundary);visibilityRecord(boundary,'polygons',layer);continue;}
      const zoneShape = new THREE.Shape();
      pathFor(zone.points, world).getPoints().forEach((point, index) => {
        if (index === 0) zoneShape.moveTo(point.x, point.y); else zoneShape.lineTo(point.x, point.y);
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(zoneShape),
        new THREE.MeshStandardMaterial({ color,...studioMaterials.copper,side:THREE.DoubleSide,depthWrite:true,...copperDepthPolicy('zone') }));
      mesh.position.z = ['F.Cu','B.Cu'].includes(layer)?zoneSurfaceZ(layer,placement):placement.center; mesh.userData.record = { ...zone, type: "Zone" };
      groupFor(layer).add(mesh);visibilityRecord(mesh,'fills',layer); pickables.push(mesh);
      appearanceRecords.push({mesh,role:'zone',layer});
    }
  }
  const viaBatches=new Map();let omittedVias=0;
  for(const via of board.vias){const span=copperPlan.viaSpans.get(via.id),outline=smoothPadOutline({shape:'circle',width:via.size,height:via.size,drill:via.drill,drillShape:'circle'});if(!outline||!span){omittedVias++;continue;}const key=JSON.stringify([via.size,via.drill,span.zMin,span.zMax]);if(!viaBatches.has(key)){if(viaBatches.size>=128){omittedVias++;continue;}viaBatches.set(key,{outline,span,vias:[]});}viaBatches.get(key).vias.push(via);}
  if(omittedVias)geometryDiagnostics.push(`${omittedVias} via bodies with unsupported annuli or unknown saved spans omitted.`);
  const viaMaterial=new THREE.MeshStandardMaterial({color:physicalColors.exposedCopper,...studioMaterials.copper,...copperDepthPolicy('via')});
  for(const[key,batch]of viaBatches){const geometry=drillWallGeometry(THREE,smoothDrillOutline({drill:batch.vias[0].drill,drillShape:'circle'}),batch.span.zMax-batch.span.zMin);
    const wallMaterial=viaMaterial.clone();wallMaterial.side=THREE.DoubleSide;
    // Render the saved bore wall, not a solid annulus through the dielectric.
    const mesh=makeInstanced(boardGroup,geometry,wallMaterial,batch.vias,(object,via)=>{const[x,y]=world(via.at);object.position.set(x,y,batch.span.zMin);},viewportSceneIdentity('via-barrel',batch.span.from+'-'+batch.span.to,key));if(mesh){visibilityRecord(mesh,'vias',batch.span.through?'through':batch.span.from+'-'+batch.span.to);pickables.push(mesh);viaExplode.push({mesh,span:batch.span});}}
  geometryDiagnostics.push('Outer copper uses saved plan centers/thickness (or the disclosed stackup fallback) with a 0.001 mm outward display offset; the substrate spans the outer copper inner faces. Saved zone fills are opaque zero-height display films inset by the smaller of 0.005 mm or one quarter of the copper thickness. Via bodies show the saved drill wall; plating thickness is not inferred.');
  const viaCapMaterial=viaBatches.size?copperCapMaterials(THREE,'via',{color:physicalColors.exposedCopper,...studioMaterials.copper}):null;
  // Annuli follow only saved span endpoints, including blind/buried inner layers.
  for(const {name:layer} of copperPlan.layers)for(const [key,batch]of viaBatches){
    if(batch.span.from!==layer&&batch.span.to!==layer)continue;
    const saved=copperPlan.byLayer.get(layer),placement=['F.Cu','B.Cu'].includes(layer)?outerCopperPlacement(layer,thickness,saved.thickness,saved.z):{base:saved.z-saved.thickness/2,thickness:saved.thickness},geometry=new THREE.ExtrudeGeometry(padShape(batch.outline),{depth:placement.thickness,bevelEnabled:false,curveSegments:8});
    const cap=makeInstanced(groupFor(layer),geometry,viaCapMaterial,batch.vias,(object,via)=>{const[x,y]=world(via.at);object.position.set(x,y,placement.base);},viewportSceneIdentity('via-annulus',layer,key));
    if(cap){visibilityRecord(cap,'vias',layer);pickables.push(cap);}
  }
  }
  const netInspection=createNetInspection(THREE,{board:{...board,tracks:refinedTracks.tracks},plan:copperPlan,zones:mechanical?[]:savedZones.records,sourceLimited:savedZones.truncated,pads:mechanical?[]:nativePads,world,colorForLayer:layerThreeColor});scene.add(netInspection.group);
  let fullNet3D=true;
  const netInspectionHelp=document.createElement('p');netInspectionHelp.className='quality-help';netInspectionHelp.hidden=true;renderingOptions.append(netInspectionHelp);
  applyAppearance();
  const parts = new THREE.Group(); boardGroup.add(parts);
  const proxyPoses = footprintProxies(board);
  const componentMesh = makeInstanced(parts, new RoundedBoxGeometry(1, 1, 1, 2, .06),
    new THREE.MeshStandardMaterial(studioMaterials.proxy), board.components,
    (object, part) => { const pose = proxyPoses.get(part); const [x, y] = world(pose?.at || part.at); const below = part.layer?.startsWith("B.");
      object.position.set(x, y, below ? bottom - 1.1 : top + 1.1);
      object.rotation.set(0, 0, pose?.rotation || 0);
      object.scale.set(pose?.width || 0, pose?.height || 0, pose ? 2.1 : 0); },
    viewportSceneIdentity("component", "F.Fab", "proxies"));
  if (componentMesh) pickables.push(componentMesh);
  if (componentMesh) { componentMesh.castShadow = true; componentMesh.receiveShadow = true; }
  const componentIndexes = uniqueComponentIndexes(board.components);
  const componentMatrices = board.components.map((_, index) => {
    const matrix = new THREE.Matrix4();
    componentMesh?.getMatrixAt(index, matrix);
    return matrix;
  });
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const modelGroups = new Map(), loadedModelIndexes = new Set();
  let stepClient=null;
  let population = board.components.map(() => true);
  function updateComponentVisibility() {
    const matrix=new THREE.Matrix4();
    board.components.forEach((part,index)=>{matrix.copy(componentMatrices[index]);matrix.elements[14]+=explode.offset(part.layer?.startsWith('B.')?'B.Cu':'F.Cu');componentMesh?.setMatrixAt(index,
      population[index]&&objectVisibility.visible('bodies',part.layer)&&!loadedModelIndexes.has(index)?matrix:hiddenMatrix);});
    if (componentMesh) { componentMesh.instanceMatrix.needsUpdate = true; componentMesh.computeBoundingSphere(); }
    for (const [index,group]of modelGroups){group.visible=population[index]&&objectVisibility.visible('bodies',board.components[index].layer);explode.layer(group,board.components[index].layer?.startsWith('B.')?'B.Cu':'F.Cu');}
    renderer.shadowMap.needsUpdate=true;
    invalidate();
  }
  const modelDiagnostics = Array.isArray(options.assetWarnings)
    ? options.assetWarnings.filter(item => typeof item === "string").slice(0, 48).map(item => item.slice(0, 500)) : [];
  if(!mechanical&&savedZones.unfilled)modelDiagnostics.push(`${savedZones.unfilled} zones have no saved copper fill; only their boundaries are shown.`);
  if(!mechanical&&savedZones.truncated)modelDiagnostics.push('Saved zone display reached its polygon/point budget; additional copper is omitted.');
  modelDiagnostics.push(...geometryDiagnostics.filter(message=>!mechanical||!/copper|pad shapes|annuli|via bodies/i.test(message)));
  showModelDiagnostics();
  function showModelDiagnostics() {
    const resolved = loadedModelIndexes.size;
    const problems = modelDiagnostics.length;
    notice.replaceChildren(document.createTextNode(`Material preview · linked models ${resolved}/${board.components.length}`));
    const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ul');summary.textContent=problems?`${problems} rendering notes`:'Rendering details';
    for(const message of ['Mask openings follow saved pad layer flags; this is not a reconstructed solder-mask solid.',`${board.components.length-resolved} footprints have no linked model; bounded stand-ins are used only where usable saved footprint bounds exist.`,...modelDiagnostics]){const row=document.createElement('li');row.textContent=message;list.append(row);}details.append(summary,list);notice.append(details);
    notice.title = modelDiagnostics.join("\n");
  }
  function glbIsSelfContained(bytes) {
    if (bytes.byteLength < 20) return false;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
        view.getUint32(8, true) !== bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) return false;
    const length = view.getUint32(12, true);
    if (length > bytes.byteLength - 20) return false;
    let descriptor;
    try { descriptor = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))); }
    catch { return false; }
    return [...(descriptor.buffers || []), ...(descriptor.images || [])]
      .every(item => !item.uri || /^data:/i.test(item.uri));
  }
  async function sceneFromAsset(entry, asset, consumeBytes) {
    const base64 = asset?.base64;
    if (typeof base64 !== "string" || base64.length > 11_200_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error("invalid or oversized model asset response");
    }
    const bytes = entry.embeddedAsset ? await globalThis.KiCadEmbeddedModels.decode(asset, fzstd.decompress)
      : Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("model asset exceeds 8 MiB");
    consumeBytes(bytes.byteLength);
    if (["step","stp"].includes(entry.format)) {
      stepClient ||=new globalThis.KiCadStepDecoder.Client(new URL("step-worker.js",location.href).href);
      const meshes=await stepClient.decode(bytes), group=new THREE.Group();
      for(const mesh of meshes){
        const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(mesh.positions,3));geometry.setIndex(new THREE.BufferAttribute(mesh.index,1));
        if(mesh.normals)geometry.setAttribute("normal",new THREE.BufferAttribute(mesh.normals,3));else geometry.computeVertexNormals();
        const material=new THREE.MeshStandardMaterial({color:new THREE.Color(...mesh.color),roughness:.65,metalness:.1});
        group.add(new THREE.Mesh(geometry,material));
      }
      return group;
    }
    if (entry.format === "glb") {
      if (!glbIsSelfContained(bytes)) throw new Error("GLB has an external dependency or invalid header");
      return (await new GLTFLoader().parseAsync(bytes.buffer, "")).scene;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const prepared = prepareVRMLSource(text);
    return restoreVRMLNames(new VRMLLoader().parse(prepared.source), prepared.identifiers);
  }
  async function loadRepositoryModels() {
    if (!options.boardPath) return;
    let inventory;
    try {
      const paths=options.assetPathsPromise?await options.assetPathsPromise:options.assetPaths;
      if(!active||captureAbort.signal.aborted)return;
      for(const warning of (Array.isArray(options.assetWarnings)?options.assetWarnings:[]).filter(item=>typeof item==='string').slice(0,48).map(item=>item.slice(0,500)))if(!modelDiagnostics.includes(warning))modelDiagnostics.push(warning);
      inventory = globalThis.KiCadRepoModels.collect(source, options.boardPath, undefined, paths);
    }
    catch (error) { if(!active||captureAbort.signal.aborted)return;modelDiagnostics.push(`Cannot read model references: ${error.message}`); showModelDiagnostics(); return; }
    modelDiagnostics.push(...inventory.diagnostics);
    showModelDiagnostics();
    const cache = new Map();
    const componentIndexes=new Map(board.components.map((component,index)=>[component.id,index]));
    let totalBytes = 0, cursor = 0;
    async function one(entry) {
      const index = componentIndexes.get(entry.footprintId);
      if (index === undefined) { modelDiagnostics.push(`${entry.reference}: footprint identity not found`); return; }
      try {
        const key = entry.assetKey || entry.path;
        if (!cache.has(key)) cache.set(key, (async () => {
          const asset = entry.embeddedAsset || await options.loadAsset?.(entry.path);
          return sceneFromAsset(entry, asset, bytes => {
            totalBytes += bytes;
            if (totalBytes > 24 * 1024 * 1024) throw new Error("Decoded 3D model assets exceed 24 MiB in this viewer");
          });
        })());
        const template = await cache.get(key);
        if (!active) return;
        const clone = template.clone(true);
        let meshCount = 0;
        clone.traverse(object => {
          if (object.isMesh && object.geometry?.attributes?.position?.count) {
            meshCount++;
            object.castShadow = true; object.receiveShadow = true;
            object.userData.record = { ...board.components[index], type: "Component", modelPath: entry.path };
            pickables.push(object);
          }
        });
        if (!meshCount) throw new Error("asset has no drawable mesh");
        const pose = globalThis.KiCadRepoModels.modelPose(entry, centerX, centerY, thickness);
        const group = new THREE.Group();
        group.position.set(...pose.position);
        group.rotation.z = pose.footprintAngle;
        const local = new THREE.Group();
        // KiCad's VRML exporter composes X/Y/Z model rotations before footprint rotation.
        local.rotation.set(...pose.modelRotation, "ZYX");
        local.scale.set(...pose.scale);
        local.add(clone); group.add(local);
        if (!modelGroups.has(index)) {
          const footprintModels = new THREE.Group();
          modelGroups.set(index, footprintModels); parts.add(footprintModels);
        }
        modelGroups.get(index).add(group);
        loadedModelIndexes.add(index);
        if (entry.format === "glb") modelDiagnostics.push(`${entry.reference}: GLB geometry is interpreted in millimetres.`);
        updateComponentVisibility();
        rememberProbeResources(group);probeRegistry.sourceAdded(group);
        setSelection(externalSelection);
      } catch (error) {
        modelDiagnostics.push(`${entry.reference}: ${entry.path}: ${error?.message || String(error)}`);
      }
      showModelDiagnostics();
    }
    await Promise.all(Array.from({ length: Math.min(3, inventory.models.length) }, async () => {
      while (cursor < inventory.models.length && active) await one(inventory.models[cursor++]);
    }));
    if(active) {
      showModelDiagnostics(); setSelection(externalSelection);
      // Fit real model height after asynchronous decoding, but never undo an
      // orbit/zoom the user has already started during loading.
      if (!userAdjustedCamera && loadedModelIndexes.size) fit();
    }
  }

  let fittedRadius = Math.hypot(width, height, thickness + 5) / 2;
  function updateClipping() {
    const range = boardClipRange(camera.position.distanceTo(controls.target), fittedRadius);
    camera.near = range.near; camera.far = range.far; camera.updateProjectionMatrix();
  }
  controls.addEventListener("change", updateClipping);
  function sizeViewport() {
    const viewportWidth = Math.max(1, canvasHost.clientWidth), viewportHeight = Math.max(1, canvasHost.clientHeight);
    const plan=qualityViewport(viewportWidth,viewportHeight,globalThis.devicePixelRatio,graphics.maxDimension,quality,graphics),ratio=plan.ratio;
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(viewportWidth, viewportHeight, false); resizeProjection(camera,viewportWidth / viewportHeight);
    if(pipeline){pipeline.composer.setPixelRatio(ratio);pipeline.composer.setSize(viewportWidth,viewportHeight);pipeline.fxaa?.material.uniforms.resolution.value.set(1/plan.width,1/plan.height);}
    camera.updateProjectionMatrix();
    const sampling=plan.width+' × '+plan.height+' px · '+(pipeline?.fxaa?'FXAA':pipeline?'SMAA':gl.getContextAttributes()?.antialias?'native MSAA':'driver antialiasing unavailable');if(qualityStats.textContent!==sampling)qualityStats.textContent=sampling;
    invalidate();
  }
  function fit(view = 'iso') {
    sizeViewport();
    boardGroup.updateWorldMatrix(true, true);
    const bounds=new THREE.Box3().setFromObject(boardGroup),sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : Math.hypot(width, height, thickness + 5) / 2;
    const center = sphere.radius > 0 ? sphere.center : new THREE.Vector3();
    const preset=boardViewPreset(view),direction = new THREE.Vector3(...preset.direction).normalize();
    const distance = boxFitDistance(bounds.getSize(new THREE.Vector3()).toArray(),direction.toArray(),45,camera.aspect,.85,preset.up)||sphereFitDistance(radius, 45, camera.aspect) || extent * 3;
    fitProjection(camera,distance);
    fittedRadius = radius;
    controls.maxDistance = Math.max(extent * 8, distance * 4);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.up.fromArray(preset.up); controls.target.copy(center); controls.update(); updateClipping();
  }
  action("Fit", () => {userAdjustedCamera=true;fit();},'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8Z','Fit board to viewport');
  const viewSelect=document.createElement('select');viewSelect.className='view-select';viewSelect.title='Choose a board viewing side';viewSelect.setAttribute('aria-label','3D camera view');const viewPrompt=document.createElement('option');viewPrompt.value='';viewPrompt.disabled=true;viewPrompt.textContent='View';viewSelect.append(viewPrompt);
  for(const {id,label}of boardViewPresets){const item=document.createElement('option');item.value=id;item.textContent=label;viewSelect.append(item);}viewSelect.value='';viewSelect.onchange=()=>{userAdjustedCamera=true;fit(viewSelect.value);viewSelect.value='';};bar.append(viewSelect);
  const projectionButton=action('Ortho',()=>setOrthographic(!camera.isOrthographicCamera),'M4 4h16v16H4z M4 10h16 M10 4v16','Orthographic projection');projectionButton.setAttribute('aria-pressed','false');projectionButton.title='Orthographic projection: parallel edges and undistorted top views';
  function setOrthographic(enabled){camera=projectionCamera(THREE,camera,controls,Boolean(enabled));terminalAnnotations.setCamera(camera);projectionButton.setAttribute('aria-pressed',String(Boolean(camera.isOrthographicCamera)));createPipeline();sizeViewport();controls.update();invalidate();return Boolean(camera.isOrthographicCamera);}
  const divider=document.createElement('span');divider.className='divider';divider.setAttribute('aria-hidden','true');bar.append(divider);
  const measureButton=action('Measure',()=>setMeasurementMode(!measuring),'M3 17 17 3l4 4L7 21ZM7 13l3 3M10 10l2 2M13 7l3 3','Measure distance between 3D surfaces');measureButton.setAttribute('aria-pressed','false');
  const displayButton=action('Display',()=>setDisplayOpen(visibilityOptions.hidden),'M3 6h18M3 12h18M3 18h18M7 3v6M17 9v6M10 15v6','3D display settings');displayButton.setAttribute('aria-expanded','false');displayButton.setAttribute('aria-controls',visibilityOptions.id);
  const explodeLabel=document.createElement('label');explodeLabel.className='explode-control';explodeLabel.title='Separate saved copper layers and their components; visual spacing only. The substrate stays at the center.';
  const explodeCaption=document.createElement('span');explodeCaption.textContent='Explode';const explodeSlider=document.createElement('input');explodeSlider.type='range';explodeSlider.min='0';explodeSlider.max='100';explodeSlider.step='1';explodeSlider.value='0';explodeSlider.setAttribute('aria-label','Explode board layers');const explodeValue=document.createElement('output');explodeValue.textContent='0%';explodeLabel.append(explodeCaption,explodeSlider,explodeValue);explodeLabel.hidden=mechanical;bar.append(explodeLabel);
  function setExplode(value){const amount=explode.set(mechanical?0:value);explodeSlider.value=String(amount);explodeValue.textContent=amount+'%';explodeSlider.setAttribute('aria-valuetext',amount+' percent exploded');for(const [name,group]of copperGroups)explode.layer(group,name);for(const {mesh,span}of viaExplode)explode.barrels(mesh,span);updateComponentVisibility();setSelection(externalSelection);probeRegistry.forEach(probe=>probe.setExplode?.(amount));fittedRadius=new THREE.Box3().setFromObject(boardGroup).getBoundingSphere(new THREE.Sphere()).radius;updateClipping();renderer.shadowMap.needsUpdate=true;invalidate();return amount;}
  let explodeFrame=0,pendingExplode=0;explodeSlider.addEventListener('input',()=>{pendingExplode=Number(explodeSlider.value);if(!explodeFrame)explodeFrame=requestAnimationFrame(()=>{explodeFrame=0;if(active)setExplode(pendingExplode);});});
  for(const name of explode.layers.filter(name=>!['F.Cu','B.Cu'].includes(name)))toggle(name,true,visible=>{groupFor(name).visible=!mechanical&&visible;});
  toggle("Front copper", true, (visible) => { groupFor("F.Cu").visible = !mechanical&&visible; });
  toggle("Back copper", true, (visible) => { groupFor("B.Cu").visible = !mechanical&&visible; });
  toggle("Parts", true, (visible) => { parts.visible = visible; renderer.shadowMap.needsUpdate=true; });
  toggle("Full net 3D", true, (enabled) => { fullNet3D=enabled;setSelection(externalSelection); });
  // Saved terminal annotations are deliberately visible through component
  // bodies, but only on the facing outer copper side. No geometry is modified.
  let showTerminalLabels=options.showNetNames===true;
  const terminalLabelStatus=document.createElement('p');terminalLabelStatus.className='quality-help';terminalLabelStatus.setAttribute('role','status');terminalLabelStatus.hidden=true;layerOptions.append(terminalLabelStatus);
  const terminalSurfaceZ=layer=>{const saved=copperPlan.byLayer.get(layer),sign=layer==='F.Cu'?1:-1;return (saved?.z??sign*(thickness/2-(saved?.thickness||.035)/2))+sign*((saved?.thickness||.035)/2+.0015)+explode.offset(layer);};
  const terminalSource={records:mechanical?[]:nativePads,world,top,bottom,surfaceZ:terminalSurfaceZ,layout:padLabels.layout,layerVisible:layer=>groupFor(layer).visible&&objectVisibility.visible('pads',layer)};
  const terminalAnnotations=createTerminalAnnotations(THREE,{scene,camera,host:canvasHost,...terminalSource,showNetNames:showTerminalLabels,showTerminalNumbers:options.showTerminalNumbers,onStatus:state=>{
    terminalLabelStatus.hidden=!(state.numbers||state.nets)||state.shown>0&&!state.overlap&&!state.budget&&!state.sourceOmitted;
    terminalLabelStatus.textContent=state.shown?`${state.shown} pad annotations shown${state.overlap?`; ${state.overlap} overlapping labels omitted`:''}${state.budget?`; ${state.budget} omitted by the label/texture budget`:''}${state.sourceOmitted?`; ${state.sourceOmitted} beyond the source-record limit`:''}.`:'Zoom in on the facing copper surface for readable saved pad annotations.';
  }});
  const terminalLabels=terminalAnnotations.group,terminalLabelController=createTerminalLabelController(terminalAnnotations,{enabled:()=>!mechanical&&!measuring,onNumbersChange:options.onTerminalNumbersChange,onNetNamesChange:options.onTerminalLabelsChange,onChange:syncTerminalToggles});
  function updateTerminalLabels(){terminalLabelController.update();}
  const terminalNumbersToggle=toggle('Pad numbers (close zoom)',terminalAnnotations.getState().numbers,visible=>terminalLabelController.setNumbers(visible,{notify:true}));
  const terminalLabelsToggle=toggle('Net names (close zoom)',showTerminalLabels,visible=>terminalLabelController.setNets(visible,{notify:true}));
  terminalNumbersToggle.title='Saved pad numbers, including BGA names such as A1, are annotations visible through component bodies. Up to 1024 readable, nonoverlapping labels are shown within a bounded texture budget.';
  terminalLabelsToggle.title='Saved net names are annotations visible through component bodies on the facing copper side. Zoom in for readable labels.';
  function syncTerminalToggles(state=terminalAnnotations.getState()){showTerminalLabels=state.nets;terminalNumbersToggle.checked=state.numbers;terminalLabelsToggle.checked=state.nets;terminalLabels.visible=!mechanical&&!measuring&&(state.numbers||state.nets);probeRegistry.forEach(probe=>{probe.setTerminalNumbers?.(state.numbers);probe.setTerminalLabels?.(state.nets);});invalidate();}
  function setTerminalLabels(visible){return terminalLabelController.setNets(visible);}
  function setTerminalNumbers(visible){return terminalLabelController.setNumbers(visible);}

  fit();

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const measurementSession=new MeasurementSession();let measuring=false,measurementUnit='mm';
  const measurementPanel=document.createElement('section');measurementPanel.className='measurement-panel';measurementPanel.hidden=true;measurementPanel.setAttribute('aria-label','3D surface measurement');
  const measurementHeading=document.createElement('div');measurementHeading.className='measurement-heading';
  const measurementTitle=document.createElement('strong');measurementTitle.textContent='Surface distance';
  const measurementUnits=document.createElement('select');measurementUnits.setAttribute('aria-label','3D measurement units');for(const unit of ['mm','mil']){const option=document.createElement('option');option.value=unit;option.textContent=unit;measurementUnits.append(option);}
  const measurementExit=document.createElement('button');measurementExit.type='button';measurementExit.textContent='Done';measurementExit.title='Exit measurement mode';measurementExit.onclick=()=>setMeasurementMode(false);
  measurementHeading.append(measurementTitle,measurementUnits,measurementExit);
  const measurementSnap=document.createElement('select'),measurementFilter=document.createElement('select'),measurementSelection=document.createElement('div');measurementSelection.className='measurement-tools';measurementSnap.setAttribute('aria-label','3D measurement snap');measurementFilter.setAttribute('aria-label','3D measurement selection filter');
  for(const [value,label]of [['surface','Surface'],['edges','Snap to edges'],['corners','Snap to corners']]){const option=document.createElement('option');option.value=value;option.textContent=label;measurementSnap.append(option);}
  for(const [value,label]of [['all','All geometry'],['board','Board outline/body'],['models','Component models'],['pads','Pads'],['tracks','Tracks'],['vias','Vias']]){const option=document.createElement('option');option.value=value;option.textContent=label;measurementFilter.append(option);}measurementSelection.append(measurementSnap,measurementFilter);
  const measurementEdges=new WeakMap();let measurementTouch=null,measurementTouchDrag=null;const measurementPointers=new Set();
  const measurementLens=document.createElement('canvas');measurementLens.width=measurementLens.height=240;measurementLens.className='measurement-label';measurementLens.hidden=true;measurementLens.setAttribute('aria-label','3D measurement magnifier');measurementLens.style.cssText='width:120px;height:120px;position:absolute;right:12px;top:50px;left:auto;pointer-events:none;border-radius:50%;z-index:8;padding:0';stage.append(measurementLens);
  function drawMeasurementLens(){if(!measuring||!measurementTouch){measurementLens.hidden=true;return;}const rect=renderer.domElement.getBoundingClientRect(),x=measurementTouch.x-rect.left,y=measurementTouch.y-rect.top;measurementLens.hidden=false;const ctx=measurementLens.getContext('2d');if(!ctx)return;const ratioX=renderer.domElement.width/rect.width,ratioY=renderer.domElement.height/rect.height;ctx.clearRect(0,0,240,240);ctx.drawImage(renderer.domElement,(x-20)*ratioX,(y-20)*ratioY,40*ratioX,40*ratioY,0,0,240,240);ctx.strokeStyle='#ffcf66';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(110,120);ctx.lineTo(130,120);ctx.moveTo(120,110);ctx.lineTo(120,130);ctx.stroke();}

  const measurementOutput=document.createElement('output');measurementOutput.setAttribute('aria-live','polite');
  const measurementStatus=document.createElement('p');measurementStatus.setAttribute('role','status');
  const measurementDelta=document.createElement('small'),measurementDisclaimer=document.createElement('small');measurementDisclaimer.textContent='Model surfaces · footprint stand-ins are approximate.';
  const measurementTools=document.createElement('div');measurementTools.className='measurement-tools';
  const measurementHistory=document.createElement('select');measurementHistory.setAttribute('aria-label','Recent 3D measurements');
  const measurementClear=document.createElement('button');measurementClear.type='button';measurementClear.textContent='Clear';measurementClear.title='Clear all 3D measurements';measurementClear.onclick=clearMeasurements;
  measurementTools.append(measurementHistory,measurementClear);measurementPanel.append(measurementHeading,measurementSelection,measurementOutput,measurementStatus,measurementDelta,measurementTools,measurementDisclaimer);stage.append(measurementPanel);
  const measurementLabel=document.createElement('div');measurementLabel.className='measurement-label';measurementLabel.hidden=true;measurementLabel.setAttribute('aria-hidden','true');stage.append(measurementLabel);
  const measureGroup=new THREE.Group();measureGroup.visible=false;scene.add(measureGroup);
  const measureGeometry=new THREE.BufferGeometry();measureGeometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const measureMaterial=new THREE.LineBasicMaterial({color:0xffd37a,transparent:true,opacity:.95,depthTest:false,depthWrite:false,toneMapped:false});
  const measureLine=new THREE.Line(measureGeometry,measureMaterial);measureLine.frustumCulled=false;measureLine.renderOrder=201;measureGroup.add(measureLine);
  const markerGeometry=new THREE.SphereGeometry(1,12,8),markerMaterial=new THREE.MeshBasicMaterial({color:0xffd37a,transparent:true,opacity:.95,depthTest:false,depthWrite:false,toneMapped:false});
  const measureMarkers=[new THREE.Mesh(markerGeometry,markerMaterial),new THREE.Mesh(markerGeometry,markerMaterial)];for(const marker of measureMarkers){marker.renderOrder=202;measureGroup.add(marker);}
  const toWorld=point=>new THREE.Vector3(point.x-centerX,centerY-point.y,point.z);
  function updateMeasurementPanel(message){
    const current=measurementSession.selected,pending=measurementSession.pending;
    measurementOutput.textContent=current?(current.approximate?'≈ ':'')+distanceLabel(current.distance,measurementUnit):'—';
    measurementStatus.textContent=message||(pending?'Choose the second surface point.':current?'Choose a point to start another measurement.':'Choose the first surface point.');
    const signed=value=>(measurementUnit==='mil'?value/.0254:value).toFixed(measurementUnit==='mil'?2:3);
    measurementDelta.textContent=current?`ΔX ${signed(current.delta.x)} · ΔY ${signed(current.delta.y)} · ΔZ ${signed(current.delta.z)} ${measurementUnit}`:'';
    measurementHistory.replaceChildren();const prompt=document.createElement('option');prompt.value='';prompt.textContent=measurementSession.records.length?'Recent measurements':'No measurements yet';measurementHistory.append(prompt);
    for(const record of measurementSession.records){const option=document.createElement('option');option.value=String(record.id);option.textContent=`#${record.id} · ${record.approximate?'≈ ':''}${distanceLabel(record.distance,measurementUnit)}`;measurementHistory.append(option);}measurementHistory.value=current?String(current.id):'';measurementHistory.disabled=!measurementSession.records.length;
    measurementLabel.textContent=current?(current.approximate?'≈ ':'')+distanceLabel(current.distance,measurementUnit):'';
    updateMeasurementGraphics();invalidate();
  }
  function updateMeasurementGraphics(){
    const current=measurementSession.selected,pending=measurementSession.pending;measureGroup.visible=measuring&&Boolean(current||pending);measurementLabel.hidden=!measuring||!current;
    if(!measureGroup.visible)return;const from=toWorld(current?.from||pending),to=current?toWorld(current.to):null;measureMarkers[0].position.copy(from);measureMarkers[1].visible=Boolean(to);measureLine.visible=Boolean(to);
    if(to){measureMarkers[1].position.copy(to);const positions=measureGeometry.getAttribute('position');positions.setXYZ(0,from.x,from.y,from.z);positions.setXYZ(1,to.x,to.y,to.z);positions.needsUpdate=true;
      const center=from.clone().add(to).multiplyScalar(.5).project(camera);measurementLabel.hidden=center.z<-1||center.z>1;
      measurementLabel.style.left=Math.max(8,Math.min(canvasHost.clientWidth-measurementLabel.offsetWidth-8,(center.x+1)*canvasHost.clientWidth/2+8))+'px';measurementLabel.style.top=Math.max(8,Math.min(canvasHost.clientHeight-measurementLabel.offsetHeight-8,(1-center.y)*canvasHost.clientHeight/2-24))+'px';
    }
    for(const marker of measureMarkers){const radius=Math.max(.005,camera.position.distanceTo(marker.position)*2*Math.tan(camera.fov*Math.PI/360)/Math.max(1,canvasHost.clientHeight)*3.5);marker.scale.setScalar(radius);}
  }
  function setMeasurementMode(enabled){if(!active)return false;measuring=Boolean(enabled);host.dataset.measuring=String(measuring);measureButton.setAttribute('aria-pressed',String(measuring));measurementPanel.hidden=!measuring;if(!measuring){measurementSession.pending=null;measurementTouch=null;measurementTouchDrag=null;measurementPointers.clear();controls.enabled=true;measurementLens.hidden=true;}updateMeasurementPanel();options.onMeasurementMode?.(measuring);return measuring;}
  function clearMeasurements(){measurementSession.clear();updateMeasurementPanel();options.onMeasurement?.(null);}
  measurementUnits.onchange=()=>{measurementUnit=measurementUnits.value==='mil'?'mil':'mm';updateMeasurementPanel();};
  measurementHistory.onchange=()=>{const record=measurementSession.replay(measurementHistory.value);if(record){updateMeasurementPanel();options.onMeasurement?.(record);}};
  const escapeMeasurement=event=>{if(event.key==='Escape'&&measuring){event.preventDefault();event.stopPropagation();setMeasurementMode(false);measureButton.focus();}};
  shadow.addEventListener('keydown',escapeMeasurement);
  function measurementPoint(){
    const visible=item=>{for(let node=item;node;node=node.parent)if(!node.visible)return false;return true;};
    const hit=raycaster.intersectObjects(pickables.filter(visible),false)[0];if(!hit)return null;
    const rawCategory=hit.object===substrate?'board':visibilityRecords.find(record=>record.mesh===hit.object)?.type||'models',category=rawCategory==='arcs'?'tracks':rawCategory;
    if(measurementFilter.value!=='all'&&measurementFilter.value!==category)return null;
    if(measurementSnap.value==='surface')return{point:hit.point,approximate:hit.object===componentMesh,kind:'surface'};
    const geometry=hit.object.geometry,positions=geometry?.getAttribute('position');if(!positions||positions.count>200000)return null;
    let edges=measurementEdges.get(geometry);if(!edges){const wire=new THREE.EdgesGeometry(geometry,25),p=wire.getAttribute('position');edges=[];for(let i=0;i+1<p.count&&edges.length<10000;i+=2)edges.push([[p.getX(i),p.getY(i),p.getZ(i)],[p.getX(i+1),p.getY(i+1),p.getZ(i+1)]]);wire.dispose();measurementEdges.set(geometry,edges);}
    const matrix=hit.object.matrixWorld.clone();if(Number.isInteger(hit.instanceId)){const instance=new THREE.Matrix4();hit.object.getMatrixAt(hit.instanceId,instance);matrix.multiply(instance);}
    const transformed=edges.map(edge=>edge.map(p=>{const v=new THREE.Vector3(...p).applyMatrix4(matrix);return{x:v.x,y:v.y,z:v.z};})),rect=renderer.domElement.getBoundingClientRect();
    const project=p=>{const clip=new THREE.Vector4(p.x,p.y,p.z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);if(clip.w<=0)return null;return{x:(clip.x/clip.w+1)*rect.width/2,y:(1-clip.y/clip.w)*rect.height/2,z:clip.z/clip.w,w:clip.w};};
    const result=snapProjectedEdges({x:(pointer.x+1)*rect.width/2,y:(1-pointer.y)*rect.height/2},transformed,project,{mode:measurementSnap.value,tolerance:measurementTouch?18:12});if(!result)return null;
    const point=new THREE.Vector3(result.point.x,result.point.y,result.point.z),screen=point.clone().project(camera),checkRay=new THREE.Raycaster();checkRay.setFromCamera(new THREE.Vector2(screen.x,screen.y),camera);const first=checkRay.intersectObjects(pickables.filter(visible),false)[0];
    if(!first||first.object!==hit.object||first.instanceId!==hit.instanceId||first.point.distanceTo(point)>Math.max(.002,camera.position.distanceTo(point)*.00005))return null;
    return{point,approximate:hit.object===componentMesh,kind:result.kind};
  }
  function measureSurface(){
    const hit=measurementPoint();if(!hit){updateMeasurementPanel('No visible feature within snap range. Adjust snap/filter or zoom in.');return;}
    const result=measurementSession.add({x:hit.point.x+centerX,y:centerY-hit.point.y,z:hit.point.z,approximate:hit.approximate});
    updateMeasurementPanel(hit.kind+' selected. '+(measurementSession.pending?'Choose the second point.':'Measurement complete.'));if(result?.distance!==undefined)options.onMeasurement?.(result);
  }
  let selected = null;
  let selectionDim=true;
  rememberProbeResources(boardGroup);
  const selectionAppearance=createSelectionAppearance(THREE,()=>{const objects=[];boardGroup.traverse(object=>{if(object.material)objects.push(object);});return objects;});
  selectionAppearanceReady=true;
  const selectionGeometry=createSelectionGeometry(THREE,{scene,objects:()=>pickables,limit:2000,dark:initialDark});
  let externalSelection = {},netHighlightColor='layer';
  const selectionNotice = document.createElement('div'); selectionNotice.className = 'hint'; selectionNotice.style.bottom = '42px'; selectionNotice.hidden = true; stage.append(selectionNotice);
  function setSelection(selection = {}) {
    invalidate();
    if(mechanical){externalSelection={};netInspection.update({},false);netInspection.group.visible=false;selectionAppearance.restore();selectionGeometry.clear();selectionNotice.hidden=true;return {highlighted:0,matched:0,limited:false,mechanical:true};}
    externalSelection = selection || {};
    const matches = selectionMatcher(externalSelection, board);
    const netState=netInspection.update(externalSelection,fullNet3D);explode.overlay(netInspection.group);
    netInspectionHelp.hidden=!netState.active;
    netInspectionHelp.textContent='Full net 3D reveals saved copper on all layers, including hidden layers, with '+(selectionDim?'translucent grey':'original-color')+' context. '+netState.warnings.slice(0,2).join(' ');
    netInspectionHelp.title=netState.warnings.join('\n');
    hint.textContent=netState.active?'Full net 3D · '+netState.nets.join(', ')+' · '+netState.tracks+' track segments · '+netState.vias+' vias'+(netState.omitted?' · '+netState.omitted+' omitted (see Display)':''):'Drag to orbit · right-drag to pan · wheel to zoom · click to inspect';
    if(netState.active){
      selectionGeometry.clear();
      selectionNotice.hidden=!netState.omitted;selectionNotice.style.display=netState.omitted?'block':'none';
      selectionNotice.textContent=netState.omitted+' selected primitives omitted; see Display for geometry notes.';
      selectionAppearance.update(matches,selectionDim,{translucent:selectionDim});
      const visible=netState.tracks+netState.pads+netState.vias+netState.platedPads+netState.fills+netState.boundaries;
      return {highlighted:visible,matched:visible,limited:netState.omitted>0||netState.sourceLimited,fullNet3D:true};
    }
    const state=selectionGeometry.update(matches,{colorForRecord:netHighlightColor==='layer'?record=>record?.layer?layerThreeColor(record.layer):null:null});
    selectionNotice.hidden=!state.limited;selectionNotice.textContent=`Showing ${state.highlighted} of ${state.matched} selected source meshes`;selectionNotice.style.display=state.limited?'block':'none';
    selectionAppearance.update(matches,state.matched>0&&selectionDim);
    return state;
  }
  function clearSelection() {
    selected = null; inspector.hidden = true; menu.hidden = true; selectionGeometry.clear();
    setSelection({});
    options.onSelect?.(null);
  }
  function select(record, point, object, instanceId, gesture) {
    if(mechanical)return;
    const mode=options.getSelectionMode?.()||selectionMode;
    setSelection(mode==='net'&&record.net?{netNames:[record.net]}:record.type==='Component'||typeof record.library==='string'?{references:[record.ref]}:{uuids:[record.uuid||record.id]});
    selected = { record, point: point.clone() };
    options.onSelect?.(record,gesture);
    inspector.replaceChildren();
    const heading = document.createElement("h2"); heading.textContent = record.ref || record.name || record.type || "Board object";
    const list = document.createElement("dl");
    for (const [label, value] of Object.entries({ Type: record.type || (record.ref ? "Component" : "Copper"),
      Reference: record.ref, Value: record.value, Layer: record.layer || record.layers?.join(", "), Net: record.net,
      Model: record.modelPath || record.modelPaths?.join(", ") })) {
      if (value == null || value === "") continue;
      const term = document.createElement("dt"), desc = document.createElement("dd");
      term.textContent = label; desc.textContent = String(value); list.append(term, desc);
    }
    inspector.append(heading, list); inspector.hidden = Boolean(options.externalInspector);
  }
  function pick(event,clearOnMiss=true) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if(measuring){measureSurface();return;}
    if (analysisOverlay?.mesh.visible) {
      const result = analysisOverlay.sample(raycaster.intersectObject(analysisOverlay.mesh, false)[0]);
      if (result) { options.onAnalysisProbe?.(result); return; }
    }
    const visible = item => { for (let node = item; node; node = node.parent) if (!node.visible) return false; return true; };
    const hits = raycaster.intersectObjects([...pickables,...netInspection.group.children].filter(visible), false);
    const mode = event.shiftKey&&!event.ctrlKey&&!event.metaKey?'object':options.getSelectionMode?.() || selectionMode;
    const hit = hits.find(hit=>selectableRecord(hit.object.userData.records?.[hit.instanceId] || hit.object.userData.record,mode));
    if (!hit) { if(clearOnMiss)clearSelection(); return; }
    const record = hit.object.userData.records?.[hit.instanceId] || hit.object.userData.record;
    if (!record) return;
    select(record, hit.point, hit.object, hit.instanceId,{individual:Boolean(event.shiftKey&&!event.ctrlKey&&!event.metaKey)});
  }
  let pointerInside=false;
  function netAtPointer(){
    if(!active||!pointerInside||measuring)return null;
    raycaster.setFromCamera(pointer,camera);
    const visible=item=>{for(let node=item;node;node=node.parent)if(!node.visible)return false;return true;};
    const hit=raycaster.intersectObjects([...pickables,...netInspection.group.children].filter(visible),false).find(hit=>selectableRecord(hit.object.userData.records?.[hit.instanceId]||hit.object.userData.record,'net'));
    return hit?(hit.object.userData.records?.[hit.instanceId]||hit.object.userData.record):null;
  }
  renderer.domElement.addEventListener('pointerleave',()=>{pointerInside=false;});
  let selectionMode = 'all';
  const hold = holdGesture(event => contextMenu(event));
  const gesture=selectionGesture({onPick:pick,onContextMenu:contextMenu,isHeld:()=>hold.isHeld()});
  const measurementTouchCapture=event=>{if(measuring&&event.pointerType==='touch'&&measurementPointers.size)controls.enabled=true;};renderer.domElement.addEventListener('pointerdown',measurementTouchCapture,true);
  renderer.domElement.addEventListener("pointerdown", (event) => { gesture.down(event); hold.down(event); menu.hidden = true;if(measuring&&event.pointerType==='touch'){measurementPointers.add(event.pointerId);measurementTouchDrag=measurementPointers.size===1?event.pointerId:null;controls.enabled=measurementPointers.size!==1;measurementTouch={x:event.clientX,y:event.clientY};invalidate();} });
  renderer.domElement.addEventListener("pointermove", event => {
    pointerInside=true;const rect=renderer.domElement.getBoundingClientRect();pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    gesture.move(event); hold.move(event);if(measuring&&event.pointerType==='touch'){measurementTouch={x:event.clientX,y:event.clientY};invalidate();}
    if (analysisOverlay && options.onAnalysisHover) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      options.onAnalysisHover(analysisOverlay.mesh.visible ? analysisOverlay.sample(raycaster.intersectObject(analysisOverlay.mesh, false)[0]) : null);
    }
  });
  renderer.domElement.addEventListener("pointercancel", event => { gesture.cancel(event); hold.up(event);measurementPointers.delete(event.pointerId);measurementTouchDrag=null;controls.enabled=true;measurementTouch=null;measurementLens.hidden=true; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    hold.up(event);gesture.up(event,{select:!(measuring&&event.pointerType==='touch')});
    if(measuring&&event.pointerType==='touch'){if(measurementTouchDrag===event.pointerId&&measurementPointers.size===1)pick(event);measurementPointers.delete(event.pointerId);measurementTouchDrag=null;controls.enabled=true;}measurementTouch=null;measurementLens.hidden=true;
  });
  function contextMenu(event) {
    event.preventDefault?.();if(measuring)return;pick(event,false); if (!selected) return;
    menu.replaceChildren();
    const actions = [["Focus object", () => { controls.target.copy(selected.point); controls.update(); }],
      ["Copy reference", () => navigator.clipboard.writeText(selected.record.ref || selected.record.name || "")]];
    if (typeof options.onInspect === "function") actions.unshift(["Properties", () => options.onInspect(selected.record)]);
    if (typeof options.onComment === "function") actions.push(["Comment on object", () => options.onComment(selected.record)]);
    for (const [label, handler] of actions) {
      const button = document.createElement("button"); button.textContent = label; button.type = "button";
      button.addEventListener("click", () => { handler(); menu.hidden = true; }); menu.append(button);
    }
    const rect = stage.getBoundingClientRect();
    menu.hidden = false;
    menu.style.maxWidth = "calc(100% - 16px)"; menu.style.maxHeight = "calc(100% - 16px)"; menu.style.overflowY = "auto";
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(event.clientX - rect.left, rect.width - bounds.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(event.clientY - rect.top, rect.height - bounds.height - 8))}px`;
  }
  renderer.domElement.addEventListener("contextmenu", event => {
    gesture.context(event);
  });
  const resize = sizeViewport;
  const observer = new ResizeObserver(resize); observer.observe(canvasHost); resize();
  let analysisOverlay = null;
  const layoutFrame = requestAnimationFrame(() => { if (active) { resize(); fit(); } });
  const projectAnchor=createAnchorProjector(THREE,{objects:()=>pickables,getCamera:()=>camera,rect:()=>renderer.domElement.getBoundingClientRect(),positionToWorld:(position,side)=>{const [x,y]=world([position.x,position.y]);return new THREE.Vector3(x,y,side==='back'?bottom+explode.offset('B.Cu'):top+explode.offset('F.Cu'));}});
  let activeAnchor=null,anchorSignature='',viewSignature='';
  function notifyAnchor(){if(!activeAnchor)return;const point=projectAnchor(activeAnchor),signature=JSON.stringify(point);if(signature!==anchorSignature){anchorSignature=signature;options.onAnchor?.({anchor:activeAnchor,point});}}
  function notifyView(){const rect=renderer.domElement.getBoundingClientRect(),signature=JSON.stringify([camera.matrixWorld.elements,camera.projectionMatrix.elements,rect.left,rect.top,rect.width,rect.height]);if(signature!==viewSignature){viewSignature=signature;options.onViewChange?.();}notifyAnchor();}
  function drawFrame(){frame=0;if(!active||contextLost)return;controls.update();updateMeasurementGraphics();updateTerminalLabels();
    let rendered=false;try{
      if(pipeline){pipeline.composer.render();const graphicsError=gl.getError();if(shaderFailure||graphicsError!==gl.NO_ERROR)throw Error(`Enhanced rendering failed (shader=${shaderFailure}, WebGL=${graphicsError}).`);}
      else renderer.render(scene,camera);
      renderCount++;rendered=true;
    }catch(error){
      console.warn('3D rendering fallback:',error?.message||String(error));
      if(pipeline){fallbackQuality('Enhanced rendering could not complete. Balanced rendering is active.');invalidate();}
      else graphicsNotice('The graphics device could not draw this view. Try Low quality or reopen 3D.');
    }
    if(rendered){drawMeasurementLens();notifyView();}
  }
  const onContextLost=event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;qualitySelect.disabled=true;graphicsNotice('The graphics context was interrupted. The board and selection are retained while the browser recovers.',true);};
  const onContextRestored=()=>{if(!active)return;contextLost=false;qualitySelect.disabled=false;disposePipeline();environment?.dispose();environment=createEnvironment();scene.environment=environment?.texture||null;renderer.shadowMap.needsUpdate=true;quality='balanced';qualitySelect.value=quality;host.dataset.quality=quality;applyLighting(lighting,false);graphicsNotice('Graphics restored. Balanced rendering is active; High quality can be selected again.');sizeViewport();invalidate();};
  renderer.domElement.addEventListener('webglcontextlost',onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored',onContextRestored);
  const closeVisibility=event=>{const path=event.composedPath();if(!path.includes(displayButton)&&!path.includes(visibilityOptions))setDisplayOpen(false);};
  const escapeVisibility=event=>{if(event.key==='Escape'&&!visibilityOptions.hidden){setDisplayOpen(false,true);event.preventDefault();event.stopImmediatePropagation();}};
  document.addEventListener('pointerdown',closeVisibility);shadow.addEventListener('keydown',escapeVisibility,true);
  applyQuality(initialQuality,false);
  const modelReady=loadRepositoryModels();
  void modelReady.catch(()=>{});
  async function captureMechanicalView(view='top') {
    if(!mechanical)throw new Error('Mechanical capture requires mount option mechanical:true.');
    if(!boardViewPresets.some(preset=>preset.id===view))throw new Error('Unsupported mechanical view preset.');
    if(!active||captureAbort.signal.aborted)throw new Error('Mechanical viewer is closed.');
    let timer,abort;
    try{await Promise.race([modelReady,new Promise((resolve,reject)=>{abort=()=>reject(new Error('Mechanical capture cancelled: viewer closed.'));captureAbort.signal.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>reject(new Error('Mechanical model loading timed out; no incomplete capture exported.')),45000);})]);}
    finally{clearTimeout(timer);if(abort)captureAbort.signal.removeEventListener('abort',abort);}
    if(!active||contextLost||captureAbort.signal.aborted)throw new Error('Mechanical graphics are unavailable or closed.');
    userAdjustedCamera=true;setSelection({});showTerminalLabels=false;terminalLabels.visible=false;measureGroup.visible=false;selectionGeometry.clear();analysisOverlay?.dispose();analysisOverlay=null;
    for(const {mesh}of visibilityRecords)mesh.visible=false;for(const group of copperGroups.values())group.visible=false;
    boardGroup.updateWorldMatrix(true,true);
    const bounds=new THREE.Box3(),temporary=new THREE.Box3();
    boardGroup.traverse(object=>{if(!object.geometry)return;for(let node=object;node;node=node.parent)if(!node.visible)return;
      if(object.isInstancedMesh){object.computeBoundingBox();if(object.boundingBox)bounds.union(temporary.copy(object.boundingBox).applyMatrix4(object.matrixWorld));}
      else{object.geometry.computeBoundingBox();if(object.geometry.boundingBox)bounds.union(temporary.copy(object.geometry.boundingBox).applyMatrix4(object.matrixWorld));}
    });
    if(bounds.isEmpty()||[...bounds.min.toArray(),...bounds.max.toArray()].some(value=>!Number.isFinite(value)||Math.abs(value)>1e6))throw new Error('No finite, bounded mechanical board or assembly geometry.');
    const preset=boardViewPreset(view),direction=new THREE.Vector3(...preset.direction).normalize(),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),distance=Math.max(1,size.length()*2);
    if(view==='top')direction.set(0,0,1);if(view==='bottom')direction.set(0,0,-1);
    const captureCamera=new THREE.OrthographicCamera(-1,1,1,-1,.01,distance*4);
    captureCamera.up.fromArray(view==='top'||view==='bottom'?[0,1,0]:preset.up);captureCamera.position.copy(center).addScaledVector(direction,distance);captureCamera.lookAt(center);captureCamera.updateMatrixWorld(true);
    const captureFrame=mechanicalCaptureFrame(bounds,captureCamera,canvasHost.clientWidth,canvasHost.clientHeight,{x:centerX,y:centerY}),{width:pixelWidth,height:pixelHeight,worldWidth,worldHeight}=captureFrame;
    captureCamera.left=-worldWidth/2;captureCamera.right=worldWidth/2;captureCamera.top=worldHeight/2;captureCamera.bottom=-worldHeight/2;captureCamera.updateProjectionMatrix();
    let image;
    try{renderer.setPixelRatio(1);renderer.setSize(pixelWidth,pixelHeight,false);renderer.shadowMap.needsUpdate=true;renderer.render(scene,captureCamera);image=renderer.domElement.toDataURL('image/png');}
    finally{if(active)sizeViewport();}
    if(!image?.startsWith('data:image/png'))throw new Error('Mechanical PNG capture failed.');
    const warnings=[...modelDiagnostics];if(loadedModelIndexes.size<board.components.length)warnings.push('Some component models are unavailable; saved-footprint stand-ins may be shown.');
    if(!board.stackup?.some(layer=>Number.isFinite(layer.thickness)))warnings.push('Saved stackup thickness is unavailable; the 3D substrate uses a 1.6 mm display fallback.');
    return {image,warnings,projection:'orthographic',view,width:pixelWidth,height:pixelHeight,mmPerPixel:worldHeight/pixelHeight,planar:view==='top',bounds:captureFrame.bounds,viewBounds:{left:-worldWidth/2,right:worldWidth/2,top:worldHeight/2,bottom:-worldHeight/2},mechanical:true};
  }
  return { host, board,ready:modelReady,captureMechanicalView,
    getProbeCount(){return probeRegistry.size();},
    createProbeViewport(probeHost,probeOptions={}){
      if(!active)throw Error('The parent 3D scene is closed.');
      return probeRegistry.create(()=>createSharedProbeViewport({THREE,OrbitControls,host:probeHost,source:boardGroup,sourceScene:scene,sourceRenderer:renderer,board,
        materialFor:object=>probeMaterials.get(object)||object.material,instanceColorFor:object=>probeInstanceColors.has(object)?probeInstanceColors.get(object):object.instanceColor,
        netInspectionSource:{board:{...board,tracks:refinedTracks.tracks},plan:copperPlan,zones:savedZones.records,sourceLimited:savedZones.truncated,pads:nativePads,world,colorForLayer:layerThreeColor},
        orthographic:Boolean(camera.isOrthographicCamera),explodeAmount:explode.get(),netHighlightColor,dark:host.dataset.theme!=='light',terminalSource,showNetNames:terminalAnnotations.getState().nets,showTerminalNumbers:terminalAnnotations.getState().numbers,...probeOptions}));
    },
    objectVisibilityCapabilities(){return {supportedTypes:[...objectVisibility.supportedTypes],unsupportedTypes:['graphics','texts','regions','dimensions','rooms','footprints']};},
    setObjectVisibility(input={}) {
      const next=objectVisibilityPolicy(input||{});
      if(next.side!==objectVisibility.side||JSON.stringify(next.hiddenTypes)!==JSON.stringify(objectVisibility.hiddenTypes))userAdjustedCamera=true;
      objectVisibility=next;
      for(const {mesh,type,layer}of visibilityRecords)mesh.visible=!mechanical&&objectVisibility.visible(type,layer);
      updateComponentVisibility();
      setSelection(externalSelection);
      return {hiddenTypes:[...objectVisibility.hiddenTypes],side:objectVisibility.side,supportedTypes:[...objectVisibility.supportedTypes],unsupportedTypes:[...objectVisibility.unsupportedTypes]};
    },
    setMeasurementMode,clearMeasurements,setTerminalLabels,setTerminalNumbers,getTerminalLabelState:()=>terminalAnnotations.getState(),
    measurementState(){return{mode:measuring,unit:measurementUnit,...measurementSession.snapshot()};},
    setQuality(value){return applyQuality(value);},
    getRenderStats(){const plan=qualityViewport(canvasHost.clientWidth,canvasHost.clientHeight,globalThis.devicePixelRatio,graphics.maxDimension,quality,graphics);return{...plan,graphicsTier:graphics.tier,defaultQuality:graphics.defaultQuality,maxDimension:graphics.maxDimension,antialias:gl.getContextAttributes()?.antialias===true,effectiveAntialias:pipeline?.fxaa?'fxaa':pipeline?'smaa':gl.getContextAttributes()?.antialias?'native-msaa':'none',postprocessSamples:pipeline?.composer.renderTarget1.samples||0,floatTargets:graphics.premium||renderer.extensions.has('EXT_color_buffer_float'),environmentLighting:Boolean(scene.environment),ambientOcclusion:Boolean(pipeline?.passes.some(pass=>pass instanceof GTAOPass&&pass.enabled)),lighting:lightingRig.state(),renderCount,contextLost,gpuTextures:renderer.info.memory.textures,drawCalls:renderer.info.render.calls,loadedModelCount:loadedModelIndexes.size,componentCount:board.components.length};},
    setAnalysisOverlay(surface) {
      if (!active) return { placed: false, reason: "3D viewer is closed." };
      if(mechanical)return {placed:false,reason:'Mechanical views exclude electrical result overlays.'};
      if (!surface) { analysisOverlay?.dispose(); analysisOverlay = null; invalidate();return { placed: false, reason: "Overlay cleared." }; }
      const basis = surface.zBasis;
      const savedLayer = surface.layer;
      if ((surface.zKnown && !["front-depth", "board-center"].includes(basis)) || (!surface.zKnown && !["F.Cu", "B.Cu"].includes(savedLayer))) return { placed: false, reason: "Saved result elevation basis or board layer is unknown; use the standalone result scene." };
      const transform = ([x, y, z]) => [x - centerX, centerY - y, surface.zKnown ? (basis === "front-depth" ? thickness / 2 - z : z) : (savedLayer === "F.Cu" ? thickness / 2 : -thickness / 2)];
      const next = createResultOverlay(surface, transform);
      // Internal copper/thermal layers must remain inspectable on the opaque PCB.
      // The result UI identifies this as showing the selected field through the board.
      next.mesh.material.depthTest = false; next.mesh.renderOrder = 20;
      analysisOverlay?.dispose(); analysisOverlay = next; scene.add(next.group);
      invalidate();
      return { placed: true, basis: surface.zKnown ? basis : savedLayer, flat: !surface.zKnown };
    },
    setAnalysisProbes(probes) { analysisOverlay?.setProbes(probes);invalidate(); },
    setAnalysisOpacity(value) { analysisOverlay?.setOpacity(value);invalidate(); },
    setSelection,
    setExplode,getExplode:()=>explode.get(),
    setOrthographic,isOrthographic:()=>Boolean(camera.isOrthographicCamera),
    projectAnchor,
    setAnchor(anchor){activeAnchor=anchor&&typeof anchor==='object'?anchor:null;anchorSignature='';if(activeAnchor)notifyAnchor();else options.onAnchor?.({anchor:null,point:null});},
    setNetHighlightColor(value){const next=value==='layer'?'layer':'accent';if(next===netHighlightColor)return;netHighlightColor=next;netInspection.setColorMode(next);probeRegistry.forEach(probe=>probe.setNetHighlightColor?.(next));setSelection(externalSelection);},
    setSelectionDim(enabled){selectionDim=Boolean(enabled);setSelection(externalSelection);return selectionDim;},
    selectionAppearanceCapabilities(){return {dim:true,instanceColors:true,desaturatesTextures:true,fullNet3d:true,internalCopper:true,viaSpans:true,translucentContext:true};},
    setLighting(value,{persist=true}={}){return applyLighting(value,persist);},
    getLightingState(){return lightingRig.state();},
    getNetInspectionState(){return netInspection.state();},
    setFullNet3D(enabled){fullNet3D=Boolean(enabled);setSelection(externalSelection);return fullNet3D;},
    setSelectionMode(mode){selectionMode=['all','part','net','pin'].includes(mode)?mode:'all';},
    focusPosition(position,{bounds,side='front'}={}){
      if(!active||![position?.x,position?.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1e6))return false;
      sizeViewport();const [x,y]=world([position.x,position.y]),target=new THREE.Vector3(x,y,side==='back'?bottom:top),direction=camera.position.clone().sub(controls.target);
      if(direction.lengthSq()<1e-10)direction.set(.45,-.38,1);direction.normalize();direction.z=(side==='back'?-1:1)*Math.abs(direction.z||.3);direction.normalize();
      const w=Number.isFinite(bounds?.w)?Math.max(8,Math.min(1e6,bounds.w*1.3)):8,h=Number.isFinite(bounds?.h)?Math.max(8,Math.min(1e6,bounds.h*1.3)):8;
      const distance=boxFitDistance([w,h,thickness+4],direction.toArray(),45,camera.aspect,.8,camera.up.toArray());if(!distance)return false;
      userAdjustedCamera=true;controls.maxDistance=Math.max(controls.maxDistance,distance*2);camera.position.copy(target).addScaledVector(direction,Math.max(controls.minDistance,distance));controls.target.copy(target);controls.update();updateClipping();invalidate();return true;
    },
    fit(topView=false){if(active)fit(topView);},
    netAtPointer,
    rotate(degrees=15){if(!active||!Number.isFinite(degrees))return false;userAdjustedCamera=true;const offset=camera.position.clone().sub(controls.target).applyAxisAngle(camera.up,degrees*Math.PI/180);camera.position.copy(controls.target).add(offset);controls.update();updateClipping();invalidate();return true;},
    flip(){if(!active)return false;userAdjustedCamera=true;const offset=camera.position.clone().sub(controls.target);camera.position.copy(controls.target).sub(offset);controls.update();updateClipping();invalidate();return true;},
    setView(view){if(!active||!boardViewPresets.some(preset=>preset.id===view))return false;userAdjustedCamera=true;fit(view);return true;},
    zoom(factor){if(!active||!Number.isFinite(factor)||factor<=0)return;const offset=camera.position.clone().sub(controls.target);const distance=Math.max(controls.minDistance,Math.min(controls.maxDistance,offset.length()/factor));if(offset.length()>0)camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();},
    setTheme(dark) {
      if (!active) return;
      host.dataset.theme = dark ? "dark" : "light";
      scene.background.setHex(dark ? 0x151820 : mechanical ? 0xffffff : 0xe7ebf1);
      selectionGeometry.setTheme(dark);
      resize();
      invalidate();
    },
    selectReference(reference) {
      const index = componentIndexes.get(reference);
      if (index == null || !componentMesh || !componentMatrices[index] || !active || !population[index]) return false;
      const model = modelGroups.get(index);
      if (model?.children.length) {
        const record = board.components[index];
        const [x, y] = world(record.at);
        select(record, new THREE.Vector3(x, y, record.layer?.startsWith("B.") ? bottom : top), model);
        return true;
      }
      const current = new THREE.Matrix4(); componentMesh.getMatrixAt(index, current);
      if (current.determinant() === 0) return false;
      const record = board.components[index];
      const [x, y] = world(record.at);
      const point = new THREE.Vector3(x, y, record.layer?.startsWith("B.") ? bottom - 1.1 : top + 1.1);
      componentMesh.localToWorld(point);
      select(record, point, componentMesh, index);
      return true;
    },
    setPopulation(entries) {
      if (!componentMesh || !active) return;
      population = populationMask(board.components, entries);
      updateComponentVisibility();
      setSelection(externalSelection);
      if (selected?.record?.ref) {
        const index = componentIndexes.get(selected.record.ref);
        if (index != null && !population[index]) clearSelection();
      }
    },
    dispose() { probeRegistry.dispose();terminalAnnotations.dispose();if(measuring)options.onMeasurementMode?.(false);active = false;captureAbort.abort(); analysisOverlay?.dispose(); stepClient?.dispose(); cancelAnimationFrame(frame); cancelAnimationFrame(layoutFrame);cancelAnimationFrame(explodeFrame); observer.disconnect();controls.removeEventListener('change',invalidate); controls.removeEventListener("change", updateClipping); controls.removeEventListener("start", cameraInteraction); controls.dispose();disposePipeline();lightingRig.dispose();environment?.dispose();renderer.domElement.removeEventListener('webglcontextlost',onContextLost);renderer.domElement.removeEventListener('webglcontextrestored',onContextRestored);document.removeEventListener('pointerdown',closeVisibility);shadow.removeEventListener('keydown',escapeVisibility,true);shadow.removeEventListener('keydown',escapeMeasurement);
    renderer.domElement.removeEventListener('pointerdown',measurementTouchCapture,true);netInspection.dispose();selectionGeometry.dispose();selectionAppearance.dispose();const resources = new Set(); scene.traverse((object) => {object.shadow?.dispose?.(); if (object.geometry) resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      materials.forEach((item) => resources.add(item)); }); resources.forEach((item) => item.dispose());hold.dispose(); renderer.dispose(); host.remove(); } };
}
