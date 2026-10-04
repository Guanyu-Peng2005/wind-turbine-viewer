import * as THREE from 'three';
import { PALETTE } from './industrial-palette';
import { carrierWeb, socketCap } from './mechanical-details';
import { buildGeneratorAssembly, type GeneratorModel } from './generator-assembly';

// Authored demonstration gearing, NOT recovered manufacturer specifications.
// Fixed ring: (sun - carrier) * Ns + (ring - carrier) * Nr = 0.
export const GEARING = Object.freeze({ sun: 24, planet: 36, ring: 96, wheel: 96, pinion: 16 });
export const STAGE_RATIO = 1 + GEARING.ring / GEARING.sun;
export const OUTPUT_RATIO = -(STAGE_RATIO ** 2) * GEARING.wheel / GEARING.pinion;
// Fastest mesh phase per input revolution, used for diagnostics.
export const MAX_MESH_TEETH_PER_INPUT_TURN = STAGE_RATIO ** 2 * GEARING.wheel;

type Binding = {
  node: THREE.Object3D;
  restMatrix:THREE.Matrix4;
  world: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
};
export type MotionLink = {
  name: string;
  nodes: THREE.Object3D[];
  bindings: Binding[];
  origin: THREE.Vector3;
  axis: THREE.Vector3;
  speedFactor: number;
  visualKind: 'rotor' | 'drivetrain';
};
type Rotor = { name: string; pivot: THREE.Group; base: THREE.Quaternion; speedFactor: number };
type Demonstration = { root: THREE.Group; owner: THREE.Object3D };
const X = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

function roots(root: THREE.Object3D, pattern: RegExp): THREE.Object3D[] {
  const matches: THREE.Object3D[] = [];
  root.traverse(n => { if (pattern.test(n.name.split('#').at(-1) ?? n.name)) matches.push(n); });
  return matches.filter(n => { for (let p = n.parent; p; p = p.parent) if (matches.includes(p)) return false; return true; });
}

function cylinder(radius: number, length: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, Math.max(length, 0.001), 32), material);
  m.rotation.z = Math.PI / 2;
  return m;
}

// Involute flanks, 20 degree pressure angle; root fillets are simplified for display.
function axialExtrusion(shape: THREE.Shape, width: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false, curveSegments: 64 });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function smoothCircularWall(geometry: THREE.BufferGeometry, radius: number): void {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i), z = position.getZ(i), r = Math.hypot(y, z);
    if (Math.abs(r - radius) > 0.00001 || Math.abs(normal.getX(i)) > 0.5) continue;
    const sign = normal.getY(i) * y + normal.getZ(i) * z < 0 ? -1 : 1;
    normal.setXYZ(i, 0, sign * y / r, sign * z / r);
  }
  normal.needsUpdate = true;
}

function annularHub(outer: number, bore: number, width: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(); shape.absarc(0, 0, outer, 0, TAU, false);
  const hole = new THREE.Path(); hole.absarc(0, 0, bore, 0, TAU, true); shape.holes.push(hole);
  const geometry = axialExtrusion(shape, width);
  smoothCircularWall(geometry, outer); smoothCircularWall(geometry, bore);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = '带通孔的轮毂'; mesh.userData.boreRadius = bore;
  return mesh;
}

