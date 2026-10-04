import { readFileSync,writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const digest=createHash('sha256').update(readFileSync(new URL('../public/models/wind-turbine-cad.glb',import.meta.url))).digest('hex');
const codeVersion=files=>{
  const hash=createHash('sha256');
  for(const file of files)hash.update(file+'\n'+readFileSync(new URL('../src/'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n'));
  return `sha256:${hash.digest('hex')}`;
};
writeFileSync(new URL('../src/model-identity.json',import.meta.url),JSON.stringify({source:`sha256:${digest}`,
  gearbox:codeVersion(['drivetrain.ts','mechanical-details.ts']),
  generator:codeVersion(['drivetrain.ts','generator-assembly.ts','generator-geometry.ts','generator-bearing.ts','generator-small-parts.ts'])},null,2)+'\n');
