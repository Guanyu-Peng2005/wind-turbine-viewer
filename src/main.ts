import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Drivetrain } from './drivetrain';
import { PALETTE } from './industrial-palette';
import { InteractionLod, ContextMaterialLod } from './interaction-lod';
import { GeneratorMaterials } from './generator-materials';
import { MotionRenderer } from './motion-renderer';
import { RenderQuality } from './render-quality';
import { frameAssemblyAttachments } from './frame-assembly';
import { equipmentContext, type RelationRole } from './part-relations';
import { SpatialIndex, surfaceAnchor, worldVisible } from './spatial-index';
import { AnchorRegistry, anchorWorldPoint, pointWorldMatrix, finiteVector, validBinding, type AnchorBinding } from './spatial-anchors';
import modelIdentity from './model-identity.json';
import './style.css';
import './presentation.css';
import './responsive.css';

type DisplayMode = 'solid' | 'xray' | 'section';
type PartRole = 'shell' | 'auxiliary' | 'internal';
type PartRecord = {
  id: number;
  node: THREE.Object3D;
  label: string;
  meshCount: number;
  originalPosition: THREE.Vector3;
  originalQuaternion: THREE.Quaternion;
  originalScale: THREE.Vector3;
  originalVisible: boolean;
  centerWorld: THREE.Vector3;
  directionWorld: THREE.Vector3;
  role: PartRole;
  members?: THREE.Object3D[];
  attachments?:THREE.Object3D[];
  scopeDescription?:string;
};
type MajorPartGroup = {
  label: string;
  parts: PartRecord[];
};
type IndustrialMaterialProfile = {
  tint: number;
  tintMix: number;
  metalness: number;
  roughness: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissiveScale: number;
};
type AnnotationSeverity = '一般' | '注意' | '重要' | '紧急';
type AnnotationStatus = '待处理' | '处理中' | '已完成';
type AnnotationViewpoint = {
  cameraPosition: [number, number, number];
  cameraUp: [number, number, number];
  target: [number, number, number];
  framing?:'presentation'|'full';
  viewport?:[number,number];
  inputAngle?:number;
  projection?:{fov:number;near:number;far:number;zoom:number};
};
type EngineeringAnnotation = {
  id: string;
  sequence: number;
  partLabel: string;
  meshPath: number[];
  binding?:AnchorBinding;
  localPosition: [number, number, number];
  localNormal: [number, number, number];
  title: string;
  description: string;
  severity: AnnotationSeverity;
  status: AnnotationStatus;
  createdAt: string;
  viewpoint?: AnnotationViewpoint;
};
type SensorQuality = 'good' | 'uncertain' | 'bad';
type SensorStatus = 'normal' | 'warning' | 'alarm' | 'offline';
type SensorDefinition = {
  id: string;
  name: string;
  partLabel: string;
  metric: string;
  unit: string;
  baseValue: number;
  amplitude: number;
  warning: number;
  alarm: number;
  precision: number;
  phase: number;
  anchor: [number, number, number];
  demoQuality?: SensorQuality;
};
type SensorDataValue = {
  sensorId: string;
  value: number | null;
  sourceTimestamp: string;
  serverTimestamp: string;
  quality: SensorQuality;
};
type SensorHistoryValue = { timestamp: number; value: number };
type SensorRuntime = SensorDefinition & {
  part: PartRecord;
  mesh: THREE.Mesh;
  localPosition: [number, number, number];
  value: number | null;
  localNormal:[number,number,number];
  binding:AnchorBinding;
  anchorDescription:string;
  sourceTimestamp: string;
  serverTimestamp: string;
  quality: SensorQuality;
  status: SensorStatus;
  history: SensorHistoryValue[];
};
type SensorDataAdapter = {
  start: (onValue: (sample: SensorDataValue) => void) => () => void;
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>('viewer');
// The final framebuffer only receives a full-screen composite. MSAA there adds
// a resolve without antialiasing the geometry already drawn into HDR targets.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
renderer.outputColorSpace = THREE.SRGBColorSpace;
// Neutral keeps CAD/product colors stable while compressing HDR highlights.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.96;
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020c13);
const roomEnvironment = new RoomEnvironment();
const pmremGenerator = new THREE.PMREMGenerator(renderer);
const environmentRenderTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
scene.environment = environmentRenderTarget.texture;
scene.environmentIntensity = 0.88;
roomEnvironment.dispose();
pmremGenerator.dispose();
const assemblyFog = new THREE.FogExp2(0x020c13, 0.00115);
scene.fog = assemblyFog;

const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 5000);
const STATIC_LAYER = 0;
const MOVING_LAYER = 1;
const SHELL_LAYER = 2;
const GENERATOR_GLASS_LAYER = 3;
camera.layers.enable(MOVING_LAYER);
camera.layers.enable(SHELL_LAYER);
camera.layers.enable(GENERATOR_GLASS_LAYER);
const controls = new OrbitControls(camera, renderer.domElement);
// Static source review prioritizes a deterministic final frame. Damping would
// keep changing the camera after pointer-up and force repeated transparent draws.
controls.enableDamping = false;
controls.enableRotate = true;
controls.enablePan = false;
controls.enableZoom = true;
controls.screenSpacePanning = false;
controls.minPolarAngle = THREE.MathUtils.degToRad(24);
controls.maxPolarAngle = THREE.MathUtils.degToRad(142);
controls.minDistance = 0.02;
controls.maxDistance = 2000;
controls.autoRotateSpeed = 0.65;

scene.add(new THREE.HemisphereLight(0xf3f6f5, 0x24303a, 1.2));
const key = new THREE.DirectionalLight(0xfffdf8, 2.5);
key.position.set(7, 11, 8);
key.castShadow = false;
scene.add(key);
const rim = new THREE.DirectionalLight(0xc6dcdf, 1.42);
rim.position.set(-9, 6, -8);
scene.add(rim);
const technologyFill = new THREE.DirectionalLight(0x9ebfc6, 0.38);
technologyFill.position.set(3, -4, 7);
scene.add(technologyFill);
scene.traverse((object) => {
  if (!(object as THREE.Light).isLight) return;
  object.layers.enable(MOVING_LAYER);
  object.layers.enable(SHELL_LAYER);
});
const generatorMaterials = new GeneratorMaterials(renderer);
let motionRenderer: MotionRenderer | null = null;
let fixedRenderer: MotionRenderer | null = null;
let generatorGlassRenderer:MotionRenderer|null=null;
let motionOptimizationEnabled = true;
let contextMaterialLod: ContextMaterialLod | null = null;
const renderQuality=new RenderQuality();
let navigationRendering=false;

const groundMaterial = new THREE.ShadowMaterial({ color: 0x34464b, opacity: 0.13 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.visible = false;
scene.add(ground);

const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0x00a7b7);
selectionBox.material.transparent = true;
selectionBox.material.opacity = 0.86;
selectionBox.visible = false;
selectionBox.layers.set(MOVING_LAYER);
scene.add(selectionBox);

const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
const modelBounds = new THREE.Box3();
const modelCenter = new THREE.Vector3();
const modelSize = new THREE.Vector3();
const materialState = new Map<THREE.Material, { transparent: boolean; opacity: number; depthWrite: boolean; side: THREE.Side; clippingPlanes: THREE.Plane[] | null }>();
const originalMeshMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const coloredXrayMaterialCaches = new Map<string, WeakMap<THREE.Material, THREE.Material>>();
const generatedXrayMaterials = new Set<THREE.Material>();
const meshToPart = new WeakMap<THREE.Object3D, PartRecord>();
const majorMeshToPart=new WeakMap<THREE.Object3D,PartRecord>();
const spatialOwner=new WeakMap<THREE.Object3D,PartRecord>();
const spatialIndex=new SpatialIndex();
let anchorRegistry:AnchorRegistry|null=null;
let spatialMeshes:THREE.Mesh[]=[];
let visibleSpatialMeshes:THREE.Mesh[]=[];
let spatialCandidatesDirty=true;
let selectedRelationships:ReturnType<typeof equipmentContext>|null=null;
const demoMaterialColors=new Map<THREE.Material,THREE.Color>();
const movingMeshKinds = new WeakMap<THREE.Mesh, 'rotor' | 'drivetrain'>();
const keyEquipmentMeshes = new WeakSet<THREE.Mesh>();
const vendorEnclosureMeshes = new WeakSet<THREE.Mesh>();
const generatorEnclosureMeshes = new WeakSet<THREE.Mesh>();
const drivetrainContextMeshes = new WeakSet<THREE.Mesh>();
const heroExteriorMeshes = new WeakSet<THREE.Mesh>();
const bladeMeshes = new WeakSet<THREE.Mesh>();
const hubBodyMeshes = new WeakSet<THREE.Mesh>();
const hubShellMeshes = new WeakSet<THREE.Mesh>();
const towerShellMeshes = new WeakSet<THREE.Mesh>();
const userHiddenParts = new Set<PartRecord>();
const xrayShellMaterial = new THREE.MeshStandardMaterial({
  color: 0x607a82,
  metalness: 0.08,
  roughness: 0.66,
  emissive: 0x071c22,
  emissiveIntensity: 0.08,
  transparent: true,
  opacity: 0.16,
  depthWrite: false,
  depthTest: true,
  side: THREE.FrontSide,
});
xrayShellMaterial.name = 'xray-shell';
const xrayStaticMaterial = new THREE.MeshStandardMaterial({
  color: 0x9fc3ca,
  metalness: 0.08,
  roughness: 0.68,
  emissive: 0x092a32,
  emissiveIntensity: 0.2,
  transparent: true,
  opacity: 0.48,
  depthWrite: false,
  side: THREE.FrontSide,
});
xrayStaticMaterial.name = 'xray-static';
const xrayEquipmentMaterial = new THREE.MeshStandardMaterial({
  color: 0x82aeb9,
  metalness: 0.14,
  roughness: 0.58,
  emissive: 0x092c35,
  emissiveIntensity: 0.22,
  transparent: true,
  opacity: 0.58,
  depthWrite: false,
  side: THREE.FrontSide,
});
xrayEquipmentMaterial.name = 'xray-key-equipment';
const xrayVendorEnclosureMaterial = new THREE.MeshStandardMaterial({
  color: 0x79aab6,
  metalness: 0.08,
  roughness: 0.62,
  emissive: 0x08252d,
  emissiveIntensity: 0.16,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  side: THREE.FrontSide,
});
xrayVendorEnclosureMaterial.name = 'xray-vendor-enclosure';
const xrayRotorMaterial = new THREE.MeshStandardMaterial({
  color: PALETTE.hub,
  metalness: 0.38,
  roughness: 0.42,
  emissive: 0x192a32,
  emissiveIntensity: 0.05,
});
xrayRotorMaterial.name = 'xray-moving-rotor';
const xrayDrivetrainMaterial = new THREE.MeshStandardMaterial({
  color: PALETTE.steel,
  metalness: 0.82,
  roughness: 0.32,
  emissive: 0x000000,
  emissiveIntensity: 0,
});
xrayDrivetrainMaterial.name = 'xray-moving-drivetrain';
const focusContextMaterial = new THREE.MeshStandardMaterial({
  color: 0x53646b,
  metalness: 0.04,
  roughness: 0.86,
  emissive: 0x071116,
  emissiveIntensity: 0.08,
  transparent: true,
  opacity: 0.075,
  depthWrite: false,
  depthTest: true,
  side: THREE.FrontSide,
});
focusContextMaterial.name = 'part-focus-context';
const connectedContextMaterial = focusContextMaterial.clone();
connectedContextMaterial.name = 'drivetrain-connected-context';
connectedContextMaterial.opacity = 0.028;
const uniformBladeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xe4e8e7,
  metalness: 0,
  roughness: 0.54,
  clearcoat: 0.08,
  clearcoatRoughness: 0.58,
  transparent: true,
  opacity: 0.85,
  depthWrite: false,
  depthTest: true,
  side: THREE.FrontSide,
});
uniformBladeMaterial.name = 'transparent-blade-composite-shell';
const hubShellMaterial=uniformBladeMaterial.clone();
hubShellMaterial.name='hub-shell';hubShellMaterial.opacity=.70;
let presentationMode:'overview'|'drivetrain'='overview';
let modelRoot: THREE.Object3D | null = null;
let homeViewBounds:THREE.Box3|null=null;
let homeFramingActive=false;
let drivetrain: Drivetrain | null = null;
let interactionLod: InteractionLod | null = null;
let detailRestoreTimer: ReturnType<typeof setTimeout> | null = null;
let rotorSpinning = false;
let parts: PartRecord[] = [];
let majorPartGroups: MajorPartGroup[] = [];
let selectedPart: PartRecord | null = null;
let partFocusActive = false;
let displayMode: DisplayMode = 'solid';
let isIsolated = false;
let triangleCount = 0;
let frameSamples = 0;
let frameTime = 0;
let previousFrameTime = performance.now();
type ExactOverlapDiagnostic = {
  kept: string;
  hidden: string[];
  signature: string;
};
let exactOverlapDiagnostics: ExactOverlapDiagnostic[] = [];

const status = byId<HTMLSpanElement>('load-status');
const progressText = byId<HTMLElement>('load-progress');
const progressBar = byId<HTMLElement>('progress-bar');
const statusStrip = document.querySelector('.status-strip') as HTMLElement;
const results = byId<HTMLElement>('part-results');
const search = byId<HTMLInputElement>('part-search');
const focusButton = byId<HTMLButtonElement>('focus-selected');
const isolateButton = byId<HTMLButtonElement>('isolate-selected');
const hideButton = byId<HTMLButtonElement>('hide-selected');
const clearPartFocusButton = byId<HTMLButtonElement>('clear-part-focus');
const explodeRange = byId<HTMLInputElement>('explode-range');
const sectionRange = byId<HTMLInputElement>('section-range');
const hideAuxiliary = byId<HTMLInputElement>('hide-auxiliary');
const annotationToggle = byId<HTMLButtonElement>('annotation-toggle');
const annotationPanel = byId<HTMLElement>('annotation-panel');
const annotationClose = byId<HTMLButtonElement>('annotation-close');
const annotationModeButton = byId<HTMLButtonElement>('annotation-mode');
const annotationTip = byId<HTMLElement>('annotation-tip');
const annotationForm = byId<HTMLFormElement>('annotation-form');
const annotationFormIndex = byId<HTMLElement>('annotation-form-index');
const annotationPartName = byId<HTMLElement>('annotation-part-name');
const annotationTitle = byId<HTMLInputElement>('annotation-title');
const annotationDescription = byId<HTMLTextAreaElement>('annotation-description');
const annotationSeverity = byId<HTMLSelectElement>('annotation-severity');
const annotationStatus = byId<HTMLSelectElement>('annotation-status');
const annotationDelete = byId<HTMLButtonElement>('annotation-delete');
const annotationCancel = byId<HTMLButtonElement>('annotation-cancel');
const annotationList = byId<HTMLElement>('annotation-list');
const annotationOverlay = byId<HTMLElement>('annotation-overlay');
const annotationCount = byId<HTMLElement>('annotation-count');
const annotationListCount = byId<HTMLElement>('annotation-list-count');
const partsInspectorPanel = byId<HTMLElement>('parts-inspector-panel');
const inspector = byId<HTMLElement>('inspector');
const inspectorToggle = byId<HTMLButtonElement>('inspector-toggle');
const compactViewport = window.matchMedia('(max-width: 900px), (pointer: coarse) and (max-width: 1400px)');
let mobileInspectorOpen = false;
let desktopUiScale = 1;
const partsTab = byId<HTMLButtonElement>('parts-tab');
const annotationsTab = byId<HTMLButtonElement>('annotations-tab');
const sensorsTab = byId<HTMLButtonElement>('sensors-tab');
const sensorPanel = byId<HTMLElement>('sensor-panel');
const sensorOverlay = byId<HTMLElement>('sensor-overlay');
const sensorAlarmCount = byId<HTMLElement>('sensor-alarm-count');
const sensorNormalCount = byId<HTMLElement>('sensor-normal-count');
const sensorWarningCount = byId<HTMLElement>('sensor-warning-count');
const sensorCriticalCount = byId<HTMLElement>('sensor-critical-count');
const sensorOfflineCount = byId<HTMLElement>('sensor-offline-count');
const sensorStreamState = byId<HTMLElement>('sensor-stream-state');
const sensorList = byId<HTMLElement>('sensor-list');
const sensorDetail = byId<HTMLElement>('sensor-detail');
const sensorDetailClose = byId<HTMLButtonElement>('sensor-detail-close');
const sensorDetailId = byId<HTMLElement>('sensor-detail-id');
const sensorDetailName = byId<HTMLElement>('sensor-detail-name');
const sensorDetailPart = byId<HTMLElement>('sensor-detail-part');
const sensorDetailValue = byId<HTMLElement>('sensor-detail-value');
const sensorDetailUnit = byId<HTMLElement>('sensor-detail-unit');
const sensorDetailStatus = byId<HTMLElement>('sensor-detail-status');
const sensorDetailTime = byId<HTMLElement>('sensor-detail-time');
const sensorDetailQuality = byId<HTMLElement>('sensor-detail-quality');
const sensorWarningThreshold = byId<HTMLElement>('sensor-warning-threshold');
const sensorAlarmThreshold = byId<HTMLElement>('sensor-alarm-threshold');
const sensorTrend = byId<HTMLCanvasElement>('sensor-trend');
const sensorCreateAnnotation = byId<HTMLButtonElement>('sensor-create-annotation');
const sensorLayerToggle = byId<HTMLButtonElement>('sensor-layer-toggle');
const navigationOrbit = byId<HTMLButtonElement>('navigation-orbit');
const navigationPan = byId<HTMLButtonElement>('navigation-pan');
const navigationReset = byId<HTMLButtonElement>('navigation-reset');
const annotationRaycaster = new THREE.Raycaster();
annotationRaycaster.layers.enable(MOVING_LAYER);
annotationRaycaster.layers.enable(SHELL_LAYER);
annotationRaycaster.layers.enable(GENERATOR_GLASS_LAYER);
const annotationPointer = new THREE.Vector2();
const annotationMeshLookup = new Map<string, THREE.Mesh>();
const annotationMarkerElements = new Map<string, HTMLButtonElement>();
const sensorMarkerElements = new Map<string, HTMLButtonElement>();
const sensorRowElements = new Map<string, HTMLButtonElement>();
const annotations: EngineeringAnnotation[] = [];
const sensors: SensorRuntime[] = [];
const LEGACY_ANNOTATION_STORAGE_KEY = 'wind-turbine-engineering-annotations-v1';
const ANNOTATION_STORAGE_KEY = 'wind-turbine-engineering-annotations-v2';
let annotationModeActive = false;
let activeAnnotationId: string | null = null;
let pendingAnnotationId: string | null = null;
let annotationPointerStart: { x: number; y: number; button: number } | null = null;
let selectedSensorId: string | null = null;
let sensorLayerVisible = false;
let stopSensorStream: (() => void) | null = null;

