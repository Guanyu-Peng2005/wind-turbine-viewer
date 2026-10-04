import * as THREE from 'three';
import { axialShape } from './generator-geometry';

const TAU = Math.PI * 2;

function race(profile: Array<[number, number]>, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.LatheGeometry(profile.map(([r, x]) => new THREE.Vector2(r, x)), 96);
  geometry.rotateZ(Math.PI / 2);
  return new THREE.Mesh(geometry, material);
}

function ring(inner: number, outer: number, width: number, material: THREE.Material) {
  const bevel = Math.min(0.001, width * 0.15);
  return race([[inner,-width/2+bevel],[inner+bevel,-width/2],[outer-bevel,-width/2],[outer,-width/2+bevel],
    [outer,width/2-bevel],[outer-bevel,width/2],[inner+bevel,width/2],[inner,width/2-bevel],[inner,-width/2+bevel]],material);
}

export type BearingAssembly = {
  cage: THREE.Group;
  innerRace: THREE.Mesh;
  outerRace: THREE.Mesh;
  journal: THREE.Mesh;
  balls: THREE.InstancedMesh;
  cageFactor: number;
  ballRelativeFactor: number;
  pitchRadius: number;
  ballRadius: number;
  journalRadius: number;
  update: (generatorAngle: number) => void;
};

/** Authored radial rolling-bearing section, ideal no-slip rolling with a fixed
 * outer ring. This is explanatory geometry/kinematics, not a catalog bearing. */
export function addGeneratorBearing(
  fixed: THREE.Group, rotor: THREE.Group, fixedX: number, rotorX: number,
  name: string, steel: THREE.Material, cageMaterial: THREE.Material,
): BearingAssembly {
  const pitch = 0.108, ballRadius = 0.019, grooveRadius = ballRadius + 0.0003;
  const groove = (x: number) => Math.sqrt(grooveRadius ** 2 - x ** 2);
  const innerProfile: Array<[number,number]> = [[.066,-.032],[.0675,-.035],[.094,-.035],[.095,-.032],[.095,-.015]];
  for(let i=0;i<=48;i++){const x=-.014+.028*i/48;innerProfile.push([pitch-groove(x)+(grooveRadius-ballRadius),x]);}
  innerProfile.push([.095,.015],[.095,.032],[.094,.035],[.0675,.035],[.066,.032],[.066,-.032]);
  const innerRace = race(innerProfile,steel);innerRace.position.x=rotorX;innerRace.name=`${name}轴承内圈 · 随轴旋转`;rotor.add(innerRace);

  const outerProfile: Array<[number,number]> = [[.121,-.032],[.122,-.035],[.142,-.035],[.143,-.032],[.143,.032],[.142,.035],[.122,.035],[.121,.032],[.121,.015]];
  for(let i=48;i>=0;i--){const x=-.014+.028*i/48;outerProfile.push([pitch+groove(x)-(grooveRadius-ballRadius),x]);}
  outerProfile.push([.121,-.015],[.121,-.032]);
  const outerRace = race(outerProfile,steel);outerRace.position.x=fixedX;outerRace.name=`${name}轴承外圈 · 固定`;fixed.add(outerRace);
  const housing=ring(.143,.172,.095,steel);housing.position.x=fixedX;housing.name='静止轴承座';fixed.add(housing);
  const journal=ring(.06,.066,.070,steel);journal.position.x=rotorX;journal.name=`${name}轴颈配合段`;rotor.add(journal);
  const sign=Math.sign(rotorX)||1;
  const shoulder=ring(.060,.083,.024,steel);shoulder.position.x=rotorX-sign*(.035+.012);shoulder.name=`${name}轴肩定位环`;rotor.add(shoulder);

  const cage=new THREE.Group();cage.position.x=fixedX;cage.name=`${name}轴承保持架`;cage.userData.drivetrainMovingRoot=true;fixed.add(cage);
  const cageShape=new THREE.Shape();cageShape.absarc(0,0,.119,0,TAU,false);
  const cageBore=new THREE.Path();cageBore.absarc(0,0,.097,0,TAU,true);cageShape.holes.push(cageBore);
  for(let i=0;i<12;i++){const a=TAU*i/12,hole=new THREE.Path();hole.absarc(pitch*Math.cos(a),pitch*Math.sin(a),.0086,0,TAU,true);cageShape.holes.push(hole);}
  const cageSideGeometry=axialShape(cageShape,.003,.00015);
  for(const side of [-1,1]){const hoop=new THREE.Mesh(cageSideGeometry,cageMaterial);hoop.position.x=side*.023;hoop.name='保持架侧环 · 滚珠观察孔';cage.add(hoop);}
  const postGeometry=new THREE.CylinderGeometry(.00875,.00875,.046,16);postGeometry.rotateZ(Math.PI/2);
  const posts=new THREE.InstancedMesh(postGeometry,cageMaterial,12),dummy=new THREE.Object3D();
  for(let i=0;i<12;i++){const a=TAU*(i+.5)/12;dummy.position.set(0,pitch*Math.cos(a),pitch*Math.sin(a));dummy.updateMatrix();posts.setMatrixAt(i,dummy.matrix);}
  posts.name='保持架隔柱';posts.instanceMatrix.needsUpdate=true;cage.add(posts);
  const rivetGeometry=new THREE.SphereGeometry(.005,16,8);rivetGeometry.scale(.42,1,1);
  const rivets=new THREE.InstancedMesh(rivetGeometry,cageMaterial,24);
  for(let i=0;i<12;i++)for(let side=0;side<2;side++){
    const a=TAU*(i+.5)/12;dummy.position.set((side===0?-1:1)*.025,pitch*Math.cos(a),pitch*Math.sin(a));dummy.updateMatrix();rivets.setMatrixAt(i*2+side,dummy.matrix);
  }
  rivets.name='保持架铆钉圆头';rivets.instanceMatrix.needsUpdate=true;cage.add(rivets);
  const balls=new THREE.InstancedMesh(new THREE.SphereGeometry(ballRadius,32,16),steel,12);balls.name='轴承滚动体';cage.add(balls);
  const cageFactor=.5*(1-ballRadius/pitch);
  const ballRelativeFactor=-(pitch+ballRadius)/ballRadius*cageFactor;
  const rotation=new THREE.Quaternion(),matrix=new THREE.Matrix4(),position=new THREE.Vector3(),scale=new THREE.Vector3(1,1,1),axis=new THREE.Vector3(1,0,0);
  const update=(generatorAngle:number)=>{
    rotation.setFromAxisAngle(axis,generatorAngle*ballRelativeFactor);
    for(let i=0;i<12;i++){const a=TAU*i/12;position.set(0,pitch*Math.cos(a),pitch*Math.sin(a));matrix.compose(position,rotation,scale);balls.setMatrixAt(i,matrix);}
    balls.instanceMatrix.needsUpdate=true;
  };
  update(0);
  return {cage,innerRace,outerRace,journal,balls,cageFactor,ballRelativeFactor,pitchRadius:pitch,ballRadius,journalRadius:.066,update};
}
