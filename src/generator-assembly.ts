import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from './industrial-palette';
import { addGeneratorBearing, type BearingAssembly } from './generator-bearing';
import { TAU, axialShape, ring, sector, slottedCore, FormedCoil, windings, laminated } from './generator-geometry';
import { blindSocket, lockingNut, threadedEnd, brushHolder, terminalBlock, braidedLead, machinedShaft } from './generator-small-parts';

export type GeneratorModel = {
  root: THREE.Group;
  statorCore: THREE.Mesh;
  rotorCore: THREE.Mesh;
  statorCoils: THREE.Group;
  rotorCoils: THREE.Group;
  endCovers: THREE.Group;
  slipRings: THREE.Group;
  brushRig: THREE.Group;
  bearings: BearingAssembly[];
  auxiliaryRotors: Array<{pivot:THREE.Group;factor:number}>;
  xraySurfaces:THREE.Mesh[];
  updateRollingElements:(angle:number)=>void;
  diagnostics: Record<string, number | string>;
};

function packetStack(geometry:THREE.BufferGeometry,material:THREE.Material,count:number,length:number,gap:number):THREE.InstancedMesh{
  const stack=new THREE.InstancedMesh(geometry,material,count),matrix=new THREE.Matrix4();
  const packet=(length-gap*(count-1))/count;
  for(let i=0;i<count;i++){matrix.makeTranslation(-length/2+packet/2+i*(packet+gap),0,0);stack.setMatrixAt(i,matrix);}
  stack.instanceMatrix.needsUpdate=true;stack.computeBoundingBox();stack.computeBoundingSphere();return stack;
}

function rounded(x:number,y:number,z:number,material:THREE.Material):THREE.Mesh{
  return new THREE.Mesh(new RoundedBoxGeometry(x,y,z,2,Math.min(x,y,z)*.16),material);
}

/** Typical wound-rotor DFIG, fitted inside the source housing. All dimensions and
 * winding counts are authored illustration parameters, not recovered factory data. */
