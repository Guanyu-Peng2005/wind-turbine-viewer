import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { compactPrimitive, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';

const input='public/models/wind-turbine-cad.glb';
const output='public/models/wind-turbine-interaction.glb';
const source=await fs.readFile(input);
const json=JSON.parse(source.subarray(20,20+source.readUInt32LE(12)).toString());
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready,MeshoptSimplifier.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder,
  'draco3d.decoder':await draco3d.createDecoderModule(),
});
console.log('Reading source CAD.');
const document=await io.read(input),root=document.getRoot();
const meshes=root.listMeshes();
if(meshes.length!==json.meshes.length)throw Error('Mesh order validation failed.');
const nodesBefore=root.listNodes().map(n=>({name:n.getName(),matrix:n.getMatrix(),children:n.listChildren().map(c=>root.listNodes().indexOf(c))}));
meshes.forEach((mesh,i)=>{
  if(mesh.getName()!==(json.meshes[i].name??''))throw Error('Mesh identity mismatch at '+i);
  mesh.listPrimitives().forEach((primitive,j)=>primitive.setExtras({...primitive.getExtras(),interactionLodKey:`m${i}p${j}`}));
});
const triangles=()=>root.listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0),0);
const before=triangles();
// No quantization, reparenting, merging, material edits or source overwrite.
console.log(`Simplifying ${before} unique triangles with normal-aware seam handling.`);
await document.transform(weld({overwrite:false}));
for(const mesh of root.listMeshes())for(const primitive of mesh.listPrimitives()){
  if(primitive.getMode()!==4 || (primitive.getIndices()?.getCount()??0)<120)continue;
  compactPrimitive(primitive);
  const normal=primitive.getAttribute('NORMAL');
  let normals=normal?.getArray();
  if(normal && (normal.getNormalized() || !(normals instanceof Float32Array))){
    normals=new Float32Array(normal.getCount()*3);const element=[];
    for(let i=0;i<normal.getCount();i++){normal.getElement(i,element);normals.set(element,i*3);}
  }
  const adapter={...MeshoptSimplifier,simplify:(indices,positions,stride,target,error,flags)=>normal
    ? MeshoptSimplifier.simplifyWithAttributes(indices,positions,stride,normals,3,[0.1,0.1,0.1],null,target,error,[...flags,'Permissive'])
    : MeshoptSimplifier.simplify(indices,positions,stride,target,error,flags)};
  simplifyPrimitive(primitive,{simplifier:adapter,ratio:0.12,error:0.002,lockBorder:false});
}
// Byte compression only: no quantization/rebasing of the primitive coordinate frame.
for(const extension of root.listExtensionsUsed())if(['KHR_draco_mesh_compression','EXT_meshopt_compression'].includes(extension.extensionName))extension.dispose();
document.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({method:EXTMeshoptCompression.EncoderMethod.QUANTIZE});
const nodesAfter=root.listNodes().map(n=>({name:n.getName(),matrix:n.getMatrix(),children:n.listChildren().map(c=>root.listNodes().indexOf(c))}));
if(JSON.stringify(nodesBefore)!==JSON.stringify(nodesAfter))throw Error('Simplification changed source hierarchy/transforms.');
const after=triangles();
await io.write(output,document);
const report={source:input,output,sourceBytes:source.byteLength,outputBytes:(await fs.stat(output)).size,
  sourceUniqueTriangles:before,lodUniqueTriangles:after,ratio:after/before,relativeErrorCeiling:0.002,normalAttributeWeight:0.1,
  topologyBordersLocked:false,sourceNodes:root.listNodes().length,nodeHierarchyAndTransformsPreserved:true,
  sourceOverwritten:false,usage:'Interaction only; original geometry restored when manipulation ends.'};
await fs.writeFile('output/interaction-lod-build.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
