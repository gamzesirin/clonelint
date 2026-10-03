const colorEnabled = () => {
  const force = process.env.FORCE_COLOR;
  if (process.env.NO_COLOR || force === '0' || force === 'false') return false;
  return Boolean(force || process.stdout.isTTY);
};

// Legacy Windows consoles render the symbols as boxes.
const unicodeEnabled = () =>
  process.platform !== 'win32' || Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.TERM || process.env.CI);

function palette() {
  const paint = (code) => (text) => (colorEnabled() ? `\x1b[${code}m${text}\x1b[0m` : text);
  return { green: paint(32), yellow: paint(33), red: paint(31), dim: paint(2), bold: paint(1) };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderFixes(applied) {
  const c = palette();
  const lines = applied.map((fix) => (fix.ok ? `  ${c.green('fixed')}   ${fix.label}` : `  ${c.red('failed')}  ${fix.label}: ${fix.error}`));
  return ['', ...lines].join('\n');
}

export function renderText(report) {
  const c = palette();
  const unicode = unicodeEnabled();
  const marks = {
    ok: c.green(unicode ? '✔' : '[ok]'),
    warn: c.yellow(unicode ? '▲' : '[warn]'),
    fail: c.red(unicode ? '✖' : '[fail]'),
  };
  const arrow = unicode ? '→' : '->';
  const lines = ['', `  ${c.bold('clonelint')} ${c.dim(`${unicode ? '·' : '-'} ${report.project} (${report.cwd})`)}`];

  if (!report.groups.length) {
    lines.push('', '  Nothing to check: no recognised project files in this directory.', '');
    return lines.join('\n');
  }

  for (const group of report.groups) {
    lines.push('', `  ${c.bold(group.title)}`);
    for (const result of group.results) {
      lines.push(`    ${marks[result.status]} ${result.message}`);
      if (result.hint) lines.push(c.dim(`      ${arrow} ${result.hint}`));
    }
  }

  const { ok, warn, fail, fixable } = report.summary;
  const summary = [c.green(`${ok} passed`)];
  if (warn) summary.push(c.yellow(plural(warn, 'warning')));
  if (fail) summary.push(c.red(`${fail} failed`));
  lines.push('', `  ${summary.join(', ')}`);
  if (fixable) lines.push(c.dim(`  ${plural(fixable, 'problem')} can be fixed automatically: clonelint --fix`));
  lines.push('');
  return lines.join('\n');
}

export function renderJson(report, applied) {
  const groups = report.groups.map((group) => ({
    ...group,
    results: group.results.map(({ fix, ...result }) => ({ ...result, fixable: Boolean(fix) })),
  }));
  return JSON.stringify({ ...report, groups, ...(applied && { applied }) }, null, 2);
}
