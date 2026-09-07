export function releaseChannel(version) {
  if (/^\d+\.\d+\.\d+$/.test(version)) return 'latest';
  const match = /^\d+\.\d+\.\d+-(beta|next)\.\d+$/.exec(version);
  if (!match) throw new Error('Use a stable version or a beta.N / next.N prerelease.');
  return match[1];
}