const SENSOR_DEFINITIONS: SensorDefinition[] = [
  { id: 'WT01-MB-T01', name: '主轴承温度', partLabel: '主轴承', metric: 'temperature', unit: '℃', baseValue: 66.2, amplitude: 2.1, warning: 75, alarm: 85, precision: 1, phase: .2, anchor: [.52, .82, .36] },
  { id: 'WT01-MS-V01', name: '主轴径向振动', partLabel: '主轴组件', metric: 'vibration_rms', unit: 'mm/s', baseValue: 2.3, amplitude: .55, warning: 4.5, alarm: 7.1, precision: 2, phase: 1.1, anchor: [.58, .68, .62] },
  { id: 'WT01-GB-OIL-T01', name: '齿轮箱油温', partLabel: '齿轮箱', metric: 'oil_temperature', unit: '℃', baseValue: 72.4, amplitude: 1.8, warning: 70, alarm: 80, precision: 1, phase: 2.4, anchor: [.42, .84, .36] },
  { id: 'WT01-GB-V01', name: '齿轮箱高速级振动', partLabel: '齿轮箱', metric: 'vibration_rms', unit: 'mm/s', baseValue: 8.55, amplitude: .2, warning: 5.5, alarm: 8, precision: 2, phase: .8, anchor: [.68, .73, .66] },
  { id: 'WT01-HSC-V01', name: '高速联轴器振动', partLabel: '高速轴联轴器', metric: 'vibration_rms', unit: 'mm/s', baseValue: 3.05, amplitude: .65, warning: 5, alarm: 7.5, precision: 2, phase: 3.1, anchor: [.5, .78, .55] },
  { id: 'WT01-GEN-WT01', name: '发电机绕组温度', partLabel: '发电机', metric: 'winding_temperature', unit: '℃', baseValue: 88.6, amplitude: 3.4, warning: 105, alarm: 120, precision: 1, phase: 1.8, anchor: [.38, .86, .35] },
  { id: 'WT01-GEN-BT01', name: '发电机轴承温度', partLabel: '发电机', metric: 'bearing_temperature', unit: '℃', baseValue: 69.8, amplitude: 2.3, warning: 80, alarm: 90, precision: 1, phase: 4.2, anchor: [.7, .72, .62] },
  { id: 'WT01-HYD-P01', name: '液压系统压力', partLabel: '液压系统', metric: 'pressure', unit: 'bar', baseValue: 155, amplitude: 4.5, warning: 175, alarm: 190, precision: 1, phase: 2.8, anchor: [.55, .82, .52], demoQuality: 'bad' },
  { id: 'WT01-TR-T01', name: '辅助变压器温度', partLabel: '辅助变压器', metric: 'temperature', unit: '℃', baseValue: 76.3, amplitude: 2.8, warning: 90, alarm: 105, precision: 1, phase: 5.1, anchor: [.52, .88, .48] },
  { id: 'WT01-YAW-V01', name: '偏航驱动振动', partLabel: '偏航系统', metric: 'vibration_rms', unit: 'mm/s', baseValue: 1.75, amplitude: .4, warning: 4.5, alarm: 7.1, precision: 2, phase: 3.8, anchor: [.62, .8, .44] },
];

let renderRequested = true;
let cameraMotionActive = false;
let applyingCameraPreset = false;
let viewportWidth = canvas.clientWidth;
let viewportHeight = canvas.clientHeight;
let overlayOffsetX=0,overlayOffsetY=0;
const viewportObserver = new ResizeObserver(() => {
  viewportWidth = canvas.clientWidth; viewportHeight = canvas.clientHeight;
  updateDesktopProportions();
  const canvasRect=canvas.getBoundingClientRect(),appRect=byId('app').getBoundingClientRect();
  overlayOffsetX=canvasRect.left-appRect.left;overlayOffsetY=canvasRect.top-appRect.top;
  invalidateStaticFrame();
});
viewportObserver.observe(canvas);
let staticFrameDirty = true;
let staticFrameBuilds = 0;
let staticFrameTarget: THREE.WebGLRenderTarget | null = null;
let compositeFrameTarget: THREE.WebGLRenderTarget | null = null;
const staticFrameScene = new THREE.Scene();
const staticFrameCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const cachedDepth = { value: null as THREE.DepthTexture | null };
const staticFrameMaterial = new THREE.MeshBasicMaterial({ depthTest: true, depthWrite: true, toneMapped: false });
staticFrameMaterial.onBeforeCompile = shader => {
  shader.uniforms.cachedDepth = cachedDepth;
  shader.fragmentShader = 'uniform sampler2D cachedDepth;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>',
    '#include <dithering_fragment>\n gl_FragDepth = texture2D(cachedDepth, vMapUv).r;');
};
const staticFrameQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), staticFrameMaterial);
staticFrameScene.add(staticFrameQuad);
const displayFrameScene=new THREE.Scene();
const displayFrameMaterial=new THREE.MeshBasicMaterial({depthTest:false,depthWrite:false,toneMapped:true});
const displayFrameQuad=new THREE.Mesh(staticFrameQuad.geometry,displayFrameMaterial);
displayFrameScene.add(displayFrameQuad);
function invalidateStaticFrame(bindingsChanged=true): void {
  staticFrameDirty = true; renderRequested = true;
  if(bindingsChanged){spatialCandidatesDirty=true;motionRenderer?.invalidateBindings();fixedRenderer?.invalidateBindings();generatorGlassRenderer?.invalidateBindings();}
}

function ensureFrameTarget(): void {
  if (!staticFrameTarget || staticFrameTarget.width !== canvas.width || staticFrameTarget.height !== canvas.height) {
    staticFrameTarget?.dispose();
    compositeFrameTarget?.dispose();
    staticFrameTarget = new THREE.WebGLRenderTarget(canvas.width, canvas.height, { type: THREE.HalfFloatType, depthBuffer: true });
    staticFrameTarget.depthTexture = new THREE.DepthTexture(canvas.width, canvas.height, THREE.UnsignedIntType);
    compositeFrameTarget=new THREE.WebGLRenderTarget(canvas.width,canvas.height,{type:THREE.HalfFloatType,depthBuffer:true});
    displayFrameMaterial.map=compositeFrameTarget.texture;displayFrameMaterial.needsUpdate=true;
    staticFrameMaterial.map = staticFrameTarget.texture;
    cachedDepth.value = staticFrameTarget.depthTexture;
    staticFrameMaterial.needsUpdate = true;
    staticFrameDirty = true;
  }
}

function renderNavigationFrame():void{
  ensureFrameTarget();
  const mask=camera.layers.mask,background=scene.background;
  renderer.setRenderTarget(compositeFrameTarget);
  camera.layers.set(STATIC_LAYER);camera.layers.enable(SHELL_LAYER);
  if(fixedRenderer)fixedRenderer.render(renderer,camera);else renderer.render(scene,camera);
  // Draw all geometry into the same single-sample HDR target during gestures;
  // resolving the entire transparent CAD through default MSAA was expensive.
  renderer.autoClear=false;scene.background=null;camera.layers.set(MOVING_LAYER);
  if(motionRenderer)motionRenderer.render(renderer,camera);else renderer.render(scene,camera);
  camera.layers.set(GENERATOR_GLASS_LAYER);
  if(generatorGlassRenderer)generatorGlassRenderer.render(renderer,camera);else renderer.render(scene,camera);
  renderer.autoClear=true;scene.background=background;camera.layers.mask=mask;
  renderer.setRenderTarget(null);renderer.render(displayFrameScene,staticFrameCamera);
  staticFrameDirty=true; // this target contains motion; rebuild the fixed layer once on release.
}

function renderMotionFrame(): void {
  ensureFrameTarget();
  const mask = camera.layers.mask;
  const background = scene.background;
  const selectionVisible = selectionBox.visible;
  if (staticFrameDirty) {
    staticFrameBuilds++;
    camera.layers.set(STATIC_LAYER);
    camera.layers.enable(SHELL_LAYER);
    selectionBox.visible = false;
    renderer.setRenderTarget(staticFrameTarget);
    if(fixedRenderer)fixedRenderer.render(renderer,camera);else renderer.render(scene,camera);
    staticFrameDirty = false;
  }
  selectionBox.visible = selectionVisible;
  renderer.setRenderTarget(compositeFrameTarget);
  // Both navigation and stationary frames blend transparency in linear HDR,
  // then use one final tone-map. This keeps blade opacity visually consistent.
  renderer.render(staticFrameScene, staticFrameCamera);
  renderer.autoClear = false;
  scene.background = null;
  camera.layers.set(MOVING_LAYER);
  if(motionOptimizationEnabled&&motionRenderer)motionRenderer.render(renderer,camera);else renderer.render(scene,camera);
  // Complete transparent stator/cover geometry must blend over the live rotor,
  // rather than being baked behind it in the fixed-frame cache.
  camera.layers.set(GENERATOR_GLASS_LAYER);
  if(generatorGlassRenderer)generatorGlassRenderer.render(renderer,camera);else renderer.render(scene,camera);
  renderer.autoClear = true;
  scene.background = background;
  camera.layers.mask = mask;
  renderer.setRenderTarget(null);renderer.render(displayFrameScene,staticFrameCamera);
}

function handleCameraChange(): void {
  let bindingsChanged=false;
  if (cameraMotionActive&&!applyingCameraPreset) {
    navigationRendering=true;
    document.body.classList.add('rendering-active');
    bindingsChanged=interactionLod?.setActive(true)??false;
    if(motionOptimizationEnabled)bindingsChanged=(contextMaterialLod?.setActive(true)??false)||bindingsChanged;
    setRenderScale(interactionLod?.ready ? (motionOptimizationEnabled?renderQuality.navigationScale:.8) : (displayMode === 'xray' ? 0.46 : 0.68));
  }
  invalidateStaticFrame(bindingsChanged);
}

function updateCameraPreset():void{
  // Pointer selection can run before OrbitControls receives pointer-up. A
  // programmatic recenter must not reactivate the drag-only geometry/materials.
  applyingCameraPreset=true;
  try{controls.update();camera.updateMatrixWorld(true);}
  finally{applyingCameraPreset=false;}
}

function setRenderScale(cap: number): void {
  const next = Math.min(devicePixelRatio, cap);
  if (Math.abs(renderer.getPixelRatio() - next) < 0.01) return;
  renderer.setPixelRatio(next);
  invalidateStaticFrame();
}

function restingRenderScale(): number {
  return motionOptimizationEnabled&&rotorSpinning&&(drivetrain?.rpm??0)>0?renderQuality.motionScale:1;
}

function beginInteractiveRender(): void {
  if (detailRestoreTimer) clearTimeout(detailRestoreTimer);
  cameraMotionActive = true;
  homeFramingActive=false;
}

function endInteractiveRender(): void {
  cameraMotionActive = false;
  if (interactionLod?.active || contextMaterialLod?.active || renderer.getPixelRatio() < Math.min(devicePixelRatio, 1)) {
    detailRestoreTimer = setTimeout(restoreFullDetail, 120);
  }
}

function restoreFullDetail(): void {
  navigationRendering=false;
  document.body.classList.toggle('rendering-active',rotorSpinning);
  if (detailRestoreTimer) clearTimeout(detailRestoreTimer);
  detailRestoreTimer = null;
  const changed = interactionLod?.setActive(false);
  const materialsChanged=contextMaterialLod?.setActive(false);
  // Bounds and picking may inspect hidden source children. Refresh those once
  // at interaction boundaries, while animation only updates visible branches.
  modelRoot?.updateMatrixWorld(true);
  drivetrain?.demonstrations.forEach(d=>d.root.updateMatrixWorld(true));
  setRenderScale(restingRenderScale());
  if (changed||materialsChanged) invalidateStaticFrame();
}

controls.addEventListener('start', beginInteractiveRender);
controls.addEventListener('end', endInteractiveRender);
controls.addEventListener('change', handleCameraChange);

function resizeRenderer(): void {
  const width = viewportWidth;
  const height = viewportHeight;
  // Match WebGLRenderer.setSize's floor rounding; round caused continual target
  // reallocations and cache rebuilds at fractional interaction resolutions.
  if (canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio())) {
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    if(homeFramingActive&&homeViewBounds)fitHomeView();
    else if(camera.view?.enabled)applyPresentationOffset(presentationFrame());
    else camera.updateProjectionMatrix();
    invalidateStaticFrame();
  }
}

function saveMaterialState(material: THREE.Material): void {
  if (materialState.has(material)) return;
  const standard = material as THREE.MeshStandardMaterial;
  materialState.set(material, {
    transparent: material.transparent,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    side: material.side,
    clippingPlanes: standard.clippingPlanes ?? null,
  });
}

function restoreMaterialState(material: THREE.Material): void {
  const original = materialState.get(material);
  if (!original) return;
  const standard = material as THREE.MeshStandardMaterial;
  material.transparent = original.transparent;
  material.opacity = original.opacity;
  material.depthWrite = original.depthWrite;
  material.side = original.side;
  standard.clippingPlanes = original.clippingPlanes;
  material.needsUpdate = true;
}

function coloredXrayMaterial(
  original: THREE.Material,
  opacity: number,
  fallback: THREE.Material,
  profile?: IndustrialMaterialProfile,
): THREE.Material {
  const cacheKey = profile
    ? `${opacity.toFixed(2)}-${profile.tint.toString(16)}-${profile.metalness}-${profile.roughness}-${profile.clearcoat ?? 0}`
    : `${opacity.toFixed(2)}-source`;
  let cache = coloredXrayMaterialCaches.get(cacheKey);
  if (!cache) {
    cache = new WeakMap<THREE.Material, THREE.Material>();
    coloredXrayMaterialCaches.set(cacheKey, cache);
  }
  const cached = cache.get(original);
  if (cached) return cached;

  const clone = original.clone();
  const colored = clone as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
    metalness?: number;
    roughness?: number;
    clearcoat?: number;
    clearcoatRoughness?: number;
  };
  if (!colored.color?.isColor) {
    // Non-standard imported materials still obey the requested opacity tier.
    // Returning the shared translucent fallback here made opaque internal CAD
    // meshes appear to penetrate one another.
    clone.dispose();
    const resolvedFallback = fallback.clone();
    resolvedFallback.transparent = opacity < 0.999;
    resolvedFallback.opacity = opacity;
    resolvedFallback.depthWrite = opacity >= 0.999;
    resolvedFallback.side = THREE.FrontSide;
    resolvedFallback.name = `${fallback.name || fallback.type} · resolved-opacity`;
    resolvedFallback.needsUpdate = true;
    cache.set(original, resolvedFallback);
    generatedXrayMaterials.add(resolvedFallback);
    return resolvedFallback;
  }
  if (profile) {
    const sourceHsl = { h: 0, s: 0, l: 0 };
    colored.color.getHSL(sourceHsl);
    const semantic = new THREE.Color(profile.tint);
    colored.color.lerp(semantic, Math.min(profile.tintMix, 0.98));
    if (colored.metalness !== undefined) colored.metalness = profile.metalness;
    if (colored.roughness !== undefined) colored.roughness = profile.roughness;
    if (colored.clearcoat !== undefined && profile.clearcoat !== undefined) colored.clearcoat = profile.clearcoat;
    if (colored.clearcoatRoughness !== undefined && profile.clearcoatRoughness !== undefined) {
      colored.clearcoatRoughness = profile.clearcoatRoughness;
    }
  }
  colored.color.offsetHSL(0, 0.025, -0.012);
  if (colored.emissive?.isColor) {
    colored.emissive.copy(colored.color).multiplyScalar(profile?.emissiveScale ?? 0.035);
    if (colored.emissiveIntensity !== undefined) colored.emissiveIntensity = 0.18;
  }
  clone.transparent = opacity < 0.999;
  clone.opacity = opacity;
  // Transparent CAD shells often contain touching/coplanar faces. Depth writes
  // make tiny sort changes appear as flicker after the camera stops.
  clone.depthWrite = opacity >= 0.999;
  clone.side = THREE.FrontSide;
  clone.name = `${original.name || original.type} · source-color-xray`;
  clone.needsUpdate = true;
  cache.set(original, clone);
  generatedXrayMaterials.add(clone);
  return clone;
}

function coloredXrayMaterials(
  original: THREE.Material | THREE.Material[],
  opacity: number,
  fallback: THREE.Material,
  part?: PartRecord,
  mesh?: THREE.Mesh,
): THREE.Material | THREE.Material[] {
  return Array.isArray(original)
    ? original.map((material) => coloredXrayMaterial(material, opacity, fallback, industrialMaterialProfile(part, material, mesh)))
    : coloredXrayMaterial(original, opacity, fallback, industrialMaterialProfile(part, original, mesh));
}

const INDUSTRIAL_LOW_SAT_BLUE = 0x7096ce;
const INDUSTRIAL_BRIGHT_SILVER = 0xc6d0d3;

function brightSilverProfile(tintMix = 0.97): IndustrialMaterialProfile {
  return { tint: INDUSTRIAL_BRIGHT_SILVER, tintMix, metalness: 0.86, roughness: 0.26, emissiveScale: 0.001 };
}

function sourceMappedIndustrialProfile(original: THREE.Material | undefined, machinery: boolean): IndustrialMaterialProfile {
  const source = (original as THREE.MeshStandardMaterial | undefined)?.color;
  if (!source?.isColor) return brightSilverProfile(0.92);
  const hsl = { h: 0, s: 0, l: 0 };
  source.getHSL(hsl);

  // The imported CAD uses vivid rainbow colours to separate sub-parts. Treat
  // those colours as segmentation evidence, then quantize them into the field
  // photo's blue/white/yellow/black/silver industrial palette.
  if (hsl.s < 0.16) {
    if (hsl.l > 0.76) return { tint: 0xe1e5e3, tintMix: 0.94, metalness: 0.05, roughness: 0.36, clearcoat: 0.18, clearcoatRoughness: 0.42, emissiveScale: 0.001 };
    if (hsl.l > 0.14) return brightSilverProfile(0.96);
    return { tint: 0x30383d, tintMix: 0.88, metalness: 0.22, roughness: 0.44, emissiveScale: 0.001 };
  }
  if (hsl.h < 0.18) {
    return machinery
      ? { tint: 0xf0bf18, tintMix: 0.9, metalness: 0.06, roughness: 0.34, clearcoat: 0.2, clearcoatRoughness: 0.38, emissiveScale: 0.001 }
      : { tint: 0xb27a35, tintMix: 0.76, metalness: 0.55, roughness: 0.31, emissiveScale: 0.001 };
  }
  if (hsl.h < 0.48) return brightSilverProfile(0.95);
  if (hsl.h < 0.72) return { tint: machinery ? INDUSTRIAL_LOW_SAT_BLUE : 0x5f7f9e, tintMix: 0.86, metalness: 0.09, roughness: 0.31, clearcoat: 0.18, clearcoatRoughness: 0.38, emissiveScale: 0.001 };
  return hsl.l > 0.62
    ? { tint: 0xe1e5e3, tintMix: 0.88, metalness: 0.05, roughness: 0.34, emissiveScale: 0.001 }
    : brightSilverProfile(0.95);
}

function generatorPaletteProfile(original: THREE.Material | undefined, meshName = ''): IndustrialMaterialProfile {
  // Stable source-mesh partition for the seven-surface imported generator:
  // one main blue casing, one yellow service/connection surface, and the
  // remaining covers/end structures in machined metallic grey.
  if (/^mesh_148(?:_1|_3|_5|_6)$/.test(meshName)) {
    return brightSilverProfile();
  }
  if (meshName === 'mesh_148') {
    return { tint: 0xf0bf18, tintMix: 0.94, metalness: 0.08, roughness: 0.33, clearcoat: 0.18, clearcoatRoughness: 0.38, emissiveScale: 0.001 };
  }
  if (meshName === 'mesh_148_2' || meshName === 'mesh_148_4') {
    return { tint: INDUSTRIAL_LOW_SAT_BLUE, tintMix: 0.96, metalness: 0.09, roughness: 0.29, clearcoat: 0.23, clearcoatRoughness: 0.34, emissiveScale: 0.001 };
  }
  const source = (original as THREE.MeshStandardMaterial | undefined)?.color;
  const hsl = { h: 0, s: 0, l: 0 };
  source?.getHSL(hsl);
  if (source?.isColor && hsl.s > 0.28 && hsl.h < 0.18) {
    return { tint: 0xf0bf18, tintMix: 0.94, metalness: 0.08, roughness: 0.33, clearcoat: 0.18, clearcoatRoughness: 0.38, emissiveScale: 0.001 };
  }
  if (source?.isColor && ((hsl.s < 0.16 && hsl.l > 0.7) || hsl.h > 0.72)) {
    return brightSilverProfile(0.96);
  }
  return { tint: INDUSTRIAL_LOW_SAT_BLUE, tintMix: 0.95, metalness: 0.09, roughness: 0.29, clearcoat: 0.23, clearcoatRoughness: 0.34, emissiveScale: 0.001 };
}

