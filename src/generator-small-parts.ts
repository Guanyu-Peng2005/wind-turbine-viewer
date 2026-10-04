import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { socketCap } from './mechanical-details';
import { axialShape, ring, TAU } from './generator-geometry';

function rectangle(w:number,h:number,r:number):THREE.Shape{
  const s=new THREE.Shape();s.moveTo(-w/2+r,-h/2);s.lineTo(w/2-r,-h/2);s.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
  s.lineTo(w/2,h/2-r);s.quadraticCurveTo(w/2,h/2,w/2-r,h/2);s.lineTo(-w/2+r,h/2);
  s.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);s.lineTo(-w/2,-h/2+r);s.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);s.closePath();return s;
}

export function blindSocket(radius:number,width:number,material:THREE.Material):THREE.Mesh{
  const cap=socketCap(radius,width,material);
  const floor=new THREE.Mesh(new THREE.CylinderGeometry(radius*.47,radius*.47,width*.12,24),material);
  floor.rotation.z=Math.PI/2;floor.position.x=-width*.29;floor.name='内六角盲孔底';cap.add(floor);return cap;
}

export function lockingNut(inner:number,outer:number,width:number,material:THREE.Material):THREE.Mesh{
  const shape=new THREE.Shape();
  for(let i=0;i<6;i++){
    const a=i*TAU/6,half=.085;
    if(i===0)shape.moveTo(outer*Math.cos(a-half),outer*Math.sin(a-half));
    else shape.lineTo(outer*Math.cos(a-half),outer*Math.sin(a-half));
    shape.lineTo((outer-.007)*Math.cos(a-half),(outer-.007)*Math.sin(a-half));
    shape.lineTo((outer-.007)*Math.cos(a+half),(outer-.007)*Math.sin(a+half));
    shape.lineTo(outer*Math.cos(a+half),outer*Math.sin(a+half));
    shape.absarc(0,0,outer,a+half,(i+1)*TAU/6-half,false);
  }
  shape.closePath();const hole=new THREE.Path();hole.absarc(0,0,inner,0,TAU,true);shape.holes.push(hole);
  const nut=new THREE.Mesh(axialShape(shape,width,.001),material);nut.name='带扳手槽的轴端锁紧圆螺母';return nut;
}

export function threadedEnd(start:number,end:number,radius:number,material:THREE.Material):THREE.Mesh{
  const points:THREE.Vector3[]=[],turns=(end-start)/.006,steps=Math.ceil(turns*40);
  for(let i=0;i<=steps;i++){const t=i/steps,a=TAU*turns*t;points.push(new THREE.Vector3(THREE.MathUtils.lerp(start,end,t),radius*Math.cos(a),radius*Math.sin(a)));}
  const mesh=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),steps,.0007,5,false),material);
  mesh.name='轴端细牙螺纹';return mesh;
}

/** Local X is axial, local +Y presses the brush outward away from the shaft. */
export function brushHolder(brass:THREE.Material,steel:THREE.Material):THREE.Group{
  const root=new THREE.Group();root.name='碳刷导槽、压紧弹簧及可拆上盖';
  const section=rectangle(.076,.063,.006),hole=rectangle(.050,.046,.002);section.holes.push(new THREE.Path(hole.getPoints(8).reverse()));
  const bodyGeometry=new THREE.ExtrudeGeometry(section,{depth:.071,bevelEnabled:true,bevelSize:.0008,bevelThickness:.0008,bevelSegments:2,curveSegments:8});
  bodyGeometry.rotateX(-Math.PI/2);bodyGeometry.translate(0,.180,0);
  const body=new THREE.Mesh(bodyGeometry,brass);body.name='开口碳刷导向盒 · 中空内腔';root.add(body);
  const turns=8,points:THREE.Vector3[]=[];
  for(let i=0;i<=128;i++){const t=i/128,a=t*turns*TAU;points.push(new THREE.Vector3(.011*Math.cos(a),.201+.038*t,.011*Math.sin(a)));}
  const spring=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),128,.0013,8,false),steel);spring.name='碳刷压紧螺旋弹簧';root.add(spring);
  for(const y of [.1995,.241]){
    const seat=ring(.003,.015,.0025,steel);seat.rotation.z=Math.PI/2;seat.position.y=y;seat.name='弹簧承压垫片';root.add(seat);
  }
  const capSection=rectangle(.080,.067,.006);
  for(const side of [-1,1]){
    const points=rectangle(.021,.033,.004).getPoints(8).reverse().map(p=>p.add(new THREE.Vector2(side*.024,0)));
    capSection.holes.push(new THREE.Path(points));
  }
  const capGeometry=new THREE.ExtrudeGeometry(capSection,{depth:.004,bevelEnabled:true,bevelSize:.0007,bevelThickness:.0007,bevelSegments:2,curveSegments:8});
  capGeometry.rotateX(-Math.PI/2);capGeometry.translate(0,.251,0);
  const cap=new THREE.Mesh(capGeometry,brass);cap.name='刷盒可拆压盖';root.add(cap);
  const adjuster=new THREE.Mesh(new THREE.CylinderGeometry(.003,.003,.018,20),steel);adjuster.position.y=.249;adjuster.name='弹簧预紧调节螺杆';root.add(adjuster);
  const adjusterHead=blindSocket(.006,.006,steel);adjusterHead.rotation.z=Math.PI/2;adjusterHead.position.y=.259;adjusterHead.name='弹簧预紧调节头';root.add(adjusterHead);
  for(const x of [-.030,.030])for(const z of [-.024,.024]){
    const bolt=blindSocket(.0038,.004,steel);bolt.rotation.z=Math.PI/2;bolt.position.set(x,.258,z);bolt.name='刷盒内六角紧固钉';root.add(bolt);
  }
  // Contact braid terminates on a real stud with an annular cable lug.
  const stud=new THREE.Mesh(new THREE.CylinderGeometry(.0035,.0035,.012,16),steel);stud.position.set(.025,.265,0);stud.name='碳刷引线接线柱';root.add(stud);
  const lug=ring(.0036,.0085,.002,brass);lug.rotation.z=Math.PI/2;lug.position.set(.025,.268,0);lug.name='引线环形端子';root.add(lug);
  return root;
}

