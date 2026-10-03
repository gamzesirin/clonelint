// Minimal version-range matching covering what npm (engines), Composer
// (require.php) and Python (requires-python) ranges look like in practice.

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** First x.y[.z] found in arbitrary text, e.g. "PHP 8.2.4 (cli)" → [8, 2, 4]. */
export function parseVersion(text) {
  const m = String(text).match(/(\d+)\.(\d+)(?:\.(\d+))?/) ?? String(text).match(/^\s*v?(\d+)\s*$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

// "18", "18.x", "8.2.*", "20.11.0" → [major, minor|null, patch|null]
function parsePartial(text) {
  const m = text.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].map((p) => (p === undefined || /[xX*]/.test(p) ? null : Number(p)));
  if (parts[1] === null) parts[2] = null;
  return parts;
}

function testComparator(version, comparator, looseTilde) {
  const m = comparator.match(/^(~=|~>|~|>=|<=|>|<|===|==|=|!=|\^)?v?(.+)$/);
  if (!m) return null;
  const op = m[1] ?? '';
  if (op === '!=') return true;
  const partial = parsePartial(m[2]);
  if (!partial) return null;
  const [major, minor, patch] = partial;
  if (major === null) return true;

  const lower = [major, minor ?? 0, patch ?? 0];
  // Exclusive upper bound of the partial itself; null when fully specified.
  const upper = minor === null ? [major + 1, 0, 0] : patch === null ? [major, minor + 1, 0] : null;
  const within = (top) => cmp(version, lower) >= 0 && cmp(version, top) < 0;

  switch (op) {
    case '>=':
      return cmp(version, lower) >= 0;
    case '>':
      return upper ? cmp(version, upper) >= 0 : cmp(version, lower) > 0;
    case '<':
      return cmp(version, lower) < 0;
    case '<=':
      return upper ? cmp(version, upper) < 0 : cmp(version, lower) <= 0;
    case '^':
      if (major > 0 || minor === null) return within([major + 1, 0, 0]);
      if (minor > 0 || patch === null) return within([0, minor + 1, 0]);
      return within([0, 0, patch + 1]);
    case '~':
    case '~=':
    case '~>':
      // npm: ~1.2 → <1.3. Composer/Python/Ruby: ~1.2 → <2.0.
      if (minor === null || (patch === null && (looseTilde || op !== '~'))) return within([major + 1, 0, 0]);
      return within([major, minor + 1, 0]);
    default:
      return upper ? within(upper) : cmp(version, lower) === 0;
  }
}

/**
 * @param {string} version installed version
 * @param {string} range   required range
 * @param {{ looseTilde?: boolean }} [options]
 * @returns {boolean | null} null when the range cannot be interpreted
 */
export function satisfies(version, range, { looseTilde = false } = {}) {
  const v = parseVersion(version);
  if (!v) return null;
  const normalized = String(range)
    .trim()
    .replace(/(\S+)\s+-\s+(\S+)/g, '>=$1 <=$2')
    .replace(/([<>=~^!]+)\s+/g, '$1');
  if (!normalized) return null;

  let unknown = false;
  for (const alternative of normalized.split(/\s*\|\|?\s*/)) {
    const comparators = alternative.split(/[\s,]+/).filter(Boolean);
    if (!comparators.length) continue;
    const verdicts = comparators.map((c) => testComparator(v, c, looseTilde));
    if (verdicts.includes(null)) unknown = true;
    else if (verdicts.every(Boolean)) return true;
  }
  return unknown ? null : false;
}