function electricalCabinetPaletteProfile(original: THREE.Material | undefined): IndustrialMaterialProfile {
  const source = (original as THREE.MeshStandardMaterial | undefined)?.color;
  const hsl = { h: 0, s: 0, l: 0 };
  source?.getHSL(hsl);
  if (source?.isColor && hsl.s > 0.28 && hsl.h < 0.18) {
    return { tint: 0xf0bf18, tintMix: 0.94, metalness: 0.06, roughness: 0.34, clearcoat: 0.18, clearcoatRoughness: 0.4, emissiveScale: 0.001 };
  }
  if (source?.isColor && hsl.s < 0.16 && hsl.l < 0.3) {
    return { tint: 0x20262b, tintMix: 0.94, metalness: 0.12, roughness: 0.46, emissiveScale: 0.001 };
  }
  if (source?.isColor && hsl.s < 0.2 && hsl.l > 0.76) {
    return { tint: 0xe1e5e3, tintMix: 0.94, metalness: 0.05, roughness: 0.36, clearcoat: 0.16, clearcoatRoughness: 0.42, emissiveScale: 0.001 };
  }
  if (source?.isColor && hsl.s < 0.2 && hsl.l > 0.48) {
    return brightSilverProfile(0.95);
  }
  return { tint: INDUSTRIAL_LOW_SAT_BLUE, tintMix: 0.94, metalness: 0.07, roughness: 0.31, clearcoat: 0.2, clearcoatRoughness: 0.36, emissiveScale: 0.001 };
}

function transformerPaletteProfile(meshName = ''): IndustrialMaterialProfile {
  // Source part 20020010139 is exported as fourteen stable material meshes.
  // Keep the enclosure predominantly blue, use brushed silver for secondary
  // doors/edge panels, and reserve yellow for small service details only.
  if (/^mesh_82(?:_1|_2|_3|_6|_7|_10|_11)$/.test(meshName)) {
    return brightSilverProfile();
  }
  if (/^mesh_82(?:_12)?$/.test(meshName)) {
    return { tint: 0xf0bf18, tintMix: 0.97, metalness: 0.07, roughness: 0.33, clearcoat: 0.2, clearcoatRoughness: 0.38, emissiveScale: 0.001 };
  }
  return { tint: INDUSTRIAL_LOW_SAT_BLUE, tintMix: 0.97, metalness: 0.08, roughness: 0.29, clearcoat: 0.24, clearcoatRoughness: 0.34, emissiveScale: 0.001 };
}

function industrialMaterialProfile(part: PartRecord | undefined, original?: THREE.Material, mesh?: THREE.Mesh): IndustrialMaterialProfile {
  const assemblyPath: string[] = [];
  let cursor: THREE.Object3D | null = part?.node ?? null;
  while (cursor && cursor !== modelRoot) {
    if (cursor.name) assemblyPath.push(cursor.name);
    cursor = cursor.parent;
  }
  const label = `${part?.label ?? ''}/${assemblyPath.join('/')}`;
  const directLabel = part?.label ?? '';
  const leafLabel = directLabel.split('#').at(-1) ?? directLabel;
  // Field-reference palette: deep blue painted machinery, warm-white enclosures,
  // safety-yellow guards, black elastomers/cables and silver exposed metal.
  if (/叶片|风轮外形/i.test(label)) return { tint: 0xe4e8e7, tintMix: 0.97, metalness: 0.01, roughness: 0.42, clearcoat: 0.18, clearcoatRoughness: 0.45, emissiveScale: 0.001 };
  if (/铜|绕组|线圈|母排/i.test(leafLabel)) return { tint: 0xa65f35, tintMix: 0.92, metalness: 0.82, roughness: 0.28, emissiveScale: 0.002 };
  if (/急停|消防|灭火|报警/i.test(leafLabel)) return { tint: 0xb43a31, tintMix: 0.97, metalness: 0.04, roughness: 0.34, clearcoat: 0.16, clearcoatRoughness: 0.4, emissiveScale: 0.002 };
  if (/制动器|制动钳|刹车钳|护罩|防护罩|护栏|扶手|锁紧装置|安全销/i.test(leafLabel)) return { tint: 0xf0bf18, tintMix: 0.97, metalness: 0.06, roughness: 0.34, clearcoat: 0.2, clearcoatRoughness: 0.38, emissiveScale: 0.002 };
  if (/电缆|电线|线束|软管|橡胶|密封/i.test(leafLabel)) return { tint: 0x20262b, tintMix: 0.98, metalness: 0.01, roughness: 0.56, clearcoat: 0.04, clearcoatRoughness: 0.68, emissiveScale: 0.001 };
  if (/20020010139#变压器|变压器/i.test(leafLabel)) return transformerPaletteProfile(mesh?.name);
  if (/配电箱|配电柜|电柜|控制柜|控制箱|控制器|变流|开关柜|电源柜|电气箱|电气柜|机柜/i.test(leafLabel)) return electricalCabinetPaletteProfile(original);
  if (/冷却器|散热器|过滤柜|设备罩|顶罩/i.test(leafLabel)) return { tint: 0xe1e5e3, tintMix: 0.97, metalness: 0.05, roughness: 0.36, clearcoat: 0.18, clearcoatRoughness: 0.42, emissiveScale: 0.001 };
  if (/主轴|传动轴|高速轴|齿轮(?!箱)|轴承|法兰|衬套|管夹|接头|紧固|制动盘/i.test(leafLabel)) return brightSilverProfile();
  if (/底座|机架|支撑|梁|平台|框架|塔架|塔身|防护板|护板/i.test(leafLabel)) return { tint: 0x153a6b, tintMix: 0.86, metalness: 0.1, roughness: 0.32, clearcoat: 0.2, clearcoatRoughness: 0.38, emissiveScale: 0.001 };
  if (/电气|桥架|接线|变压/i.test(leafLabel)) return { tint: 0xd7dcdb, tintMix: 0.92, metalness: 0.06, roughness: 0.38, clearcoat: 0.14, clearcoatRoughness: 0.46, emissiveScale: 0.001 };
  if (/发电机/i.test(leafLabel)) return generatorPaletteProfile(original, mesh?.name);
  if (/齿轮箱|偏航|变桨|轮毂|液压|润滑|油泵|油箱|过滤|水泵|风扇|联轴器|测速盘/i.test(leafLabel)) {
    if ((part?.meshCount ?? 0) > 4) return sourceMappedIndustrialProfile(original, true);
    return { tint: INDUSTRIAL_LOW_SAT_BLUE, tintMix: 0.88, metalness: 0.08, roughness: 0.29, clearcoat: 0.24, clearcoatRoughness: 0.34, emissiveScale: 0.001 };
  }
  return sourceMappedIndustrialProfile(original, false);
}

function refreshPartVisibility(): void {
  parts.forEach((part) => {
    const modeHidden = displayMode === 'xray'
      && hideAuxiliary.checked
      && part.role === 'auxiliary';
    const hidden=[...userHiddenParts].some(record=>belongsToPart(part.node,record));
    part.node.visible = isIsolated
      ? Boolean(selectedPart&&partRoots(selectedPart).some(root=>part.node===root||isDescendantOf(part.node,root)||isDescendantOf(root,part.node)))
      : part.originalVisible && !hidden && !modeHidden;
  });
  drivetrain?.syncVisibility(displayMode, isIsolated, selectedPart?.node ?? null);
  const visible = parts.filter((part) => part.node.visible).length;
  if (parts.length) {
    byId('metric-parts').textContent = visible.toLocaleString('zh-CN');
  }
  invalidateStaticFrame();
}

function isWithinSelectedAssembly(object: THREE.Object3D, selected: THREE.Object3D): boolean {
  return object === selected || isDescendantOf(object, selected);
}

function partRoots(part:PartRecord):THREE.Object3D[]{return part.members??[part.node,...(part.attachments??[])];}
function belongsToPart(object:THREE.Object3D,part:PartRecord):boolean{return partRoots(part).some(root=>isWithinSelectedAssembly(object,root));}
function partBounds(part:PartRecord):THREE.Box3{
  const bounds=new THREE.Box3();partRoots(part).forEach(root=>bounds.union(new THREE.Box3().setFromObject(root)));return bounds;
}
function partOrbitCenter(part:PartRecord):THREE.Vector3{
  // The three blades are one selection. Their rotating AABB has a shifting
  // center, whereas the shared rotor axis is fixed in the nacelle.
  if(part.members&&drivetrain)return new THREE.Vector3().fromArray(drivetrain.anchors.lowOrigin);
  if(part.label==='轮毂总成'&&part.attachments)return new THREE.Box3().setFromObject(part.node).getCenter(new THREE.Vector3());
  return partBounds(part).getCenter(new THREE.Vector3());
}

function centerOrbitOnPart(part:PartRecord):void{
  homeFramingActive=false;
  const center=partOrbitCenter(part);
  // Recenter a model click without changing the viewing direction or zoom.
  camera.position.add(center.clone().sub(controls.target));
  controls.target.copy(center);
  updateCameraPreset();
  invalidateStaticFrame();
}
function setPresentationMode(mode:'overview'|'drivetrain'):void{
  presentationMode=mode;
  if(drivetrain){drivetrain.showInternals=mode==='drivetrain';drivetrain.generatorPresentation=mode==='drivetrain'?'section':'cad';}
  byId<HTMLInputElement>('show-internals').checked=mode==='drivetrain';
}

function relationRole(mesh:THREE.Object3D):RelationRole{
  if(!selectedPart||!selectedRelationships)return 'context';
  // Prefer the explicit leaf owner. A bearing nested under the shaft assembly
  // is still a support, rather than inheriting the shaft's current-part role.
  const owner=majorMeshToPart.get(mesh);
  if(owner)return selectedRelationships.roles.get(owner.label)??'context';
  if(belongsToPart(mesh,selectedPart))return 'current';
  return 'context';
}
function relationProfile(role:RelationRole):IndustrialMaterialProfile{
  return {tint:role==='upstream'?0x73804a:role==='downstream'?0xcfb274:role==='related'?0x9b83af:0xa5b6c1,
    tintMix:.88,metalness:.50,roughness:.34,emissiveScale:.001};
}
function styleBlade(mesh:THREE.Mesh):void{
  const role=relationRole(mesh),relating=Boolean(selectedRelationships&&partFocusActive);
  // The rotor remains substantial when the surrounding drivetrain is ghosted.
  // Keep this material policy independent of playback and interaction quality.
  mesh.material=relating&&(role==='upstream'||role==='downstream'||role==='related')
    ?coloredXrayMaterial(uniformBladeMaterial,.85,uniformBladeMaterial,relationProfile(role))
    :uniformBladeMaterial;
  mesh.userData.relationshipRole=relating?role:'none';mesh.renderOrder=3;
}
function styleRotorHub(mesh:THREE.Mesh):void{
  const original=originalMeshMaterials.get(mesh);if(!original)return;
  const role=relationRole(mesh),relating=Boolean(selectedRelationships&&partFocusActive);
  const opacity=hubShellMeshes.has(mesh)?.70:1;
  if(relating&&(role==='upstream'||role==='downstream'||role==='related')){
    mesh.material=Array.isArray(original)?original.map(m=>coloredXrayMaterial(m,opacity,xrayEquipmentMaterial,relationProfile(role)))
      :coloredXrayMaterial(original,opacity,xrayEquipmentMaterial,relationProfile(role));
  }else{
    if(hubShellMeshes.has(mesh))mesh.material=hubShellMaterial;
    else{
      // The rotor assembly ancestor is also used by the blades. Do not let
      // that broad label turn the cast hub and its fittings into white plastic.
      const profile:IndustrialMaterialProfile={tint:0xaebcc5,tintMix:.98,metalness:.86,roughness:.30,emissiveScale:.001};
      mesh.material=Array.isArray(original)?original.map(m=>coloredXrayMaterial(m,1,xrayEquipmentMaterial,profile))
        :coloredXrayMaterial(original,1,xrayEquipmentMaterial,profile);
    }
  }
  mesh.userData.relationshipRole=relating?role:'none';mesh.renderOrder=3;
}
function styleDemonstrationRelations():void{
  drivetrain?.demonstrations.forEach((demo,index)=>{
    // Selection only changes emphasis. Visibility belongs to the presentation
    // mode (and explicit hide/isolate controls), so the power chain stays intact.
    demo.root.traverse(object=>{
      const mesh=object as THREE.Mesh;if(!mesh.isMesh)return;
      const owner=majorMeshToPart.get(mesh)?.label??(index===0?'齿轮箱':'发电机');
      const role=selectedRelationships?.roles.get(owner);
      mesh.userData.relationshipRole=selectedRelationships?(role??'context'):'none';
      for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material]){
        const standard=material as THREE.MeshStandardMaterial;if(!standard.color)continue;
        if(!demoMaterialColors.has(material))demoMaterialColors.set(material,standard.color.clone());
        standard.color.copy(demoMaterialColors.get(material)!);
        if(role==='upstream'||role==='downstream'||role==='related')standard.color.lerp(new THREE.Color(relationProfile(role).tint),role==='upstream'?.9:role==='related'?.8:.6);
      }
    });
  });
}

function applyPartFocusVisuals(): void {
  if (!modelRoot || (!(partFocusActive&&selectedPart)&&presentationMode!=='drivetrain')) return;
  modelRoot.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    if(bladeMeshes.has(mesh)){
      styleBlade(mesh);return;
    }
    if(hubBodyMeshes.has(mesh)||hubShellMeshes.has(mesh)){
      styleRotorHub(mesh);return;
    }
    const role=relationRole(mesh);
    mesh.userData.relationshipRole=selectedRelationships?role:'none';
    if(selectedRelationships&&role!=='current'&&role!=='context'){
      const original=originalMeshMaterials.get(mesh);if(!original)return;
      const distance=selectedRelationships.upstream.get(majorMeshToPart.get(mesh)?.label??'')??selectedRelationships.downstream.get(majorMeshToPart.get(mesh)?.label??'')??1;
      const opacity=revealVendorInternals(mesh) ? .035
        : role==='related' ? (meshToPart.get(mesh)?.role==='shell' ? .055 : .42)
        : presentationMode==='drivetrain'&&drivetrainContextMeshes.has(mesh) ? .72
        : distance===1 ? .55 : .23;
      mesh.material=Array.isArray(original)?original.map(m=>coloredXrayMaterial(m,opacity,xrayEquipmentMaterial,relationProfile(role)))
        :coloredXrayMaterial(original,opacity,xrayEquipmentMaterial,relationProfile(role));
      mesh.renderOrder=12;return;
    }
    const isSelected = role==='current'
      || (presentationMode==='drivetrain'&&drivetrainContextMeshes.has(mesh))
      || (!selectedRelationships&&Boolean(selectedPart&&belongsToPart(mesh,selectedPart)));
    if (!isSelected) {
      mesh.material = presentationMode==='drivetrain' && meshToPart.get(mesh)?.role !== 'shell'
        ? connectedContextMaterial : focusContextMaterial;
      mesh.renderOrder = 0;
      return;
    }
    const originalMaterial = originalMeshMaterials.get(mesh);
    if (!originalMaterial) return;
    const opacity = revealVendorInternals(mesh) ? 0.035 : selectedPart?.role==='shell'?.30:1;
    mesh.material = coloredXrayMaterials(originalMaterial, opacity, xrayEquipmentMaterial, meshToPart.get(mesh), mesh);
    mesh.renderOrder = 20;
  });
  invalidateStaticFrame();
}

function revealVendorInternals(mesh: THREE.Mesh): boolean {
  return Boolean(vendorEnclosureMeshes.has(mesh) && drivetrain?.showInternals
    && (!generatorEnclosureMeshes.has(mesh) || drivetrain.generatorPresentation === 'section'));
}

function isGeneratorChainFocus(): boolean {
  return Boolean(partFocusActive && selectedPart?.label.includes('发电机'));
}

function applyDisplayMode(mode: DisplayMode): void {
  contextMaterialLod?.setActive(false);
  displayMode = mode;
  document.querySelectorAll<HTMLButtonElement>('.mode-button').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  byId('section-control').classList.toggle('visible', mode === 'section');
  byId('xray-filter').classList.toggle('visible', mode === 'xray');
  scene.fog = mode === 'xray' ? null : assemblyFog;
  modelRoot?.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const originalMaterial = originalMeshMaterials.get(mesh);
    if (!originalMaterial) return;
    mesh.material = originalMaterial;
    mesh.userData.relationshipRole='none';
    const materials = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
    materials.forEach(restoreMaterialState);
    const part = meshToPart.get(mesh);
    mesh.renderOrder = 0;
    const movingKind = movingMeshKinds.get(mesh);
    if (!movingKind) mesh.layers.set(part?.role === 'shell' ? SHELL_LAYER : STATIC_LAYER);
    if (mode === 'xray') {
      if (bladeMeshes.has(mesh)) {
        styleBlade(mesh);
      } else if(hubBodyMeshes.has(mesh)||hubShellMeshes.has(mesh)){
        styleRotorHub(mesh);
      } else if (movingKind === 'rotor') {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayEquipmentMaterial, part, mesh);
        mesh.renderOrder = 3;
      } else if (towerShellMeshes.has(mesh)) {
        mesh.material = xrayShellMaterial;
        mesh.layers.set(SHELL_LAYER);
        mesh.renderOrder = 10;
      } else if (heroExteriorMeshes.has(mesh)) {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayEquipmentMaterial, part, mesh);
        mesh.renderOrder = 3;
      } else if (part?.role === 'shell') {
        mesh.material = xrayShellMaterial;
        mesh.renderOrder = 10;
      } else if (revealVendorInternals(mesh)) {
        mesh.material = coloredXrayMaterials(originalMaterial, 0.035, xrayVendorEnclosureMaterial, part, mesh);
        mesh.renderOrder = 4;
      } else if (movingKind === 'drivetrain') {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayEquipmentMaterial, part, mesh);
        mesh.renderOrder = 2;
      } else if (vendorEnclosureMeshes.has(mesh)) {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayVendorEnclosureMaterial, part, mesh);
        mesh.renderOrder = 1;
      } else if (keyEquipmentMeshes.has(mesh)) {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayEquipmentMaterial, part, mesh);
        mesh.renderOrder = 1;
      } else {
        mesh.material = coloredXrayMaterials(originalMaterial, 1, xrayStaticMaterial, part, mesh);
      }
    } else if (mode === 'section') {
      materials.forEach((material) => {
        (material as THREE.MeshStandardMaterial).clippingPlanes = [sectionPlane];
        material.needsUpdate = true;
      });
    }
  });
  refreshPartVisibility();
  setRenderScale(restingRenderScale());
  if ((partFocusActive && selectedPart)||presentationMode==='drivetrain') applyPartFocusVisuals();
  styleDemonstrationRelations();
  // The main-parts tree uses material contrast as its selection signal; a CAD
  // bounding cube obscures the component and is intentionally omitted here.
  if (selectedPart && !partFocusActive) emphasizeSelected(selectedPart);
  if (drivetrain && displayMode === 'xray') generatorMaterials.applyTo(drivetrain.demonstrations[1].owner);
  renderPartList(search.value);
  invalidateStaticFrame();
}

function emphasizeSelected(part: PartRecord): void {
  selectionBox.setFromObject(part.node);
  selectionBox.visible = !part.members;
  partRoots(part).forEach(root=>root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.renderOrder = displayMode === 'xray' && part.role === 'shell' ? 2 : 0;
  }));
}