export function terminalBlock(insulation:THREE.Material,steel:THREE.Material,brass:THREE.Material):THREE.Group{
  const root=new THREE.Group();root.name='绝缘端子座 · 螺柱与环形接线端';
  const base=new THREE.Mesh(new RoundedBoxGeometry(.094,.028,.075,2,.004),insulation);base.name='绝缘接线底座';root.add(base);
  const foot=new THREE.Mesh(new RoundedBoxGeometry(.106,.007,.082,2,.002),insulation);foot.position.y=-.017;foot.name='端子座安装法兰';root.add(foot);
  const post=new THREE.Mesh(new THREE.CylinderGeometry(.004,.004,.031,24),brass);post.position.y=.027;post.name='接线螺柱';root.add(post);
  const eye=ring(.0042,.010,.003,brass);eye.rotation.z=Math.PI/2;eye.position.y=.032;eye.name='电缆端子压接环';root.add(eye);
  const nut=new THREE.Mesh(new THREE.CylinderGeometry(.007,.007,.005,6),steel);nut.position.y=.037;nut.name='接线柱六角螺母';root.add(nut);
  for(const x of [-.037,.037]){const bolt=blindSocket(.004,.005,steel);bolt.rotation.z=Math.PI/2;bolt.position.set(x,.018,0);bolt.name='端子座紧固钉';root.add(bolt);}
  return root;
}

export function braidedLead(points:THREE.Vector3[],material:THREE.Material):THREE.Group{
  const root=new THREE.Group();root.name='碳刷柔性铜编织带 · 固定连接';
  const center=new THREE.CatmullRomCurve3(points),steps=64,frames=center.computeFrenetFrames(steps,false);
  for(let strand=0;strand<3;strand++){
    const path:THREE.Vector3[]=[];
    for(let i=0;i<=steps;i++){const t=i/steps,a=TAU*(7*t+strand/3),p=center.getPointAt(t);p.addScaledVector(frames.normals[i],.0022*Math.cos(a)).addScaledVector(frames.binormals[i],.0022*Math.sin(a));path.push(p);}
    const wire=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path),128,.0015,6,false),material);wire.name='铜编织股线';root.add(wire);
  }
  return root;
}

export function machinedShaft(sections:Array<{a:number;b:number;r:number}>,pivotCenter:number,material:THREE.Material):THREE.Mesh{
  const bore=.023,chamfer=.0018,profile:THREE.Vector2[]=[];
  const add=(r:number,x:number)=>profile.push(new THREE.Vector2(r,x-pivotCenter));
  const first=sections[0],last=sections.at(-1)!;add(bore,first.a);add(first.r-chamfer,first.a);add(first.r,first.a+chamfer);
  for(let i=0;i<sections.length;i++){
    const current=sections[i];add(current.r,current.b-chamfer);
    if(i+1<sections.length){const next=sections[i+1];add(current.r-chamfer,current.b);add(next.r-chamfer,current.b);add(next.r,current.b+chamfer);}
  }
  add(last.r-chamfer,last.b);add(bore,last.b);add(bore,first.a);
  const geometry=new THREE.LatheGeometry(profile,128);geometry.rotateZ(-Math.PI/2);
  const mesh=new THREE.Mesh(geometry,material);mesh.name='发电机阶梯转轴 · 轴肩倒角与中空引线通道';mesh.userData.shaftSections=sections;return mesh;
}
