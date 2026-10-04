import fs from 'node:fs';
import path from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';

const projectRoot = path.resolve(import.meta.dirname, '..');
const manifestPath = path.join(projectRoot, 'public', 'models', 'assembly-manifest.json');
const glbPath = path.join(projectRoot, 'public', 'models', 'wind-turbine-cad.glb');
const viewerSourcePath = path.join(projectRoot, 'src', 'main.ts');
const outputDirectory = path.join(projectRoot, 'output', 'source-audit');

function readGlbJson(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(20);
    fs.readSync(fd, header, 0, header.length, 0);
    if (header.readUInt32LE(0) !== 0x46546c67) throw new Error('Not a GLB file.');
    const jsonLength = header.readUInt32LE(12);
    const jsonType = header.readUInt32LE(16);
    if (jsonType !== 0x4e4f534a) throw new Error('First GLB chunk is not JSON.');
    const jsonBuffer = Buffer.alloc(jsonLength);
    fs.readSync(fd, jsonBuffer, 0, jsonLength, 20);
    return JSON.parse(jsonBuffer.toString('utf8').replace(/[\u0000 ]+$/u, ''));
  } finally {
    fs.closeSync(fd);
  }
}

function leafName(name = '') {
  return name.split('/').at(-1) ?? name;
}

function canonicalName(name = '') {
  // SolidWorks' GLB exporter collapses repeated default instance suffixes
  // (for example "part-1-1" becomes "part-1") without changing identity.
  return leafName(name).replace(/(?:-1)+$/u, '');
}

function nodeLocalMatrix(node) {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3(...(node.translation ?? [0, 0, 0])),
    new Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
    new Vector3(...(node.scale ?? [1, 1, 1])),
  );
}

function matrixFromSolidWorks(values, transposeRotation) {
  if (!Array.isArray(values) || values.length < 13) return new Matrix4();
  const scale = Number(values[12] || 1);
  const [a0, a1, a2, a3, a4, a5, a6, a7, a8, tx, ty, tz] = values.map(Number);
  const matrix = transposeRotation
    ? [a0, a3, a6, 0, a1, a4, a7, 0, a2, a5, a8, 0, tx, ty, tz, 1]
    : [a0, a1, a2, 0, a3, a4, a5, 0, a6, a7, a8, 0, tx, ty, tz, 1];
  matrix[0] *= scale; matrix[1] *= scale; matrix[2] *= scale;
  matrix[4] *= scale; matrix[5] *= scale; matrix[6] *= scale;
  matrix[8] *= scale; matrix[9] *= scale; matrix[10] *= scale;
  return new Matrix4().fromArray(matrix);
}