// Only presentation/maintenance clutter is hidden. Functional brackets, cable trays,
// junction boxes, sensors, pipe clamps and structural sections remain visible so the
// source assembly and routing can be audited without silently dropping real hardware.
const AUXILIARY_PATTERN = /螺栓|螺母|垫圈|螺钉|螺杆|开口销|定位销|销轴|挡圈|铆钉|运输架|运输支架|踏板支撑|平台支撑|舱上控制柜支架|高速制动盘防护罩|防护栏|护栏|栏杆|扶梯|爬梯|铝梯|过梯|平台|踏板|操作台|扶手|吊耳|吊装口|吊机口|挂钩|格栅|钢丝网|垫板|盖帽|舱盖|检修盖|逃生盖|人孔盖|天窗|逃生装置|手柄|把手|雨眉|风速风向仪|避雷针|航空灯|主电缆桥架|扁钢桥架|电缆桥架主支撑|通风罩|百叶窗|风口栅格|密封条|毛刷|铰链|合页|锁扣|门锁|快速夹钳|安全锚点|锚点底板|预埋板|铭牌|标牌|标识|小吊机|灭火器|消防/i;
const SHELL_SURFACE_PATTERN = /机舱罩|罩体|上罩|左下罩|右下罩|顶罩|外壳|壳体|罩壳|蒙皮|舱门|塔身/i;

function classifyPart(node: THREE.Object3D): PartRole {
  const assemblyPath: string[] = [];
  let cursor: THREE.Object3D | null = node;
  while (cursor && cursor !== modelRoot) {
    if (cursor.name) assemblyPath.push(cursor.name.split('#').at(-1) ?? cursor.name);
    cursor = cursor.parent;
  }
  if (AUXILIARY_PATTERN.test(assemblyPath.join('/'))) return 'auxiliary';
  if (SHELL_SURFACE_PATTERN.test(assemblyPath.join('/'))) return 'shell';
  return 'internal';
}

function collectPartNodes(root: THREE.Object3D): PartRecord[] {
  const owners: THREE.Object3D[] = [];
  root.traverse((node) => {
    let ancestor: THREE.Object3D | null = node;
    while (ancestor) {
      if (ancestor.userData.motionCue) return;
      ancestor = ancestor.parent;
    }
    if (!node.name.trim()) return;
    const directMeshCount = node.children.filter((child) => (child as THREE.Mesh).isMesh).length;
    if (directMeshCount > 0) owners.push(node);
  });

  const candidates: THREE.Object3D[] = [];
  for (const owner of owners) {
    const hasNestedOwner = owners.some((other) => other !== owner && isDescendantOf(other, owner));
    if (!hasNestedOwner) candidates.push(owner);
    else {
      owner.children.forEach((child, index) => {
        if (!(child as THREE.Mesh).isMesh) return;
        child.name ||= `${owner.name} · surface ${index + 1}`;
        candidates.push(child);
      });
    }
  }

  if (candidates.length < 10) {
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) candidates.push(node);
    });
  }

  const unique = [...new Set(candidates)];
  return unique.map((node, index) => {
    const box = new THREE.Box3().setFromObject(node);
    const center = box.getCenter(new THREE.Vector3());
    const direction = center.clone().sub(modelCenter);
    if (direction.lengthSq() < 1e-8) direction.set(index % 2 ? 1 : -1, ((index % 7) - 3) * 0.15, ((index % 5) - 2) * 0.15);
    direction.normalize();
    const record: PartRecord = {
      id: index + 1,
      node,
      label: node.name || `CAD-PART-${String(index + 1).padStart(4, '0')}`,
      meshCount: 0,
      originalPosition: node.position.clone(),
      originalQuaternion: node.quaternion.clone(),
      originalScale: node.scale.clone(),
      originalVisible: node.visible,
      centerWorld: center,
      directionWorld: direction,
      role: classifyPart(node),
    };
    node.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        record.meshCount += 1;
        meshToPart.set(child, record);
      }
    });
    return record;
  });
}

function createMajorPartRecord(node: THREE.Object3D, label: string, id: number): PartRecord {
  const box = new THREE.Box3().setFromObject(node);
  const center = box.getCenter(new THREE.Vector3());
  const direction = center.clone().sub(modelCenter);
  if (direction.lengthSq() < 1e-8) direction.set(1, 0, 0);
  let meshCount = 0;
  node.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });
  return {
    id,
    node,
    label,
    meshCount,
    originalPosition: node.position.clone(),
    originalQuaternion: node.quaternion.clone(),
    originalScale: node.scale.clone(),
    originalVisible: node.visible,
    centerWorld: center,
    directionWorld: direction.normalize(),
    role: classifyPart(node),
  };
}

function buildMajorPartGroups(): MajorPartGroup[] {
  let nextId = 1;
  const record = (pattern: RegExp, label: string): PartRecord | null => {
    const node = findMotionRoots(pattern)[0] ?? null;
    return node ? createMajorPartRecord(node, label, nextId++) : null;
  };
  const hubRecord = record(/^轮毂-简化(?:-\d+)?$/i, '轮毂总成');
  if(hubRecord){
    hubRecord.attachments=findMotionRoots(/^导流罩$/i);
    hubRecord.attachments.forEach(root=>root.traverse(node=>{if((node as THREE.Mesh).isMesh)hubRecord.meshCount++;}));
  }
  const brakeRecord=record(/^高速轴制动器(?:-\d+)?$/i,'高速轴制动器');
  const brakeDisc=drivetrain?.demonstrations[0].root.getObjectByName('高速制动盘示意');
  if(brakeRecord&&brakeDisc){brakeRecord.attachments=[brakeDisc];brakeRecord.meshCount++;}
  const bladeRoots = findMotionRoots(/^WD190-7500\.?stp-[123]$/i)
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  let bladeRecord:PartRecord|null=null;
  if(bladeRoots.length){
    bladeRecord=createMajorPartRecord(bladeRoots[0],'叶片',nextId++);bladeRecord.members=bladeRoots;
    bladeRecord.meshCount=0;bladeRoots.forEach(root=>root.traverse(node=>{if((node as THREE.Mesh).isMesh)bladeRecord!.meshCount++;}));
    bladeRecord.centerWorld=partBounds(bladeRecord).getCenter(new THREE.Vector3());
  }
  const compact = (items: Array<PartRecord | null>): PartRecord[] => items.filter((item): item is PartRecord => Boolean(item));
  const frameRecord=():PartRecord|null=>{
    const frame=record(/^主机架(?:-\d+)?$/i,'主机架');
    if(!frame)return null;
    frame.attachments=frameAssemblyAttachments(frame.node);
    frame.attachments.forEach(root=>root.traverse(node=>{if((node as THREE.Mesh).isMesh)frame.meshCount++;}));
    frame.centerWorld=partBounds(frame).getCenter(new THREE.Vector3());
    frame.scopeDescription='前主机架、后机架及连接螺栓和垫圈';
    return frame;
  };

  const groups:MajorPartGroup[]=[
    {
      label: '风轮系统',
      parts: compact([
        hubRecord,
        bladeRecord,
      ]),
    },
    {
      label: '主传动系统',
      parts: compact([
        record(/^主轴组件(?:-\d+)?$/i, '主轴组件'),
        record(/^主轴承(?:-\d+)?$/i, '主轴承'),
        record(/^齿轮箱(?:-\d+)?$/i, '齿轮箱'),
        brakeRecord,
        record(/^高速轴联轴器(?:-\d+)?$/i, '高速轴联轴器'),
        record(/^发电机(?:-\d+)?$/i, '发电机'),
      ]),
    },
    {
      label: '承载与辅助系统',
      parts: compact([
        frameRecord(),
        record(/^液压系统(?:-\d+)?$/i, '液压系统'),
        record(/^辅助变压器(?:-\d+)?$/i, '辅助变压器'),
        record(/^偏航系统总成(?:-\d+)?$/i, '偏航系统'),
        record(/^机舱罩(?:-\d+)?$/i, '机舱外壳'),
      ]),
    },
  ].filter((group) => group.parts.length);
  groups.forEach(group=>group.parts.forEach(part=>partRoots(part).forEach(root=>root.traverse(mesh=>{
    if((mesh as THREE.Mesh).isMesh)majorMeshToPart.set(mesh,part);
  }))));
  return groups;
}

function isDescendantOf(node: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current = node.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function suppressExactOverlapDuplicates(): void {
  exactOverlapDiagnostics = [];
  if (!modelRoot) return;
  modelRoot.updateMatrixWorld(true);
  const groups = new Map<string, PartRecord[]>();
  parts.forEach((part) => {
    if (part.role !== 'internal') return;
    const box = new THREE.Box3().setFromObject(part.node);
    const size = box.getSize(new THREE.Vector3());
    if (size.x * size.y * size.z <= 1e-9) return;
    let triangles = 0;
    let vertices = 0;
    part.node.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const geometry = (object as THREE.Mesh).geometry;
      triangles += geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
      vertices += geometry.attributes.position?.count ?? 0;
    });
    const boundsKey = [...box.min.toArray(), ...box.max.toArray()]
      .map((value) => value.toFixed(4))
      .join(',');
    const signature = `${boundsKey}|${Math.round(triangles)}|${vertices}`;
    const group = groups.get(signature) ?? [];
    group.push(part);
    groups.set(signature, group);
  });
  groups.forEach((group, signature) => {
    if (group.length < 2) return;
    // SolidWorks duplicate-instance suffixes are appended with an underscore by
    // the GLB exporter. Prefer the unsuffixed source instance as presentation owner.
    group.sort((left, right) => Number(/_\d+$/.test(left.label)) - Number(/_\d+$/.test(right.label)));
    const [kept, ...duplicates] = group;
    duplicates.forEach((part) => {
      part.originalVisible = false;
      part.node.visible = false;
      part.node.userData.presentationDuplicateOf = kept.label;
    });
    exactOverlapDiagnostics.push({
      kept: kept.label,
      hidden: duplicates.map((part) => part.label),
      signature,
    });
  });
}

function suppressNestedYawBrakeDuplicates(): void {
  const nestedDuplicates = parts.filter((part) => {
    if (!/02310044#偏航制动器/i.test(part.label)) return false;
    let parent = part.node.parent;
    while (parent && parent !== modelRoot) {
      if (/偏航集中润滑系统/i.test(parent.name)) return true;
      parent = parent.parent;
    }
    return false;
  });
  if (!nestedDuplicates.length) return;
  nestedDuplicates.forEach((part) => {
    part.originalVisible = false;
    part.node.visible = false;
    part.node.userData.presentationDuplicateOf = 'W55D3-02-02-00#偏航系统总成 / 主偏航制动器实例';
    part.node.userData.presentationSuppressionReason = 'Lubrication subassembly repeats the brake solid at an occupied yaw-ring station.';
  });
  exactOverlapDiagnostics.push({
    kept: 'W55D3-02-02-00#偏航系统总成 / 18 个主偏航制动器',
    hidden: nestedDuplicates.map((part) => part.label),
    signature: 'nested-subassembly-repeat|yaw-central-lubrication|brake-solid',
  });
}

function rerouteHydraulicHoseAroundRearGuard(): void {
  if (!modelRoot) return;
  const hosePart = parts.find((part) => /液压软管3/i.test(part.label));
  const guardPart = parts.find((part) => /后机架防护板X(?!I)/i.test(part.label));
  if (!hosePart || !guardPart) return;

  modelRoot.updateMatrixWorld(true);
  const obstacle = new THREE.Box3().setFromObject(guardPart.node);
  const sourceMeshes: THREE.Mesh[] = [];
  hosePart.node.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) sourceMeshes.push(object as THREE.Mesh);
  });
  const rubberBody = [...sourceMeshes].sort((left, right) => (
    (right.geometry.attributes.position?.count ?? 0) - (left.geometry.attributes.position?.count ?? 0)
  ))[0];
  const startFitting = sourceMeshes.find((mesh) => mesh.name === 'mesh_232');
  const endFitting = sourceMeshes.find((mesh) => mesh.name === 'mesh_232_1');
  if (!rubberBody || !startFitting || !endFitting) return;

  const startWorld = new THREE.Box3().setFromObject(startFitting).getCenter(new THREE.Vector3());
  const endWorld = new THREE.Box3().setFromObject(endFitting).getCenter(new THREE.Vector3());
  const edgeY = obstacle.max.y + 0.14;
  const bypassZ = obstacle.min.z - 0.1;
  const worldPoints = [
    startWorld.clone(),
    new THREE.Vector3(obstacle.min.x - 0.22, Math.max(startWorld.y, edgeY + 0.06), bypassZ),
    new THREE.Vector3(obstacle.min.x - 0.08, edgeY, bypassZ),
    new THREE.Vector3(endWorld.x + 0.12, edgeY, bypassZ),
    endWorld.clone().lerp(new THREE.Vector3(endWorld.x + 0.12, edgeY, bypassZ), 0.18),
    endWorld.clone(),
  ];
  const localPoints = worldPoints.map((point) => hosePart.node.worldToLocal(point.clone()));
  const curve = new THREE.CatmullRomCurve3(localPoints, false, 'centripetal');
  const hoseGeometry = new THREE.TubeGeometry(curve, 160, 0.018, 12, false);
  const hoseMaterial = new THREE.MeshPhysicalMaterial({
    name: 'Hydraulic hose · graphite rubber',
    color: 0x555b62,
    metalness: 0.04,
    roughness: 0.5,
    clearcoat: 0.08,
    clearcoatRoughness: 0.52,
  });
  rubberBody.geometry = hoseGeometry;
  rubberBody.material = hoseMaterial;
  rubberBody.visible = true;
  rubberBody.layers.set(STATIC_LAYER);
  rubberBody.userData.attachment = {
    parentSocket: hosePart.label,
    localStart: localPoints[0].toArray(),
    localEnd: localPoints.at(-1)?.toArray(),
    contactType: 'embedded-fitting',
    embedDepth: 0.006,
    gapTolerance: 0.002,
  };
  rubberBody.userData.presentationRebuiltInPlace = true;
  originalMeshMaterials.set(rubberBody, hoseMaterial);
  saveMaterialState(hoseMaterial);
  hosePart.node.userData.presentationReroute = {
    reason: 'Rebuild the original visible hose mesh in place with one continuous closed-section route.',
    obstacle: guardPart.label,
    sourceBody: rubberBody.name,
    rebuiltInPlace: true,
    controlPoints: localPoints.map((point) => point.toArray()),
    tubeRadius: 0.018,
    endpointMode: 'source-fitting-centers',
  };
}

function updateExplosion(percent: number): void {
  if (!modelRoot) return;
  const amplitude = modelSize.length() * 0.16 * (percent / 100);
  parts.forEach((part) => {part.node.position.copy(part.originalPosition);part.node.updateMatrix();});
  modelRoot.updateMatrixWorld(true);
  parts.forEach((part, index) => {
    if (percent <= 0 || !part.node.parent) return;
    const layerBias = 0.35 + ((index % 9) / 8) * 0.35;
    const offsetWorld = part.directionWorld.clone().multiplyScalar(amplitude * layerBias);
    const desiredWorld = part.node.getWorldPosition(new THREE.Vector3()).add(offsetWorld);
    const desiredLocal = part.node.parent.worldToLocal(desiredWorld);
    part.node.position.copy(desiredLocal);
    part.node.updateMatrix();
  });
  modelRoot.updateMatrixWorld(true);
  selectionBox.visible = false;
  if (selectedPart) emphasizeSelected(selectedPart);
  invalidateStaticFrame();
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value > 999999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}

type PresentationFrame={left:number;top:number;width:number;height:number};

function updateDesktopProportions():void{
  const desktop=!compactViewport.matches;
  // The accepted desktop composition is 1915 × 958 CSS pixels. Scale the UI
  // with its available viewport, not the monitor DPR (which also includes zoom).
  desktopUiScale=desktop?Math.max(.5,Math.min(1,canvas.clientWidth/1915,canvas.clientHeight/958)):1;
  const app=byId('app');
  app.classList.toggle('desktop-proportions',desktop);
  app.style.setProperty('--desktop-ui-scale',String(desktopUiScale));
  app.style.setProperty('--presentation-height',`${canvas.clientHeight/desktopUiScale}px`);
}

function presentationFrame():PresentationFrame{
  const canvasRect=canvas.getBoundingClientRect(),panel=inspector.getBoundingClientRect();
  const toolbar=document.querySelector<HTMLElement>('.viewer-toolbar')!.getBoundingClientRect();
  const compact=compactViewport.matches,margin=compact?12:24*desktopUiScale,left=margin;
  const top=compact?Math.max(inspectorToggle.getBoundingClientRect().bottom,document.querySelector<HTMLElement>('.transmission-control')!.getBoundingClientRect().bottom)-canvasRect.top+12:margin;
  let right=viewportWidth-margin,bottom=Math.min(viewportHeight-margin,toolbar.top-canvasRect.top-(compact?20:20*desktopUiScale));
  if(!compact||mobileInspectorOpen){
    if(panel.left-canvasRect.left>viewportWidth*.45)right=Math.min(right,panel.left-canvasRect.left-margin);
    else bottom=Math.min(bottom,panel.top-canvasRect.top-margin);
  }
  return {left,top,width:Math.max(80,right-left),height:Math.max(80,bottom-top)};
}

function setMobileInspectorOpen(open:boolean):void{
  updateDesktopProportions();
  mobileInspectorOpen=open;
  inspector.dataset.mobileOpen=String(open);
  const collapsed=compactViewport.matches&&!open;
  inspector.inert=collapsed;
  if(collapsed)inspector.setAttribute('aria-hidden','true');else inspector.removeAttribute('aria-hidden');
  inspectorToggle.setAttribute('aria-expanded',String(!collapsed));
  inspectorToggle.textContent=open?'收起面板':'零件面板';
  if(collapsed&&inspector.contains(document.activeElement))inspectorToggle.focus({preventScroll:true});
  requestAnimationFrame(()=>{
    if(!modelRoot)return;
    viewportWidth=canvas.clientWidth;viewportHeight=canvas.clientHeight;
    if(homeFramingActive)fitHomeView();
    else if(camera.view?.enabled||compactViewport.matches)applyPresentationOffset(presentationFrame());
    invalidateStaticFrame();updateAnnotationOverlay();updateSensorOverlay();
  });
}

function applyPresentationOffset(frame:PresentationFrame):void{
  // Shift the projection, not the orbit target, to leave room for the UI.
  camera.setViewOffset(viewportWidth,viewportHeight,
    viewportWidth/2-(frame.left+frame.width/2),viewportHeight/2-(frame.top+frame.height/2),viewportWidth,viewportHeight);
}

function fitHomeView():void{
  if(!modelRoot)return;
  if(!homeViewBounds){
    homeViewBounds=new THREE.Box3();
    // The hub and the complete nacelle frame the presentation. Including the
    // full blade diameter or tower height would make the machinery unreadable.
    for(const group of majorPartGroups)for(const part of group.parts){
      if(part.label!=='叶片')homeViewBounds.union(partBounds(part));
    }
    homeViewBounds.expandByScalar(.25);
    // Cache the frame before autoplay so reset never changes with rotor phase.
  }
  const center=homeViewBounds.getCenter(new THREE.Vector3());
  fitBounds(homeViewBounds,new THREE.Vector3(.46,.48,1.5),1.10,center,presentationFrame());
  homeFramingActive=true;
}