function gear(pitch: number, teeth: number, width: number, material: THREE.Material, boreRadius: number): THREE.Group {
  const module = 2 * pitch / teeth;
  const rootRadius = pitch - 1.25 * module;
  const tip = pitch + module;
  const base = pitch * Math.cos(THREE.MathUtils.degToRad(20));
  const inv = (r: number) => { const a = Math.acos(Math.min(1, base / r)); return Math.tan(a) - a; };
  const half = (r: number) => Math.PI / (2 * teeth) + inv(pitch) - inv(Math.max(base, r)) - module * 0.02 / pitch;
  const shape = new THREE.Shape();
  let first = true;
  const point = (r: number, a: number) => {
    if (first) { shape.moveTo(r * Math.cos(a), r * Math.sin(a)); first = false; }
    else shape.lineTo(r * Math.cos(a), r * Math.sin(a));
  };
  for (let i = 0; i < teeth; i++) {
    const a = i * TAU / teeth;
    point(rootRadius, a - Math.PI / teeth);
    point(rootRadius, a - half(base));
    for (let j = 0; j <= 5; j++) { const r = THREE.MathUtils.lerp(Math.max(base, rootRadius), tip, j / 5); point(r, a - half(r)); }
    for (let j = 5; j >= 0; j--) { const r = THREE.MathUtils.lerp(Math.max(base, rootRadius), tip, j / 5); point(r, a + half(r)); }
    point(rootRadius, a + half(base));
    point(rootRadius, a + Math.PI / teeth);
  }
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, boreRadius, 0, TAU, true);
  shape.holes.push(hole);
  if (teeth >= 60) {
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6;
      const window = new THREE.Path(); window.absarc(pitch * 0.60 * Math.cos(a), pitch * 0.60 * Math.sin(a), pitch * 0.11, 0, TAU, true);
      shape.holes.push(window);
    }
  }
  const geometry = axialExtrusion(shape, width);
  const group = new THREE.Group();
  group.name = '有孔齿轮';
  group.userData.gear = { pitch, teeth, width, boreRadius, internal: false };
  const face = new THREE.Mesh(geometry, material); face.name = '齿轮齿面';
  const hubRadius = Math.min(rootRadius * 0.95, Math.max(pitch * 0.32, boreRadius + 0.012));
  group.add(face, annularHub(hubRadius, boreRadius, width * 1.16, material));
  // Machined shoulder on each face makes the hub/contact readable at close range.
  for (const sign of [-1, 1]) {
    const shoulder = annularHub(hubRadius * 1.08, hubRadius * 0.94, 0.004, material);
    shoulder.position.x = sign * (width * 0.5 + 0.002); shoulder.name = '齿轮端面加工台阶'; group.add(shoulder);
  }
  return group;
}

function ringGear(pitch: number, teeth: number, width: number, material: THREE.Material): THREE.Mesh {
  const module = 2 * pitch / teeth;
  const shape = new THREE.Shape();
  shape.absarc(0, 0, pitch + module * 3, 0, TAU, false);
  const hole = new THREE.Path();
  const base = pitch * Math.cos(THREE.MathUtils.degToRad(20));
  const root = pitch + 1.25 * module, tip = pitch - module;
  const inv = (r: number) => { const a = Math.acos(base / r); return Math.tan(a) - a; };
  const half = (r: number) => Math.PI / (2 * teeth) - inv(pitch) + inv(r) - module * 0.02 / pitch;
  const points: THREE.Vector2[] = [];
  const point = (r: number, a: number) => points.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
  // The internal flanks use the same module and pressure angle as the planets.
  for (let i = 0; i < teeth; i++) {
    const a = i * TAU / teeth;
    point(root, a - Math.PI / teeth);
    for (let j = 0; j <= 6; j++) { const r = THREE.MathUtils.lerp(root, tip, j / 6); point(r, a - half(r)); }
    for (let j = 6; j >= 0; j--) { const r = THREE.MathUtils.lerp(root, tip, j / 6); point(r, a + half(r)); }
    point(root, a + Math.PI / teeth);
  }
  points.reverse().forEach((p, i) => i === 0 ? hole.moveTo(p.x, p.y) : hole.lineTo(p.x, p.y));
  hole.closePath(); shape.holes.push(hole);
  const geometry = axialExtrusion(shape, width);
  smoothCircularWall(geometry, pitch + module * 3);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.gear = { pitch, teeth, width, internal: true };
  return mesh;
}

function boundsInFrame(node: THREE.Object3D, frame: THREE.Object3D): THREE.Box3 {
  const inverse = frame.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  node.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    if (mesh.geometry.boundingBox) box.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  return box;
}

export class Drivetrain {
  readonly links: MotionLink[] = [];
  readonly rotors: Rotor[] = [];
  readonly demonstrations: Demonstration[] = [];
  readonly anchors: Record<string, number[]> = {};
  readonly gearing = GEARING;
  readonly connectionChecks: { name: string; errorMeters: number }[] = [];
  readonly clearanceChecks: { name: string; clearanceMeters: number; requiredMeters: number }[] = [];
  generatorModel: GeneratorModel | null = null;
  inputAngle = 0;
  rpm = 10;
  readonly playbackRate = 0.25;
  effectivePlaybackRate = 0;
  lastPitchAdvance = 0;
  showInternals = false;
  generatorPresentation: 'cad' | 'section' = 'section';
  readonly bounds = new THREE.Box3();
  private rotation = new THREE.Matrix4();
  private transform = new THREE.Matrix4();
  private local = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private readonly x = new THREE.Vector3(1, 0, 0);

