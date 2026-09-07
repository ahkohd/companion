export function releaseVersion(current, tags, bump, override = '') {
  const valid = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!valid.test(current)) throw Error('Invalid package version');
  if (!['patch', 'minor', 'major'].includes(bump)) throw Error('Invalid version bump');
  const versions = [current, ...tags.map(t => t.replace(/^v/, '').replace(/-beta$/, '')).filter(t => valid.test(t))];
  versions.sort((a, b) => {
    const x = a.split('.').map(Number), y = b.split('.').map(Number);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  if (override) {
    if (!valid.test(override)) throw Error('Exact version must be numeric major.minor.patch');
    return override;
  }
  const parts = versions.at(-1).split('.').map(Number);
  const index = ['major', 'minor', 'patch'].indexOf(bump);
  parts[index]++;
  for (let i = index + 1; i < 3; i++) parts[i] = 0;
  return parts.join('.');
}
