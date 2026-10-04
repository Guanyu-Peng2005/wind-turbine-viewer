import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const TAU = 2 * Math.PI;

function extrusion(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width, steps: 1, curveSegments: 32, bevelEnabled: bevel > 0,
    bevelSegments: 3, bevelThickness: bevel, bevelSize: bevel,
  });
  geometry.translate(0, 0, -width / 2);
  geometry.rotateY(Math.PI / 2); geometry.rotateX(Math.PI / 2);
  return geometry;
}

function circularHole(x: number, y: number, radius: number): THREE.Path {
  const hole = new THREE.Path(); hole.absarc(x, y, radius, 0, TAU, true); return hole;
}

export function socketCap(radius: number, width: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(); shape.absarc(0, 0, radius, 0, TAU, false);
  const hex = new THREE.Path();
  for (let i = 0; i <= 6; i++) {
    const a = -TAU * i / 6, r = radius * 0.46;
    if (i === 0) hex.moveTo(r * Math.cos(a), r * Math.sin(a));
    else hex.lineTo(r * Math.cos(a), r * Math.sin(a));
  }
  hex.closePath(); shape.holes.push(hex);
  const cap = new THREE.Mesh(extrusion(shape, width, radius * 0.06), material);
  cap.name = '内六角紧固帽'; cap.userData.detail = { type: 'socket', socketSides: 6, bore: true };
  return cap;
}

/** A continuous three-lobed casting, not three intersecting rectangular bars.
 * Axial frame: X. Plate holes: centre + 3 pin seats + 3 lightening windows.
 * The plate remains behind the gears, at the original carrier support station.
 */
export function carrierWeb(orbit: number, offset: number, material: THREE.Material): THREE.Mesh {
  const boss = 0.075, valleyRadius = 0.13;
  const shape = new THREE.Shape();
  const local = (r: number, t: number, a: number) => new THREE.Vector2(r * Math.cos(a) - t * Math.sin(a), r * Math.sin(a) + t * Math.cos(a));
  shape.moveTo(orbit, -boss);
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3, next = (i + 1) * TAU / 3, middle = a + Math.PI / 3;
    shape.absarc(orbit * Math.cos(a), orbit * Math.sin(a), boss, a - Math.PI / 2, a + Math.PI / 2, false);
    const c1 = local(orbit * 0.62, boss * 0.8, a);
    const c2 = new THREE.Vector2(0.15 * Math.cos(middle - 0.3), 0.15 * Math.sin(middle - 0.3));
    const v = new THREE.Vector2(valleyRadius * Math.cos(middle), valleyRadius * Math.sin(middle));
    shape.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, v.x, v.y);
    const c3 = new THREE.Vector2(0.15 * Math.cos(middle + 0.3), 0.15 * Math.sin(middle + 0.3));
    const c4 = local(orbit * 0.62, -boss * 0.8, next), end = local(orbit, -boss, next);
    shape.bezierCurveTo(c3.x, c3.y, c4.x, c4.y, end.x, end.y);
  }
  shape.closePath();
  shape.holes.push(circularHole(0, 0, 0.065));
  for (let i = 0; i < 3; i++) {
    const a = TAU * i / 3;
    shape.holes.push(circularHole(orbit * Math.cos(a), orbit * Math.sin(a), 0.026));
    const window = new THREE.Path();
    window.absellipse(orbit * 0.56 * Math.cos(a), orbit * 0.56 * Math.sin(a), orbit * 0.14, 0.016, 0, TAU, true, a);
    shape.holes.push(window);
  }
  const geometry = extrusion(shape, 0.04, 0.002);
  const web = new THREE.Mesh(geometry, material);
  web.position.x = -offset;
  web.name = '行星架支臂';
  web.userData.detail = { type: 'continuous-cast-web', lobes: 3, holes: 7, lighteningWindows: 3, bevelMeters: 0.002, outline: shape.getPoints(32).map(p => p.toArray()), windows: shape.holes.map(h => h.getPoints(32).map(p => p.toArray())) };
  web.userData.attachment = { parentSocket: 'carrier-input-hub', contact: 'overlap', embedDepth: 0.008, frame: 'carrier-local X axis' };
  return web;
}

export function roundedConductor(length: number, radial: number, tangential: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(length, radial, tangential, 2, Math.min(radial, tangential) * 0.22), material);
  mesh.name = '圆角导体'; return mesh;
}
