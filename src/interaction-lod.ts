import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Association = { meshes?: number; primitives?: number } | undefined;
type Binding = { mesh: THREE.Mesh; original: THREE.BufferGeometry; low: THREE.BufferGeometry };
const triangleCount = (g: THREE.BufferGeometry) => (g.index?.count ?? g.attributes.position.count) / 3;

/** Geometry-only interaction tier. The original Object3Ds, transforms, materials,
 * picking identities and annotation paths never change. Full geometry is restored
 * after gestures; locally rebuilt presentation meshes are deliberately excluded.
 */
export class InteractionLod {
  ready = false;
  active = false;
  status: 'loading' | 'ready' | 'unavailable' = 'loading';
  private requested = false;
  private disposed = false;
  private bindings: Binding[] = [];
  private pool = new Set<THREE.BufferGeometry>();
  private skipped = 0;
  private rejectedBounds = 0;

  constructor(private root: THREE.Object3D, private association: (mesh: THREE.Mesh) => Association) {}

  async load(loader: GLTFLoader, invalidate: () => void): Promise<void> {
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/wind-turbine-interaction.glb`);
      const byKey = new Map<string, THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      gltf.scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        this.pool.add(mesh.geometry);
        const key = mesh.geometry.userData.interactionLodKey;
        if (typeof key === 'string') byKey.set(key, mesh.geometry);
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(m => materials.add(m));
      });
      materials.forEach(m => m.dispose());
      if (this.disposed) { this.pool.forEach(g => g.dispose()); this.pool.clear(); return; }
      this.root.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const ref = this.association(mesh);
        if (!ref || ref.meshes === undefined || ref.primitives === undefined || mesh.userData.presentationRebuiltInPlace || (mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          this.skipped++; return;
        }
        const low = byKey.get(`m${ref.meshes}p${ref.primitives}`), original = mesh.geometry;
        if (!low || triangleCount(low) >= triangleCount(original)) { this.skipped++; return; }
        if (!original.boundingBox) original.computeBoundingBox();
        if (!low.boundingBox) low.computeBoundingBox();
        const before = original.boundingBox!, after = low.boundingBox!;
        const tolerance = before.getSize(new THREE.Vector3()).length() * 0.002 + 0.00001;
        if (before.min.distanceTo(after.min) > tolerance || before.max.distanceTo(after.max) > tolerance) {
          this.rejectedBounds++; return;
        }
        this.bindings.push({ mesh, original, low });
      });
      const used = new Set(this.bindings.map(b => b.low));
      this.pool.forEach(g => { if (!used.has(g)) { g.dispose(); this.pool.delete(g); } });
      this.ready = this.bindings.length > 0;
      this.status = this.ready ? 'ready' : 'unavailable';
      if (this.requested && this.setActive(true)) invalidate();
    } catch (error) {
      this.status = 'unavailable';
      console.warn('Interaction detail unavailable; keeping full CAD geometry.', error);
    }
  }

  setActive(active: boolean): boolean {
    this.requested = active;
    const next = active && this.ready;
    if (next === this.active) return false;
    this.bindings.forEach(b => { b.mesh.geometry = next ? b.low : b.original; });
    this.active = next;
    return true;
  }

  diagnostics() {
    let originalTriangles = 0, interactionTriangles = 0, visibleBindings = 0;
    for (const b of this.bindings) {
      let visible = true;
      for (let p: THREE.Object3D | null = b.mesh; p; p = p.parent) visible &&= p.visible;
      if (!visible) continue;
      visibleBindings++;
      originalTriangles += triangleCount(b.original); interactionTriangles += triangleCount(b.low);
    }
    return { status: this.status, active: this.active, mappedMeshes: this.bindings.length, visibleBindings,
      originalTriangles, interactionTriangles, skipped: this.skipped, rejectedBounds: this.rejectedBounds,
      allOriginalGeometryRestored: !this.active && this.bindings.every(b => b.mesh.geometry === b.original) };
  }

  dispose() {
    this.disposed = true;
    this.setActive(false);
    this.pool.forEach(g => g.dispose()); this.pool.clear(); this.bindings.length = 0;
  }
}

/** Only faint context shells use inexpensive unlit shading during gestures.
 * Opaque machinery keeps its PBR materials; every source binding is restored. */
export class ContextMaterialLod {
  active=false;
  private bindings:Array<{mesh:THREE.Mesh;full:THREE.Material;low:THREE.Material}>=[];
  private replacements=new Map<THREE.Material,THREE.Material>();
  constructor(private root:THREE.Object3D,materials:THREE.Material[]){
    for(const material of materials){
      const source=material as THREE.MeshStandardMaterial;
      const low=new THREE.MeshBasicMaterial({name:`${source.name} · interaction`,color:0x75868e,
        transparent:source.transparent,opacity:source.opacity,depthWrite:source.depthWrite,depthTest:source.depthTest,side:source.side});
      this.replacements.set(material,low);
    }
  }
  setActive(active:boolean):boolean{
    if(active===this.active)return false;
    if(active){
      this.root.traverseVisible(node=>{
        const mesh=node as THREE.Mesh;if(!mesh.isMesh||Array.isArray(mesh.material))return;
        const low=this.replacements.get(mesh.material);if(!low)return;
        this.bindings.push({mesh,full:mesh.material,low});mesh.material=low;
      });
    }else{
      for(const b of this.bindings)if(b.mesh.material===b.low)b.mesh.material=b.full;
      this.bindings.length=0;
    }
    this.active=active;return true;
  }
  dispose(){this.setActive(false);this.replacements.forEach(m=>m.dispose());}
}
