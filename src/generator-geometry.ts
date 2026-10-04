import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function axialShape(shape: THREE.Shape, width: number, bevel = 0): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 64 });
  geometry.translate(0, 0, -width / 2); geometry.rotateY(Math.PI / 2); geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function ring(inner: number, outer: number, width: number, material: THREE.Material): THREE.Mesh {
  const b = Math.min(width * .15, .002);
  const profile = [[inner,-width/2+b],[inner+b,-width/2],[outer-b,-width/2],[outer,-width/2+b],
    [outer,width/2-b],[outer-b,width/2],[inner+b,width/2],[inner,width/2-b],[inner,-width/2+b]];
  const geometry = new THREE.LatheGeometry(profile.map(([r,x])=>new THREE.Vector2(r,x)),96);geometry.rotateZ(-Math.PI/2);
  const mesh = new THREE.Mesh(geometry,material);mesh.userData.radial = {inner,outer,width};return mesh;
}

export function sector(inner: number, outer: number, width: number, material: THREE.Material,
  start:number, span:number, holes = false): THREE.Mesh {
  const shape=new THREE.Shape(),closed=span>=TAU-1e-8;
  if(closed){
    // A complete annulus needs a real inner hole, not two joined arcs that
    // leave a coincident radial seam in the triangulation.
    shape.absarc(0,0,outer,0,TAU,false);
    const bore=new THREE.Path();bore.absarc(0,0,inner,0,TAU,true);shape.holes.push(bore);
  }else{
    shape.moveTo(outer*Math.cos(start),outer*Math.sin(start));
    shape.absarc(0,0,outer,start,start+span,false);shape.lineTo(inner*Math.cos(start+span),inner*Math.sin(start+span));
    shape.absarc(0,0,inner,start+span,start,true);shape.closePath();
  }
  const holeCount=closed?8:5;
  if(holes)for(let i=0;i<holeCount;i++){
    const a=start+span*(i+.5)/holeCount,r=(inner+outer)*.5,hole=new THREE.Path();
    hole.absarc(r*Math.cos(a),r*Math.sin(a),(outer-inner)*.20,0,TAU,true);shape.holes.push(hole);
  }
  const geometry=axialShape(shape,width,.001);
  const p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    const y=p.getY(i),z=p.getZ(i),r=Math.hypot(y,z);
    if(Math.abs(n.getX(i))<.1&&(Math.abs(r-inner)<1e-5||Math.abs(r-outer)<1e-5)){
      const sign=Math.abs(r-inner)<1e-5?-1:1;n.setXYZ(i,0,sign*y/r,sign*z/r);
    }
  }
  const mesh=new THREE.Mesh(geometry,material);
  mesh.userData.radial={inner,outer,width,coverageDegrees:span*180/Math.PI,ventilationHoles:holes?holeCount:0};
  return mesh;
}

