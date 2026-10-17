export function assertLaunch(launch, releases, requirePublished = false) {
  if (!['candidate', 'published'].includes(launch.state) || !/^\d+\.\d+\.\d+$/.test(launch.version) || !/^[a-f\d]{40}$/.test(launch.commit) || !/^\d{4}-\d{2}-\d{2}$/.test(launch.verifiedAt) || !launch.ref) throw new Error('Invalid launch source provenance.');
  if (launch.state === 'candidate') {
    if (launch.date || launch.url) throw new Error('A candidate cannot claim a publication date or release URL.');
    if (requirePublished) throw new Error('Launch blocked: the target must be verified as a published release.');
    return;
  }
  const tag = `v${launch.version}`;
  const expectedUrl = `https://github.com/raiseCatError/notMyShell/releases/tag/${tag}`;
  if (launch.ref !== tag || launch.url !== expectedUrl || launch.date !== releases?.latest.date || releases?.latest.tag !== tag || releases.sourceCommit !== launch.commit || releases.latest.url !== launch.url) throw new Error('Published launch source does not match the verified public release snapshot.');
}