function maxMatrixError(left, right) {
  let maximum = 0;
  for (let index = 0; index < 16; index += 1) {
    maximum = Math.max(maximum, Math.abs(left.elements[index] - right.elements[index]));
  }
  return maximum;
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const gltf = readGlbJson(glbPath);
const sourceComponents = manifest.components;
const gltfNodes = gltf.nodes;
const componentNodes = gltfNodes.slice(1);

const gltfParents = new Array(gltfNodes.length).fill(-1);
gltfNodes.forEach((node, parentIndex) => {
  (node.children ?? []).forEach((childIndex) => { gltfParents[childIndex] = parentIndex; });
});

const worldMatrices = new Array(gltfNodes.length);
function worldMatrix(index) {
  if (worldMatrices[index]) return worldMatrices[index];
  const local = nodeLocalMatrix(gltfNodes[index]);
  const parent = gltfParents[index];
  worldMatrices[index] = parent >= 0 ? worldMatrix(parent).clone().multiply(local) : local;
  return worldMatrices[index];
}
gltfNodes.forEach((_, index) => worldMatrix(index));

const nameMismatches = [];
const parentMismatches = [];
const suppressedComponents = [];
const missingMeshComponents = [];
const componentReconciliation = [];

for (let index = 0; index < sourceComponents.length; index += 1) {
  const source = sourceComponents[index];
  const target = componentNodes[index];
  if (!target || canonicalName(source.name) !== canonicalName(target.name)) {
    nameMismatches.push({ index, source: source.name, glb: target?.name ?? null });
  }
  const glbIndex = index + 1;
  const parentIndex = gltfParents[glbIndex];
  const targetParent = parentIndex >= 0 ? gltfNodes[parentIndex] : null;
  const expectedParent = source.parent ? canonicalName(source.parent) : null;
  const actualParent = targetParent && parentIndex !== 0 ? canonicalName(targetParent.name) : null;
  const nameMatches = Boolean(target) && canonicalName(source.name) === canonicalName(target.name);
  const parentMatches = expectedParent === actualParent;
  if (expectedParent !== actualParent) {
    parentMismatches.push({ index, component: source.name, sourceParent: source.parent, glbParent: targetParent?.name ?? null });
  }
  if (source.suppressed) suppressedComponents.push(source.name);
  if (target && target.mesh === undefined && !(target.children?.length)) missingMeshComponents.push(source.name);
  componentReconciliation.push({
    sourceIndex: index,
    glbNodeIndex: target ? index + 1 : null,
    sourceName: source.name,
    glbName: target?.name ?? null,
    sourceParent: source.parent ?? null,
    glbParent: targetParent && parentIndex !== 0 ? targetParent.name : null,
    depth: source.depth,
    suppressed: Boolean(source.suppressed),
    nameMatches,
    parentMatches,
    status: nameMatches && parentMatches ? 'MATCH' : 'MISMATCH',
  });
}

const groupTransformRows = [];
for (let index = 0; index < sourceComponents.length; index += 1) {
  const source = sourceComponents[index];
  const target = componentNodes[index];
  if (!target?.children?.length || !source.transform?.length) continue;
  const targetWorld = worldMatrices[index + 1];
  const directError = maxMatrixError(matrixFromSolidWorks(source.transform, false), targetWorld);
  const transposedError = maxMatrixError(matrixFromSolidWorks(source.transform, true), targetWorld);
  groupTransformRows.push({
    component: source.name,
    error: Math.min(directError, transposedError),
    convention: directError <= transposedError ? 'direct' : 'transposed',
  });
}

const dominantConvention = groupTransformRows.filter((row) => row.convention === 'direct').length >= groupTransformRows.length / 2
  ? 'direct'
  : 'transposed';
const checkedTransforms = groupTransformRows.filter((row) => row.convention === dominantConvention);
const transformTolerance = 1e-4;
const transformMismatches = checkedTransforms.filter((row) => row.error > transformTolerance);

const routeCategories = {
  cable: /电缆|电线|线束|动力线|信号线/i,
  cableTray: /桥架|线槽|电缆夹|电缆固定/i,
  hydraulicLubrication: /液压|润滑|油管|油路|油泵|油箱|过滤器/i,
  cooling: /冷却|水管|水路|水泵|散热/i,
  pipeAndFitting: /软管|硬管|管路|管夹|管接头|接头|法兰|HDPE管|PE管/i,
};
const routes = {};
for (const [category, pattern] of Object.entries(routeCategories)) {
  routes[category] = sourceComponents
    .map((component, index) => ({ component, index }))
    .filter(({ component }) => pattern.test(leafName(component.name)))
    .map(({ component, index }) => {
      const glbNode = componentNodes[index];
      const glbIndex = index + 1;
      const parentIndex = gltfParents[glbIndex];
      const glbParent = parentIndex > 0 ? gltfNodes[parentIndex] : null;
      const nameMatches = Boolean(glbNode) && canonicalName(component.name) === canonicalName(glbNode.name);
      const parentMatches = canonicalName(component.parent ?? '') === canonicalName(glbParent?.name ?? '');
      return {
        index,
        name: component.name,
        parent: component.parent,
        transform: component.transform,
        glbName: glbNode?.name ?? null,
        glbParent: glbParent?.name ?? null,
        sourceToGlbMatches: nameMatches && parentMatches,
      };
    });
}

const viewerSource = fs.readFileSync(viewerSourcePath, 'utf8');
const auxiliaryPatternSource = viewerSource.match(/const AUXILIARY_PATTERN = \/(.+)\/i;/u)?.[1];
if (!auxiliaryPatternSource) throw new Error('Could not read AUXILIARY_PATTERN from src/main.ts.');
const presentationAuxiliaryPattern = new RegExp(auxiliaryPatternSource, 'i');
const routePresentationVisibility = Object.fromEntries(Object.entries(routes).map(([category, rows]) => {
  const hiddenComponents = rows.filter((row) => presentationAuxiliaryPattern.test(row.name));
  return [category, {
    sourceCount: rows.length,
    visibleByPresentationRuleCount: rows.length - hiddenComponents.length,
    hiddenByPresentationRuleCount: hiddenComponents.length,
    hiddenComponents: hiddenComponents.map((row) => row.name),
  }];
}));

const report = {
  generatedAt: new Date().toISOString(),
  source: {
    title: manifest.title,
    componentCount: sourceComponents.length,
    suppressedCount: suppressedComponents.length,
  },
  glb: {
    nodeCount: gltfNodes.length,
    componentNodeCount: componentNodes.length,
    meshCount: gltf.meshes?.length ?? 0,
    materialCount: gltf.materials?.length ?? 0,
    animationCount: gltf.animations?.length ?? 0,
  },
  hierarchyAudit: {
    countMatches: sourceComponents.length === componentNodes.length,
    nameMismatchCount: nameMismatches.length,
    parentMismatchCount: parentMismatches.length,
    nameMismatches,
    parentMismatches,
    missingRenderableLeafCount: missingMeshComponents.length,
    missingRenderableLeaves: missingMeshComponents,
  },
  transformAudit: {
    scope: 'Assembly/group nodes only. Leaf mesh nodes are recentered and uniformly scaled by the SolidWorks GLB exporter.',
    convention: dominantConvention,
    tolerance: transformTolerance,
    checkedCount: checkedTransforms.length,
    mismatchCount: transformMismatches.length,
    maximumError: checkedTransforms.reduce((maximum, row) => Math.max(maximum, row.error), 0),
    mismatches: transformMismatches,
  },
  routeAudit: Object.fromEntries(Object.entries(routes).map(([category, rows]) => [category, {
    count: rows.length,
    matchedGlbCount: rows.filter((row) => row.sourceToGlbMatches).length,
    mismatchCount: rows.filter((row) => !row.sourceToGlbMatches).length,
    components: rows,
  }])),
  presentationFilterAudit: {
    ruleSource: 'src/main.ts:AUXILIARY_PATTERN',
    routes: routePresentationVisibility,
  },
  sourceCapabilities: {
    availableFields: [...new Set(sourceComponents.flatMap((component) => Object.keys(component)))].sort(),
    mateDefinitionsPresent: false,
    electricalNetlistPresent: false,
    hydraulicSchematicPresent: false,
    controlLogicPresent: false,
  },
  limitations: [
    'Parasolid/GLB provides geometry, hierarchy, and transforms but no SolidWorks mate definitions.',
    'No electrical netlist, cable pin-to-pin connectivity, hydraulic schematic, or control logic is present in the supplied source.',
    'Gearbox and generator internals are not separately identifiable subassemblies in the supplied source.',
  ],
};

fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'source-assembly-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(fileName, rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const body = [headers, ...rows.map((row) => headers.map((header) => row[header]))]
    .map((row) => row.map(csvCell).join(','))
    .join('\n');
  fs.writeFileSync(path.join(outputDirectory, fileName), `\ufeff${body}\n`);
}