export function slottedCore(inner: number, outer: number, width: number, slots: number,
  depth: number, halfSlot: number, stator: boolean): THREE.BufferGeometry {
  const shape=new THREE.Shape(),step=TAU/slots;
  const point=(r:number,a:number,first=false)=>{
    const x=r*Math.cos(a),y=r*Math.sin(a);
    if(first)shape.moveTo(x,y);
    else if(Math.hypot(shape.currentPoint.x-x,shape.currentPoint.y-y)>1e-10)shape.lineTo(x,y);
  };
  if(stator){
    shape.absarc(0,0,outer,0,TAU,false);
    const bore=new THREE.Path();bore.moveTo(inner*Math.cos(step/2),inner*Math.sin(step/2));
    const boreArc=(radius:number,a:number,b:number)=>{
      const segments=Math.max(1,Math.ceil(Math.abs(b-a)/.018));
      for(let j=1;j<=segments;j++){const angle=a+(b-a)*j/segments;bore.lineTo(radius*Math.cos(angle),radius*Math.sin(angle));}
    };
    for(let i=0;i<slots;i++){
      const a=-i*step;
      boreArc(inner,a+step/2,a+halfSlot);
      bore.lineTo((inner+depth)*Math.cos(a+halfSlot),(inner+depth)*Math.sin(a+halfSlot));
      boreArc(inner+depth,a+halfSlot,a-halfSlot);
      bore.lineTo(inner*Math.cos(a-halfSlot),inner*Math.sin(a-halfSlot));
      boreArc(inner,a-halfSlot,a-step/2);
    }
    bore.closePath();shape.holes.push(bore);
  }else{
    for(let i=0;i<slots;i++){
      const a=i*step;
      point(outer,a-step/2,i===0);point(outer,a-halfSlot);point(outer-depth,a-halfSlot);
      point(outer-depth,a+halfSlot);point(outer,a+halfSlot);
      for(let j=1;j<=5;j++)point(outer,a+halfSlot+(step/2-halfSlot)*j/5);
    }
    shape.closePath();const hole=new THREE.Path();hole.absarc(0,0,inner,0,TAU,true);shape.holes.push(hole);
  }
  const geometry=axialShape(shape,width),p=geometry.attributes.position,n=geometry.attributes.normal;
  for(let i=0;i<p.count;i++){
    const y=p.getY(i),z=p.getZ(i),r=Math.hypot(y,z);
    if(Math.abs(n.getX(i))>.3)continue;
    if((Math.abs(r-outer)<1e-5||Math.abs(r-inner)<1e-5)&&Math.abs((n.getY(i)*y+n.getZ(i)*z)/r)>.7){const sign=Math.abs(r-inner)<1e-5?-1:1;n.setXYZ(i,0,sign*y/r,sign*z/r);}
  }
  geometry.userData.core={stator,slots,coverageDegrees:360,inner,outer,slotDepth:depth};
  geometry.computeBoundingBox();return geometry;
}

export class FormedCoil extends THREE.Curve<THREE.Vector3>{
  constructor(readonly half:number,readonly radiusA:number,readonly radiusB:number,readonly pitch:number,readonly bend:number,readonly flare:number,readonly fanning=0){super();}
  override getPoint(t:number,target=new THREE.Vector3()):THREE.Vector3{
    const s=Math.min(t,1-1e-12)*4,part=Math.floor(s),u=s-part;
    let x=0,a=0,r=this.radiusA;
    if(part===0)x=THREE.MathUtils.lerp(-this.half,this.half,u);
    else if(part===1){const f=.5-.5*Math.cos(Math.PI*u),s=Math.sin(Math.PI*u)**2;x=this.half+this.bend*Math.sin(Math.PI*u);a=this.pitch*f;r=THREE.MathUtils.lerp(this.radiusA,this.radiusB,f)+this.flare*s+this.fanning*Math.sin(TAU*u)*s;}
    else if(part===2){x=THREE.MathUtils.lerp(this.half,-this.half,u);a=this.pitch;r=this.radiusB;}
    else{const f=.5-.5*Math.cos(Math.PI*u),s=Math.sin(Math.PI*u)**2;x=-this.half-this.bend*Math.sin(Math.PI*u);a=this.pitch*(1-f);r=THREE.MathUtils.lerp(this.radiusB,this.radiusA,f)+this.flare*s-this.fanning*Math.sin(TAU*u)*s;}
    return target.set(x,r*Math.cos(a),r*Math.sin(a));
  }
}

