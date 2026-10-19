type AssemblyMember = { system: string; cluster: string };

/** Open the first meaningful child level; never manufacture children for a solid part. */
export function initialDisassemblyScope(entries: readonly AssemblyMember[], requested = '') {
  const members = entries.filter(entry => entry.system === requested);
  const system = members.length ? requested : '';
  const clusters = new Set(members.map(entry => entry.cluster));
  const cluster = members.length > 1 && clusters.size === 1 ? members[0].cluster : null;
  return { system, cluster };
}