writeCsv('component-reconciliation.csv', componentReconciliation);
writeCsv('route-inventory.csv', Object.entries(report.routeAudit).flatMap(([category, audit]) => (
  audit.components.map((component) => ({ category, ...component }))
)));

const markdown = `# 风机源文件装配审计\n\n`
  + `- 源装配节点：${report.source.componentCount}\n`
  + `- GLB 对应装配节点：${report.glb.componentNodeCount}\n`
  + `- 数量一致：${report.hierarchyAudit.countMatches ? '是' : '否'}\n`
  + `- 名称顺序差异：${report.hierarchyAudit.nameMismatchCount}\n`
  + `- 父级层级差异：${report.hierarchyAudit.parentMismatchCount}\n`
  + `- 无几何且无子级的 GLB 叶节点：${report.hierarchyAudit.missingRenderableLeafCount}\n`
  + `- 已校验装配级变换：${report.transformAudit.checkedCount}\n`
  + `- 超出 ${report.transformAudit.tolerance} 容差的装配级变换：${report.transformAudit.mismatchCount}\n`
  + `- 最大装配级矩阵误差：${report.transformAudit.maximumError}\n\n`
  + `## 走线实体\n\n`
  + `| 类别 | 源文件实体 | GLB逐项匹配 | 差异 |\n|---|---:|---:|---:|\n`
  + Object.entries(report.routeAudit).map(([category, value]) => `| ${category} | ${value.count} | ${value.matchedGlbCount} | ${value.mismatchCount} |`).join('\n')
  + `\n\n## 展示过滤对走线的影响\n\n`
  + `| 类别 | 源文件实体 | 仍显示 | 被隐藏 |\n|---|---:|---:|---:|\n`
  + Object.entries(report.presentationFilterAudit.routes).map(([category, value]) => `| ${category} | ${value.sourceCount} | ${value.visibleByPresentationRuleCount} | ${value.hiddenByPresentationRuleCount} |`).join('\n')
  + `\n\n## 源文件能力边界\n\n`
  + report.limitations.map((item) => `- ${item}`).join('\n')
  + `\n`;
fs.writeFileSync(path.join(outputDirectory, 'source-assembly-audit.md'), markdown);

console.log(JSON.stringify({
  componentCount: report.source.componentCount,
  glbComponentNodeCount: report.glb.componentNodeCount,
  nameMismatchCount: report.hierarchyAudit.nameMismatchCount,
  parentMismatchCount: report.hierarchyAudit.parentMismatchCount,
  missingRenderableLeafCount: report.hierarchyAudit.missingRenderableLeafCount,
  checkedTransforms: report.transformAudit.checkedCount,
  transformMismatchCount: report.transformAudit.mismatchCount,
  maximumTransformError: report.transformAudit.maximumError,
  routeCounts: Object.fromEntries(Object.entries(report.routeAudit).map(([key, value]) => [key, {
    source: value.count,
    matchedGlb: value.matchedGlbCount,
    mismatch: value.mismatchCount,
  }])),
  routePresentationHiddenCounts: Object.fromEntries(Object.entries(report.presentationFilterAudit.routes).map(([key, value]) => [key, value.hiddenByPresentationRuleCount])),
}, null, 2));
