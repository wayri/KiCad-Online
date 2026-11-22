import {createLayerInspection} from './layerInspection.mjs';
import {createSelectionGeometry} from './selectionGeometry.mjs';
import * as THREE from "three";
import { Earcut } from "three/src/extras/Earcut.js";
import {savedZoneBufferGeometry} from "./zoneGeometry.mjs";
import {createSharedGeometryCache} from './sharedGeometry.mjs';
import {createModelTemplateCache} from './modelTemplates.mjs';
import {createSceneResources} from './sceneResources.mjs';
import {createGraphicsHealth} from './graphicsHealth.mjs';
import {createModelGraphBudget,modelDecodeConcurrency,preflightModelGLB} from './modelGraphBudget.mjs';
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
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import "../design-diff.js";
import "../repo-models.js";
import fzstd from "../vendor/fzstd/fzstd.js";
import padLabels from "../pad-labels.js";
import "../embedded-models.js";
import "../step-decoder.js";
import { parseKicadBoard } from "@spike/boardParser";
import "../layer-colors.js";
import "../file-compatibility.js";
import "../worksheet.js";
import "../pcb-renderer.js";
import "../owned-canvas.js";
import {makeSilkscreen,updateSubstrateMaterials} from "./boardSurface.mjs";
const layerThreeColor = name => Number.parseInt(globalThis.KiCadLayerColors.hexFor(name).slice(1), 16);
import { viewportSceneIdentity } from "@spike/viewportScenePolicy";
import { populationMask, uniqueComponentIndexes } from "./componentState.mjs";
import { footprintProxies } from "./footprintProxies.mjs";
import {createAnchorProjector} from "./projectAnchor.mjs";
import {sourceCopperPlan} from "./copperStack.mjs";
import {createNetInspection} from "./netInspection.mjs";
import {createSelectionAppearance} from "./selectionAppearance.mjs";
import { createExplodeView } from './explodeView.mjs';
import { selectionMatcher, selectionNetNames, pickSavedGeometry, selectionGesture, holdGesture } from "./selectionState.mjs";
import { sphereFitDistance,boxFitDistance } from "./fitPolicy.mjs";
import { qualityName, qualityViewport, graphicsProfile, boardOcclusion, boardClipRange, configureOcclusionDepth, studioMaterials, padHasMaskOpening, physicalColors, copperDepthPolicy, copperCapMaterials, configureCopperDepth, createLinearCopperMaterials } from "./renderQuality.mjs";
import { createResultOverlay } from "./result3d.js";
import { createSourceZoneIndex,drillLoopInsideBoard,boardRimGeometry } from "./sourceGeometry.mjs";
import { padSourceDetails } from "./padGeometry.mjs";
import {sourceSelectionRecords} from './sourceSelection.mjs';
import {drillWallGeometry,copperStrokeBatches,smoothPadOutline,smoothDrillOutline,outerCopperPlacement,zoneSurfaceZ,substrateEnvelope,refineCopperTracks} from './copperGeometry.mjs';
import {createProbeRegistry,createSharedProbeViewport} from './probeViewport.mjs';
import {createTerminalAnnotations,createTerminalLabelController} from './terminalLabels.mjs';
import { MeasurementSession,distanceLabel,snapProjectedEdges } from "./measurement3d.mjs";
import {projectionCamera,resizeProjection,fitProjection} from "./cameraProjection.mjs";
import {createDCCopperViewport,dcBoardLayerZ,dcBoardLayerOverlay} from "./dcCopperViewport.mjs";
import {mountCompactToolbar} from "./toolbarLayout.mjs";
import { boardViewPresets,boardViewPreset } from "./viewPresets.mjs";
export { mountResultScene } from "./result3d.js";

const STYLE = `
.explode-control{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px}.explode-control input{width:90px;min-width:60px;accent-color:#68b6ec}.explode-control output{min-width:32px;font-variant-numeric:tabular-nums}.explode-control[hidden]{display:none}
.bar .secondary-tools{display:contents}.bar button[hidden],.bar .secondary-tools[hidden]{display:none}
:host([data-compact="true"]) .bar{position:relative;z-index:8;gap:3px;padding-inline:6px}
:host([data-compact="true"]) .bar .title,:host([data-compact="true"]) .bar .detail,:host([data-compact="true"]) .bar .divider{display:none}
:host([data-compact="true"]) .bar .secondary-tools:not([hidden]){position:absolute;top:calc(100% + 3px);right:6px;width:min(260px,calc(100% - 12px));max-height:min(320px,calc(100vh - 70px));overflow:auto;display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:8px;background:var(--menu);border:1px solid var(--border);border-radius:7px;box-shadow:0 8px 24px #0005}
:host([data-compact="true"]) .bar .secondary-tools button{justify-content:flex-start;background:var(--button);border-color:var(--button-border)}
:host([data-compact="true"]) .bar .secondary-tools .explode-control{display:flex;min-height:34px;justify-content:space-between;width:100%}
:host([data-compact="true"]) .bar .secondary-tools .explode-control input{min-width:50px;flex:1}

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
  :host([data-measuring=true]) .canvas canvas{cursor:crosshair}
  .snap-target{position:absolute;z-index:5;pointer-events:none;width:16px;height:16px;transform:translate(-50%,-50%);border:2px solid #65e6ff;border-radius:50%;box-shadow:0 0 0 1px #15202a}
  .snap-target[data-kind="surface"]{width:9px;height:9px;border-color:#ffdc88}
  .snap-target[data-kind="mesh vertex"]{border-radius:2px}
  .snap-target[hidden]{display:none}
  @media(max-width:700px){.detail{display:none}.bar{gap:4px;padding-inline:6px}.hint{display:none}.inspector{width:min(260px,65%)}}@media(max-width:380px){.title{display:none}.bar{gap:2px}.bar button{padding-inline:5px}.view-select{max-width:90px}}
  @media(pointer:coarse){button,select{min-height:40px}.bar{min-height:50px}.visibility-options label{min-height:32px}}
`;