  constructor(modelRoot: THREE.Object3D, private scene: THREE.Scene, private layer: number, private transparentLayer:number=3) {
    modelRoot.updateMatrixWorld(true);
    const rotor = roots(modelRoot, /风轮外形(?:-\d+)?$/)[0];
    const shaft = roots(modelRoot, /^主轴-\d+$/)[0];
    const ring = roots(modelRoot, /^前挡圈-\d+$/)[0];
    const coupling = roots(modelRoot, /^高速轴联轴器(?:-\d+)?$/)[0];
    const gearbox = roots(modelRoot, /^齿轮箱(?:-\d+)?$/)[0];
    const generator = roots(modelRoot, /^发电机(?:-\d+)?$/)[0];
    if (!rotor || !shaft || !ring || !coupling || !gearbox || !generator) throw new Error('缺少传动轴定位零件，无法建立联动');

    // Retaining-ring centre lies on the source shaft axis. The asymmetric hub's
    // bounding-box centre does not. All low-speed bodies use this one axis line.
    const lowOrigin = ring.getWorldPosition(new THREE.Vector3());
    const axis = X.clone().transformDirection(shaft.matrixWorld);
    const highOrigin = coupling.getWorldPosition(new THREE.Vector3());
    const highAxis = X.clone().transformDirection(coupling.matrixWorld);
    if (highAxis.dot(axis) < 0) highAxis.negate();
    if (axis.dot(highAxis) < 0.9999) throw new Error('源模型轴线不平行，不能使用当前平行级传动示意');
    this.anchors.lowOrigin = lowOrigin.toArray(); this.anchors.lowAxis = axis.toArray();
    this.anchors.highOrigin = highOrigin.toArray(); this.anchors.highAxis = highAxis.toArray();
    this.bind([rotor], '叶轮与轮毂', lowOrigin, axis, 1, 'rotor');
    this.bind([shaft, ...roots(modelRoot, /^(前挡圈|后挡圈|锁紧衬套|低速轴测速盘)-\d+$/)], '主轴与轴上附件', lowOrigin, axis, 1, 'drivetrain');
    this.bind([coupling], '高速联轴器', highOrigin, highAxis, OUTPUT_RATIO, 'drivetrain');
    this.bounds.union(new THREE.Box3().setFromObject(shaft));
    this.bounds.union(new THREE.Box3().setFromObject(gearbox));
    this.bounds.union(new THREE.Box3().setFromObject(generator));
    this.buildInternals(gearbox, generator, lowOrigin, axis, highOrigin, highAxis);
    // Internal local transforms are authored once. Only motion pivots need
    // recomposition; fixed brush gear, covers and stator packets stay untouched.
    this.demonstrations.forEach(d=>{d.root.updateMatrixWorld(true);d.root.traverse(n=>{n.matrixAutoUpdate=false;});});
    this.links.forEach(link=>link.nodes.forEach(node=>{
      node.updateMatrixWorld(true);
      node.traverse(child=>{child.matrixAutoUpdate=false;});
    }));
  }

  private bind(nodes: THREE.Object3D[], name: string, origin: THREE.Vector3, axis: THREE.Vector3, speedFactor: number, visualKind: MotionLink['visualKind']) {
    this.links.push({ name, nodes, origin: origin.clone(), axis: axis.clone(), speedFactor, visualKind,
      bindings: nodes.map(node => ({ node, restMatrix:node.matrix.clone(), world: node.matrixWorld.clone(), position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() })) });
  }

  private rotating(parent: THREE.Object3D, name: string, factor: number, position = new THREE.Vector3(), phase = 0): THREE.Group {
    const pivot = new THREE.Group(); pivot.name = name; pivot.position.copy(position); pivot.rotation.x = phase;
    pivot.userData.drivetrainMovingRoot = true; parent.add(pivot);
    this.rotors.push({ name, pivot, base: pivot.quaternion.clone(), speedFactor: factor });
    return pivot;
  }

