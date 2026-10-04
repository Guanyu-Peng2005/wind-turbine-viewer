import type { Object3D } from 'three';

const partName=(node:Object3D)=>node.name.split('#').at(-1)??node.name;

/** The source CAD stores the front casting and rear frame as siblings under
 * 机舱座. Its M30 joint hardware lies at their shared flange. Cable trays and
 * guards in that neighbourhood are separate functional parts. */
export function frameAssemblyAttachments(front:Object3D):Object3D[]{
  const base=front.parent;
  if(!base||!/^机舱座(?:-\d+)?$/.test(partName(base)))return [];
  return base.children.filter(node=>node!==front&&(
    /^后机架(?:-\d+)?$/.test(partName(node))
    ||/^(?:螺栓M30×130|垫圈30-300HV)(?:-|$)/.test(partName(node))
  ));
}