export function buildGeneratorAssembly(frame:THREE.Group,rotor:THREE.Group,start:number,end:number,statorOuter:number):GeneratorModel{
  const length=end-start,pivotCenter=(start+end)/2,center=pivotCenter-length*.08,offset=center-pivotCenter;
  const activeLength=length*.44,half=activeLength/2,endTurn=Math.min(length*.075,.30);
  const rotorRadius=statorOuter*.66,airGap=.012,statorBore=rotorRadius+airGap;
  const statorSlots=48,rotorSlots=36,statorSlotDepth=.13,rotorSlotDepth=.13;
  const statorHalfSlot=.032,rotorHalfSlot=.054;
  const statorR1=statorBore+.025,statorR2=statorBore+.090;
  const rotorR1=rotorRadius-.030,rotorR2=rotorRadius-.100;
  const slotWidth=.022,slotThickness=.009;
  const de=start+length*.09,nde=end-length*.22;
  const journalRadius=.082,bearingScale=journalRadius/.066;
  const steel=new THREE.MeshStandardMaterial({color:PALETTE.steel,metalness:.91,roughness:.28});
  const rotorIron=new THREE.MeshStandardMaterial({color:0x88949e,metalness:.78,roughness:.38});laminated(rotorIron);
  const statorIron=new THREE.MeshStandardMaterial({color:0xb4bec7,metalness:.72,roughness:.4});laminated(statorIron);
  const windingMaterial=new THREE.MeshPhysicalMaterial({color:0xc6a053,metalness:.43,roughness:.34,clearcoat:.25,clearcoatRoughness:.35});
  const brass=new THREE.MeshStandardMaterial({color:0xc8ad70,metalness:.86,roughness:.3});
  const insulation=new THREE.MeshStandardMaterial({color:0x343b45,metalness:.03,roughness:.59});
  const wedgeMaterial=new THREE.MeshStandardMaterial({color:0x8e99a4,metalness:.32,roughness:.46});
  const paint=new THREE.MeshPhysicalMaterial({color:PALETTE.paint,metalness:.08,roughness:.33,clearcoat:.18});
  const carbon=new THREE.MeshStandardMaterial({color:0x353537,metalness:.08,roughness:.66});
  const translucent=<T extends THREE.MeshStandardMaterial>(source:T,opacity:number):T=>{
    const material=source.clone();material.transparent=true;material.opacity=opacity;material.depthWrite=false;
    material.onBeforeCompile=source.onBeforeCompile;material.customProgramCacheKey=source.customProgramCacheKey;
    return material;
  };
  // Complete stationary surfaces are drawn transparently after the moving
  // opaque parts. No sector is removed to expose the rotor.
  statorIron.transparent=true;statorIron.opacity=.14;statorIron.depthWrite=false;
  const statorWinding=translucent(windingMaterial,.28),statorWedge=translucent(wedgeMaterial,.18);
  const statorPressureFinish=translucent(steel,.14),statorSupport=translucent(insulation,.20),endShieldFinish=translucent(paint,.14);
  const xraySurfaces:THREE.Mesh[]=[];
  const transparentSurface=<T extends THREE.Mesh>(mesh:T):T=>{
    mesh.userData.generatorXray=true;xraySurfaces.push(mesh);return mesh;
  };

  // Compact active stack leaves real axial space for end turns, bearings and collector.
  const packets=8,gap=.008,packetWidth=(activeLength-gap*(packets-1))/packets;
  const statorCore=transparentSurface(packetStack(slottedCore(statorBore,statorOuter,packetWidth,statorSlots,statorSlotDepth,statorHalfSlot,true),statorIron,packets,activeLength,gap));
  statorCore.position.x=center;statorCore.name='定子叠片铁芯 · 槽孔与径向通风道';frame.add(statorCore);
  const rotorCore=packetStack(slottedCore(.15,rotorRadius,packetWidth,rotorSlots,rotorSlotDepth,rotorHalfSlot,false),rotorIron,packets,activeLength,gap);
  rotorCore.position.x=offset;rotorCore.name='绕线转子叠片铁芯 · 槽内绕组';rotor.add(rotorCore);

  const statorCoils=new THREE.Group();statorCoils.position.x=center;statorCoils.name='固定定子绕组 · 双层槽内导体与端部回绕';frame.add(statorCoils);
  const statorPitch=11,rotorPitch=8; // Four-pole, one-slot short-pitched illustrative layout.
  const statorAngles=Array.from({length:statorSlots},(_,i)=>i*TAU/statorSlots);
  const statorCurve=new FormedCoil(half,statorR1,statorR2,statorPitch*TAU/statorSlots,endTurn,.025,-.020);
  statorCoils.add(transparentSurface(windings(statorCurve,statorAngles,slotWidth,slotThickness,statorWinding,'完整定子成型线圈 · 两层导体与闭合端冠')));
  const rotorCoils=new THREE.Group();rotorCoils.position.x=offset;rotorCoils.name='旋转绕组 · 埋入转子槽内';rotor.add(rotorCoils);
  const rotorAngles=Array.from({length:rotorSlots},(_,i)=>i*TAU/rotorSlots);
  const rotorCurve=new FormedCoil(half,rotorR1,rotorR2,rotorPitch*TAU/rotorSlots,endTurn*.9,.009,.012);
  const rotorBundles=windings(rotorCurve,rotorAngles,slotWidth,slotThickness,windingMaterial,'转子成型线圈 · 槽内导体及端部回绕');rotorCoils.add(rotorBundles);

  // Flush slot wedges retain the conductors; the rotor surface is electrical
  // steel and insulation, rather than long copper rods floating above a cylinder.
  const wedges=new THREE.InstancedMesh(new RoundedBoxGeometry(activeLength,.012,2*(rotorRadius-.014)*Math.sin(rotorHalfSlot)-.0004,2,.002),wedgeMaterial,rotorSlots);
  const dummy=new THREE.Object3D();
  for(let i=0;i<rotorSlots;i++){const a=rotorAngles[i];dummy.position.set(offset,(rotorRadius-.008)*Math.cos(a),(rotorRadius-.008)*Math.sin(a));dummy.rotation.set(a,0,0);dummy.updateMatrix();wedges.setMatrixAt(i,dummy.matrix);}
  wedges.name='转子槽楔 · 与外圆齐平';wedges.instanceMatrix.needsUpdate=true;rotor.add(wedges);

  const fixedWedges=new THREE.Group();fixedWedges.position.x=center;fixedWedges.name='定子槽口绝缘槽楔';frame.add(fixedWedges);
  const statorWedges=transparentSurface(new THREE.InstancedMesh(new RoundedBoxGeometry(activeLength,.009,.020,2,.0014),statorWedge,statorSlots));
  statorWedges.name='完整周向定子槽楔';
  for(let i=0;i<statorSlots;i++){
    const a=i*TAU/statorSlots;dummy.position.set(0,(statorBore+.010)*Math.cos(a),(statorBore+.010)*Math.sin(a));dummy.rotation.set(a,0,0);dummy.updateMatrix();statorWedges.setMatrixAt(i,dummy.matrix);
  }
  statorWedges.instanceMatrix.needsUpdate=true;statorWedges.computeBoundingBox();statorWedges.computeBoundingSphere();fixedWedges.add(statorWedges);

  // Stepped shaft: source coupling socket -> bearing journals -> rotor core hub.
  const shaftSections=[{a:0,b:de-.08,r:.06},{a:de-.08,b:center-half-.06,r:journalRadius},
    {a:center-half-.06,b:center+half+.06,r:.15},{a:center+half+.06,b:end+.015,r:journalRadius}];
  rotor.add(machinedShaft(shaftSections,pivotCenter,steel));
  for(const sign of [-1,1]){
    const pressure=new THREE.Mesh(slottedCore(.1501,rotorRadius-.006,.028,rotorSlots,rotorSlotDepth-.006,rotorHalfSlot,false),steel);pressure.position.x=offset+sign*(half+.016);pressure.name='转子开槽压板';rotor.add(pressure);
    // Authored 1 mm compression of the insulating retaining band on the end turns.
    const bandStation=half+.06,bandWidth=.04,position=rotorBundles.geometry.attributes.position;let envelope=0;
    for(let i=0;i<position.count;i++)if(Math.abs(Math.abs(position.getX(i))-bandStation)<bandWidth/2)envelope=Math.max(envelope,Math.hypot(position.getY(i),position.getZ(i)));
    const retaining=ring(envelope-.001,envelope+.012,bandWidth,insulation);retaining.position.x=offset+sign*bandStation;retaining.name='转子端部绕组绑扎支撑环';rotor.add(retaining);
    const statorPressure=transparentSurface(new THREE.Mesh(slottedCore(statorBore,statorOuter+.012,.025,statorSlots,statorSlotDepth,statorHalfSlot,true),statorPressureFinish));statorPressure.position.x=center+sign*(half+.016);statorPressure.name='完整定子开槽压紧环';frame.add(statorPressure);
    const support=transparentSurface(ring(statorR2+.004,statorR2+.018,.038,statorSupport));support.position.x=center+sign*(half+.06);support.name='完整定子端部绝缘支撑';frame.add(support);
  }

  const endCovers=new THREE.Group();endCovers.name='固定端盾与轴承支撑';frame.add(endCovers);
  const bearings:BearingAssembly[]=[];
  for(const [index,x]of [de,nde].entries()){
    const cover=transparentSurface(sector(.172*bearingScale,statorOuter+.035,.045,endShieldFinish,0,TAU,true));cover.position.x=x;
    cover.name=index===0?'驱动端端盾 · 通风孔与轴承配合':'非驱动端端盾 · 通风孔与轴承配合';endCovers.add(cover);
    const fixedBearing=new THREE.Group();fixedBearing.position.x=x;fixedBearing.scale.setScalar(bearingScale);endCovers.add(fixedBearing);
    const movingBearing=new THREE.Group();movingBearing.position.x=x-pivotCenter;movingBearing.scale.setScalar(bearingScale);rotor.add(movingBearing);
    const bearing=addGeneratorBearing(fixedBearing,movingBearing,0,0,index===0?'驱动端':'非驱动端',steel,brass);bearings.push(bearing);
    // The continuous stepped shaft already provides this journal surface.
    bearing.journal.visible=false;
    for(let i=0;i<16;i++){
      const a=TAU*(i+.5)/16,bolt=blindSocket(.012,.014,steel);bolt.position.set(x+(index===0?-.032:.032),(statorOuter+.012)*Math.cos(a),(statorOuter+.012)*Math.sin(a));if(index===0)bolt.rotation.y=Math.PI;bolt.name='端盾内六角螺钉';endCovers.add(bolt);
    }
  }
  // Fixed axial tie rods clamp the lamination stack into the stationary end shields.
  for(const a of [45,135,225,315].map(d=>d*Math.PI/180)){
    const rod=new THREE.Mesh(new THREE.CylinderGeometry(.011,.011,nde-de,12),steel);rod.rotation.z=Math.PI/2;
    rod.position.set((de+nde)/2,(statorOuter+.018)*Math.cos(a),(statorOuter+.018)*Math.sin(a));rod.name='固定铁芯拉紧杆';frame.add(rod);
  }

  // Shaft-mounted centrifugal ventilation wheel, separated axially from the winding ends.
  const fanX=nde+.16,fanOuter=rotorRadius*.88;
  const fanDisk=ring(journalRadius,fanOuter,.016,steel);fanDisk.position.x=fanX-pivotCenter;fanDisk.name='轴带通风轮背板';rotor.add(fanDisk);
  const fanHub=ring(journalRadius,.143,.085,steel);fanHub.position.x=fanX-.01-pivotCenter;fanHub.name='通风轮加厚轮毂';rotor.add(fanHub);
  const bladeShape=new THREE.Shape();bladeShape.moveTo(.138,-.004);bladeShape.bezierCurveTo(fanOuter*.60,0,fanOuter*.83,.05,fanOuter*Math.cos(.40),fanOuter*Math.sin(.40));
  bladeShape.lineTo(fanOuter*Math.cos(.40)-.004,fanOuter*Math.sin(.40)+.008);bladeShape.bezierCurveTo(fanOuter*.83,.061,fanOuter*.60,.008,.138,.004);bladeShape.closePath();
  const fanBlades=new THREE.InstancedMesh(axialShape(bladeShape,.045,.001),steel,12),fanMatrix=new THREE.Matrix4();
  for(let i=0;i<12;i++){fanMatrix.makeRotationX(TAU*i/12);fanMatrix.setPosition(fanX+.03-pivotCenter,0,0);fanBlades.setMatrixAt(i,fanMatrix);}
  fanBlades.name='轴带通风轮曲面叶片';fanBlades.instanceMatrix.needsUpdate=true;rotor.add(fanBlades);
  for(let i=0;i<6;i++){const a=i*TAU/6,bolt=blindSocket(.007,.008,steel);bolt.position.set(fanX+.041-pivotCenter,.116*Math.cos(a),.116*Math.sin(a));bolt.name='通风轮轮毂锁紧螺钉';rotor.add(bolt);}

  // DFIG identity anchor: three rings turn with the wound rotor; all brush gear is fixed.
  const slipRings=new THREE.Group();slipRings.name='三相滑环 · 随转轴旋转';rotor.add(slipRings);
  const brushRig=new THREE.Group();brushRig.name='固定碳刷与刷架';frame.add(brushRig);
  const ringRadius=.163,ringWidth=.055,ringPositions=[end-.35,end-.23,end-.11];
  const sleeve=ring(journalRadius,.120,.37,insulation);sleeve.position.x=end-.23-pivotCenter;sleeve.name='滑环轴绝缘套';slipRings.add(sleeve);
  for(let i=0;i<2;i++){
    const separator=ring(.120,.143,.048,insulation);separator.position.x=(ringPositions[i]+ringPositions[i+1])/2-pivotCenter;separator.name='相间绝缘隔套';slipRings.add(separator);
  }
  const endInsulator=ring(journalRadius,.145,.008,insulation);endInsulator.position.x=end-.0785-pivotCenter;endInsulator.name='滑环组绝缘端垫';slipRings.add(endInsulator);
  const washer=ring(journalRadius,.123,.005,steel);washer.position.x=end-.072-pivotCenter;washer.name='轴端止动垫圈';slipRings.add(washer);
  const locknut=lockingNut(journalRadius,.113,.025,steel);locknut.position.x=end-.057-pivotCenter;slipRings.add(locknut);
  slipRings.add(threadedEnd(end-.04-pivotCenter,end+.010-pivotCenter,journalRadius+.0001,steel));
  for(const [phase,x]of ringPositions.entries()){
    const collector=ring(.120,ringRadius,ringWidth,brass);collector.position.x=x-pivotCenter;collector.name=`转子相${phase+1}集电环`;slipRings.add(collector);
    const terminal=terminalBlock(insulation,steel,brass);terminal.position.set(x,0,.555);terminal.rotation.x=Math.PI/2;terminal.name=`转子相${phase+1}静止接线端子`;brushRig.add(terminal);
    const mountingRail=sector(.479,.505,.024,paint,Math.PI/3,Math.PI/3);mountingRail.position.x=x;mountingRail.name='端子座弧形安装横梁';brushRig.add(mountingRail);
    for(const dx of [-.035,.035]){
      const spacer=ring(.003,.008,.034,steel);spacer.position.set(x+dx,0,.519);spacer.rotation.y=-Math.PI/2;spacer.name='端子座螺钉隔柱';brushRig.add(spacer);
    }
    for(const a of [60,120].map(d=>d*Math.PI/180)){
      // The sector bevel expands 1 mm inward; compensate to retain the authored contact clearance.
      const contact=sector(ringRadius+.00115,.198,.044,carbon,a-.10,.20);contact.position.x=x;contact.name=`相${phase+1}固定碳刷`;brushRig.add(contact);
      const holder=brushHolder(brass,steel);holder.position.x=x;holder.rotation.x=a;brushRig.add(holder);
      const mid=(a+Math.PI/2)/2;
      const lead=braidedLead([new THREE.Vector3(x+.025,.268*Math.cos(a),.268*Math.sin(a)),
        new THREE.Vector3(x+.040,.35*Math.cos(a),.35*Math.sin(a)),new THREE.Vector3(x+.040,.49*Math.cos(mid),.49*Math.sin(mid)),
        new THREE.Vector3(x+.03,0,.57),new THREE.Vector3(x,0,.587)],windingMaterial);brushRig.add(lead);
      const bridge=sector(.2568,.505,.025,paint,a-.085,.17);bridge.position.x=x;bridge.name='固定刷盒径向安装臂';brushRig.add(bridge);
    }
  }
  // Holder bridges connect both rails to the original stationary end-shield plane.
  for(const a of [60,120].map(d=>d*Math.PI/180)){
    const anchor=sector(.205,.505,.052,paint,a-.11,.22);anchor.position.x=nde;anchor.name='刷架支座 · 固定于端盾轴承座';brushRig.add(anchor);
    const support=rounded(end+.05-nde,.035,.035,paint);support.position.set((nde+end+.05)/2,.489*Math.cos(a),.489*Math.sin(a));support.rotation.x=a;support.name='刷架静止支撑梁';brushRig.add(support);
  }

  frame.userData.generatorType='Typical DFIG · authored reconstruction';
  const diagnostics={
    generatorType:'典型双馈绕线式发电机；未经厂家尺寸验证',center,pivotCenter,activeLength,statorOuterRadius:statorOuter,
    rotorCoreRadius:rotorRadius,statorBoreRadius:statorBore,radialClearanceMeters:airGap,
    rotorWindingMaxRadius:rotorBundles.geometry.userData.winding.maxRadius,retainedStatorCoils:statorAngles.length,statorSlots,rotorSlots,
    statorCoverageDegrees:360,endShieldCoverageDegrees:360,statorWedgeCount:statorSlots,endShieldFasteners:32,
    internalPresentation:'Full 360-degree assembly; stationary covers and stator use transparency, without geometric cutouts.',
    poleCount:4,statorCoilPitchSlots:statorPitch,rotorCoilPitchSlots:rotorPitch,
    statorSlotDepth,rotorSlotDepth,slotWidth,slotThickness,statorHalfSlot,rotorHalfSlot,
    deBearingStation:de,ndeBearingStation:nde,endTurn,coreStart:center-half,coreEnd:center+half,
    windingToDriveBearingClearance:center-half-endTurn-(de+.095*bearingScale/2),
    windingToRearBearingClearance:nde-.095*bearingScale/2-(center+half+endTurn),
    slipRingCount:3,slipRingRadius:ringRadius,brushContactGapMeters:.00015,journalRadius,
    fanStation:fanX,wireRouting:'Two radial slot layers and closed formed end windings; illustrative winding pitch and dimensions.'
  };
  return {root:frame,statorCore,rotorCore,statorCoils,rotorCoils,endCovers,slipRings,brushRig,bearings,xraySurfaces,
    auxiliaryRotors:bearings.map(b=>({pivot:b.cage,factor:b.cageFactor})),
    updateRollingElements:angle=>bearings.forEach(b=>b.update(angle)),diagnostics};
}