function fitBounds(box: THREE.Box3, direction = new THREE.Vector3(1.2, 0.72, 1.25), padding = 1.3, orbitCenter?:THREE.Vector3, frame?:PresentationFrame): void {
  if (box.isEmpty()) return;
  homeFramingActive=false;
  camera.aspect=viewportWidth/Math.max(viewportHeight,1);
  if(frame)applyPresentationOffset(frame);else camera.clearViewOffset();
  const center = orbitCenter?.clone()??box.getCenter(new THREE.Vector3());
  // Framing can include related parts, but the pivot remains on the selection.
  // Fit the furthest corner relative to that pivot so the context still fits.
  const extent=new THREE.Vector3(
    Math.max(Math.abs(box.min.x-center.x),Math.abs(box.max.x-center.x)),
    Math.max(Math.abs(box.min.y-center.y),Math.abs(box.max.y-center.y)),
    Math.max(Math.abs(box.min.z-center.z),Math.abs(box.max.z-center.z)),
  );
  const radius = Math.max(extent.length(), 0.01);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const viewDirection=direction.clone().normalize();
  let distance = (radius / Math.tan(fov / 2)) * padding;
  if(orbitCenter){
    // Fit the eight corners in camera space instead of an oversized sphere
    // around an off-center selection. This keeps the chosen part readable.
    const right=new THREE.Vector3().crossVectors(camera.up,viewDirection).normalize();
    const up=new THREE.Vector3().crossVectors(viewDirection,right).normalize();
    const tanY=Math.tan(fov/2)*(frame?frame.height/viewportHeight:1);
    const tanX=Math.tan(fov/2)*(frame?frame.width/viewportHeight:camera.aspect);
    distance=radius*.15;
    for(const x of[box.min.x,box.max.x])for(const y of[box.min.y,box.max.y])for(const z of[box.min.z,box.max.z]){
      const offset=new THREE.Vector3(x,y,z).sub(center);
      distance=Math.max(distance,offset.dot(viewDirection)+padding*Math.max(Math.abs(offset.dot(right))/tanX,Math.abs(offset.dot(up))/tanY));
    }
  }
  camera.near = Math.max(distance / 1000, 0.005);
  camera.far = Math.max(distance * 20, 100);
  camera.updateProjectionMatrix();
  camera.position.copy(center).add(viewDirection.multiplyScalar(distance));
  controls.target.copy(center);
  controls.minDistance = radius * 0.04;
  controls.maxDistance = distance * 6;
  updateCameraPreset();
}

function fitObject(object: THREE.Object3D, direction = new THREE.Vector3(1.2, 0.72, 1.25), padding = 1.3): void {
  fitBounds(new THREE.Box3().setFromObject(object), direction, padding);
}

function findByTerms(terms: string[]): THREE.Object3D | null {
  if (!modelRoot) return null;
  let match: THREE.Object3D | null = null;
  modelRoot.traverse((node) => {
    if (match) return;
    const name = node.name.toLowerCase();
    if (terms.some((term) => name.includes(term))) match = node;
  });
  return match;
}

function leafNodeName(node: THREE.Object3D): string {
  return node.name.split('#').at(-1) ?? node.name;
}

function findMotionRoots(pattern: RegExp): THREE.Object3D[] {
  if (!modelRoot) return [];
  const matches: THREE.Object3D[] = [];
  modelRoot.traverse((node) => {
    if (node.name && pattern.test(leafNodeName(node))) matches.push(node);
  });
  return matches.filter((node) => !matches.some((other) => other !== node && isDescendantOf(node, other)));
}

function setupMotionLinks(): void {
  if (!modelRoot) return;
  drivetrain = new Drivetrain(modelRoot, scene, MOVING_LAYER,GENERATOR_GLASS_LAYER);
  drivetrain.links.forEach(link => link.nodes.forEach(node => node.traverse(object => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    movingMeshKinds.set(mesh, link.visualKind);
    if (link.visualKind === 'drivetrain') drivetrainContextMeshes.add(mesh);
    mesh.layers.set(MOVING_LAYER);
  })));
  findMotionRoots(/^(齿轮箱|发电机)(?:-\d+)?$/).forEach(node => node.traverse(object => {
    if ((object as THREE.Mesh).isMesh) {
      vendorEnclosureMeshes.add(object as THREE.Mesh);
      drivetrainContextMeshes.add(object as THREE.Mesh);
    }
  }));
  findMotionRoots(/^发电机(?:-\d+)?$/).forEach(node => node.traverse(object => {
    if ((object as THREE.Mesh).isMesh) generatorEnclosureMeshes.add(object as THREE.Mesh);
  }));
  findMotionRoots(/^(主轴承|高速轴制动器)/).forEach(node => node.traverse(object => {
    if ((object as THREE.Mesh).isMesh) drivetrainContextMeshes.add(object as THREE.Mesh);
  }));
}

function setMotionRunning(running: boolean): void {
  rotorSpinning = Boolean(drivetrain) && running;
  document.body.classList.toggle('rendering-active',rotorSpinning||navigationRendering);
  previousFrameTime = performance.now();
  renderQuality.reset();
  renderRequested = true;
  setRenderScale(restingRenderScale());
}

function setView(view: string): void {
  restoreFullDetail();
  document.querySelectorAll<HTMLButtonElement>('.view-button').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  if (!modelRoot) return;
  if (view === 'selected' && selectedPart) {
    if (isGeneratorChainFocus() && !isIsolated) return fitGeneratorPresentation();
    return fitBounds(partBounds(selectedPart), new THREE.Vector3(1, .55, 1.4), 1.55,partOrbitCenter(selectedPart));
  }
  if (view === 'nacelle') {
    return fitHomeView();
  }
  if (view === 'rotor') {
    const target = findByTerms(['轮毂', 'hub', 'rotor']);
    if (target) return fitObject(target, new THREE.Vector3(1.25, .5, 1.15), 1.65);
  }
  fitObject(modelRoot, new THREE.Vector3(1.2, .6, 1.25), 1.16);
}

function updateSelectedUI(): void {
  byId('generator-guide').hidden = !selectedPart?.label.includes('发电机');
  const cad = !drivetrain?.showInternals || drivetrain.generatorPresentation !== 'section';
  byId('generator-section-notes').hidden = cad;
  byId('generator-cad-mode').setAttribute('aria-pressed', String(cad));
  byId('generator-section-mode').setAttribute('aria-pressed', String(!cad));
  const enabled = Boolean(selectedPart);
  focusButton.disabled = !enabled;
  isolateButton.disabled = !enabled;
  hideButton.disabled = !enabled;
  clearPartFocusButton.disabled = !enabled;
  byId('selected-card').hidden = !selectedPart;
  byId('selected-name').textContent = selectedPart?.label ?? '';
  renderPartRelations();
}

function renderPartRelations():void{
  const panel=byId('part-relations-panel');panel.hidden=!selectedPart||!selectedRelationships;
  if(!selectedPart||!selectedRelationships)return;
  const list=(container:HTMLElement,entries:Array<{label:string;hint:string;badge?:string}>,empty:string)=>{
    container.replaceChildren();
    if(!entries.length){const note=document.createElement('small');note.textContent=empty;container.append(note);return;}
    for(const entry of entries){const button=document.createElement('button');button.type='button';button.dataset.part=entry.label;
      const name=document.createElement('span');name.textContent=entry.label;button.append(name);
      if(entry.badge){const badge=document.createElement('small');badge.className='relation-path-badge';badge.textContent=entry.badge;button.append(badge);}
      button.title=entry.hint;button.setAttribute('aria-label',`查看关联零件：${entry.label}`);
      button.addEventListener('click',()=>{const part=majorPartByLabel(entry.label);if(part)selectPart(part,true,true);});container.append(button);}
  };
  for(const direction of ['upstream','downstream'] as const){
    const paths=direction==='upstream'?selectedRelationships.upstreamPaths:selectedRelationships.downstreamPaths;
    list(byId(`relationship-${direction}`),[...selectedRelationships[direction]].map(([label,d])=>{
      const path=paths.get(label)??[],electrical=path.some(e=>e.kind==='electrical'),illustrative=path.some(e=>e.illustrative);
      return {label,badge:d>1?'间接':illustrative?'电气示意':electrical?'电气':undefined,
        hint:`${d===1?'直接':'间接'}${direction==='upstream'?'上游':'下游'}；${illustrative?'演示关系，含电气示意连接':electrical?'能量关系，含电气连接':'机械传动'}。`+path.map(e=>`${e.from} → ${e.to}：${e.label}`).join('；')};
    }),direction==='upstream'?'无动力上游':selectedRelationships.emptyDownstream);
  }
  const related=byId('relationship-related');related.replaceChildren();
  const groups=[
    {kind:'support',direction:'incoming',title:'由谁支撑'},
    {kind:'support',direction:'outgoing',title:'支撑对象'},
    {kind:'protection',direction:'incoming',title:'由谁防护'},
    {kind:'protection',direction:'outgoing',title:'防护对象'},
    {kind:'service',direction:'incoming',title:'辅助来源'},
    {kind:'service',direction:'outgoing',title:'辅助对象'},
  ];
  for(const group of groups){
    const entries=selectedRelationships.related.filter(r=>r.kind===group.kind&&r.direction===group.direction);
    const supportNote=group.kind==='support'&&group.direction==='incoming'?selectedRelationships.supportNote:null;
    if(!entries.length&&!supportNote)continue;
    const section=document.createElement('section');section.className='relation-direction-group';
    section.dataset.kind=group.kind;section.dataset.direction=group.direction;
    const heading=document.createElement('h4');heading.textContent=group.title;
    const buttons=document.createElement('div');
    if(supportNote){
      const note=document.createElement('small');note.textContent=supportNote;
      note.title='本图尚未单列该零件的装配支承关系，不代表实物没有支撑。';buttons.append(note);
    }else list(buttons,entries.map(r=>({label:r.label,
      badge:r.distance>1?`经${r.path.slice(0,-1).map(e=>e.to).join('、')}`:undefined,
      hint:r.path.map(e=>`${e.from} → ${e.to}：${e.label}`).join('；')+(r.distance>1?'（间接支撑）':'')})),'');
    section.append(heading,buttons);related.append(section);
  }
  related.parentElement!.hidden=!selectedRelationships.related.length&&!selectedRelationships.supportNote;
}

function fitPartWithRelations(part:PartRecord):void{
  if(part.members){
    // Selecting the grouped blades should not frame their full swept diameter.
    // Keep the current viewing distance and direction, centered on the hub axis.
    centerOrbitOnPart(part);
    return;
  }
  const orbitCenter=partOrbitCenter(part);
  const bounds=partBounds(part);
  if(selectedRelationships){
    const labels=[...selectedRelationships.upstream.keys(),...selectedRelationships.downstream.keys()];
    for(const label of labels){const neighbor=majorPartByLabel(label);if(!neighbor)continue;
      if(neighbor.members&&drivetrain)bounds.union(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3().fromArray(drivetrain.anchors.lowOrigin),new THREE.Vector3(3,3,3)));
      else bounds.union(partBounds(neighbor));
    }
  }
  fitBounds(bounds,new THREE.Vector3(1,.55,1.4),1.2,orbitCenter,part.label==='主机架'||compactViewport.matches?presentationFrame():undefined);
}

function selectPart(part: PartRecord | null, focus = false, activateFocus = false): void {
  restoreFullDetail();
  selectedPart = part;
  partFocusActive = Boolean(part && activateFocus);
  selectedRelationships=part&&activateFocus?equipmentContext(part.label,new Set(majorPartGroups.flatMap(g=>g.parts.map(p=>p.label)))):null;
  selectionBox.visible = false;
  applyDisplayMode(displayMode);
  updateSelectedUI();
  if (focus && part) {
    if(selectedRelationships&&!isIsolated)fitPartWithRelations(part);
    else if (isGeneratorChainFocus() && !isIsolated) fitGeneratorPresentation();
    else fitPartWithRelations(part);
  }else if(part)centerOrbitOnPart(part);
}

function objectPathFromModelRoot(object: THREE.Object3D): number[] {
  if (!modelRoot) return [];
  const path: number[] = [];
  let cursor: THREE.Object3D | null = object;
  while (cursor && cursor !== modelRoot) {
    const objectParent: THREE.Object3D | null = cursor.parent;
    if (!objectParent) return [];
    const index = objectParent.children.indexOf(cursor);
    if (index < 0) return [];
    path.unshift(index);
    cursor = objectParent;
  }
  return cursor === modelRoot ? path : [];
}

function meshFromModelPath(path: number[]): THREE.Mesh | null {
  if (!modelRoot) return null;
  let cursor: THREE.Object3D = modelRoot;
  for (const index of path) {
    const child = cursor.children[index];
    if (!child) return null;
    cursor = child;
  }
  return (cursor as THREE.Mesh).isMesh ? cursor as THREE.Mesh : null;
}

function majorPartForMesh(mesh: THREE.Mesh): PartRecord | null {
  const mapped=majorMeshToPart.get(mesh);if(mapped)return mapped;
  for (const group of majorPartGroups) {
    const part = group.parts.find((candidate) => belongsToPart(mesh,candidate));
    if (part) return part;
  }
  return null;
}

function annotationPartLabel(mesh: THREE.Mesh): string {
  return spatialOwner.get(mesh)?.label??majorPartForMesh(mesh)?.label
    ?? meshToPart.get(mesh)?.label
    ?? leafNodeName(mesh.parent ?? mesh)
    ?? '未命名零件';
}

function annotationMesh(annotation: EngineeringAnnotation): THREE.Mesh | null {
  if(annotation.binding)return anchorRegistry?.resolve(annotation.binding)??null;
  const cached = annotationMeshLookup.get(annotation.id);
  if (cached) return cached;
  const resolved = meshFromModelPath(annotation.meshPath);
  if (resolved) annotationMeshLookup.set(annotation.id, resolved);
  return resolved;
}

function annotationWorldPoint(annotation: EngineeringAnnotation): THREE.Vector3 | null {
  const mesh = annotationMesh(annotation);
  if (!mesh) return null;
  return anchorWorldPoint(mesh,annotation.localPosition,annotation.binding);
}

function captureAnnotationViewpoint(): AnnotationViewpoint {
  return {
    cameraPosition: camera.position.toArray(),
    cameraUp: camera.up.toArray(),
    target: controls.target.toArray(),
    framing:camera.view?.enabled?'presentation':'full',
    viewport:[viewportWidth,viewportHeight],
    inputAngle:drivetrain?.inputAngle??0,
    projection:{fov:camera.fov,near:camera.near,far:camera.far,zoom:camera.zoom},
  };
}

function isAnnotationViewpoint(value: unknown): value is AnnotationViewpoint {
  if (!value || typeof value !== 'object') return false;
  const viewpoint = value as Partial<AnnotationViewpoint>;
  return finiteVector(viewpoint.cameraPosition)&&finiteVector(viewpoint.cameraUp)&&finiteVector(viewpoint.target)
    &&viewpoint.cameraUp.some(v=>Math.abs(v)>1e-12)&&viewpoint.cameraPosition.some((v,i)=>Math.abs(v-viewpoint.target![i])>1e-12)
    &&(viewpoint.framing===undefined||viewpoint.framing==='presentation'||viewpoint.framing==='full')
    &&(viewpoint.viewport===undefined||(Array.isArray(viewpoint.viewport)&&viewpoint.viewport.length===2&&viewpoint.viewport.every(v=>Number.isFinite(v)&&v>0)))
    &&(viewpoint.inputAngle===undefined||Number.isFinite(viewpoint.inputAngle))
    &&(viewpoint.projection===undefined||(!!viewpoint.projection&&typeof viewpoint.projection==='object'&&Number.isFinite(viewpoint.projection.fov)&&viewpoint.projection.fov>0&&viewpoint.projection.fov<180
      &&Number.isFinite(viewpoint.projection.near)&&viewpoint.projection.near>0&&Number.isFinite(viewpoint.projection.far)&&viewpoint.projection.far>viewpoint.projection.near
      &&Number.isFinite(viewpoint.projection.zoom)&&viewpoint.projection.zoom>0));
}

function persistAnnotations(): void {
  try {
    const saved = annotations.filter((annotation) => annotation.id !== pendingAnnotationId);
    localStorage.setItem(ANNOTATION_STORAGE_KEY, JSON.stringify({schemaVersion:2,records:saved}));
  } catch (error) {
    console.warn('工程标注无法写入本地存储', error);
  }
}

function isStoredAnnotation(value: unknown): value is EngineeringAnnotation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<EngineeringAnnotation>;
  return typeof item.id === 'string'
    && Number.isInteger(item.sequence)&&Number(item.sequence)>0
    && typeof item.partLabel === 'string'
    && Array.isArray(item.meshPath)&&item.meshPath.every(i=>Number.isInteger(i)&&i>=0)
    && finiteVector(item.localPosition)&&finiteVector(item.localNormal)
    && (item.binding===undefined||validBinding(item.binding))
    && typeof item.title === 'string'
    && typeof item.description === 'string'
    && ['一般', '注意', '重要', '紧急'].includes(item.severity ?? '')
    && ['待处理', '处理中', '已完成'].includes(item.status ?? '')
    && typeof item.createdAt === 'string'
    && (item.viewpoint === undefined || isAnnotationViewpoint(item.viewpoint));
}

function loadStoredAnnotations(): void {
  annotations.length = 0;
  annotationMeshLookup.clear();
  try {
    const raw = localStorage.getItem(ANNOTATION_STORAGE_KEY)??localStorage.getItem(LEGACY_ANNOTATION_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const records=Array.isArray(parsed)?parsed:(parsed as {schemaVersion?:number;records?:unknown})?.schemaVersion===2?(parsed as {records:unknown}).records:[];
    if (!Array.isArray(records)) return;
    records.filter(isStoredAnnotation).forEach((annotation) => {
      // v1 always used the preserved source GLB. Adopt only a matching part;
      // keep unresolved records in the list instead of silently dropping them.
      if(!annotation.binding){
        const mesh=meshFromModelPath(annotation.meshPath),label=annotation.partLabel==='变压器'?'辅助变压器':annotation.partLabel;
        if(mesh&&annotationPartLabel(mesh)===label)annotation.binding=anchorRegistry?.bind(mesh)??undefined;
        else annotation.binding={rootId:'source',modelVersion:'unverified-legacy',objectId:''};
      }
      const mesh=annotationMesh(annotation);
      annotations.push(annotation);
      if(mesh)annotationMeshLookup.set(annotation.id, mesh);
    });
  } catch (error) {
    console.warn('工程标注记录读取失败', error);
  }
  renderAnnotationList();
  renderAnnotationMarkers();
}

function setAnnotationTip(message: string, active = false): void {
  annotationTip.textContent = message;
  annotationTip.hidden = !message;
  annotationTip.classList.toggle('active', active);
}

function setNavigationMode(mode: 'orbit' | 'pan', cancelAnnotation = true): void {
  navigationOrbit.classList.toggle('active', mode === 'orbit');
  navigationPan.classList.toggle('active', mode === 'pan');
  navigationOrbit.setAttribute('aria-pressed', String(mode === 'orbit'));
  navigationPan.setAttribute('aria-pressed', String(mode === 'pan'));
  canvas.classList.toggle('navigation-pan', mode === 'pan');
  controls.enableRotate = mode === 'orbit';
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = true;
  controls.minPolarAngle = THREE.MathUtils.degToRad(1);
  controls.maxPolarAngle = THREE.MathUtils.degToRad(179);
  controls.mouseButtons.LEFT = mode === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  controls.mouseButtons.RIGHT = null;
  controls.touches.ONE = mode === 'orbit' ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.update();
  if (cancelAnnotation && annotationModeActive) setAnnotationMode(false);
}

function setAnnotationMode(active: boolean): void {
  annotationModeActive = active;
  annotationModeButton.setAttribute('aria-pressed', String(active));
  annotationToggle.setAttribute('aria-pressed', String(active));
  canvas.classList.toggle('annotation-active', active);
  setAnnotationTip(
    active ? '点击模型表面放置标注。' : '',
    active,
  );
}

function setInspectorTab(tab: 'parts' | 'annotations' | 'sensors',reveal=true): void {
  if(reveal&&compactViewport.matches&&!mobileInspectorOpen)setMobileInspectorOpen(true);
  const showParts = tab === 'parts';
  const showAnnotations = tab === 'annotations';
  const showSensors = tab === 'sensors';
  partsInspectorPanel.hidden = !showParts;
  annotationPanel.hidden = !showAnnotations;
  sensorPanel.hidden = !showSensors;
  partsTab.classList.toggle('active', showParts);
  annotationsTab.classList.toggle('active', showAnnotations);
  sensorsTab.classList.toggle('active', showSensors);
  partsTab.setAttribute('aria-selected', String(showParts));
  annotationsTab.setAttribute('aria-selected', String(showAnnotations));
  sensorsTab.setAttribute('aria-selected', String(showSensors));
  updateSensorAlarmBadge();
  if (!showAnnotations) {
    setAnnotationMode(false);
    closeAnnotationEditor(true, true);
  }
  if (!showSensors && selectedSensorId) {
    selectedSensorId = null;
    sensorDetail.hidden = true;
    sensorPanel.classList.remove('detail-open');
    scheduleSensorUiUpdate();
  }
}

function setAnnotationPanelOpen(open: boolean,reveal=true): void {
  setInspectorTab(open ? 'annotations' : 'parts',reveal);
}

function renderAnnotationMarkers(): void {
  annotationMarkerElements.forEach((element) => element.remove());
  annotationMarkerElements.clear();
  annotations.forEach((annotation) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = `annotation-pin${annotation.id === activeAnnotationId ? ' active' : ''}${annotation.id === pendingAnnotationId ? ' pending' : ''}`;
    marker.dataset.annotationId = annotation.id;
    marker.dataset.severity = annotation.severity;
    marker.setAttribute('aria-label', `标注 ${annotation.sequence}：${annotation.title}`);
    marker.textContent = String(annotation.sequence).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'annotation-pin-label';
    const title = document.createElement('b');
    title.textContent = annotation.title || '待填写标注';
    const meta = document.createElement('small');
    meta.textContent = `${annotation.partLabel} · ${annotation.status}`;
    label.append(title, meta);
    marker.append(label);
    marker.addEventListener('pointerdown', (event) => event.stopPropagation());
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      selectAnnotation(annotation.id, true, false);
    });
    marker.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      selectAnnotation(annotation.id, true, true);
    });
    annotationOverlay.append(marker);
    annotationMarkerElements.set(annotation.id, marker);
  });
  updateAnnotationOverlay();
}