// The scene filter changes visibility only; saved geometry and cameras stay intact.
export function objectVisibilityPolicy(input = {}) {
  const supportedTypes = ['arcs','pads','vias','tracks','fills','polygons','bodies','silkscreen'];
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
  const sourceAST=globalThis.KiCadDesignDiff.parse(source,{compactCopper:true}),savedZones=createSourceZoneIndex(sourceAST),zoneSourceStats=savedZones.stats();
  const board = parseKicadBoard(source,sourceAST,{zonePoints:false});
  const sourceRecords=sourceSelectionRecords(sourceAST,board,globalThis.KiCadPCBRenderer?.firstCopperPadNumber);board.components=sourceRecords.components;
  const padDetails=padSourceDetails(sourceAST),nativePads=sourceRecords.pads.map(pad=>({...pad,...padDetails.get(pad.uuid||pad.id)}));board.pads=nativePads;
  const geometryDiagnostics=[],zoneBuffers=[];
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
  function setDisplayOpen(open,restoreFocus=false){visibilityOptions.hidden=!open;displayButton.setAttribute('aria-expanded',String(open));if(restoreFocus)(compactToolbar.compact?moreButton:displayButton).focus();}
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
  const sharedPadGeometry=createSharedGeometryCache();
  const padExtrusion=(outline,thickness)=>sharedPadGeometry.get(
    JSON.stringify([outline.outline,outline.drill||null,thickness]),
    ()=>new THREE.ExtrudeGeometry(padShape(outline),{depth:thickness,bevelEnabled:false,curveSegments:8})
  );
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
  const renderer = new THREE.WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, alpha: false, powerPreference: "high-performance" });
  const gl=renderer.getContext(),graphics=graphicsProfile({maxTextureSize:renderer.capabilities.maxTextureSize,maxRenderbufferSize:gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),deviceMemory:globalThis.navigator?.deviceMemory,hardwareConcurrency:globalThis.navigator?.hardwareConcurrency,floatTargets:renderer.extensions.has('EXT_color_buffer_float'),android:/Android/i.test(globalThis.navigator?.userAgent||'')});
  const zoneBudget=(graphics.constrained?32:64)*1024*1024;
  const zoneStats={budgetBytes:zoneBudget,retainedBytes:0,renderedContours:0,vertices:0,rejected:0};
  const graphicsHealth=createGraphicsHealth(gl);
  const modelResources=createSceneResources({onChange:graphicsHealth.invalidate});
  const modelGeometryBudget=(graphics.constrained?32:graphics.premium?96:64)*1024*1024;
  const modelTextureBudget=(graphics.constrained?16:graphics.premium?64:32)*1024*1024;
  const modelGraph=createModelGraphBudget(graphics.constrained?8192:32768);
  const decodeConcurrency=modelDecodeConcurrency(graphics.constrained,board.components.length);
  if(!savedQuality&&!options.quality)initialQuality=graphics.defaultQuality;
  let active=true,frame=0,contextLost=false,renderCount=0,pipeline=null,quality=initialQuality,shaderFailure=false;
  function invalidate(){if(!active||contextLost||frame)return;frame=requestAnimationFrame(drawFrame);}
  function graphicsNotice(message,retry=false){qualityNotice.replaceChildren(document.createTextNode(message));qualityNotice.hidden=false;
    const close=document.createElement('button');close.type='button';close.textContent='Dismiss';close.onclick=()=>{qualityNotice.hidden=true;};qualityNotice.append(close);
    if(retry){const button=document.createElement('button');button.type='button';button.textContent='Retry graphics';button.onclick=()=>renderer.forceContextRestore();qualityNotice.append(button);}
  }
  function disposePipeline(){if(!pipeline)return;for(const pass of pipeline.passes){pass.dispose?.();if(pass instanceof GTAOPass){pass.gtaoMaterial.dispose();pass.blendMaterial.dispose();pass.depthTexture?.dispose();}}pipeline.composer.dispose();pipeline=null;}
  function createPipeline(){
    disposePipeline();graphicsHealth.invalidate();if(quality==='low')return;
    const enhanced=quality==='high',floatTargets=renderer.extensions.has('EXT_color_buffer_float');
    if(enhanced&&!floatTargets)throw Error('Floating-point render targets are unavailable.');
    const target=new THREE.WebGLRenderTarget(1,1,{type:floatTargets?THREE.HalfFloatType:THREE.UnsignedByteType,depthBuffer:true,stencilBuffer:false,samples:0});
    const composer=new EffectComposer(renderer,target),passes=[];pipeline={composer,passes};
    const base=new RenderPass(scene,camera);passes.push(base);
    if(enhanced){const ao=new GTAOPass(scene,camera,1,1,undefined,boardOcclusion(thickness));
      configureOcclusionDepth(ao.normalMaterial);
      ao.enabled=lighting!=='universal';ao.blendIntensity=.65;ao.updatePdMaterial({radius:4,rings:2,samples:12});
      const inheritedVisibility=ao.overrideVisibility.bind(ao);ao.overrideVisibility=()=>{inheritedVisibility();scene.traverse(object=>{const materials=Array.isArray(object.material)?object.material:[object.material];if(materials.some(material=>material&&(material.transparent||material.depthTest===false)))object.visible=false;});};
      passes.push(ao);
    }
    const output=new OutputPass(),smaa=new SMAAPass(1,1);
    for(const texture of [smaa.areaTexture,smaa.searchTexture])texture.image?.addEventListener?.('load',()=>{graphicsHealth.invalidate();invalidate();},{once:true});
    passes.push(output,smaa);for(const pass of passes)composer.addPass(pass);
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
  let userAdjustedCamera = false,cameraMoving=false;
  const cameraInteraction = () => { userAdjustedCamera=true;cameraMoving=true;invalidate(); };
  const cameraInteractionEnd = () => { cameraMoving=false;invalidate(); };
  controls.addEventListener("start", cameraInteraction);
  controls.addEventListener("end", cameraInteractionEnd);
  controls.addEventListener('change',invalidate);
  controls.enableDamping = true; controls.dampingFactor = 0.1; controls.screenSpacePanning = true;
  controls.minDistance = .1; controls.maxDistance = extent * 8;
  const lightingRig=createBoardLighting(THREE,{scene,renderer,extent});
  function applyLighting(value,persist=true){graphicsHealth.invalidate();lighting=lightingName(value);lightingSelect.value=lighting;host.dataset.lighting=lighting;const state=lightingRig.set(lighting,quality);
    for(const pass of pipeline?.passes||[])if(pass instanceof GTAOPass)pass.enabled=state.occlusion;
    if(persist)try{localStorage.setItem(lightingKey,lighting);}catch{}
    invalidate();return state;
  }
  lightingSelect.onchange=()=>applyLighting(lightingSelect.value);
  applyLighting(lighting,false);
  const boardGroup = new THREE.Group(); scene.add(boardGroup);
  const probeCopperMaterials=createLinearCopperMaterials();
  const probeRegistry=createProbeRegistry(2),probeMaterials=new WeakMap(),probeInstanceColors=new WeakMap();
  function rememberProbeResources(group){group.traverse(object=>{if(object.material&&!probeMaterials.has(object))probeMaterials.set(object,object.material);if(object.isInstancedMesh&&!probeInstanceColors.has(object))probeInstanceColors.set(object,object.instanceColor);});}
  const copperGroups = new Map(), pickables = [];
  const explode=createExplodeView(THREE,copperPlan),viaExplode=[],layerInspection=createLayerInspection(copperPlan.layers.map(layer=>layer.name));
  let objectVisibility=objectVisibilityPolicy();
  const visibilityRecords=[],measurementCategories=new WeakMap();
  const visibilityRecord=(mesh,type,layer)=>{visibilityRecords.push({mesh,type,layer});measurementCategories.set(mesh,type==='arcs'?'tracks':type);mesh.visible=!mechanical&&objectVisibility.visible(type,layer);return mesh;};
  const arcIds=new Set(sourceAST.filter(node=>Array.isArray(node)&&node[0]==='arc').map(node=>{const id=node.find(value=>Array.isArray(value)&&['uuid','tstamp'].includes(value[0]))?.[1];return typeof id==='object'?id?.quoted:id;}).filter(Boolean));
  const isArc=track=>arcIds.has(track.id)||arcIds.has(track.id?.replace(/:\d+$/,''))||/^track-\d+:\d+$/.test(track.id||'');
  const appearanceRecords=[];let realistic=true,selectionAppearanceReady=false;
  let showPinOneMarkers=options.showPinOneMarkers!==false;
  const pinOneColor=globalThis.KiCadPCBRenderer?.pinOneColor;
  const appearanceLabel=document.createElement('label');appearanceLabel.append(document.createTextNode('Appearance'));
  const appearanceSelect=document.createElement('select');appearanceSelect.setAttribute('aria-label','3D board appearance');
  for(const [value,label]of [['realistic','Realistic'],['layers','Layer colors']]){const option=document.createElement('option');option.value=value;option.textContent=label;appearanceSelect.append(option);}appearanceLabel.append(appearanceSelect);
  const qualityHelp=document.createElement('p');qualityHelp.className='quality-help';qualityHelp.textContent='Sharp prioritizes crisp copper and model edges without ambient occlusion. High adds Studio ambient occlusion at a lower pixel budget. Universal evenly lights both faces and edges without shadows. Linked model availability is shown below the viewport.';const qualityStats=document.createElement('small');qualityStats.setAttribute('aria-label','3D render sampling');qualityStats.className='quality-help';renderingOptions.append(appearanceLabel,qualityLabel,lightingLabel,qualityHelp,qualityStats);
  function applyAppearance(){if(selectionAppearanceReady)selectionAppearance.restore();const useRealistic=realistic&&explode.get()===0&&!layerInspection.get();for(const record of appearanceRecords){const {mesh,role,layer}=record;
    const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
    if(role==='pads'){for(const material of materials)material.color.setHex(0xffffff);record.pads.forEach((pad,index)=>mesh.setColorAt(index,new THREE.Color(showPinOneMarkers&&pad.pinOne&&pinOneColor?pinOneColor:useRealistic?(padHasMaskOpening(pad,layer)?physicalColors.exposedCopper:physicalColors.coatedCopper):layerThreeColor(layer))));if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;}
    else for(const material of materials)material.color.setHex(useRealistic?physicalColors.coatedCopper:layerThreeColor(layer));
    for(const material of materials){material.metalness=useRealistic&&role!=='pads'?.08:studioMaterials.copper.metalness;material.roughness=useRealistic&&role!=='pads'?.52:studioMaterials.copper.roughness;}
  }probeCopperMaterials.sync();if(selectionAppearanceReady)setSelection(externalSelection);invalidate();}
  appearanceSelect.onchange=()=>{realistic=appearanceSelect.value==='realistic';applyAppearance();};
  const groupFor = (layer) => {
    if (!copperGroups.has(layer)) { const group = new THREE.Group(); group.name = layer; boardGroup.add(group); copperGroups.set(layer, group); group.visible=!mechanical; }
    return copperGroups.get(layer);
  };
  let silkscreen=[],silkRefreshTimer=null;
  const refinedTracks=mechanical?{tracks:[],warnings:[]}:refineCopperTracks(board.tracks,sourceAST);geometryDiagnostics.push(...refinedTracks.warnings);
  const substratePose=substrateEnvelope(thickness,copperPlan.byLayer);
  if(substratePose.missingOuterDepths)geometryDiagnostics.push('Outer copper inner-face depths are incomplete; missing substrate faces use the nominal board envelope.');
  const shape = boardShape(board, world);
  // Saved pad/via drill loops cut the substrate itself; NPTH does not need a
  // copper annulus. Cap triangulation work and disclose omissions explicitly.
  const drilled=new Set(),acceptedDrills=[];let drillCount=0,drillPoints=0,omittedDrills=0;
  const inside=(point,loop)=>{let result=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const [a,b]=[loop[i],loop[j]];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;};
  const outer=board.outlineLoops?.[0],outlineHoles=board.outlineLoops?.slice(1)||[];
  for(const item of [...nativePads,...(mechanical?[]:board.vias.filter(via=>copperPlan.viaSpans.get(via.id)?.through).map(via=>({...via,shape:'circle',width:via.size,height:via.size,drillShape:'circle',rotation:0})))]){
    if(!(item.drill>0))continue;const loop=smoothDrillOutline(item);if(!loop){omittedDrills++;continue;}
    const angle=(item.rotation||0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),[cx,cy]=world(item.at);
    if(outlineHoles.some(hole=>inside(item.at,hole)))continue;
    const points=loop.map(([x,y])=>[cx+x*c+y*s,cy+x*s-y*c]);
    const key=JSON.stringify(points.map(point=>point.map(value=>Math.round(value*10000)/10000)));if(drilled.has(key))continue;
    if(drillCount>=1024||drillPoints+points.length>100000||!outer){omittedDrills++;continue;}
    const saved=points.map(([x,y])=>[x+centerX,centerY-y]),xs=saved.map(p=>p[0]),ys=saved.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const nearby=acceptedDrills.filter(d=>d.maxX>=minX-1e-8&&d.minX<=maxX+1e-8&&d.maxY>=minY-1e-8&&d.minY<=maxY+1e-8);
    if(!drillLoopInsideBoard(saved,outer,[...outlineHoles,...nearby.map(d=>d.loop)])){omittedDrills++;continue;}
    acceptedDrills.push({loop:saved,minX,maxX,minY,maxY});
    drilled.add(key);drillCount++;drillPoints+=points.length;shape.holes.push(pathFor(points,point=>point));
  }
  if(omittedDrills)geometryDiagnostics.push(`${omittedDrills} drill loops were omitted because they overlap another cut, cross the board boundary, or exceed the triangulation budget.`);
  const substrate = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: substratePose.depth, bevelEnabled: false, curveSegments: 8 }),
    [new THREE.MeshPhysicalMaterial(studioMaterials.solderMask),
      new THREE.MeshStandardMaterial(studioMaterials.substrateEdge)]);
  const substrateMaterials=substrate.material;
  substrate.position.z = substratePose.bottom;
  substrate.receiveShadow = true;
  substrate.userData.record = { type: "Board", name: "Substrate", layer: "Edge.Cuts", id: "board" };
  substrate.userData.identity = viewportSceneIdentity("substrate", "Edge.Cuts", "board");
  boardGroup.add(substrate); pickables.push(substrate);
  const edges = new THREE.LineSegments(boardRimGeometry(THREE,shape,substratePose.depth),
    new THREE.LineBasicMaterial({ color: 0x9bb7ac, transparent: true, opacity: .42 }));
  edges.position.z = substratePose.bottom; boardGroup.add(edges);

  if(!mechanical){
  try {
    const silk=globalThis.KiCadPCBRenderer.build(sourceAST,options.path||"",{silkscreenOnly:true});
    silkscreen=makeSilkscreen(THREE,silk.primitives,board.bounds,copperPlan.byLayer,thickness,geometryDiagnostics,renderer.capabilities.getMaxAnisotropy());
    for(const {mesh,layer} of silkscreen){groupFor(layer).add(mesh);visibilityRecord(mesh,"silkscreen",layer);}
    if(silkscreen.length)geometryDiagnostics.push('Silkscreen uses saved board and footprint graphics. Text uses browser font metrics. Close views use a higher-density crop of the visible artwork.');
    for(const warning of silk.warnings.filter(w=>w.includes("not drawn exactly")))geometryDiagnostics.push(warning);
  } catch(error){geometryDiagnostics.push("Saved silkscreen could not be rendered: "+error.message);}
  for (const {name:layer} of copperPlan.layers) {
    const color=layerThreeColor(layer);
    const saved=copperPlan.byLayer.get(layer),placement=['F.Cu','B.Cu'].includes(layer)?outerCopperPlacement(layer,thickness,saved?.thickness||.035,saved?.z):{center:saved.z,base:saved.z-saved.thickness/2,thickness:saved.thickness},z=placement.center;
    for(const category of ['tracks','arcs']){
    const candidates=refinedTracks.tracks.filter(item=>item.layer===layer&&(isArc(item)?'arcs':'tracks')===category),stroke=copperStrokeBatches(THREE,candidates,{world,z,thickness:placement.thickness});
    if(stroke.invalid)geometryDiagnostics.push(`${layer}: invalid saved track widths or positions omitted.`);
    if(stroke.plan?.limited)geometryDiagnostics.push(`${layer}: large track caps exceed the ${stroke.plan.tolerance} mm tessellation tolerance at the 128-segment display limit.`);
    const trackMaterial=configureCopperDepth(new THREE.MeshStandardMaterial({color,...studioMaterials.copper}),'track');
    for(const batch of stroke.batches){const mesh=makeInstanced(groupFor(layer),batch.geometry,trackMaterial,batch.records,batch.place,viewportSceneIdentity('copper-track',layer,category+'-'+batch.part));if(mesh){visibilityRecord(mesh,category,layer);pickables.push(mesh);appearanceRecords.push({mesh,role:'tracks',layer});}}
    if(!stroke.batches.length)trackMaterial.dispose();
    }
    const pads = nativePads.filter(item=>item.nativeType!=='np_thru_hole'&&
      (item.layer===layer||item.layers?.includes(layer)||item.layers?.includes('*.Cu')||
       item.layers?.includes('F&B.Cu')&&['F.Cu','B.Cu'].includes(layer)));
    const batches=new Map();let omittedPads=0;
    for(const pad of pads){const key=JSON.stringify([pad.shape,pad.width,pad.height,pad.roundrectRatio,pad.drill,pad.drillShape,pad.drillWidth,pad.drillHeight,pad.drillOffset,pad.customAnchor,pad.customPrimitives]);if(!batches.has(key)){const outline=smoothPadOutline(pad);if(!outline||batches.size>=256){omittedPads++;continue;}if(outline.tessellation.limited)geometryDiagnostics.push(`${layer}: a pad contour retains validated geometry because the 0.0025 mm tolerance could not be met within hole-containment/display limits.`);batches.set(key,{outline,pads:[]});}batches.get(key).pads.push(pad);}
    if(omittedPads)geometryDiagnostics.push(`${layer}: ${omittedPads} unsupported/ambiguous pad shapes omitted; no rectangular stand-ins were substituted.`);
    const padMaterial=batches.size?copperCapMaterials(THREE,'pad',{color:0xffffff,...studioMaterials.copper},{logarithmicDepth:true}):null;
    for(const [key,batch]of batches){const geometry=padExtrusion(batch.outline,placement.thickness);
      const padMesh=makeInstanced(groupFor(layer),geometry,padMaterial,batch.pads,(object,pad)=>{const[x,y]=world(pad.at);object.position.set(x,y,placement.base);object.rotation.z=(pad.rotation||0)*Math.PI/180;},viewportSceneIdentity('copper-pad',layer,key));
      if(padMesh){visibilityRecord(padMesh,'pads',layer);pickables.push(padMesh);appearanceRecords.push({mesh:padMesh,role:'pads',layer,pads:batch.pads});}
    }
    for(const zone of savedZones.forLayer(layer)){
      const record={id:zone.id,contour:zone.contour,layer,net:zone.net,filled:zone.filled,type:zone.filled?'Zone':'Zone boundary'};
      const depth=zone.filled?(['F.Cu','B.Cu'].includes(layer)?zoneSurfaceZ(layer,placement):placement.center):z;
      let geometry;
      try{
        const built=savedZoneBufferGeometry(THREE,zone,{world,triangulate:Earcut.triangulate,maxBytes:zoneBudget-zoneStats.retainedBytes});
        geometry=built.geometry;
        zoneStats.retainedBytes+=built.bytes;zoneStats.renderedContours++;zoneStats.vertices+=built.vertices;
      }catch(error){
        zoneStats.rejected++;
        zoneBuffers.push({record,geometry:null,depth});
        if(zoneStats.rejected<=16)geometryDiagnostics.push(`${layer}: saved zone ${zone.id} contour ${zone.contour}: ${error.message}`);
        continue;
      }
      zoneBuffers.push({record,geometry,depth});
      const mesh=zone.filled?new THREE.Mesh(geometry,
        configureCopperDepth(new THREE.MeshStandardMaterial({color,...studioMaterials.copper,side:THREE.DoubleSide,depthWrite:true}),'zone')):
        new THREE.LineLoop(geometry,new THREE.LineBasicMaterial({color:layerThreeColor(layer),transparent:true,opacity:.6}));
      mesh.position.z=depth;mesh.userData.record=record;groupFor(layer).add(mesh);
      visibilityRecord(mesh,zone.filled?'fills':'polygons',layer);
      if(zone.filled){pickables.push(mesh);appearanceRecords.push({mesh,role:'zone',layer});}
    }
  }
  const viaBatches=new Map();let omittedVias=0;
  for(const via of board.vias){const span=copperPlan.viaSpans.get(via.id),outline=smoothPadOutline({shape:'circle',width:via.size,height:via.size,drill:via.drill,drillShape:'circle'});if(!outline||!span){omittedVias++;continue;}const key=JSON.stringify([via.size,via.drill,span.zMin,span.zMax]);if(!viaBatches.has(key)){if(viaBatches.size>=128){omittedVias++;continue;}viaBatches.set(key,{outline,span,vias:[]});}viaBatches.get(key).vias.push(via);}
  if(omittedVias)geometryDiagnostics.push(`${omittedVias} via bodies with unsupported annuli or unknown saved spans omitted.`);
  const viaMaterial=new THREE.MeshStandardMaterial({color:physicalColors.exposedCopper,...studioMaterials.copper,...copperDepthPolicy('via','wall')});
  for(const[key,batch]of viaBatches){const geometry=drillWallGeometry(THREE,smoothDrillOutline({drill:batch.vias[0].drill,drillShape:'circle'}),batch.span.zMax-batch.span.zMin);
    const wallMaterial=viaMaterial.clone();wallMaterial.side=THREE.DoubleSide;
    // Render the saved bore wall, not a solid annulus through the dielectric.
    const mesh=makeInstanced(boardGroup,geometry,wallMaterial,batch.vias,(object,via)=>{const[x,y]=world(via.at);object.position.set(x,y,batch.span.zMin);},viewportSceneIdentity('via-barrel',batch.span.from+'-'+batch.span.to,key));if(mesh){visibilityRecord(mesh,'vias',batch.span.through?'through':batch.span.from+'-'+batch.span.to);pickables.push(mesh);viaExplode.push({mesh,span:batch.span});}}
  geometryDiagnostics.push('Outer copper uses saved plan centers/thickness (or the disclosed stackup fallback) with a 0.001 mm outward display offset; the substrate spans the outer copper inner faces. Saved zone fills are opaque zero-height display films inset by the smaller of 0.005 mm or one quarter of the copper thickness. Via bodies show the saved drill wall; plating thickness is not inferred.');
  const viaCapMaterial=viaBatches.size?copperCapMaterials(THREE,'via',{color:physicalColors.exposedCopper,...studioMaterials.copper},{logarithmicDepth:true}):null;
  // Annuli follow only saved span endpoints, including blind/buried inner layers.
  for(const {name:layer} of copperPlan.layers)for(const [key,batch]of viaBatches){
    if(batch.span.from!==layer&&batch.span.to!==layer)continue;
    const saved=copperPlan.byLayer.get(layer),placement=['F.Cu','B.Cu'].includes(layer)?outerCopperPlacement(layer,thickness,saved.thickness,saved.z):{base:saved.z-saved.thickness/2,thickness:saved.thickness},geometry=padExtrusion(batch.outline,placement.thickness);
    const cap=makeInstanced(groupFor(layer),geometry,viaCapMaterial,batch.vias,(object,via)=>{const[x,y]=world(via.at);object.position.set(x,y,placement.base);},viewportSceneIdentity('via-annulus',layer,key));
    if(cap){visibilityRecord(cap,'vias',layer);pickables.push(cap);}
  }
  }
  const netInspectionSource={
    board:{...board,tracks:refinedTracks.tracks},plan:copperPlan,zones:zoneBuffers,
    sourceLimited:zoneSourceStats.omitted>0||zoneSourceStats.invalid>0,
    pads:mechanical?[]:nativePads,world,colorForLayer:layerThreeColor
  };
  const netInspection=createNetInspection(THREE,netInspectionSource);scene.add(netInspection.group);
  let dcProbeMode=false;
  const dcViewport=createDCCopperViewport(THREE,{
    canvas:renderer.domElement,getCamera:()=>camera,
    getCopperMeshes:()=>[
      ...pickables.filter(mesh=>copperGroups.get(mesh.parent?.name)===mesh.parent).map(mesh=>({mesh,layer:mesh.parent.name})),
      ...netInspection.group.children.filter(mesh=>mesh.isMesh&&!mesh.userData.explodeSpan).map(mesh=>({mesh,layer:mesh.userData.layer||mesh.userData.record?.layer}))
    ],
    getLayerZ:layer=>dcBoardLayerZ(copperPlan.byLayer,explode,layer),
    centerX,centerY,isActive:()=>active&&!contextLost&&!mechanical
  });
  dcViewport.setProbeMode=enabled=>{dcProbeMode=active&&!mechanical&&Boolean(enabled);return dcProbeMode;};
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
  if(componentMesh){componentMesh.userData.footprintStandIns=true;pickables.push(componentMesh);}
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
  function updateComponentVisibility(changedIndex) {
    const matrix=new THREE.Matrix4();
    const indexes=Number.isInteger(changedIndex)?[changedIndex]:board.components.map((_,index)=>index);
    for(const index of indexes){const part=board.components[index];matrix.copy(componentMatrices[index]);matrix.elements[14]+=explode.componentOffset(part.layer?.startsWith('B.')?'back':'front');componentMesh?.setMatrixAt(index,
      population[index]&&objectVisibility.visible('bodies',part.layer)&&!loadedModelIndexes.has(index)?matrix:hiddenMatrix);}
    // Loading a real model only hides its stand-in; the existing sphere remains
    // a conservative bound until a full visibility or explode update.
    if (componentMesh) { componentMesh.instanceMatrix.needsUpdate = true; if(changedIndex===undefined)componentMesh.computeBoundingSphere(); }
    const visibleGroup=(index,group)=>{group.visible=population[index]&&objectVisibility.visible('bodies',board.components[index].layer);explode.component(group,board.components[index].layer?.startsWith('B.')?'back':'front');};
    if(changedIndex===undefined){for(const [index,group]of modelGroups)visibleGroup(index,group);}
    else {const group=modelGroups.get(changedIndex);if(group)visibleGroup(changedIndex,group);}
    renderer.shadowMap.needsUpdate=true;
    invalidate();
  }
  const modelDiagnostics = Array.isArray(options.assetWarnings)
    ? options.assetWarnings.filter(item => typeof item === "string").slice(0, 48).map(item => item.slice(0, 500)) : [];
  if(!mechanical&&zoneSourceStats.unfilled)modelDiagnostics.push(`${zoneSourceStats.unfilled} zones have no saved copper fill; only their boundaries are shown.`);
  if(!mechanical&&(zoneSourceStats.omitted||zoneSourceStats.invalid||zoneStats.rejected))modelDiagnostics.push(`Saved zones omitted: ${zoneSourceStats.omitted} beyond the contour index, ${zoneSourceStats.invalid} invalid and ${zoneStats.rejected} rejected during geometry creation.`);
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
  function modelWrappers(index){return modelGroups.has(index)?2:3;}
  function retainModel(root,index){
    try{
      modelGraph.checkTemplate(root,modelWrappers(index));
      return modelResources.retain(root,modelGeometryBudget,modelTextureBudget);
    }catch(error){
      modelResources.discard(root);
      throw error;
    }
  }
  async function sceneFromAsset(entry, asset, consumeBytes, index) {
    const base64 = asset?.base64;
    if (typeof base64 !== "string" || base64.length > 11_200_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
      throw new Error("invalid or oversized model asset response");
    }
    const bytes = entry.embeddedAsset ? await globalThis.KiCadEmbeddedModels.decode(asset, fzstd.decompress)
      : globalThis.KiCadEmbeddedModels.decodeBase64(base64);
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
      return retainModel(group,index);
    }
    if (entry.format === "glb") {
      try {
        preflightModelGLB(bytes,modelGraph.limit,{
          maxAccessorBytes:modelGeometryBudget,maxTextureBytes:modelTextureBudget,maxTextureDimension:graphics.maxDimension
        });
      } catch(error) {
        if(['MODEL_GRAPH_BUDGET','MODEL_ALLOCATION_BUDGET'].includes(error.code))modelGraph.rejectPreflight();
        throw error;
      }
      return retainModel((await new GLTFLoader().parseAsync(bytes.buffer, "")).scene,index);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const prepared = prepareVRMLSource(text);
    return retainModel(restoreVRMLNames(new VRMLLoader().parse(prepared.source), prepared.identifiers),index);
  }
  async function loadRepositoryModels(modelSource) {
    if (!options.boardPath) return;
    let inventory;
    try {
      const paths=options.assetPathsPromise?await options.assetPathsPromise:options.assetPaths;
      if(!active||captureAbort.signal.aborted)return;
      for(const warning of (Array.isArray(options.assetWarnings)?options.assetWarnings:[]).filter(item=>typeof item==='string').slice(0,48).map(item=>item.slice(0,500)))if(!modelDiagnostics.includes(warning))modelDiagnostics.push(warning);
      inventory = globalThis.KiCadRepoModels.collectParsed(modelSource, options.boardPath, paths);
      modelSource = null;
    }
    catch (error) { if(!active||captureAbort.signal.aborted)return;modelDiagnostics.push(`Cannot read model references: ${error.message}`); showModelDiagnostics(); return; }
    modelDiagnostics.push(...inventory.diagnostics);
    showModelDiagnostics();
    const cache = createModelTemplateCache(inventory.models);
    const componentIndexes=new Map(board.components.map((component,index)=>[component.id,index]));
    let totalBytes = 0, cursor = 0;
    async function one(entry) {
      const index = componentIndexes.get(entry.footprintId);
      if (index === undefined) { modelDiagnostics.push(`${entry.reference}: footprint identity not found`); cache.release(entry); return; }
      try {
        const template = await cache.get(entry, async () => {
          const asset = entry.embeddedAsset || await options.loadAsset?.(entry.path);
          if(!active)throw Error('3D viewer closed before model decoding.');
          return sceneFromAsset(entry, asset, bytes => {
            totalBytes += bytes;
            if (totalBytes > 24 * 1024 * 1024) throw new Error("Decoded 3D model assets exceed 24 MiB in this viewer");
          },index);
        });
        if (!active) return;
        modelGraph.admit(template,modelWrappers(index),()=>{
          const clone = cache.isLastUse(entry)?template:template.clone(true);
          modelResources.retainClone(clone,modelGeometryBudget,modelTextureBudget);
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
          updateComponentVisibility(index);
          // Extend the cached enclosure once per arriving model, not once per
          // camera frame. Keep late models inside the clip range after user pan.
          group.updateWorldMatrix(true,true);clipBounds.union(new THREE.Box3().setFromObject(group));const loadedSphere=clipBounds.getBoundingSphere(new THREE.Sphere());fittedRadius=loadedSphere.radius;fittedCenter.copy(loadedSphere.center);updateClipping();
          rememberProbeResources(group);probeRegistry.sourceAdded(group);
          if(Object.keys(externalSelection).length)setSelection(externalSelection);
        });
      } catch (error) {
        if(active)modelDiagnostics.push(`${entry.reference}: ${entry.path}: ${error?.message || String(error)}`);
      } finally {
        cache.release(entry);
      }
      if(active)showModelDiagnostics();
    }
    await Promise.all(Array.from({ length: Math.min(decodeConcurrency, inventory.models.length) }, async () => {
      while (cursor < inventory.models.length && active) await one(inventory.models[cursor++]);
    }));
    cache.clear();
    stepClient?.dispose();
    stepClient=null;
    if(active) {
      showModelDiagnostics(); setSelection(externalSelection);
      // Fit real model height after asynchronous decoding, but never undo an
      // orbit/zoom the user has already started during loading.
      if (!userAdjustedCamera && loadedModelIndexes.size) fit();
    }
  }

  let fittedRadius = Math.hypot(width, height, thickness + 5) / 2;const fittedCenter=new THREE.Vector3(),clipBounds=new THREE.Box3();
  function updateClipping() {
    const range = boardClipRange(camera.position.distanceTo(controls.target), fittedRadius+fittedCenter.distanceTo(controls.target));
    camera.near = range.near; camera.far = range.far; camera.updateProjectionMatrix();
  }
  controls.addEventListener("change", updateClipping);
  function sizeViewport() {
    const viewportWidth = Math.max(1, canvasHost.clientWidth), viewportHeight = Math.max(1, canvasHost.clientHeight);
    const plan=qualityViewport(viewportWidth,viewportHeight,globalThis.devicePixelRatio,graphics.maxDimension,quality,graphics),ratio=plan.ratio;
    if(renderer.domElement.width!==Math.floor(viewportWidth*ratio)||renderer.domElement.height!==Math.floor(viewportHeight*ratio))graphicsHealth.invalidate();
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(viewportWidth, viewportHeight, false); resizeProjection(camera,viewportWidth / viewportHeight);
    if(pipeline){pipeline.composer.setPixelRatio(ratio);pipeline.composer.setSize(viewportWidth,viewportHeight);}
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
    fittedRadius = radius;fittedCenter.copy(center);clipBounds.copy(bounds);
    controls.maxDistance = Math.max(extent * 8, distance * 4);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.up.fromArray(preset.up); controls.target.copy(center); controls.update(); updateClipping();
  }
  action("Fit", () => {userAdjustedCamera=true;fit();},'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M8 8h8v8H8Z','Fit board to viewport');
  const viewSelect=document.createElement('select');viewSelect.className='view-select';viewSelect.title='Choose a board viewing side';viewSelect.setAttribute('aria-label','3D camera view');const viewPrompt=document.createElement('option');viewPrompt.value='';viewPrompt.disabled=true;viewPrompt.textContent='View';viewSelect.append(viewPrompt);
  for(const {id,label}of boardViewPresets){const item=document.createElement('option');item.value=id;item.textContent=label;viewSelect.append(item);}viewSelect.value='';viewSelect.onchange=()=>{userAdjustedCamera=true;fit(viewSelect.value);viewSelect.value='';};bar.append(viewSelect);
  const projectionButton=action('Ortho',()=>{userAdjustedCamera=true;setOrthographic(!camera.isOrthographicCamera);},'M4 4h16v16H4z M4 10h16 M10 4v16','Orthographic projection');projectionButton.setAttribute('aria-pressed','false');projectionButton.title='Orthographic projection: parallel edges and undistorted top views';
  function setOrthographic(enabled){camera=projectionCamera(THREE,camera,controls,Boolean(enabled));terminalAnnotations.setCamera(camera);projectionButton.setAttribute('aria-pressed',String(Boolean(camera.isOrthographicCamera)));createPipeline();sizeViewport();controls.update();invalidate();return Boolean(camera.isOrthographicCamera);}
  const divider=document.createElement('span');divider.className='divider';divider.setAttribute('aria-hidden','true');bar.append(divider);
  const measureButton=action('Measure',()=>setMeasurementMode(!measuring),'M3 17 17 3l4 4L7 21ZM7 13l3 3M10 10l2 2M13 7l3 3','Measure distance between 3D surfaces');measureButton.setAttribute('aria-pressed','false');
  const displayButton=action('Display',()=>setDisplayOpen(visibilityOptions.hidden),'M3 6h18M3 12h18M3 18h18M7 3v6M17 9v6M10 15v6','3D display settings');displayButton.setAttribute('aria-expanded','false');displayButton.setAttribute('aria-controls',visibilityOptions.id);
  const explodeLabel=document.createElement('label');explodeLabel.className='explode-control';explodeLabel.title='Expand saved copper layers, vias and components. The represented substrate fades to reveal inner copper; separate dielectric and metal-core solids are unavailable.';
  const explodeCaption=document.createElement('span');explodeCaption.textContent='Expand';const explodeSlider=document.createElement('input');explodeSlider.type='range';explodeSlider.min='0';explodeSlider.max='100';explodeSlider.step='1';explodeSlider.value='0';explodeSlider.setAttribute('aria-label','Expand board layers');const explodeValue=document.createElement('output');explodeValue.textContent='0%';explodeLabel.append(explodeCaption,explodeSlider,explodeValue);explodeLabel.hidden=mechanical;bar.append(explodeLabel);
  const secondaryTools=document.createElement('div');secondaryTools.className='secondary-tools';secondaryTools.id='more-3d-tools';secondaryTools.setAttribute('role','group');secondaryTools.setAttribute('aria-label','More 3D tools');secondaryTools.append(projectionButton,divider,measureButton,displayButton,explodeLabel);bar.append(secondaryTools);
  const moreButton=document.createElement('button');moreButton.type='button';moreButton.textContent='More';moreButton.setAttribute('aria-label','More 3D tools');moreButton.setAttribute('aria-controls',secondaryTools.id);bar.append(moreButton);
  const compactToolbar=mountCompactToolbar({host,moreButton,panel:secondaryTools,force:options.compactControls===true});
  moreButton.addEventListener('click',()=>compactToolbar.toggle());
  for(const control of [projectionButton,measureButton,displayButton])control.addEventListener('click',()=>{if(compactToolbar.open){compactToolbar.close();moreButton.focus();}});
  const closeCompactTools=event=>{const path=event.composedPath();if(!path.includes(moreButton)&&!path.includes(secondaryTools))compactToolbar.close();};
  const escapeCompactTools=event=>{if(event.key==='Escape'&&compactToolbar.open){compactToolbar.close();moreButton.focus();event.preventDefault();event.stopImmediatePropagation();}};
  document.addEventListener('pointerdown',closeCompactTools);shadow.addEventListener('keydown',escapeCompactTools,true);
  function applyExpand(value,syncSlider=true){const wasExpanded=explode.get()>0,amount=explode.set(mechanical?0:value),expanded=amount>0;if(syncSlider)explodeSlider.value=String(Math.round(amount));explodeValue.textContent=Math.round(amount)+'%';for(const [name,group]of copperGroups)explode.layer(group,name);for(const {mesh,span}of viaExplode)explode.barrels(mesh,span);
    updateSubstrateMaterials(substrateMaterials,substrate.material,expanded||Boolean(layerInspection.get()),Math.min(explode.substrateOpacity(),layerInspection.substrateOpacity()));edges.material.opacity=Math.min(.42*Math.min(explode.substrateOpacity(),layerInspection.substrateOpacity()),edges.material.userData.selectionOpacityCap??1);
    analysisOverlay?.boardLayerPlacement?.update(analysisOverlay.group);updateComponentVisibility();if(wasExpanded!==expanded)applyAppearance();else {explode.overlay(netInspection.group);selectionGeometry.refreshTransforms();}probeRegistry.forEach(probe=>probe.setExplode?.(amount));clipBounds.setFromObject(boardGroup);const boundsSphere=clipBounds.getBoundingSphere(new THREE.Sphere());fittedRadius=boundsSphere.radius;fittedCenter.copy(boundsSphere.center);updateClipping();renderer.shadowMap.needsUpdate=true;invalidate();return amount;}
  let explodeFrame=0;
  function setExplode(value){userAdjustedCamera=true;if(explodeFrame){cancelAnimationFrame(explodeFrame);explodeFrame=0;}return applyExpand(value);}
  explodeSlider.addEventListener('input',()=>{userAdjustedCamera=true;const target=Number(explodeSlider.value),start=explode.get();if(explodeFrame)cancelAnimationFrame(explodeFrame);let began;
    const step=time=>{if(!active)return;if(began===undefined)began=time;const t=Math.min(1,(time-began)/180),ease=1-(1-t)**3;applyExpand(start+(target-start)*ease,false);explodeFrame=t<1?requestAnimationFrame(step):0;};explodeFrame=requestAnimationFrame(step);});
  function applyLayerInspection(){
    userAdjustedCamera=true;
    for(const [name,group]of copperGroups)group.visible=!mechanical&&layerInspection.visible(name);
    parts.visible=layerInspection.partsVisible();
    const faded=explode.get()>0||Boolean(layerInspection.get());updateSubstrateMaterials(substrateMaterials,substrate.material,faded,Math.min(explode.substrateOpacity(),layerInspection.substrateOpacity()));
    edges.material.opacity=.42*Math.min(explode.substrateOpacity(),layerInspection.substrateOpacity());if(selectionAppearanceReady)applyAppearance();renderer.shadowMap.needsUpdate=true;invalidate();
  }
  const inspectLabel=document.createElement('label'),inspectLayer=document.createElement('select');inspectLabel.append(document.createTextNode('Inspect layer'));inspectLayer.setAttribute('aria-label','Inspect saved copper layer');inspectLayer.title='Choose a copper layer to reveal it through the board and hide component bodies. Return to Assembled board to restore display choices.';
  for(const [value,label]of [['','Assembled board'],...copperPlan.layers.map(layer=>[layer.name,layer.name])]){const option=document.createElement('option');option.value=value;option.textContent=label;inspectLayer.append(option);}inspectLabel.append(inspectLayer);inspectLabel.hidden=mechanical;layerOptions.append(inspectLabel);inspectLayer.onchange=()=>{layerInspection.focus(inspectLayer.value);applyLayerInspection();};
  for(const name of explode.layers.filter(name=>!['F.Cu','B.Cu'].includes(name)))toggle(name,true,visible=>{layerInspection.setLayer(name,visible);applyLayerInspection();});
  for(const [layer,label]of [['F.Cu','Front copper'],['B.Cu','Back copper'],['F.SilkS','Front silkscreen'],['B.SilkS','Back silkscreen']])if(copperPlan.byLayer.has(layer)||copperGroups.has(layer))toggle(label,true,visible=>{layerInspection.setLayer(layer,visible);applyLayerInspection();});
  toggle('Parts',true,visible=>{layerInspection.setParts(visible);applyLayerInspection();});
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
  const pinOneToggle=toggle('Pin 1 markers',showPinOneMarkers,visible=>{
    setPinOneMarkers(visible);
    options.onPinOneMarkersChange?.(visible);
  });
  pinOneToggle.title='Color the copper for pad 1, or ball A1 when a footprint has no numbered pad 1.';
  function setPinOneMarkers(visible){
    const next=Boolean(visible);
    if(next!==showPinOneMarkers){
      showPinOneMarkers=next;pinOneToggle.checked=next;applyAppearance();
    }
    return showPinOneMarkers;
  }
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
  measurementSnap.value='edges';
  const measurementEdges=new WeakMap(),measurementRay=new THREE.Raycaster();
  let measurementTouch=null,measurementTouchDrag=null,measurementHover=null,measurementPointer=null,measurementPreviewTimer=null;
  const measurementPointers=new Set();
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
  const snapTarget=document.createElement('div');snapTarget.className='snap-target';snapTarget.hidden=true;snapTarget.setAttribute('aria-hidden','true');stage.append(snapTarget);
  const snapPlaceholder=new THREE.BufferGeometry();
  const snapLineGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const snapLine=new THREE.Line(snapLineGeometry,new THREE.LineBasicMaterial({color:0x65e6ff,depthTest:false,depthWrite:false,toneMapped:false}));
  snapLine.visible=false;snapLine.frustumCulled=false;snapLine.renderOrder=203;scene.add(snapLine);
  const snapTint=new THREE.Mesh(snapPlaceholder,new THREE.MeshBasicMaterial({color:0x65e6ff,transparent:true,opacity:.32,depthWrite:false,toneMapped:false,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-8,side:THREE.DoubleSide}));
  snapTint.matrixAutoUpdate=false;snapTint.frustumCulled=false;snapTint.visible=false;snapTint.renderOrder=200;scene.add(snapTint);
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
    camera.updateMatrixWorld();
    const current=measurementSession.selected,pending=measurementSession.pending;
    const hover=measuring?measurementHover:null;
    const point=hover?.point.clone().project(camera);
    snapTarget.hidden=!point||Math.abs(point.x)>1||Math.abs(point.y)>1||Math.abs(point.z)>1;
    if(!snapTarget.hidden){snapTarget.style.left=(point.x+1)*canvasHost.clientWidth/2+'px';snapTarget.style.top=(1-point.y)*canvasHost.clientHeight/2+'px';snapTarget.dataset.kind=hover.kind;}
    snapLine.visible=!snapTarget.hidden&&Boolean(hover.edge);
    if(snapLine.visible){
      const positions=snapLineGeometry.getAttribute('position');
      hover.edge.forEach((p,i)=>positions.setXYZ(i,p.x,p.y,p.z));positions.needsUpdate=true;
    }
    snapTint.visible=!snapTarget.hidden&&hover.object!==substrate&&hover.kind!=='surface';
    if(snapTint.visible){
      snapTint.geometry=hover.object.geometry;
      snapTint.matrix.copy(hover.matrix);snapTint.matrixWorldNeedsUpdate=true;
    }else snapTint.geometry=snapPlaceholder;
    measureGroup.visible=measuring&&Boolean(current||pending);measurementLabel.hidden=!measuring||!current;
    if(!measureGroup.visible)return;const from=toWorld(current?.from||pending),to=current?toWorld(current.to):hover?.point;measureMarkers[0].position.copy(from);measureMarkers[1].visible=Boolean(to);measureLine.visible=Boolean(to);
    if(to){measureMarkers[1].position.copy(to);const positions=measureGeometry.getAttribute('position');positions.setXYZ(0,from.x,from.y,from.z);positions.setXYZ(1,to.x,to.y,to.z);positions.needsUpdate=true;
      const center=from.clone().add(to).multiplyScalar(.5).project(camera);measurementLabel.hidden=center.z<-1||center.z>1;
      measurementLabel.style.left=Math.max(8,Math.min(canvasHost.clientWidth-measurementLabel.offsetWidth-8,(center.x+1)*canvasHost.clientWidth/2+8))+'px';measurementLabel.style.top=Math.max(8,Math.min(canvasHost.clientHeight-measurementLabel.offsetHeight-8,(1-center.y)*canvasHost.clientHeight/2-24))+'px';
    }
    for(const marker of measureMarkers){const viewportHeight=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom:camera.position.distanceTo(marker.position)*2*Math.tan(camera.fov*Math.PI/360);const radius=Math.max(.005,viewportHeight/Math.max(1,canvasHost.clientHeight)*3.5);marker.scale.setScalar(radius);}
  }
  function setMeasurementMode(enabled){if(!active)return false;measuring=Boolean(enabled);host.dataset.measuring=String(measuring);measureButton.setAttribute('aria-pressed',String(measuring));measurementPanel.hidden=!measuring;if(!measuring){measurementSession.pending=null;measurementTouch=null;measurementTouchDrag=null;measurementPointers.clear();controls.enabled=true;measurementLens.hidden=true;clearMeasurementPreview();}updateMeasurementPanel();options.onMeasurementMode?.(measuring);return measuring;}
  function clearMeasurements(){measurementSession.clear();clearMeasurementPreview();updateMeasurementPanel();options.onMeasurement?.(null);}
  for(const select of [measurementFilter,measurementSnap])select.onchange=()=>{
    measurementHover=null;updateMeasurementPanel();if(measurementPointer)queueMeasurementPreview(measurementPointer);
  };
  measurementUnits.onchange=()=>{measurementUnit=measurementUnits.value==='mil'?'mil':'mm';updateMeasurementPanel();};
  measurementHistory.onchange=()=>{const record=measurementSession.replay(measurementHistory.value);if(record){updateMeasurementPanel();options.onMeasurement?.(record);}};
  const escapeMeasurement=event=>{if(event.key==='Escape'&&measuring){event.preventDefault();event.stopPropagation();setMeasurementMode(false);measureButton.focus();}};
  shadow.addEventListener('keydown',escapeMeasurement);
  function measurementCategory(object){
    if(object===substrate)return 'board';
    return measurementCategories.get(object)||'models';
  }
  function measurementPoint(event){
    const rect=renderer.domElement.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0)return null;
    const coords={x:event.clientX-rect.left,y:event.clientY-rect.top},mode=measurementSnap.value,filter=measurementFilter.value;
    const tolerance=event.pointerType==='touch'?20:12;
    camera.updateMatrixWorld();
    const visible=pickables.filter(item=>{for(let node=item;node;node=node.parent)if(!node.visible)return false;return true;});
    const cast=(x,y,objects=visible)=>{
      measurementRay.setFromCamera({x:x/rect.width*2-1,y:1-y/rect.height*2},camera);
      return measurementRay.intersectObjects(objects,false)[0];
    };
    const eligible=hit=>hit&&(filter==='all'||measurementCategory(hit.object)===filter);
    const hit=cast(coords.x,coords.y);
    const base=(entry,point,kind,matrix)=>({point,kind,matrix,object:entry.object,approximate:entry.object===componentMesh});
    if(mode==='surface')return eligible(hit)?base(hit,hit.point,'surface'):null;
    const project=p=>{
      const clip=new THREE.Vector4(p.x,p.y,p.z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      return clip.w>0?{x:(clip.x/clip.w+1)*rect.width/2,y:(1-clip.y/clip.w)*rect.height/2,z:clip.z/clip.w,w:clip.w}:null;
    };
    const processed=new Map();
    function snap(entry){
      if(!eligible(entry))return null;
      let instances=processed.get(entry.object);
      if(!instances)processed.set(entry.object,instances=new Set());
      if(instances.has(entry.instanceId))return null;
      instances.add(entry.instanceId);
      const geometry=entry.object.geometry,positions=geometry?.getAttribute('position');
      if(!positions||(entry.object!==substrate&&positions.count>200000))return null;
      let segments=measurementEdges.get(geometry);
      if(!segments){
        const wire=entry.object===substrate?null:new THREE.EdgesGeometry(geometry,25);
        const points=(wire||edges.geometry).getAttribute('position');segments=[];
        for(let i=0;i+1<points.count;i+=2)segments.push([new THREE.Vector3().fromBufferAttribute(points,i),new THREE.Vector3().fromBufferAttribute(points,i+1)]);
        wire?.dispose();measurementEdges.set(geometry,segments);
      }
      const matrix=entry.object.matrixWorld.clone();
      if(Number.isInteger(entry.instanceId)){const instance=new THREE.Matrix4();entry.object.getMatrixAt(entry.instanceId,instance);matrix.multiply(instance);}
      let candidates=segments;
      if(entry.object===substrate){
        const z=camera.isOrthographicCamera?(camera.top-camera.bottom)/camera.zoom:camera.position.distanceTo(entry.point)*2*Math.tan(camera.fov*Math.PI/360);
        const range=Math.max(.05,4*z*tolerance/rect.height);
        const local=entry.point.clone().applyMatrix4(matrix.clone().invert());
        candidates=segments.filter(([a,b])=>Math.min(a.x,b.x)<=local.x+range&&Math.max(a.x,b.x)>=local.x-range&&Math.min(a.y,b.y)<=local.y+range&&Math.max(a.y,b.y)>=local.y-range);
      }
      const transformed=candidates.slice(0,10000).map(segment=>segment.map(point=>point.clone().applyMatrix4(matrix)));
      const result=snapProjectedEdges(coords,transformed,project,{mode,tolerance});
      if(!result)return null;
      const point=new THREE.Vector3(result.point.x,result.point.y,result.point.z),first=cast(result.screen.x,result.screen.y);
      // A silhouette ray may miss the exact shared edge. Only a surface
      // strictly in front of the candidate makes the feature invisible.
      if(first&&first.distance+Math.max(.003,camera.position.distanceTo(point)*.00008)<measurementRay.ray.origin.distanceTo(point))return null;
      return {...base(entry,point,result.kind,matrix),distance:result.distance,edge:result.edge};
    }
    const central=snap(hit);
    if(central)return central;
    if(!eligible(hit)){
      let best=null;
      for(const [x,y] of [[-1,0],[1,0],[0,-1],[0,1],[-.7,-.7],[-.7,.7],[.7,-.7],[.7,.7]]){
        const candidate=snap(cast(coords.x+x*tolerance,coords.y+y*tolerance));
        if(candidate&&(!best||candidate.distance<best.distance))best=candidate;
      }
      if(best)return best;
    }
    return eligible(hit)?base(hit,hit.point,'surface'):null;
  }
  function clearMeasurementPreview(){
    clearTimeout(measurementPreviewTimer);measurementPreviewTimer=null;measurementPointer=null;measurementHover=null;
    invalidate();
  }
  function queueMeasurementPreview(event){
    measurementPointer={clientX:event.clientX,clientY:event.clientY,pointerType:event.pointerType};
    if(measurementPreviewTimer!==null)return;
    measurementPreviewTimer=setTimeout(()=>{
      measurementPreviewTimer=null;if(!measuring||!measurementPointer)return;
      measurementHover=measurementPoint(measurementPointer);
      const step=measurementSession.pending?'Choose the second point.':'Choose the first point.';
      const target=measurementHover?.kind==='mesh vertex'?'Corner snapped':measurementHover?.kind==='mesh edge'?'Edge snapped':measurementHover?'Surface point':'Move over visible geometry';
      measurementStatus.textContent=target+' · '+step;updateMeasurementGraphics();invalidate();
    },48);
  }
  function measureSurface(event){
    clearTimeout(measurementPreviewTimer);measurementPreviewTimer=null;measurementPointer=null;
    const hit=measurementPoint(event);
    if(!hit){updateMeasurementPanel('No visible target. Try another point or change the geometry filter.');return;}
    measurementHover=hit;
    const result=measurementSession.add({x:hit.point.x+centerX,y:centerY-hit.point.y,z:hit.point.z,approximate:hit.approximate});
    const target=hit.kind==='mesh vertex'?'Corner':hit.kind==='mesh edge'?'Edge':'Surface point';
    updateMeasurementPanel(target+' selected. '+(measurementSession.pending?'Choose the second point.':'Measurement complete.'));
    if(result?.distance!==undefined)options.onMeasurement?.(result);
  }
  let selected = null;
  let selectionDim=true;
  rememberProbeResources(boardGroup);
  const selectionAppearance=createSelectionAppearance(THREE,()=>{const objects=[];boardGroup.traverse(object=>{if(object.material)objects.push(object);});return objects;});
  selectionAppearanceReady=true;
  const selectionManagedExternally=options.selectionManagedExternally&&typeof options.onSelect==='function';
  const selectionGeometry=createSelectionGeometry(THREE,{scene,objects:()=>pickables,limit:2000,dark:initialDark});
  let externalSelection = {},netHighlightColor='layer';
  const selectionNotice = document.createElement('div'); selectionNotice.className = 'hint'; selectionNotice.style.bottom = '42px'; selectionNotice.hidden = true; stage.append(selectionNotice);
  function setSelection(selection = {}) {
    graphicsHealth.invalidate();invalidate();
    if(mechanical){externalSelection={};netInspection.update({},false);netInspection.group.visible=false;selectionAppearance.restore();selectionGeometry.clear();selectionNotice.hidden=true;return {highlighted:0,matched:0,limited:false,mechanical:true};}
    externalSelection = selection || {};
    const matches = selectionMatcher(externalSelection, board),netNames=selectionNetNames(externalSelection,board);
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
    selectionAppearance.update(matches,state.matched>0&&selectionDim,{netContext:netNames.size>0});
    return state;
  }
  function updateNetHighlightColor(value){
    const next=value==='layer'?'layer':'accent';
    if(next===netHighlightColor)return false;
    netHighlightColor=next;
    netInspection.setColorMode(next);
    probeRegistry.forEach(probe=>probe.setNetHighlightColor?.(next));
    return true;
  }
  function clearSelection() {
    selected = null; inspector.hidden = true; menu.hidden = true; selectionGeometry.clear();
    if(!selectionManagedExternally)setSelection({});
    options.onSelect?.(null);
  }
  function select(record, point, object, instanceId, gesture) {
    if(mechanical)return;
    const mode=options.getSelectionMode?.()||selectionMode;
    if(!selectionManagedExternally)setSelection(!gesture?.individual&&mode==='net'&&record.net?{netNames:[record.net]}:record.type==='Component'||typeof record.library==='string'?{references:[record.ref]}:{uuids:[record.uuid||record.id]});
    selected = { record, point: point.clone() };
    options.onSelect?.(record,gesture);
    if(options.externalInspector)return;
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
    if(measuring){measureSurface(event);return;}
    if (analysisOverlay?.mesh.visible) {
      const result = analysisOverlay.sample(raycaster.intersectObject(analysisOverlay.mesh, false)[0]);
      if (result) { options.onAnalysisProbe?.(result); return; }
    }
    const individual=Boolean(event.shiftKey&&!event.ctrlKey&&!event.metaKey);
    const result=pickAtRay(individual?'object':options.getSelectionMode?.()||selectionMode);
    if(!result){if(clearOnMiss)clearSelection();return;}
    const {hit,record}=result;
    select(record,hit.point,hit.object,hit.instanceId,{individual});
  }
  let pointerInside=false;
  function netAtPointer(){
    if(!active||!pointerInside||measuring)return null;
    raycaster.setFromCamera(pointer,camera);
    return pickAtRay('net')?.record||null;
  }
  function pickAtRay(mode){
    const visible=item=>{for(let node=item;node;node=node.parent)if(!node.visible)return false;return true;};
    return pickSavedGeometry(raycaster,pickables.filter(mesh=>visible(mesh)&&(explode.get()===0||mesh!==substrate)),netInspection.group.children.filter(visible),mode);
  }
  renderer.domElement.addEventListener('pointerleave',()=>{pointerInside=false;if(measuring)clearMeasurementPreview();});
  let selectionMode = 'all';
  const hold = holdGesture(event => contextMenu(event));
  const gesture=selectionGesture({onPick:pick,onContextMenu:contextMenu,isHeld:()=>hold.isHeld()});
  renderer.domElement.addEventListener('wheel',()=>{if(measuring)clearMeasurementPreview();},{passive:true});
  const measurementTouchCapture=event=>{if(measuring&&event.pointerType==='touch'&&measurementPointers.size)controls.enabled=true;};renderer.domElement.addEventListener('pointerdown',measurementTouchCapture,true);
  renderer.domElement.addEventListener("pointerdown", (event) => { gesture.down(event); if(!measuring)hold.down(event); menu.hidden = true;if(measuring&&event.pointerType==='touch'){measurementPointers.add(event.pointerId);measurementTouchDrag=measurementPointers.size===1?event.pointerId:null;controls.enabled=measurementPointers.size!==1;measurementTouch={x:event.clientX,y:event.clientY};invalidate();} });
  renderer.domElement.addEventListener("pointermove", event => {
    pointerInside=true;const rect=renderer.domElement.getBoundingClientRect();pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    gesture.move(event); hold.move(event);
    if(measuring){
      if(event.buttons===0||event.pointerType==='touch'&&measurementPointers.size===1)queueMeasurementPreview(event);
      else if(measurementPointer||measurementHover)clearMeasurementPreview();
    }
    if(measuring&&event.pointerType==='touch'){measurementTouch={x:event.clientX,y:event.clientY};invalidate();}
    if (analysisOverlay && options.onAnalysisHover) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      options.onAnalysisHover(analysisOverlay.mesh.visible ? analysisOverlay.sample(raycaster.intersectObject(analysisOverlay.mesh, false)[0]) : null);
    }
  });
  renderer.domElement.addEventListener("pointercancel", event => { gesture.cancel(event); hold.up(event);if(measuring)clearMeasurementPreview();measurementPointers.delete(event.pointerId);measurementTouchDrag=null;controls.enabled=true;measurementTouch=null;measurementLens.hidden=true; });
  renderer.domElement.addEventListener("pointerup", (event) => {
    hold.up(event);gesture.up(event,{select:!dcProbeMode&&!(measuring&&event.pointerType==='touch')});
    if(measuring&&event.pointerType==='touch'){if(measurementTouchDrag===event.pointerId&&measurementPointers.size===1)pick(event);measurementPointers.delete(event.pointerId);measurementTouchDrag=null;controls.enabled=true;}measurementTouch=null;measurementLens.hidden=true;
  });
  function contextMenu(event) {
    if(dcProbeMode){event.preventDefault?.();return;}
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
  const layoutFrame = requestAnimationFrame(() => { if (active) { resize(); if(!userAdjustedCamera)fit(); } });
  const projectAnchor=createAnchorProjector(THREE,{objects:()=>pickables,getCamera:()=>camera,rect:()=>renderer.domElement.getBoundingClientRect(),positionToWorld:(position,side)=>{const [x,y]=world([position.x,position.y]);return new THREE.Vector3(x,y,side==='back'?bottom+explode.offset('B.Cu'):top+explode.offset('F.Cu'));}});
  let activeAnchor=null,anchorSignature='',viewSignature='';
  function notifyAnchor(){if(!activeAnchor)return;const point=projectAnchor(activeAnchor),signature=JSON.stringify(point);if(signature!==anchorSignature){anchorSignature=signature;options.onAnchor?.({anchor:activeAnchor,point});}}
  function notifyView(){const rect=renderer.domElement.getBoundingClientRect(),signature=JSON.stringify([camera.matrixWorld.elements,camera.projectionMatrix.elements,rect.left,rect.top,rect.width,rect.height]);if(signature!==viewSignature){viewSignature=signature;options.onViewChange?.();}notifyAnchor();}
  function applySilkscreenDetail(){
    if(!silkscreen.length)return [];
    camera.updateMatrixWorld();
    const pixels=renderer.domElement,refresh=[],originals=[];
    const moving=cameraMoving||Boolean(explodeFrame);
    for(const face of silkscreen){
      const region=face.viewRegion(camera,pixels),map=face.detailMap(region);
      if(!moving&&face.needsRefresh(region))refresh.push([face,region]);
      if(map){
        const material=face.mesh.material;
        originals.push([material,material.map]);
        material.map=map;
      }
    }
    clearTimeout(silkRefreshTimer);
    if(refresh.length)silkRefreshTimer=setTimeout(()=>{
      silkRefreshTimer=null;
      if(!active||contextLost||cameraMoving||explodeFrame)return;
      let changed=false;
      for(const [face,region] of refresh)changed=face.refresh(region)||changed;
      if(changed){graphicsHealth.invalidate();invalidate();}
    },100);
    return originals;
  }
  function drawFrame(){frame=0;if(!active||contextLost)return;controls.update();updateMeasurementGraphics();updateTerminalLabels();
    const silkMaps=applySilkscreenDetail();
    let rendered=false;shaderFailure=false;try{
      if(pipeline){pipeline.composer.render();const graphicsError=graphicsHealth.check();if(shaderFailure||graphicsError!==gl.NO_ERROR)throw Error(`Enhanced rendering failed (shader=${shaderFailure}, WebGL=${graphicsError}).`);}
      else {renderer.render(scene,camera);if(shaderFailure)throw Error('Board rendering shader failed.');}
      renderCount++;rendered=true;
    }catch(error){
      console.warn('3D rendering fallback:',error?.message||String(error));
      if(pipeline){fallbackQuality('Enhanced rendering could not complete. Balanced rendering is active.');invalidate();}
      else graphicsNotice('The graphics device could not draw this view. Try Low quality or reopen 3D.');
    }finally{
      for(const [material,map] of silkMaps)material.map=map;
    }
    if(rendered){drawMeasurementLens();notifyView();}
  }
  const onContextLost=event=>{event.preventDefault();contextLost=true;cancelAnimationFrame(frame);frame=0;qualitySelect.disabled=true;graphicsNotice('The graphics context was interrupted. The board and selection are retained while the browser recovers.',true);};
  const onContextRestored=()=>{if(!active)return;contextLost=false;cameraMoving=false;qualitySelect.disabled=false;disposePipeline();environment?.dispose();environment=createEnvironment();scene.environment=environment?.texture||null;renderer.shadowMap.needsUpdate=true;quality='balanced';qualitySelect.value=quality;host.dataset.quality=quality;applyLighting(lighting,false);graphicsNotice('Graphics restored. Balanced rendering is active; High quality can be selected again.');sizeViewport();invalidate();};
  renderer.domElement.addEventListener('webglcontextlost',onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored',onContextRestored);
  const closeVisibility=event=>{const path=event.composedPath();if(!path.includes(displayButton)&&!path.includes(visibilityOptions))setDisplayOpen(false);};
  const escapeVisibility=event=>{if(event.key==='Escape'&&!visibilityOptions.hidden){setDisplayOpen(false,true);event.preventDefault();event.stopImmediatePropagation();}};
  document.addEventListener('pointerdown',closeVisibility);shadow.addEventListener('keydown',escapeVisibility,true);
  applyQuality(initialQuality,false);
  const modelReady=loadRepositoryModels(options.boardPath ? globalThis.KiCadRepoModels.modelSource(sourceAST) : null);
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
  return { host, board,ready:modelReady,captureMechanicalView,getDCViewport:()=>dcViewport,
    getProbeCount(){return probeRegistry.size();},
    createProbeViewport(probeHost,probeOptions={}){
      if(!active)throw Error('The parent 3D scene is closed.');
      return probeRegistry.create(()=>createSharedProbeViewport({THREE,OrbitControls,host:probeHost,source:boardGroup,sourceScene:scene,sourceRenderer:renderer,board,
        materialFor:object=>probeCopperMaterials.forMaterial(probeMaterials.get(object)||object.material),instanceColorFor:object=>probeInstanceColors.has(object)?probeInstanceColors.get(object):object.instanceColor,
        netInspectionSource,
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
    setMeasurementMode,clearMeasurements,setPinOneMarkers,setTerminalLabels,setTerminalNumbers,getTerminalLabelState:()=>terminalAnnotations.getState(),
    measurementState(){return{mode:measuring,unit:measurementUnit,...measurementSession.snapshot()};},
    setQuality(value){return applyQuality(value);},
    getRenderStats(){const plan=qualityViewport(canvasHost.clientWidth,canvasHost.clientHeight,globalThis.devicePixelRatio,graphics.maxDimension,quality,graphics);return{...plan,...modelResources.stats(),graphicsHealth:graphicsHealth.stats(),modelGraph:{...modelGraph.stats(),decodeConcurrency},padGeometryCache:sharedPadGeometry.stats(),zones:{...zoneSourceStats,...zoneStats},selectionMaterials:selectionAppearance.stats(),silkscreen:silkscreen.map(face=>face.sampling()),graphicsTier:graphics.tier,defaultQuality:graphics.defaultQuality,maxDimension:graphics.maxDimension,antialias:gl.getContextAttributes()?.antialias===true,effectiveAntialias:pipeline?.fxaa?'fxaa':pipeline?'smaa':gl.getContextAttributes()?.antialias?'native-msaa':'none',postprocessSamples:pipeline?.composer.renderTarget1.samples||0,floatTargets:graphics.premium||renderer.extensions.has('EXT_color_buffer_float'),environmentLighting:Boolean(scene.environment),ambientOcclusion:Boolean(pipeline?.passes.some(pass=>pass instanceof GTAOPass&&pass.enabled)),lighting:lightingRig.state(),renderCount,contextLost,gpuTextures:renderer.info.memory.textures,drawCalls:renderer.info.render.calls,loadedModelCount:loadedModelIndexes.size,componentCount:board.components.length};},
    setAnalysisOverlay(surface) {
      graphicsHealth.invalidate();
      if (!active) return { placed: false, reason: "3D viewer is closed." };
      if(mechanical)return {placed:false,reason:'Mechanical views exclude electrical result overlays.'};
      if (!surface) { analysisOverlay?.dispose(); analysisOverlay = null; invalidate();return { placed: false, reason: "Overlay cleared." }; }
      const basis = surface.zBasis;
      const savedLayer = surface.layer;
      const boardLayerPlacement = surface.boardLayer === true ? dcBoardLayerOverlay(surface,copperPlan.byLayer,explode,centerX,centerY) : null;
      if (surface.boardLayer === true && !boardLayerPlacement) return { placed: false, reason: "Fast DC result requires a known saved copper layer and zero-height layer coordinates." };
      if (!boardLayerPlacement && ((surface.zKnown && !["front-depth", "board-center"].includes(basis)) || (!surface.zKnown && !["F.Cu", "B.Cu"].includes(savedLayer)))) return { placed: false, reason: "Saved result elevation basis or board layer is unknown; use the standalone result scene." };
      const transform = boardLayerPlacement?.transform || (([x, y, z]) => [x - centerX, centerY - y, surface.zKnown ? (basis === "front-depth" ? thickness / 2 - z : z) : (savedLayer === "F.Cu" ? thickness / 2 : -thickness / 2)]);
      const next = createResultOverlay(surface, transform);
      if(boardLayerPlacement){next.boardLayerPlacement=boardLayerPlacement;boardLayerPlacement.update(next.group);}
      // Internal copper/thermal layers must remain inspectable on the opaque PCB.
      // The result UI identifies this as showing the selected field through the board.
      next.mesh.material.depthTest = false; next.mesh.renderOrder = 20;
      analysisOverlay?.dispose(); analysisOverlay = next; scene.add(next.group);
      invalidate();
      return { placed: true, basis: boardLayerPlacement ? savedLayer : surface.zKnown ? basis : savedLayer, flat: Boolean(boardLayerPlacement)||!surface.zKnown };
    },
    setAnalysisProbes(probes) { analysisOverlay?.setProbes(probes);invalidate(); },
    setAnalysisOpacity(value) { analysisOverlay?.setOpacity(value);invalidate(); },
    setSelection,
    setExplode,getExplode:()=>explode.get(),
    setOrthographic,isOrthographic:()=>Boolean(camera.isOrthographicCamera),
    projectAnchor,
    setAnchor(anchor){activeAnchor=anchor&&typeof anchor==='object'?anchor:null;anchorSignature='';if(activeAnchor)notifyAnchor();else options.onAnchor?.({anchor:null,point:null});},
    setSelectionPresentation(selection,{color,dim}={}){
      if(color!==undefined)updateNetHighlightColor(color);
      if(dim!==undefined)selectionDim=Boolean(dim);
      return setSelection(selection);
    },
    setNetHighlightColor(value){if(updateNetHighlightColor(value))setSelection(externalSelection);},
    setSelectionDim(enabled){const next=Boolean(enabled);if(next!==selectionDim){selectionDim=next;setSelection(externalSelection);}return selectionDim;},
    selectionAppearanceCapabilities(){return {dim:true,instanceColors:true,desaturatesTextures:false,fullNet3d:true,internalCopper:true,viaSpans:true,translucentContext:true};},
    setLighting(value,{persist=true}={}){return applyLighting(value,persist);},
    getLightingState(){return lightingRig.state();},
    getNetInspectionState(){return netInspection.state();},
    setFullNet3D(enabled){fullNet3D=Boolean(enabled);setSelection(externalSelection);return fullNet3D;},
    setSelectionMode(mode){selectionMode=['all','part','net','pin'].includes(mode)?mode:'all';},
    focusPosition(position,{bounds,side='front',layer,reference}={}){
      if(!active||![position?.x,position?.y].every(value=>Number.isFinite(value)&&Math.abs(value)<=1e6))return false;
      const component=board.components[componentIndexes.get(reference)],componentSide=component?.layer?.startsWith('B.')?'back':'front';
      sizeViewport();const [x,y]=world([position.x,position.y]),surface=side==='back'?bottom:top,z=component?(componentSide==='back'?bottom:top)+explode.componentOffset(componentSide):copperPlan.byLayer.has(layer)?copperPlan.byLayer.get(layer).z+explode.offset(layer):surface+explode.offset(side==='back'?'B.Cu':'F.Cu'),target=new THREE.Vector3(x,y,z),direction=camera.position.clone().sub(controls.target);
      if(direction.lengthSq()<1e-10)direction.set(.45,-.38,1);direction.normalize();direction.z=(side==='back'?-1:1)*Math.abs(direction.z||.3);direction.normalize();
      const w=Number.isFinite(bounds?.w)?Math.max(8,Math.min(1e6,bounds.w*1.3)):8,h=Number.isFinite(bounds?.h)?Math.max(8,Math.min(1e6,bounds.h*1.3)):8;
      const distance=boxFitDistance([w,h,thickness+4],direction.toArray(),45,camera.aspect,.8,camera.up.toArray());if(!distance)return false;
      userAdjustedCamera=true;controls.maxDistance=Math.max(controls.maxDistance,distance*2);camera.position.copy(target).addScaledVector(direction,Math.max(controls.minDistance,distance));controls.target.copy(target);controls.update();updateClipping();invalidate();return true;
    },
    fit(topView=false){if(active){userAdjustedCamera=true;fit(topView);}},
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
        select(record, new THREE.Vector3(x, y, (record.layer?.startsWith("B.") ? bottom : top)+explode.componentOffset(record.layer?.startsWith("B.")?'back':'front')), model);
        return true;
      }
      const current = new THREE.Matrix4(); componentMesh.getMatrixAt(index, current);
      if (current.determinant() === 0) return false;
      const record = board.components[index];
      const [x, y] = world(record.at);
      const point = new THREE.Vector3(x, y, (record.layer?.startsWith("B.") ? bottom - 1.1 : top + 1.1)+explode.componentOffset(record.layer?.startsWith("B.")?'back':'front'));
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
    dispose() { probeRegistry.dispose();probeCopperMaterials.dispose();clearTimeout(silkRefreshTimer);clearTimeout(measurementPreviewTimer);snapTint.geometry=snapPlaceholder;for(const face of silkscreen)face.dispose();terminalAnnotations.dispose();if(measuring)options.onMeasurementMode?.(false);active = false;captureAbort.abort(); analysisOverlay?.dispose(); stepClient?.dispose(); cancelAnimationFrame(frame); cancelAnimationFrame(layoutFrame);cancelAnimationFrame(explodeFrame); observer.disconnect();compactToolbar.dispose();document.removeEventListener('pointerdown',closeCompactTools);shadow.removeEventListener('keydown',escapeCompactTools,true);controls.removeEventListener('change',invalidate); controls.removeEventListener("change", updateClipping); controls.removeEventListener("start", cameraInteraction); controls.removeEventListener("end", cameraInteractionEnd); controls.dispose();disposePipeline();lightingRig.dispose();environment?.dispose();renderer.domElement.removeEventListener('webglcontextlost',onContextLost);renderer.domElement.removeEventListener('webglcontextrestored',onContextRestored);document.removeEventListener('pointerdown',closeVisibility);shadow.removeEventListener('keydown',escapeVisibility,true);shadow.removeEventListener('keydown',escapeMeasurement);
    renderer.domElement.removeEventListener('pointerdown',measurementTouchCapture,true);netInspection.dispose();selectionGeometry.dispose();selectionAppearance.dispose();const resources = new Set(); scene.traverse((object) => {object.shadow?.dispose?.(); if (object.geometry) resources.add(object.geometry);
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      materials.forEach((item) => resources.add(item)); }); resources.forEach((item) => {if(!modelResources.owns(item))item.dispose();});modelResources.dispose();sharedPadGeometry.clear();hold.dispose(); renderer.dispose(); host.remove(); } };
}
