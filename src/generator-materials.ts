import * as THREE from 'three';

/** Source-CAD surface finish only; visibility, framing and lighting belong to the assembly. */
export class GeneratorMaterials {
  private materials = new Map<string, THREE.MeshPhysicalMaterial>();
  private environment: THREE.WebGLRenderTarget | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {}

  applyTo(owner: THREE.Object3D): void {
    owner.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(source => this.material(mesh.name, source))
        : this.material(mesh.name, mesh.material);
    });
  }

  private material(meshName: string, source: THREE.Material): THREE.MeshPhysicalMaterial {
    const key = `${meshName}/${source.uuid}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const original = source as THREE.MeshStandardMaterial;
    const painted = meshName === 'mesh_148_2' || meshName === 'mesh_148_4';
    const yellow = meshName === 'mesh_148';
    if (!this.environment) this.environment = this.createEnvironment();
    const material = new THREE.MeshPhysicalMaterial({
      name: `Generator surface · ${meshName}`,
      color: original.color ?? 0xc6d0d3,
      metalness: painted || yellow ? 0.08 : 0.96,
      roughness: painted ? 0.34 : yellow ? 0.35 : 0.3,
      clearcoat: painted || yellow ? 0.22 : 0,
      clearcoatRoughness: 0.32,
      envMap: this.environment.texture,
      envMapIntensity: painted ? 0.7 : 1.15,
      envMapRotation: new THREE.Euler(0, 1.2, 0),
      opacity: source.opacity,
      transparent: source.transparent,
      depthWrite: source.depthWrite,
      side: source.side,
      clippingPlanes: source.clippingPlanes,
    });
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vCadPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCadPosition = position;');
      shader.fragmentShader = 'varying vec3 vCadPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        float grain = fract(sin(dot(floor(vCadPosition * 1450.0), vec3(12.9898, 78.233, 39.425))) * 43758.5453);
        float filteredGrain = clamp(1.0 - length(fwidth(vCadPosition)) * 1450.0, 0.0, 1.0);
        roughnessFactor += (grain - 0.5) * 0.035 * filteredGrain;
      `);
    };
    material.customProgramCacheKey = () => 'generator-cad-surface-v1';
    this.materials.set(key, material);
    return material;
  }

  private createEnvironment(): THREE.WebGLRenderTarget {
    const environment = new THREE.Scene(); environment.background = new THREE.Color(0x4b5260);
    const panel = (position: [number, number, number], width: number, height: number, intensity: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({
        color: new THREE.Color(1, 0.98, 0.94).multiplyScalar(intensity), side: THREE.DoubleSide,
      }));
      mesh.position.set(...position); mesh.lookAt(0, 0, 0); environment.add(mesh);
    };
    panel([0, 5, 3], 8, 5, 4); panel([5, 1, 0], 3, 7, 3); panel([-4, 2, -3], 2, 7, 5);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(environment, 0.02); pmrem.dispose();
    environment.traverse(object => {
      const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
    });
    return target;
  }

  dispose(): void {
    this.materials.forEach(material => material.dispose());
    this.environment?.dispose();
  }
}