function updateAnnotationOverlay(): void {
  if (!annotations.length) return;
  annotations.forEach((annotation) => {
    const marker = annotationMarkerElements.get(annotation.id);
    const worldPoint = annotationWorldPoint(annotation);
    if (!marker) return;
    if(!worldPoint||!worldVisible(annotationMesh(annotation)!)){marker.hidden=true;return;}
    const projected = worldPoint.project(camera);
    const visible = projected.z > -1 && projected.z < 1;
    if(marker.hidden===visible)marker.hidden=!visible;
    if (!visible) return;
    const x = `${Math.round((overlayOffsetX+(projected.x*.5+.5)*viewportWidth)*10)/10}px`;
    const y = `${Math.round((overlayOffsetY+(-projected.y*.5+.5)*viewportHeight)*10)/10}px`;
    if(marker.style.left!==x)marker.style.left=x;
    if(marker.style.top!==y)marker.style.top=y;
  });
}

function renderAnnotationList(): void {
  annotationCount.textContent = String(annotations.length);
  annotationListCount.textContent = `${annotations.length} 项`;
  annotationList.replaceChildren();
  if (!annotations.length) {
    const empty = document.createElement('p');
    empty.className = 'annotation-empty';
    empty.textContent = '暂无标注';
    annotationList.append(empty);
    return;
  }
  [...annotations].sort((left, right) => left.sequence - right.sequence).forEach((annotation) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `annotation-row${annotation.id === activeAnnotationId ? ' active' : ''}`;
    const index = document.createElement('span');
    index.className = 'annotation-row-index';
    index.textContent = String(annotation.sequence).padStart(2, '0');
    const content = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = annotation.title || '待填写标注';
    const meta = document.createElement('small');
    meta.textContent = `${annotation.partLabel} · ${annotationMesh(annotation)?annotation.status:'定位待确认'}`;
    content.append(title, meta);
    const severity = document.createElement('span');
    severity.className = 'annotation-severity';
    severity.dataset.level = annotation.severity;
    severity.textContent = annotation.severity;
    row.append(index, content, severity);
    row.title = '单击定位，双击编辑';
    row.addEventListener('click', () => selectAnnotation(annotation.id, true, false));
    row.addEventListener('dblclick', () => selectAnnotation(annotation.id, true, true));
    annotationList.append(row);
  });
}

function openAnnotationEditor(annotation: EngineeringAnnotation, pending = false): void {
  activeAnnotationId = annotation.id;
  annotationForm.hidden = false;
  annotationFormIndex.textContent = String(annotation.sequence).padStart(2, '0');
  annotationPartName.textContent = annotation.partLabel;
  annotationTitle.value = pending ? '' : annotation.title;
  annotationDescription.value = annotation.description;
  annotationSeverity.value = annotation.severity;
  annotationStatus.value = annotation.status;
  annotationDelete.hidden = pending;
  setAnnotationTip(pending ? '填写标注后保存。' : '编辑标注', true);
  renderAnnotationList();
  renderAnnotationMarkers();
  requestAnimationFrame(() => annotationTitle.focus());
}

function closeAnnotationEditor(removePending = false, clearSelection = false): void {
  let removedPending = false;
  if (removePending && pendingAnnotationId) {
    const pendingIndex = annotations.findIndex((annotation) => annotation.id === pendingAnnotationId);
    if (pendingIndex >= 0) annotations.splice(pendingIndex, 1);
    annotationMeshLookup.delete(pendingAnnotationId);
    pendingAnnotationId = null;
    removedPending = true;
  }
  if (clearSelection || removedPending) activeAnnotationId = null;
  annotationForm.hidden = true;
  annotationDelete.hidden = false;
  setAnnotationTip('');
  renderAnnotationList();
  renderAnnotationMarkers();
}

function focusAnnotation(annotation: EngineeringAnnotation): void {
  const mesh = annotationMesh(annotation);
  const worldPoint = annotationWorldPoint(annotation);
  if (!mesh || !worldPoint) return;
  if (annotation.viewpoint) {
    homeFramingActive=false;
    const saved=annotation.viewpoint;
    if(saved.projection){camera.fov=saved.projection.fov;camera.zoom=saved.projection.zoom;}
    const resized=saved.viewport&&(Math.abs(saved.viewport[0]-viewportWidth)>2||Math.abs(saved.viewport[1]-viewportHeight)>2);
    if(resized){
      const direction=new THREE.Vector3(...saved.cameraPosition).sub(new THREE.Vector3(...saved.target)).normalize();
      const owner=majorPartByLabel(annotation.partLabel),bounds=owner?partBounds(owner):new THREE.Box3().setFromObject(mesh);
      fitBounds(bounds,direction,1.2,worldPoint,presentationFrame());invalidateStaticFrame();return;
    }
    camera.position.fromArray(annotation.viewpoint.cameraPosition);
    camera.up.fromArray(annotation.viewpoint.cameraUp);
    controls.target.fromArray(annotation.viewpoint.target);
    camera.near = saved.projection?.near??Math.max(modelSize.length() / 100000, .001);
    camera.far = saved.projection?.far??Math.max(modelSize.length() * 20, 100);
    camera.aspect=viewportWidth/Math.max(viewportHeight,1);
    if(saved.framing==='full')camera.clearViewOffset();else applyPresentationOffset(presentationFrame());
    const distance=camera.position.distanceTo(controls.target);
    controls.minDistance=Math.max(distance*.001,.001);controls.maxDistance=Math.max(distance*100,10);
    camera.updateProjectionMatrix();
    updateCameraPreset();
    invalidateStaticFrame();
    return;
  }
  const meshBounds = new THREE.Box3().setFromObject(mesh);
  const size = meshBounds.getSize(new THREE.Vector3());
  const minimumSize = Math.max(modelSize.length() * .008, .02);
  if (size.length() < minimumSize) {
    meshBounds.setFromCenterAndSize(worldPoint, new THREE.Vector3(minimumSize, minimumSize, minimumSize));
  } else {
    const offset = worldPoint.clone().sub(meshBounds.getCenter(new THREE.Vector3())).multiplyScalar(.55);
    meshBounds.translate(offset);
  }
  const viewDirection = camera.position.clone().sub(controls.target).normalize();
  fitBounds(meshBounds, viewDirection, 1.85);
  invalidateStaticFrame();
}

function selectAnnotation(id: string, focus = false, edit = false): void {
  if (pendingAnnotationId && pendingAnnotationId !== id) closeAnnotationEditor(true, true);
  const annotation = annotations.find((item) => item.id === id);
  if (!annotation) return;
  if(focus&&annotationMesh(annotation)){
    const owner=majorPartByLabel(annotation.partLabel);if(owner&&owner!==selectedPart)selectPart(owner,false,true);
  }
  if(focus&&annotation.binding&&annotation.binding.rootId!=='source'&&annotationMesh(annotation)){
    setPresentationMode('drivetrain');applyDisplayMode(displayMode);updateSelectedUI();
  }
  setAnnotationPanelOpen(true);
  activeAnnotationId = annotation.id;
  if (edit || id === pendingAnnotationId) openAnnotationEditor(annotation, id === pendingAnnotationId);
  else {
    annotationForm.hidden = true;
    annotationDelete.hidden = false;
    setAnnotationTip('双击标注可编辑。', true);
    renderAnnotationList();
    renderAnnotationMarkers();
  }
  if (focus) focusAnnotation(annotation);
}

function deleteAnnotation(id: string): void {
  const index = annotations.findIndex((annotation) => annotation.id === id);
  if (index < 0) return;
  annotations.splice(index, 1);
  annotationMeshLookup.delete(id);
  if (pendingAnnotationId === id) pendingAnnotationId = null;
  if (activeAnnotationId === id) activeAnnotationId = null;
  annotationForm.hidden = true;
  persistAnnotations();
  renderAnnotationList();
  renderAnnotationMarkers();
}

function isPresentationShell(mesh: THREE.Mesh): boolean {
  return bladeMeshes.has(mesh)
    || hubShellMeshes.has(mesh)
    || towerShellMeshes.has(mesh)
    || majorPartForMesh(mesh)?.role === 'shell'
    || meshToPart.get(mesh)?.role === 'shell';
}

function isPickThroughShell(mesh:THREE.Mesh):boolean{
  if(displayMode!=='xray')return false;
  // Source shell children can have generic CAD names; use their assembly owner,
  // not just the leaf name. Blades remain selectable when no interior is hit.
  return hubShellMeshes.has(mesh)||towerShellMeshes.has(mesh)
    || majorPartForMesh(mesh)?.label==='机舱外壳'
    || majorPartForMesh(mesh)?.role==='shell'
    || meshToPart.get(mesh)?.role==='shell'
    || revealVendorInternals(mesh);
}

