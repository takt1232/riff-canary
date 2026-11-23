// The installed-version text shown in Settings > About and the settings footer. Pure (no DOM, no
// platform APIs), so the rules can be tested in Node: test/version-info.test.js.
(function (root) {
  const shortSha = (sha) => {
    const s = String(sha || '').trim();
    return !s || s === 'dev' ? '' : s.slice(0, 7);
  };

  // { version, run, sha } -> what About shows and the small footer tag.
  // A local build has sha "dev": it gets the version but no build or commit.
  function format({ version = '', run = 0, sha = '' } = {}) {
    const v = String(version || '').trim();
    const build = Number(run) > 0 ? Math.floor(Number(run)) : 0;
    const commit = shortSha(sha);
    const detail = [];
    // Build and commit belong to a stamped (official) build; local builds have sha "dev".
    if (commit) {
      if (build) detail.push(`build ${build}`);
      detail.push(commit);
    }
    const detailText = detail.join(' \u00b7 ');
    const about = v
      ? [`Version ${v}`, detailText].filter(Boolean).join(' \u00b7 ')
      : detail.length ? `Development build \u00b7 ${detailText}` : 'Development build';
    return { version: v, build, commit, detail: detailText, about, tag: v ? `v${v}` : 'dev' };
  }

  const api = { format, shortSha };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CanaryVersion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