/** Rounded rectangular conductor bundle; closed seam with radial frame alignment. */
export function coilGeometry(curve:FormedCoil,width:number,thickness:number):THREE.BufferGeometry{
  const steps=240,sides=16,positions:number[]=[],uvs:number[]=[],indices:number[]=[];
  const radial=new THREE.Vector3(),tangent=new THREE.Vector3(),binormal=new THREE.Vector3();
  let maxRadius=0,minRadius=Infinity,maxChordError=0;
  for(let i=0;i<=steps;i++){
    const t=i/steps,p=curve.getPoint(t);curve.getTangent(t,tangent);
    radial.set(0,p.y,p.z).normalize();radial.addScaledVector(tangent,-radial.dot(tangent)).normalize();
    binormal.crossVectors(tangent,radial).normalize();
    for(let j=0;j<=sides;j++){
      const a=TAU*j/sides,c=Math.cos(a),s=Math.sin(a);
      const r=Math.sign(c)*Math.sqrt(Math.abs(c))*thickness*.5,b=Math.sign(s)*Math.sqrt(Math.abs(s))*width*.5;
      const v=p.clone().addScaledVector(radial,r).addScaledVector(binormal,b);
      positions.push(v.x,v.y,v.z);uvs.push(t,j/sides);
      maxRadius=Math.max(maxRadius,Math.hypot(v.y,v.z));minRadius=Math.min(minRadius,Math.hypot(v.y,v.z));
    }
    if(i<steps){const line=new THREE.Line3(p,curve.getPoint((i+1)/steps)),mid=curve.getPoint((i+.5)/steps);maxChordError=Math.max(maxChordError,line.closestPointToPoint(mid,true,new THREE.Vector3()).distanceTo(mid));}
  }
  // Straight slot legs are planar extrusions. Keep the end-adjacent rings for
  // identical bend normals/UVs, but connect the collinear middle in one span.
  // Every curved end-turn sample and the full rounded conductor section remains.
  const rings=Array.from({length:steps+1},(_,i)=>i).filter(i=>!(i>1&&i<59)&&!(i>121&&i<179));
  for(let k=0;k<rings.length-1;k++)for(let j=0;j<sides;j++){
    const a=rings[k]*(sides+1)+j,b=a+1,c=rings[k+1]*(sides+1)+j,d=c+1;indices.push(a,b,c,b,d,c);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
  // Calculate smooth normals with the original sampling, then retain those exact
  // normals while removing only the redundant coplanar index spans.
  const originalIndices:number[]=[];
  for(let i=0;i<steps;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+1,c=a+sides+1,d=c+1;originalIndices.push(a,b,c,b,d,c);}
  geometry.setIndex(originalIndices);geometry.computeVertexNormals();geometry.setIndex(indices);
  const normals=geometry.getAttribute('normal'),average=new THREE.Vector3(),other=new THREE.Vector3();
  const join=(a:number,b:number)=>{
    average.fromBufferAttribute(normals,a).add(other.fromBufferAttribute(normals,b)).normalize();
    normals.setXYZ(a,average.x,average.y,average.z);normals.setXYZ(b,average.x,average.y,average.z);
  };
  for(let i=0;i<=steps;i++)join(i*(sides+1),i*(sides+1)+sides);
  for(let j=0;j<=sides;j++)join(j,steps*(sides+1)+j);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  geometry.userData.winding={closed:true,slotRadiusA:curve.radiusA,slotRadiusB:curve.radiusB,pitch:curve.pitch,width,thickness,
    half:curve.half,bend:curve.bend,maxRadius,minRadius,seamGap:curve.getPoint(0).distanceTo(curve.getPoint(1)),maxChordError};
  return geometry;
}

export function windings(curve:FormedCoil,angles:number[],width:number,thickness:number,material:THREE.Material,name:string):THREE.InstancedMesh{
  const geometry=coilGeometry(curve,width,thickness),mesh=new THREE.InstancedMesh(geometry,material,angles.length),matrix=new THREE.Matrix4();
  angles.forEach((angle,i)=>{matrix.makeRotationX(angle);mesh.setMatrixAt(i,matrix);});
  mesh.name=name;mesh.userData.winding=geometry.userData.winding;mesh.userData.slotAngles=angles;
  mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();return mesh;
}

export function laminated(material:THREE.MeshStandardMaterial):void{
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying float vLaminationX;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvLaminationX=position.x;');
    shader.fragmentShader='varying float vLaminationX;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float phase=vLaminationX/.003;float footprint=max(fwidth(phase),.0001);
      float seam=min(fract(phase),1.-fract(phase));
      float groove=1.-smoothstep(.06-footprint,.06+footprint,seam);
      diffuseColor.rgb*=1.-.18*groove*(1.-smoothstep(.35,1.2,footprint));`);
  };
  material.customProgramCacheKey=()=> 'dfig-lamination-v2';
}