function placeAnnotationAtPointer(event: PointerEvent): void {
  if (!annotationModeActive || !modelRoot) return;
  restoreFullDetail();
  const intersection = spatialIntersectionAtPoint(event.clientX,event.clientY,true);
  if (!intersection) {
    setAnnotationTip('请点击可见零件表面。', true);
    return;
  }
  const mesh = intersection.object as THREE.Mesh;
  const meshPath = objectPathFromModelRoot(mesh);
  const binding=anchorRegistry?.bind(mesh,intersection.instanceId);
  if (!binding) {
    setAnnotationTip('此位置无法标注，请选择其他零件。', true);
    return;
  }
  if (pendingAnnotationId) deleteAnnotation(pendingAnnotationId);
  const localPosition = intersection.point.clone().applyMatrix4(pointWorldMatrix(mesh,intersection.instanceId).invert());
  const localNormal = intersection.face?.normal.clone().normalize() ?? new THREE.Vector3(0, 1, 0);
  const nextSequence = annotations.reduce((maximum, annotation) => Math.max(maximum, annotation.sequence), 0) + 1;
  const id = globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}-${nextSequence}`;
  const annotation: EngineeringAnnotation = {
    id,
    sequence: nextSequence,
    partLabel: annotationPartLabel(mesh),
    meshPath,
    binding,
    localPosition: localPosition.toArray(),
    localNormal: localNormal.toArray(),
    title: '待填写标注',
    description: '',
    severity: '一般',
    status: '待处理',
    createdAt: new Date().toISOString(),
    viewpoint: captureAnnotationViewpoint(),
  };
  annotations.push(annotation);
  annotationMeshLookup.set(id, mesh);
  pendingAnnotationId = id;
  activeAnnotationId = id;
  setAnnotationMode(false);
  setAnnotationTip('填写标注后保存。', true);
  openAnnotationEditor(annotation, true);
}

function majorPartByLabel(label: string): PartRecord | null {
  // Keep older annotation/sensor references readable after the CAD-grounded rename.
  if(label==='变压器')label='辅助变压器';
  for (const group of majorPartGroups) {
    const part = group.parts.find((candidate) => candidate.label === label);
    if (part) return part;
  }
  return null;
}

function sensorTarget(definition:SensorDefinition,part:PartRecord):{mesh:THREE.Mesh;description:string}|null{
  const generator=drivetrain?.generatorModel;
  let root:THREE.Object3D=part.node,description=definition.name+'测点示意';
  if(definition.id==='WT01-GEN-WT01'&&generator){root=generator.statorCoils;description='定子绕组 · 示意测点';}
  else if(definition.id==='WT01-GEN-BT01'&&generator){root=generator.bearings[0].outerRace;description='驱动端轴承外圈 · 示意测点';}
  else{
    const pattern=definition.id==='WT01-HYD-P01'?/^液压站(?:-\d+)?$/:
      definition.id==='WT01-YAW-V01'?/^偏航驱动组件(?:-\d+)?$/:
      definition.id==='WT01-MS-V01'?/^主轴-\d+$/:null;
    if(pattern){let found:THREE.Object3D|undefined;part.node.traverse(n=>{if(!found&&pattern.test(leafNodeName(n)))found=n;});if(!found)return null;root=found;}
  }
  let largest: THREE.Mesh | null = null;
  let largestVolume = -1;
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
    const volume = Math.max(size.x * size.y * size.z, size.lengthSq() * .0001);
    if (volume <= largestVolume) return;
    largest = mesh;
    largestVolume = volume;
  });
  return largest?{mesh:largest,description}:null;
}

function sensorAnchorSeed(geometry:THREE.BufferGeometry, anchor: [number, number, number]): THREE.Vector3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) return new THREE.Vector3();
  return new THREE.Vector3(
    THREE.MathUtils.lerp(box.min.x, box.max.x, anchor[0]),
    THREE.MathUtils.lerp(box.min.y, box.max.y, anchor[1]),
    THREE.MathUtils.lerp(box.min.z, box.max.z, anchor[2]),
  );
}

function sensorWorldPoint(sensor: SensorRuntime): THREE.Vector3 {
  return anchorWorldPoint(sensor.mesh,sensor.localPosition,sensor.binding);
}

function sensorStatus(value: number | null, quality: SensorQuality, warning: number, alarm: number): SensorStatus {
  if (quality === 'bad' || value === null) return 'offline';
  if (value >= alarm) return 'alarm';
  if (quality === 'uncertain' || value >= warning) return 'warning';
  return 'normal';
}

function sensorStatusText(statusValue: SensorStatus): string {
  return ({ normal: '正常', warning: '预警', alarm: '报警', offline: '离线' } as const)[statusValue];
}

function sensorQualityText(quality: SensorQuality): string {
  return ({ good: '良好', uncertain: '存疑', bad: '无效' } as const)[quality];
}

function formatSensorValue(sensor: SensorRuntime): string {
  return sensor.value === null ? '—' : sensor.value.toFixed(sensor.precision);
}

function sensorUnitText(unit:string):string{
  return ({'mm/s':'毫米/秒',bar:'巴'} as Record<string,string>)[unit]??unit;
}

function createDemoSensorAdapter(): SensorDataAdapter {
  return {
    start(onValue) {
      const emit = () => {
        const now = Date.now();
        const elapsed = now / 1000;
        SENSOR_DEFINITIONS.forEach((definition, index) => {
          const quality = definition.demoQuality ?? (index === 6 && Math.sin(elapsed / 17) > .96 ? 'uncertain' : 'good');
          const wave = Math.sin(elapsed * .19 + definition.phase) * .72
            + Math.sin(elapsed * .053 + definition.phase * 1.7) * .28;
          const value = quality === 'bad' ? null : definition.baseValue + definition.amplitude * wave;
          onValue({
            sensorId: definition.id,
            value,
            sourceTimestamp: new Date(now - 120).toISOString(),
            serverTimestamp: new Date(now).toISOString(),
            quality,
          });
        });
      };
      emit();
      const timer = window.setInterval(emit, 1000);
      return () => window.clearInterval(timer);
    },
  };
}

function createWebSocketSensorAdapter(url: string): SensorDataAdapter {
  return {
    start(onValue) {
      const socket = new WebSocket(url);
      socket.addEventListener('message', (event) => {
        try {
          const sample = JSON.parse(String(event.data)) as Partial<SensorDataValue>;
          if (typeof sample.sensorId !== 'string') return;
          if (sample.value !== null && typeof sample.value !== 'number') return;
          if (!['good', 'uncertain', 'bad'].includes(sample.quality ?? '')) return;
          onValue({
            sensorId: sample.sensorId,
            value: sample.value ?? null,
            sourceTimestamp: sample.sourceTimestamp ?? new Date().toISOString(),
            serverTimestamp: sample.serverTimestamp ?? new Date().toISOString(),
            quality: sample.quality as SensorQuality,
          });
        } catch (error) {
          console.warn('实时传感器消息格式无效', error);
        }
      });
      return () => socket.close();
    },
  };
}

let sensorUiUpdateScheduled = false;
function scheduleSensorUiUpdate(): void {
  if (sensorUiUpdateScheduled) return;
  sensorUiUpdateScheduled = true;
  requestAnimationFrame(() => {
    sensorUiUpdateScheduled = false;
    renderSensorUi();
  });
}

function applySensorValue(sample: SensorDataValue): void {
  const sensor = sensors.find((candidate) => candidate.id === sample.sensorId);
  if (!sensor) return;
  sensor.value = sample.value;
  sensor.sourceTimestamp = sample.sourceTimestamp;
  sensor.serverTimestamp = sample.serverTimestamp;
  sensor.quality = sample.quality;
  sensor.status = sensorStatus(sample.value, sample.quality, sensor.warning, sensor.alarm);
  if (sample.value !== null) {
    sensor.history.push({ timestamp: Date.parse(sample.sourceTimestamp), value: sample.value });
    if (sensor.history.length > 60) sensor.history.splice(0, sensor.history.length - 60);
  }
  scheduleSensorUiUpdate();
}

function ensureSensorRows(): void {
  if (sensorRowElements.size === sensors.length) return;
  sensorList.replaceChildren();
  sensorRowElements.clear();
  sensors.forEach((sensor) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sensor-row';
    const statusDot = document.createElement('i');
    statusDot.setAttribute('aria-hidden', 'true');
    const content = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = sensor.name;
    const meta = document.createElement('small');
    content.append(name, meta);
    const value = document.createElement('span');
    value.className = 'sensor-row-value';
    row.append(statusDot, content, value);
    row.addEventListener('click', () => selectSensor(sensor.id, true));
    sensorList.append(row);
    sensorRowElements.set(sensor.id, row);
  });
}

function ensureSensorMarkers(): void {
  if (sensorMarkerElements.size === sensors.length) return;
  sensorOverlay.replaceChildren();
  sensorMarkerElements.clear();
  sensors.forEach((sensor, index) => {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'sensor-pin';
    marker.textContent = String(index + 1).padStart(2, '0');
    marker.setAttribute('aria-label', `${sensor.name}传感器`);
    const label = document.createElement('span');
    label.className = 'sensor-pin-label';
    const name = document.createElement('b');
    name.textContent = sensor.name;
    const value = document.createElement('small');
    label.append(name, value);
    marker.append(label);
    marker.addEventListener('pointerdown', (event) => event.stopPropagation());
    marker.addEventListener('click', (event) => {
      event.stopPropagation();
      selectSensor(sensor.id, true);
    });
    sensorOverlay.append(marker);
    sensorMarkerElements.set(sensor.id, marker);
  });
}

function drawSensorTrend(sensor: SensorRuntime): void {
  const context = sensorTrend.getContext('2d');
  if (!context) return;
  const width = sensorTrend.width;
  const height = sensorTrend.height;
  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(2,10,14,.32)';
  context.fillRect(0, 0, width, height);
  const values = sensor.history.map((sample) => sample.value);
  if (values.length < 2) return;
  const minValue = Math.min(...values, sensor.warning) - Math.max(sensor.amplitude, 1) * .6;
  const maxValue = Math.max(...values, sensor.alarm) + Math.max(sensor.amplitude, 1) * .6;
  const range = Math.max(maxValue - minValue, .001);
  const yFor = (value: number) => height - 12 - ((value - minValue) / range) * (height - 24);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(198,208,211,.09)';
  for (let row = 1; row < 4; row += 1) {
    const y = (height / 4) * row;
    context.beginPath(); context.moveTo(8, y); context.lineTo(width - 8, y); context.stroke();
  }
  [[sensor.warning, '#e6b94e'], [sensor.alarm, '#d8675d']].forEach(([threshold, color]) => {
    context.strokeStyle = String(color);
    context.globalAlpha = .55;
    context.setLineDash([5, 5]);
    const y = yFor(Number(threshold));
    context.beginPath(); context.moveTo(8, y); context.lineTo(width - 8, y); context.stroke();
  });
  context.setLineDash([]);
  context.globalAlpha = 1;
  context.strokeStyle = sensor.status === 'alarm' ? '#d8675d' : sensor.status === 'warning' ? '#e6b94e' : '#7ea7dc';
  context.lineWidth = 2.5;
  context.beginPath();
  values.forEach((value, index) => {
    const x = 8 + (index / Math.max(values.length - 1, 1)) * (width - 16);
    const y = yFor(value);
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.stroke();
}

function renderSensorDetail(sensor: SensorRuntime): void {
  sensorDetail.hidden = false;
  sensorPanel.classList.add('detail-open');
  sensorDetailId.textContent = `测点 ${String(sensors.indexOf(sensor)+1).padStart(2,'0')}`;
  sensorDetailName.textContent = sensor.name;
  sensorDetailPart.textContent = `${sensor.partLabel} · ${sensor.anchorDescription}${worldVisible(sensor.mesh)?'':' · 开启传动透视查看'}`;
  sensorDetailValue.textContent = formatSensorValue(sensor);
  sensorDetailUnit.textContent = sensorUnitText(sensor.unit);
  sensorDetailStatus.textContent = sensorStatusText(sensor.status);
  sensorDetailStatus.dataset.status = sensor.status;
  sensorDetailTime.textContent = sensor.sourceTimestamp ? new Date(sensor.sourceTimestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
  sensorDetailQuality.textContent = sensorQualityText(sensor.quality);
  sensorWarningThreshold.textContent = `${sensor.warning} ${sensorUnitText(sensor.unit)}`;
  sensorAlarmThreshold.textContent = `${sensor.alarm} ${sensorUnitText(sensor.unit)}`;
  sensorCreateAnnotation.disabled = sensor.status === 'normal';
  drawSensorTrend(sensor);
}

function updateSensorAlarmBadge(): void {
  sensorAlarmCount.hidden = Number(sensorAlarmCount.textContent) === 0 || (!sensorLayerVisible && sensorPanel.hidden);
}

function renderSensorUi(): void {
  ensureSensorRows();
  ensureSensorMarkers();
  const counts: Record<SensorStatus, number> = { normal: 0, warning: 0, alarm: 0, offline: 0 };
  sensors.forEach((sensor) => {
    counts[sensor.status] += 1;
    const row = sensorRowElements.get(sensor.id);
    if (row) {
      row.dataset.status = sensor.status;
      row.classList.toggle('active', sensor.id === selectedSensorId);
      row.querySelector('small')!.textContent = `${sensor.partLabel} · ${sensorStatusText(sensor.status)}`;
      row.querySelector<HTMLElement>('.sensor-row-value')!.textContent = `${formatSensorValue(sensor)}${sensor.value === null ? '' : ` ${sensorUnitText(sensor.unit)}`}`;
    }
    const marker = sensorMarkerElements.get(sensor.id);
    if (marker) {
      marker.dataset.status = sensor.status;
      marker.classList.toggle('active', sensor.id === selectedSensorId);
      marker.querySelector('small')!.textContent = `${formatSensorValue(sensor)}${sensor.value === null ? '' : ` ${sensorUnitText(sensor.unit)}`}`;
    }
  });
  sensorNormalCount.textContent = String(counts.normal);
  sensorWarningCount.textContent = String(counts.warning);
  sensorCriticalCount.textContent = String(counts.alarm);
  sensorOfflineCount.textContent = String(counts.offline);
  sensorAlarmCount.textContent = String(counts.alarm);
  updateSensorAlarmBadge();
  sensorStreamState.textContent = counts.offline === sensors.length ? '未连接' : '已连接';
  const selected = sensors.find((sensor) => sensor.id === selectedSensorId);
  if (selected) renderSensorDetail(selected);
  updateSensorOverlay();
}

function updateSensorOverlay(): void {
  sensors.forEach((sensor) => {
    const marker = sensorMarkerElements.get(sensor.id);
    if (!marker) return;
    if (!sensorLayerVisible || !worldVisible(sensor.mesh) || (sensor.status !== 'alarm' && sensor.id !== selectedSensorId)) {
      if(!marker.hidden)marker.hidden=true;
      return;
    }
    const projected = sensorWorldPoint(sensor).project(camera);
    // High-performance HMI rule: keep normal and warning telemetry out of the
    // default 3D scene. A non-alarm point appears only when the operator
    // explicitly selects it from the monitoring list.
    const visible = sensorLayerVisible
      && (sensor.status === 'alarm' || sensor.id === selectedSensorId)
      && projected.z > -1 && projected.z < 1;
    if(marker.hidden===visible)marker.hidden=!visible;
    if (!visible) return;
    const left = `${Math.round((overlayOffsetX+(projected.x*.5+.5)*viewportWidth)*10)/10}px`;
    const top = `${Math.round((overlayOffsetY+(-projected.y*.5+.5)*viewportHeight)*10)/10}px`;
    if (marker.style.left !== left) marker.style.left = left;
    if (marker.style.top !== top) marker.style.top = top;
  });
}

function selectSensor(id: string, focus = false): void {
  const sensor = sensors.find((candidate) => candidate.id === id);
  if (!sensor) return;
  selectedSensorId = id;
  setInspectorTab('sensors');
  if (focus) selectPart(sensor.part, true, true);
  renderSensorUi();
}

function setSensorLayerVisible(visible: boolean): void {
  sensorLayerVisible = visible;
  sensorLayerToggle.classList.toggle('active', visible);
  sensorLayerToggle.setAttribute('aria-pressed', String(visible));
  updateSensorAlarmBadge();
  updateSensorOverlay();
}

function createAnnotationFromSensor(): void {
  const sensor = sensors.find((candidate) => candidate.id === selectedSensorId);
  if (!sensor) return;
  closeAnnotationEditor(true, true);
  const nextSequence = annotations.reduce((maximum, annotation) => Math.max(maximum, annotation.sequence), 0) + 1;
  const id = globalThis.crypto?.randomUUID?.() ?? `annotation-${Date.now()}-${nextSequence}`;
  const annotation: EngineeringAnnotation = {
    id,
    sequence: nextSequence,
    partLabel: sensor.partLabel,
    meshPath: objectPathFromModelRoot(sensor.mesh),
    binding:sensor.binding,
    localPosition: [...sensor.localPosition],
    localNormal: [...sensor.localNormal],
    title: `${sensor.name}${sensor.status === 'alarm' ? '报警' : '预警'}`,
    description: `${sensor.name}当前值：${formatSensorValue(sensor)} ${sensorUnitText(sensor.unit)}；数据质量：${sensorQualityText(sensor.quality)}；源时间：${new Date(sensor.sourceTimestamp).toLocaleString('zh-CN',{hour12:false})}。`,
    severity: sensor.status === 'alarm' ? '紧急' : '注意',
    status: '待处理',
    createdAt: new Date().toISOString(),
    viewpoint: captureAnnotationViewpoint(),
  };
  annotations.push(annotation);
  annotationMeshLookup.set(id, sensor.mesh);
  pendingAnnotationId = id;
  activeAnnotationId = id;
  setInspectorTab('annotations');
  openAnnotationEditor(annotation, true);
  annotationTitle.value = annotation.title;
  annotationDescription.value = annotation.description;
  annotationSeverity.value = annotation.severity;
}

async function initializeSensors(): Promise<void> {
  stopSensorStream?.();
  stopSensorStream = null;
  selectedSensorId = null;
  sensorDetail.hidden = true;
  sensorPanel.classList.remove('detail-open');
  sensors.length = 0;
  sensorMarkerElements.clear();
  sensorRowElements.clear();
  const prepared=await Promise.all(SENSOR_DEFINITIONS.map(async(definition):Promise<SensorRuntime|null> => {
    const part = majorPartByLabel(definition.partLabel);
    if (!part) return null;
    const target=sensorTarget(definition,part);
    if (!target) return null;
    const {mesh,description}=target;
    const geometry=mesh.geometry;
    await spatialIndex.ensure(geometry);
    const binding=anchorRegistry?.bind(mesh,(mesh as THREE.InstancedMesh).isInstancedMesh?0:undefined);
    if(!binding)return null;
    const anchor=surfaceAnchor(mesh,sensorAnchorSeed(geometry,definition.anchor),geometry);
    return {
      ...definition,
      part,
      mesh,
      binding,anchorDescription:description,
      localPosition:anchor.position.toArray(),localNormal:anchor.normal.toArray(),
      value: null,
      sourceTimestamp: '',
      serverTimestamp: '',
      quality: 'bad',
      status: 'offline',
      history: [],
    };
  }));
  sensors.push(...prepared.filter((sensor):sensor is SensorRuntime=>sensor!==null));
  renderSensorUi();
  stopSensorStream = createDemoSensorAdapter().start(applySensorValue);
}

function renderPartList(query = ''): void {
  if (!majorPartGroups.length) return;
  const normalized = query.trim().toLowerCase();
  results.replaceChildren();
  let renderedCount = 0;
  majorPartGroups.forEach((group) => {
    const filtered = group.parts.filter((part) => !normalized || part.label.toLowerCase().includes(normalized) || leafNodeName(part.node).toLowerCase().includes(normalized));
    if (!filtered.length) return;
    const section = document.createElement('section');
    section.className = 'tree-group';
    const heading = document.createElement('h3');
    heading.className = 'tree-group-label';
    heading.textContent = group.label;
    section.append(heading);
    filtered.forEach((part) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `part-row${selectedPart === part ? ' active' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(selectedPart === part));
      if(part.scopeDescription)row.title=part.scopeDescription;
      row.style.setProperty('--tree-order', String(renderedCount));
      row.innerHTML = `<span class="tree-node" aria-hidden="true"><i></i></span><span><strong></strong></span><span class="visibility" aria-hidden="true">${selectedPart === part && partFocusActive ? '●' : '○'}</span>`;
      row.querySelector('strong')!.textContent = part.label;
      row.addEventListener('click', () => selectPart(part, true, true));
      section.append(row);
      renderedCount += 1;
    });
    results.append(section);
  });
  if (!renderedCount) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = '未找到零件';
    results.append(empty);
  }
}

function clearPartFocus(): void {
  restoreFullDetail();
  isIsolated=false;
  isolateButton.textContent='独显';
  selectedPart = null;
  selectedRelationships=null;
  partFocusActive = false;
  selectionBox.visible = false;
  applyDisplayMode(displayMode);
  updateSelectedUI();
}

function clearVisibilityFilters():void{
  userHiddenParts.clear();
  isIsolated=false;
  isolateButton.textContent='独显';
}

function restoreVisibility(): void {
  restoreFullDetail();setPresentationMode('overview');
  clearVisibilityFilters();
  selectedPart = null;
  selectedRelationships=null;
  partFocusActive = false;
  selectionBox.visible = false;
  applyDisplayMode(displayMode);
  refreshPartVisibility();
  updateSelectedUI();
}

function beginAnnotationPlacement(): void {
  closeAnnotationEditor(true, true);
  setAnnotationPanelOpen(true);
  setAnnotationMode(true);
}

function setOrbitPivotFromPointer(event: MouseEvent): void {
  restoreFullDetail();
  if (!modelRoot || annotationModeActive || pendingAnnotationId) return;
  const part=selectedPart??pickPartAtPoint(event.clientX,event.clientY);
  if(part)centerOrbitOnPart(part);
}

search.addEventListener('input', () => renderPartList(search.value));
inspectorToggle.addEventListener('click',()=>setMobileInspectorOpen(!mobileInspectorOpen));
compactViewport.addEventListener('change',()=>setMobileInspectorOpen(mobileInspectorOpen));
setMobileInspectorOpen(false);
partsTab.addEventListener('click', () => setAnnotationPanelOpen(false));
annotationsTab.addEventListener('click', () => setAnnotationPanelOpen(true));
sensorsTab.addEventListener('click', () => setInspectorTab('sensors'));
annotationToggle.addEventListener('click', beginAnnotationPlacement);
annotationClose.addEventListener('click', () => setAnnotationPanelOpen(false));
annotationModeButton.addEventListener('click', () => {
  if (annotationModeActive) setAnnotationMode(false);
  else beginAnnotationPlacement();
});
navigationOrbit.addEventListener('click', () => setNavigationMode('orbit'));
navigationPan.addEventListener('click', () => setNavigationMode('pan'));
navigationReset.addEventListener('click', resetViewerView);
sensorLayerToggle.addEventListener('click', () => setSensorLayerVisible(!sensorLayerVisible));
sensorDetailClose.addEventListener('click', () => {
  selectedSensorId = null;
  sensorDetail.hidden = true;
  sensorPanel.classList.remove('detail-open');
  renderSensorUi();
});
sensorCreateAnnotation.addEventListener('click', createAnnotationFromSensor);
annotationCancel.addEventListener('click', () => closeAnnotationEditor(true));
annotationDelete.addEventListener('click', () => {
  if (!activeAnnotationId) return;
  const annotation = annotations.find((item) => item.id === activeAnnotationId);
  if (!annotation) return;
  if (window.confirm(`确定删除标注 ${String(annotation.sequence).padStart(2, '0')}「${annotation.title}」吗？`)) {
    deleteAnnotation(annotation.id);
  }
});
annotationForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!activeAnnotationId) return;
  const annotation = annotations.find((item) => item.id === activeAnnotationId);
  if (!annotation) return;
  const title = annotationTitle.value.trim();
  if (!title) {
    annotationTitle.focus();
    return;
  }
  annotation.title = title;
  annotation.description = annotationDescription.value.trim();
  annotation.severity = annotationSeverity.value as AnnotationSeverity;
  annotation.status = annotationStatus.value as AnnotationStatus;
  annotation.viewpoint = captureAnnotationViewpoint();
  if (pendingAnnotationId === annotation.id) pendingAnnotationId = null;
  persistAnnotations();
  closeAnnotationEditor(false, false);
  setAnnotationTip('标注已保存。', true);
});

const modelPointerIds=new Set<number>();
canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  modelPointerIds.add(event.pointerId);
  if(modelPointerIds.size>1){partPointerDragged=true;return;}
  partPointerDragged=false;
  annotationPointerStart = { x: event.clientX, y: event.clientY, button: event.button };
});
let partPointerDragged=false;
canvas.addEventListener('pointermove',event=>{
  if(annotationPointerStart&&Math.hypot(event.clientX-annotationPointerStart.x,event.clientY-annotationPointerStart.y)>5)partPointerDragged=true;
});
canvas.addEventListener('pointerup', (event) => {
  modelPointerIds.delete(event.pointerId);
  const start = annotationPointerStart;
  annotationPointerStart = null;
  if (!start || start.button !== 0 || event.button !== 0 || partPointerDragged) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
  if(annotationModeActive)placeAnnotationAtPointer(event);else selectPartAtPointer(event);
});
canvas.addEventListener('pointercancel',event=>{
  modelPointerIds.delete(event.pointerId);annotationPointerStart=null;partPointerDragged=true;
});
canvas.addEventListener('dblclick', setOrbitPivotFromPointer);

function initializeSpatialRegistry():void{
  if(!modelRoot)return;
  const roots=[{id:'source',version:modelIdentity.source,root:modelRoot},
    ...(drivetrain?.demonstrations??[]).map((d,i)=>({id:i===0?'gearbox':'generator',version:i===0?modelIdentity.gearbox:modelIdentity.generator,root:d.root}))];
  anchorRegistry=new AnchorRegistry(roots);
  const seen=new Set<THREE.Mesh>();spatialMeshes=[];
  for(const {id,root}of roots)root.traverse(object=>{
    const mesh=object as THREE.Mesh;if(!mesh.isMesh||seen.has(mesh))return;seen.add(mesh);spatialMeshes.push(mesh);
    const owner=majorMeshToPart.get(mesh)??(id==='source'?majorPartForMesh(mesh):majorPartByLabel(id==='gearbox'?'齿轮箱':'发电机'));
    if(owner)spatialOwner.set(mesh,owner);
  });
  spatialCandidatesDirty=true;
}

function spatialIntersectionAtPoint(clientX:number,clientY:number,annotation=false):THREE.Intersection|null{
  if(!modelRoot||!majorPartGroups.length)return null;
  const rect=canvas.getBoundingClientRect();
  annotationPointer.set((clientX-rect.left)/rect.width*2-1,-(clientY-rect.top)/rect.height*2+1);
  camera.updateMatrixWorld(true);
  annotationRaycaster.setFromCamera(annotationPointer,camera);
  if(spatialCandidatesDirty){
    visibleSpatialMeshes=spatialMeshes.filter(mesh=>worldVisible(mesh)&&(Array.isArray(mesh.material)?mesh.material:[mesh.material]).some(m=>m.visible&&m.opacity>0));
    spatialCandidatesDirty=false;
  }
  const interiors:THREE.Mesh[]=[],shells:THREE.Mesh[]=[];
  for(const mesh of visibleSpatialMeshes){
    const owner=spatialOwner.get(mesh);
    if(!annotation&&!owner)continue;
    if(annotation&&partFocusActive&&selectedPart&&owner!==selectedPart)continue;
    const explicitShell=annotation&&partFocusActive&&selectedPart?.role==='shell'&&owner===selectedPart;
    if(isPickThroughShell(mesh)&&!explicitShell)continue;
    (isPresentationShell(mesh)&&!explicitShell?shells:interiors).push(mesh);
  }
  const candidates=annotationRaycaster.intersectObjects(interiors,false);
  const hitMaterial=(hit:THREE.Intersection)=>{
    const mesh=hit.object as THREE.Mesh;
    return Array.isArray(mesh.material)?mesh.material[hit.face?.materialIndex??0]:mesh.material;
  };
  const usable=(hit:THREE.Intersection)=>{
    const material=hitMaterial(hit);
    return material?.visible&&material.opacity>0;
  };
  return candidates.find(hit=>usable(hit)&&hitMaterial(hit).opacity>=.2)
    ??candidates.find(usable)??annotationRaycaster.intersectObjects(shells,false).find(usable)??null;
}