  private buildInternals(gearbox: THREE.Object3D, generator: THREE.Object3D, origin: THREE.Vector3, axis: THREE.Vector3, highOrigin: THREE.Vector3, highAxis: THREE.Vector3) {
    const materials = {
      input: new THREE.MeshStandardMaterial({ color: PALETTE.steel, metalness: 0.88, roughness: 0.25 }),
      planet: new THREE.MeshStandardMaterial({ color: PALETTE.secondarySteel, metalness: 0.90, roughness: 0.28 }),
      sun: new THREE.MeshStandardMaterial({ color: PALETTE.sunGear, metalness: 0.88, roughness: 0.29 }),
      fixed: new THREE.MeshStandardMaterial({ color: PALETTE.graphite, metalness: 0.1, roughness: 0.32 }),
      carrier: new THREE.MeshStandardMaterial({ color: PALETTE.carrier, metalness: 0.09, roughness: 0.31 }),
      pin: new THREE.MeshStandardMaterial({ color: PALETTE.brass, metalness: 0.78, roughness: 0.36 }),
    };
    const frame = new THREE.Group(); frame.name = '齿轮箱内部 · 参数化传动示意';
    frame.position.copy(origin); frame.quaternion.setFromUnitVectors(X, axis); this.scene.add(frame); frame.updateMatrixWorld(true);
    const box = boundsInFrame(gearbox, frame);
    const output = frame.worldToLocal(highOrigin.clone());
    // Reserve the actual source shaft/coupling envelopes before laying out gears.
    // Neither the source shaft nor its mechanical attachment is shortened/moved.
    const shaftBounds = boundsInFrame(this.links[1].nodes[0], frame);
    const couplingBounds = boundsInFrame(this.links[2].nodes[0], frame);
    const width = 0.25;
    const carrierOffset = width * 0.75;
    const sourceClearance = 0.10;
    const stage1x = Math.max(box.min.x + 0.35, shaftBounds.max.x + sourceClearance + carrierOffset + width * 0.11);
    const parallelx = Math.min(box.max.x - 0.25, couplingBounds.min.x - width * 0.58 - 0.18);
    const stage2x = THREE.MathUtils.lerp(stage1x, parallelx, 0.5);
    if (stage2x - stage1x < 0.55) throw new Error('源主轴与联轴器之间没有足够的无干涉展示空间');
    const pitchRing = Math.min(0.72, Math.min(box.max.y, -box.min.y, box.max.z, -box.min.z) * 0.7);
    const pitchSun = pitchRing * GEARING.sun / GEARING.ring;
    const pitchPlanet = pitchRing * GEARING.planet / GEARING.ring;
    const orbit = pitchSun + pitchPlanet;
    const stage = (x: number, factor: number, label: string) => {
      const root = new THREE.Group(); root.position.x = x; root.name = label; frame.add(root);
      const ring = ringGear(pitchRing, GEARING.ring, width, materials.fixed); ring.name = `${label}固定内齿圈`; root.add(ring);
      for (const sign of [-1, 1]) {
        const flange = annularHub(pitchRing + 0.06, pitchRing + 0.021, 0.018, materials.fixed);
        flange.position.x = sign * (width * 0.5 + 0.010); flange.name = `${label}齿圈安装法兰`; root.add(flange);
        for (let i = 0; i < 12; i++) {
          const a = i * TAU / 12, bolt = socketCap(0.011, 0.012, materials.input);
          bolt.position.set(sign * (width * 0.5 + 0.025), (pitchRing + 0.040) * Math.cos(a), (pitchRing + 0.040) * Math.sin(a));
          bolt.name = `${label}齿圈法兰螺栓${sign}-${i + 1}`; root.add(bolt);
        }
      }
      const sun = this.rotating(root, `${label}太阳轮`, factor * STAGE_RATIO);
      sun.add(gear(pitchSun, GEARING.sun, width, materials.sun, 0.065));
      const carrier = this.rotating(root, `${label}行星架`, factor);
      const carrierBoss = cylinder(0.10, 0.05, materials.carrier);
      carrierBoss.position.x = -carrierOffset; carrierBoss.name = '行星架输入座'; carrier.add(carrierBoss);
      carrier.add(carrierWeb(orbit, carrierOffset, materials.carrier));
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        const boss = annularHub(0.065, 0.026, 0.060, materials.carrier);
        boss.position.set(-carrierOffset, orbit * Math.cos(a), orbit * Math.sin(a)); boss.name = `${label}轴销座${i + 1}`; carrier.add(boss);
        // Relative rotation: parent carrier contributes +factor in world space.
        const planet = this.rotating(carrier, `${label}行星轮${i + 1}`, -factor * GEARING.ring / GEARING.planet,
          new THREE.Vector3(0, orbit * Math.cos(a), orbit * Math.sin(a)), Math.PI / GEARING.planet);
        planet.add(gear(pitchPlanet, GEARING.planet, width, materials.planet, 0.030));
        const pin = cylinder(0.026, width * 1.6, materials.pin); pin.position.copy(planet.position);
        pin.name = `${label}行星轮轴销${i + 1}`; pin.userData.pinRadius = 0.026; carrier.add(pin);
        const washer = annularHub(0.047, 0.027, 0.012, materials.input);
        washer.position.set(width * 0.5 + 0.03, planet.position.y, planet.position.z); washer.name = `${label}轴销止推垫圈${i + 1}`; carrier.add(washer);
        const cap = socketCap(0.033, 0.022, materials.pin);
        cap.position.set(width * 0.8 + 0.008, planet.position.y, planet.position.z); cap.name = `${label}轴销内六角锁帽${i + 1}`; carrier.add(cap);
        const spacer = annularHub(0.033, 0.027, 0.036, materials.input);
        spacer.position.set(width * 0.5 + 0.054, planet.position.y, planet.position.z); spacer.name = `${label}轴销隔套${i + 1}`; carrier.add(spacer);
      }
      return { sun, carrier };
    };
    const stage1 = stage(stage1x, 1, '一级');
    const stage2 = stage(stage2x, STAGE_RATIO, '二级');
    const shaftBetween = (parent: THREE.Group, a: number, b: number, r: number, name = '连接轴') => {
      const mesh = cylinder(r, Math.abs(b - a), materials.input); mesh.position.x = (a + b) / 2; mesh.name = name; parent.add(mesh);
    };
    // The low-speed input ends at the carrier BEHIND the gear face, not inside
    // the faster sun gear. Likewise stage one's output terminates at carrier two.
    const transitionStart = shaftBounds.max.x - 0.025;
    const transitionEnd = stage1x - carrierOffset;
    const adapter = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.10, transitionEnd - transitionStart, 64), materials.input);
    adapter.rotation.z = Math.PI / 2;
    adapter.position.x = (transitionStart + transitionEnd) / 2 - stage1x;
    adapter.name = '主轴至一级行星架过渡接头'; stage1.carrier.add(adapter);
    shaftBetween(stage1.sun, 0, stage2x - stage1x - carrierOffset, 0.065, '一级太阳轮至二级行星架连接轴');
    shaftBetween(stage2.sun, 0, parallelx - stage2x, 0.065, '二级太阳轮至平行级连接轴');
    const distance = Math.hypot(output.y, output.z);
    if (distance < 0.05) throw new Error('高速轴偏置不足，无法建立平行级');
    const wheelRadius = distance * GEARING.wheel / (GEARING.wheel + GEARING.pinion);
    const pinionRadius = distance - wheelRadius;
    const phase = Math.atan2(output.z, output.y);
    const wheel = this.rotating(frame, '平行级大齿轮', STAGE_RATIO ** 2, new THREE.Vector3(parallelx, 0, 0), phase);
    wheel.add(gear(wheelRadius, GEARING.wheel, width, materials.input, 0.065));
    const pinion = this.rotating(frame, '平行级输出齿轮与制动盘', OUTPUT_RATIO, new THREE.Vector3(parallelx, output.y, output.z), phase + Math.PI + Math.PI / GEARING.pinion);
    pinion.add(gear(pinionRadius, GEARING.pinion, width, materials.planet, 0.055));
    shaftBetween(pinion, 0, output.x - parallelx, 0.055);
    // The disc belongs to the brake assembly, not the gearbox relationship
    // group. Keep its material independent so role tinting cannot leak across.
    const disc = cylinder(0.23, 0.035, materials.input.clone());
    disc.position.x = (width * 0.58 + couplingBounds.min.x - parallelx) * 0.5;
    disc.name = '高速制动盘示意'; pinion.add(disc);
    this.clearanceChecks.push(
      { name: '源主轴端面至一级齿轮前端', clearanceMeters: stage1x - width * 0.58 - shaftBounds.max.x, requiredMeters: 0.05 },
      { name: '行星架轴销座至齿轮轮毂', clearanceMeters: carrierOffset - 0.030 - width * 0.58, requiredMeters: 0.01 },
      { name: '级间输入轴至下一级太阳轮', clearanceMeters: carrierOffset - width * 0.58, requiredMeters: 0.02 },
      { name: '行星轮通孔与轴销径向间隙', clearanceMeters: 0.030 - 0.026, requiredMeters: 0.003 },
      { name: '输出齿轮至源联轴器端面', clearanceMeters: couplingBounds.min.x - parallelx - width * 0.58, requiredMeters: 0.10 },
      { name: '制动盘至源联轴器端面', clearanceMeters: couplingBounds.min.x - parallelx - disc.position.x - 0.0175, requiredMeters: 0.04 },
    );
    this.connectionChecks.push({ name: '平行级节圆相切', errorMeters: Math.abs(wheelRadius + pinionRadius - distance) });
    const outputEnd = frame.localToWorld(new THREE.Vector3(output.x, output.y, output.z));
    this.connectionChecks.push({ name: '高速输出轴连接源联轴器轴心', errorMeters: outputEnd.distanceTo(highOrigin) });
    this.addDemonstration(frame, gearbox);

    const generatorFrame = new THREE.Group(); generatorFrame.name = '发电机内部 · 转子与定子示意';
    generatorFrame.position.copy(highOrigin); generatorFrame.quaternion.setFromUnitVectors(X, highAxis);
    this.scene.add(generatorFrame); generatorFrame.updateMatrixWorld(true);
    const generatorBox = boundsInFrame(generator, generatorFrame);
    const generatorCouplingBounds = boundsInFrame(this.links[2].nodes[0], generatorFrame);
    const genStart = Math.max(0.25, generatorBox.min.x + 0.25, generatorCouplingBounds.max.x + 0.14), genEnd = generatorBox.max.x - 0.3;
    const genCenter = (genStart + genEnd) / 2;
    const rotor = this.rotating(generatorFrame, '发电机转子', OUTPUT_RATIO, new THREE.Vector3(genCenter, 0, 0));
    const radius = Math.max(0.25, Math.min(generatorBox.max.y, -generatorBox.min.y, generatorBox.max.z, -generatorBox.min.z) * 0.85);
    this.generatorModel = buildGeneratorAssembly(generatorFrame, rotor, genStart, genEnd, radius);
    this.generatorModel.auxiliaryRotors.forEach(({pivot,factor})=>this.rotors.push({name:pivot.name,pivot,base:pivot.quaternion.clone(),speedFactor:OUTPUT_RATIO*factor}));
    this.clearanceChecks.push({name:'源联轴器至发电机驱动端轴承座',clearanceMeters:Number(this.generatorModel.diagnostics.deBearingStation)-.095*(.082/.066)/2-generatorCouplingBounds.max.x,requiredMeters:.10});
    this.connectionChecks.push({ name: '发电机转子与联轴器共轴', errorMeters: generatorFrame.localToWorld(new THREE.Vector3()).distanceTo(highOrigin) });
    this.addDemonstration(generatorFrame, generator);
  }

  private addDemonstration(root: THREE.Group, owner: THREE.Object3D) {
    root.userData.motionCue = true;
    root.traverse(n => {
      let moving = false;
      for (let p: THREE.Object3D | null = n; p && p !== root.parent; p = p.parent) {
        if (p.userData.drivetrainMovingRoot) { moving = true; break; }
      }
      n.layers.set(moving ? this.layer : n.userData.generatorXray ? this.transparentLayer : 0);
    });
    this.demonstrations.push({ root, owner });
  }

  applyAngle(angle: number): void {
    this.inputAngle = angle;
    for (const link of this.links) {
      this.rotation.makeRotationAxis(link.axis, (angle * link.speedFactor) % TAU);
      this.transform.makeTranslation(link.origin.x, link.origin.y, link.origin.z).multiply(this.rotation);
      this.rotation.makeTranslation(-link.origin.x, -link.origin.y, -link.origin.z);
      this.transform.multiply(this.rotation);
      for (const b of link.bindings) {
        if (angle === 0) { b.node.position.copy(b.position); b.node.quaternion.copy(b.quaternion); b.node.scale.copy(b.scale); b.node.matrix.copy(b.restMatrix); }
        else {
          this.local.copy(b.node.parent!.matrixWorld).invert().multiply(this.transform).multiply(b.world);
          this.local.decompose(b.node.position, b.node.quaternion, b.node.scale);
          // The source hierarchy is frozen. Preserve its affine transform rather
          // than recomposing a slightly rounded quaternion/scale decomposition.
          b.node.matrix.copy(this.local);
        }
        b.node.matrixWorldNeedsUpdate=true;
        this.updateVisibleWorldMatrices(b.node);
      }
    }
    for (const r of this.rotors) {
      r.pivot.quaternion.copy(r.base).multiply(this.q.setFromAxisAngle(this.x, (angle * r.speedFactor) % TAU));
      r.pivot.updateMatrix();
    }
    this.generatorModel?.updateRollingElements(angle*OUTPUT_RATIO);
    this.demonstrations.forEach(d => {if(d.root.visible)this.updateVisibleWorldMatrices(d.root);});
  }

  private updateVisibleWorldMatrices(node:THREE.Object3D):void{
    // r185 requires force propagation when the local transform is frozen but
    // its parent moved. Only the visible branch is forced, never the hidden CAD.
    node.updateWorldMatrix(false,false,true);
    if(node.visible)for(const child of node.children)if(child.visible)this.updateVisibleWorldMatrices(child);
  }

  advance(delta: number) {
    if (!Number.isFinite(delta) || delta <= 0) return;
    const omega = this.rpm * TAU / 60;
    const step = delta * omega * this.playbackRate;
    this.effectivePlaybackRate = omega > 0 ? step / (delta * omega) : 0;
    this.lastPitchAdvance = step * MAX_MESH_TEETH_PER_INPUT_TURN / TAU;
    this.applyAngle(this.inputAngle + step);
  }
  reset() { this.applyAngle(0); }
  syncVisibility(mode: string, isolated: boolean, selected: THREE.Object3D | null) {
    this.demonstrations.forEach((d, index) => {
      let visible = true;
      for (let n: THREE.Object3D | null = d.owner; n; n = n.parent) visible &&= n.visible;
      let hasVisibleMesh = false;
      d.owner.traverseVisible(n => { if ((n as THREE.Mesh).isMesh) hasVisibleMesh = true; });
      visible &&= hasVisibleMesh;
      if (isolated) { visible = false; for (let n: THREE.Object3D | null = selected; n; n = n.parent) if (n === d.owner) visible = true; }
      d.root.visible = this.showInternals && mode === 'xray' && visible
        && (index !== 1 || this.generatorPresentation === 'section');
    });
    // Hidden internals reappear at the current phase, including while paused.
    this.applyAngle(this.inputAngle);
  }
  diagnostics() {
    return { inputAngle: this.inputAngle, rpm: this.rpm, playbackRate: this.playbackRate, effectivePlaybackRate: this.effectivePlaybackRate, lastPitchAdvance: this.lastPitchAdvance, outputRatio: OUTPUT_RATIO, anchors: this.anchors, clearances: this.clearanceChecks,
      gearing: this.gearing, connections: this.connectionChecks, links: this.links.map(l => ({ name: l.name, factor: l.speedFactor, angle: this.inputAngle * l.speedFactor, nodes: l.nodes.map(n => n.name) })),
      rotors: this.rotors.map(r => ({ name: r.name, factor: r.speedFactor, angle: this.inputAngle * r.speedFactor })),
      generator: this.generatorModel?.diagnostics,
      specification: '演示假设：两级固定内齿圈行星级 5×5，平行级 6，总增速 150；非厂家传动参数' };
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.demonstrations.forEach(d => { d.root.removeFromParent(); d.root.traverse(n => { const m = n as THREE.Mesh; if (!m.isMesh) return; geometries.add(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach(v => materials.add(v)); }); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
}