function pickPartAtPoint(clientX:number,clientY:number):PartRecord|null{
  const hit=spatialIntersectionAtPoint(clientX,clientY);
  return hit?spatialOwner.get(hit.object)??null:null;
}

function selectPartAtPointer(event:PointerEvent):void{
  restoreFullDetail();
  const part=pickPartAtPoint(event.clientX,event.clientY);
  if(part&&part!==selectedPart){setInspectorTab('parts');selectPart(part,false,true);}
}
window.addEventListener('resize', updateAnnotationOverlay);

document.addEventListener('keydown', (event) => {
  const editing = document.activeElement instanceof HTMLInputElement
    || document.activeElement instanceof HTMLTextAreaElement
    || document.activeElement instanceof HTMLSelectElement;
  if (event.key.toLowerCase() === 'a' && !editing) {
    event.preventDefault();
    beginAnnotationPlacement();
    return;
  }
  if (event.key === '1' && !editing) {
    event.preventDefault();
    setNavigationMode('orbit');
    return;
  }
  if (event.key === '2' && !editing) {
    event.preventDefault();
    setNavigationMode('pan');
    return;
  }
  if (event.key.toLowerCase() === 'r' && !editing) {
    event.preventDefault();
    resetViewerView();
    return;
  }
  if (event.key.toLowerCase() === 'm' && !editing) {
    event.preventDefault();
    setSensorLayerVisible(!sensorLayerVisible);
    return;
  }
  if (event.key === 'Escape' && (annotationModeActive || !annotationForm.hidden)) {
    event.preventDefault();
    setAnnotationMode(false);
    closeAnnotationEditor(true);
    return;
  }
  if (event.key === '/' && document.activeElement !== search) { event.preventDefault();if(compactViewport.matches)setMobileInspectorOpen(true);search.focus(); }
  if(event.key==='Escape'&&compactViewport.matches&&mobileInspectorOpen){setMobileInspectorOpen(false);return;}
  if (event.key === 'Escape') { search.value = ''; search.blur(); clearPartFocus(); }
});

setNavigationMode('orbit', false);

clearPartFocusButton.addEventListener('click', () => clearPartFocus());
focusButton.addEventListener('click', () => selectedPart && fitBounds(partBounds(selectedPart),new THREE.Vector3(1,.55,1.3),1.55,partOrbitCenter(selectedPart)));
isolateButton.addEventListener('click', () => {
  if (!selectedPart) return;
  if (isIsolated) restoreVisibility();
  else {
    isIsolated = true;
    isolateButton.textContent = '全部';
    refreshPartVisibility();
  }
  renderPartList(search.value);
});
hideButton.addEventListener('click', () => {
  if (!selectedPart) return;
  userHiddenParts.add(selectedPart);
  refreshPartVisibility();
  selectionBox.visible = false;
  renderPartList(search.value);
});

document.querySelectorAll<HTMLButtonElement>('.mode-button').forEach((button) => button.addEventListener('click', () => applyDisplayMode(button.dataset.mode as DisplayMode)));
document.querySelectorAll<HTMLButtonElement>('.view-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view ?? 'overview')));
hideAuxiliary.addEventListener('change', () => {
  refreshPartVisibility();
  renderPartList(search.value);
});

explodeRange.addEventListener('input', () => {
  beginInteractiveRender();
  const value = Number(explodeRange.value);
  byId<HTMLOutputElement>('explode-value').value = `${value}%`;
  updateExplosion(value);
  endInteractiveRender();
});
sectionRange.addEventListener('input', () => {
  const value = Number(sectionRange.value);
  byId<HTMLOutputElement>('section-value').value = `${value}%`;
  sectionPlane.constant = THREE.MathUtils.lerp(-modelBounds.max.x, -modelBounds.min.x, value / 100);
});

byId<HTMLInputElement>('show-internals').addEventListener('change', event => {
  restoreFullDetail();
  const visible=(event.target as HTMLInputElement).checked;
  setPresentationMode(visible?'drivetrain':'overview');
  applyDisplayMode('xray');
  updateSelectedUI();
});
function fitGeneratorPresentation(): void {
  if (!drivetrain?.generatorModel) return;
  restoreFullDetail();
  fitBounds(drivetrain.bounds, new THREE.Vector3(1.1, 0.75, 1.4), 1.1,selectedPart?partOrbitCenter(selectedPart):undefined);
}

byId('generator-internal-detail').addEventListener('click',()=>{
  if(!drivetrain?.generatorModel)return;
  restoreFullDetail();
  const model=drivetrain.generatorModel;
  const bounds=new THREE.Box3().setFromObject(model.statorCore)
    .union(new THREE.Box3().setFromObject(model.endCovers))
    .union(new THREE.Box3().setFromObject(model.brushRig))
    .union(new THREE.Box3().setFromObject(drivetrain.links[2].nodes[0]));
  fitBounds(bounds,new THREE.Vector3(1.05,.55,1.65),1.08);
});

byId('generator-bearing-detail').addEventListener('click',()=>{
  const bearing=drivetrain?.generatorModel?.bearings[0];if(!bearing)return;
  restoreFullDetail();
  const bounds=new THREE.Box3().setFromObject(bearing.outerRace).union(new THREE.Box3().setFromObject(bearing.innerRace)).expandByScalar(.10);
  fitBounds(bounds,new THREE.Vector3(-1.3,.6,1.4),1.15);
});
byId('generator-collector-detail').addEventListener('click',()=>{
  const model=drivetrain?.generatorModel;if(!model)return;
  restoreFullDetail();
  const bounds=new THREE.Box3().setFromObject(model.slipRings).union(new THREE.Box3().setFromObject(model.brushRig));
  fitBounds(bounds,new THREE.Vector3(1.15,.5,1.8),1.13);
});

for (const mode of ['cad', 'section'] as const) {
  byId(`generator-${mode}-mode`).addEventListener('click', () => {
    if (!drivetrain) return;
    setPresentationMode(mode==='section'?'drivetrain':'overview');
    applyDisplayMode('xray');
    updateSelectedUI();
  });
}

function resetViewerView():void{
  restoreFullDetail();
  setNavigationMode('orbit', false);
  setAnnotationPanelOpen(false,false);
  clearVisibilityFilters();
  search.value = '';
  explodeRange.value = '0';
  byId<HTMLOutputElement>('explode-value').value = '0%';
  updateExplosion(0);
  selectPart(null);
  renderPartList();
  setView('nacelle');
}

const draco = new DRACOLoader();
draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
const loader = new GLTFLoader();
loader.setDRACOLoader(draco);
loader.setMeshoptDecoder(MeshoptDecoder);

loader.load(
  `${import.meta.env.BASE_URL}models/wind-turbine-cad.glb`,
  (gltf) => {
    modelRoot = gltf.scene;
    modelRoot.name ||= 'Wind Turbine CAD Assembly';
    scene.add(modelRoot);
    modelBounds.setFromObject(modelRoot);
    modelBounds.getCenter(modelCenter);
    modelBounds.getSize(modelSize);
    ground.position.y = modelBounds.min.y - Math.max(modelSize.y * .002, .01);
    ground.scale.setScalar(Math.max(modelSize.x, modelSize.z, 10) / 250 * 2.5);

    modelRoot.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      originalMeshMaterials.set(mesh, mesh.material);
      const geometry = mesh.geometry;
      triangleCount += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach(saveMaterialState);
    });

    parts = collectPartNodes(modelRoot);
    rerouteHydraulicHoseAroundRearGuard();
    suppressExactOverlapDuplicates();
    suppressNestedYawBrakeDuplicates();
    const drivetrainFocus = findByTerms(['传动系统']);
    if (drivetrainFocus) {
      // Keep the complete nacelle neighborhood while excluding the remote tower and blade spans.
      // The static layer is cached, so restoring these devices does not add per-frame draw cost.
      const focusBox = new THREE.Box3().setFromObject(drivetrainFocus).expandByScalar(7.5);
      parts.forEach((part) => {
        if (focusBox.containsPoint(part.centerWorld)) return;
        part.originalVisible = false;
        part.node.visible = false;
      });
    }
    // The three blades are rigidly mounted to the hub and must remain visible even
    // though their far-away centers fall outside the nacelle performance crop.
    const bladeRoots = findMotionRoots(/^WD190-7500\.?stp-[123]$/i);
    // The uppermost source tower section is the real lower support of the yaw ring.
    // Restore this exact source subtree after the nacelle crop so the bearing is not
    // left visually floating. Its original transform and hierarchy remain untouched.
    const upperTowerRoots = findMotionRoots(/塔身Ⅳ/i);
    const hubRoot = findMotionRoots(/轮毂-简化/i)[0] ?? null;
    const hubShroudRoot = findMotionRoots(/^导流罩$/i)[0] ?? null;
    bladeRoots.forEach((node) => {
      node.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return;
        bladeMeshes.add(object as THREE.Mesh);
        heroExteriorMeshes.add(object as THREE.Mesh);
      });
    });
    upperTowerRoots.forEach((node) => {
      node.traverse((object) => {
        if ((object as THREE.Mesh).isMesh) towerShellMeshes.add(object as THREE.Mesh);
      });
    });
    [...(hubRoot ? [hubRoot] : [])].forEach((node) => {
      node.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return;
        hubBodyMeshes.add(object as THREE.Mesh);
        heroExteriorMeshes.add(object as THREE.Mesh);
      });
    });
    [...(hubShroudRoot ? [hubShroudRoot] : [])].forEach((node) => {
      node.traverse((object) => {
        if (!(object as THREE.Mesh).isMesh) return;
        // Only the composite cover is white. Its metal connection plates and
        // fittings belong to the same assembly but keep a metallic finish.
        if(/连接板|过渡接头|螺[栓钉母]|垫圈/.test(object.name))hubBodyMeshes.add(object as THREE.Mesh);
        else hubShellMeshes.add(object as THREE.Mesh);
        heroExteriorMeshes.add(object as THREE.Mesh);
      });
    });
    const belongsToRoots = (node: THREE.Object3D, roots: THREE.Object3D[]): boolean => {
      let cursor: THREE.Object3D | null = node;
      while (cursor) {
        if (roots.includes(cursor)) return true;
        cursor = cursor.parent;
      }
      return roots.some((root) => {
        let rootCursor: THREE.Object3D | null = root;
        while (rootCursor) {
          if (rootCursor === node) return true;
          rootCursor = rootCursor.parent;
        }
        return false;
      });
    };
    const sourceConnectionRoots = [
      ...bladeRoots,
      ...upperTowerRoots,
      ...(hubRoot ? [hubRoot] : []),
      ...(hubShroudRoot ? [hubShroudRoot] : []),
    ];
    parts.forEach((part) => {
      if (!belongsToRoots(part.node, sourceConnectionRoots)) return;
      part.originalVisible = true;
      part.node.visible = true;
    });
    let motionReady=false;
    try {
      setupMotionLinks();
      byId<HTMLInputElement>('show-internals').disabled = false;
      motionReady=true;
    } catch (error) {
      console.error(error);
    }
    majorPartGroups = buildMajorPartGroups();
    initializeSpatialRegistry();
    refreshPartVisibility();
    byId('metric-triangles').textContent = formatNumber(triangleCount);
    renderPartList();
    sectionPlane.constant = -modelCenter.x;
    applyDisplayMode('xray');
    loadStoredAnnotations();
    void initializeSensors().catch(error=>{console.error('测点定位初始化失败',error);sensorStreamState.textContent='测点定位不可用';});
    // Sensor targets enter the worker queue first. Prewarm visible source parts
    // and procedural internals without blocking the render loop.
    spatialIndex.warm(spatialMeshes.filter(mesh=>worldVisible(mesh)||!isWithinSelectedAssembly(mesh,modelRoot!)));
    setView('nacelle');
    // Always begin with the assembled turbine, including older bookmarked detail URLs.
    setPresentationMode('overview');updateSelectedUI();
    // Freeze the fixed assembly world matrices once. Source motion bindings and
    // procedural rotors update their own subtrees; camera updates remain automatic.
    scene.updateMatrixWorld(true);
    scene.matrixWorldAutoUpdate = false;
    if(drivetrain)motionRenderer=new MotionRenderer(scene,MOVING_LAYER,drivetrain.rotors.map(r=>r.pivot));
    fixedRenderer=new MotionRenderer(scene,STATIC_LAYER,drivetrain?.demonstrations.map(d=>d.root)??[],[SHELL_LAYER],false);
    generatorGlassRenderer=new MotionRenderer(scene,GENERATOR_GLASS_LAYER,[],[],false);
    contextMaterialLod=new ContextMaterialLod(modelRoot,[focusContextMaterial,connectedContextMaterial]);
    controls.enabled = true;
    interactionLod = new InteractionLod(modelRoot, mesh => gltf.parser.associations.get(mesh) as { meshes?: number; primitives?: number } | undefined);
    void interactionLod.load(loader, invalidateStaticFrame);
    // Start the assembled turbine turning; reveal the internals only when the
    // user enters a drivetrain view or explicitly enables the internal display.
    setMotionRunning(motionReady);
    setRenderScale(restingRenderScale());
    status.textContent = motionReady?'加载完成':'传动初始化失败，请刷新重试';
    progressText.textContent = '100%';
    progressBar.style.width = '100%';
    if(motionReady)setTimeout(() => statusStrip.classList.add('loaded'), 900);
    (window as Window & { __ready?: boolean; __assembly?: object }).__ready = true;
    (window as Window & { __assembly?: object }).__assembly = {
      parts,
      modelRoot,
      modelBounds,
      drivetrain,
      setMotionRunning,
      requestRender: invalidateStaticFrame,
      setMotionOptimizationEnabled: (enabled:boolean)=>{motionOptimizationEnabled=enabled;invalidateStaticFrame();},
      renderReferenceFrame: () => { renderer.render(scene, camera); renderRequested = false; },
      inspectBounds: (bounds: THREE.Box3, direction: THREE.Vector3) => fitBounds(bounds, direction, 1.1),
      exactOverlapDiagnostics,
      annotations,
      sensors,
      setAnnotationMode,
      selectAnnotation,
      selectSensor,
      createWebSocketSensorAdapter,
      setView,
      applyDisplayMode,
      majorPartGroups,
      pickPartAtPoint:(x:number,y:number)=>pickPartAtPoint(x,y)?.label??null,
      inspectSpatialHit:(x:number,y:number,annotation=false)=>{const hit=spatialIntersectionAtPoint(x,y,annotation);return hit?{mesh:hit.object,instanceId:hit.instanceId,point:hit.point,binding:anchorRegistry?.bind(hit.object as THREE.Mesh,hit.instanceId)}:null;},
      captureAnnotationViewpoint,
      getRelationshipState:()=>({selected:selectedPart?.label??null,mode:presentationMode,
        upstream:selectedRelationships?[...selectedRelationships.upstream.keys()]:[],downstream:selectedRelationships?[...selectedRelationships.downstream.keys()]:[],related:selectedRelationships?.related??[]}),
      getRenderDiagnostics: () => ({
        renderedFrames: renderer.info.render.frame,
        renderRequested,
        cameraMotionActive,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        threeRevision: THREE.REVISION,
        renderer: "WebGLRenderer",
        staticFrameBuilds,
        motionRenderer: motionRenderer?.diagnostics(),
        fixedRenderer:fixedRenderer?.diagnostics(),
        generatorGlassRenderer:generatorGlassRenderer?.diagnostics(),
        contextMaterialLod: contextMaterialLod?.active,
        renderQuality: renderQuality.diagnostics(),
        navigationRendering,
        interactionLod: interactionLod?.diagnostics(),
        spatialIndex:spatialIndex.diagnostics(),
        cameraWorld: camera.matrixWorld.toArray(),
        cameraProjection: camera.projectionMatrix.toArray(),
        orbitTarget:controls.target.toArray(),
        homeView:{active:homeFramingActive,bounds:homeViewBounds?{min:homeViewBounds.min.toArray(),max:homeViewBounds.max.toArray()}:null,frame:presentationFrame()},
        viewport: [canvas.width, canvas.height],
      }),
    };
  },
  (event) => {
    const progress = event.total ? Math.round((event.loaded / event.total) * 100) : 0;
    status.textContent = '加载模型…';
    progressText.textContent = event.total ? `${progress}%` : `${(event.loaded / 1024 / 1024).toFixed(0)} 兆字节`;
    progressBar.style.width = `${Math.min(progress || 12, 96)}%`;
  },
  (error) => {
    console.error(error);
    status.textContent = '加载失败，请刷新重试';
    progressText.textContent = '失败';
    statusStrip.querySelector('.status-dot')?.classList.add('error');
  },
);

renderer.setAnimationLoop(() => {
  resizeRenderer();
  const now = performance.now();
  const delta = Math.max((now - previousFrameTime) / 1000, 0);
  previousFrameTime = now;
  const motionActive = rotorSpinning && !!drivetrain && drivetrain.rpm > 0 && !document.hidden;
  if (motionActive && drivetrain) {
    drivetrain.advance(delta);
  }
  if (controls.enableDamping || controls.autoRotate) controls.update();
  if (!motionActive && !renderRequested) return;
  if(motionOptimizationEnabled&&renderQuality.observe(delta*1000,navigationRendering,motionActive,now)){
    setRenderScale(navigationRendering?renderQuality.navigationScale:restingRenderScale());
  }
  updateAnnotationOverlay();
  updateSensorOverlay();
  selectionBox.visible && selectedPart && selectionBox.setFromObject(selectedPart.node);
  // Cache fixed CAD with its depth; live bodies use that same restored depth.
  if (navigationRendering&&motionOptimizationEnabled&&displayMode==='xray') renderNavigationFrame();
  else if (displayMode === 'xray' && !isIsolated) renderMotionFrame();
  else renderer.render(scene, camera);
  renderRequested = motionActive;

  frameSamples += 1;
  frameTime += delta;
  if (frameTime >= .75) {
    byId('metric-fps').textContent = String(Math.round(frameSamples / frameTime));
    frameSamples = 0;
    frameTime = 0;
  }
});

// Resume from the current pose; never integrate time spent in a hidden tab.
document.addEventListener('visibilitychange', () => { previousFrameTime = performance.now(); });

window.addEventListener('beforeunload', () => {
  renderer.setAnimationLoop(null);
  if (detailRestoreTimer) clearTimeout(detailRestoreTimer);
  viewportObserver.disconnect();
  interactionLod?.dispose();
  contextMaterialLod?.dispose();
  stopSensorStream?.();
  controls.dispose();
  draco.dispose();
  modelRoot?.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => material.dispose());
  });
  xrayShellMaterial.dispose();
  xrayStaticMaterial.dispose();
  xrayEquipmentMaterial.dispose();
  xrayVendorEnclosureMaterial.dispose();
  xrayRotorMaterial.dispose();
  xrayDrivetrainMaterial.dispose();
  focusContextMaterial.dispose();
  connectedContextMaterial.dispose();
  uniformBladeMaterial.dispose();
  hubShellMaterial.dispose();
  environmentRenderTarget.dispose();
  generatorMaterials.dispose();
  motionRenderer?.dispose();
  fixedRenderer?.dispose();
  generatorGlassRenderer?.dispose();
  generatedXrayMaterials.forEach((material) => material.dispose());
  generatedXrayMaterials.clear();
  drivetrain?.dispose();
  staticFrameTarget?.dispose();
  compositeFrameTarget?.dispose();displayFrameMaterial.dispose();
  staticFrameQuad.geometry.dispose();
  staticFrameMaterial.dispose();
  renderer.dispose();
});
