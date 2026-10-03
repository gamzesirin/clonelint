const TEMPLATES = ['.env.example', '.env.sample', '.env.template', '.env.dist', '.env.local.example'];
// Later files override earlier ones, mirroring how most frameworks load them.
const ENV_FILES = ['.env', '.env.local', '.env.development', '.env.development.local'];

function closingQuote(body, quote) {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && quote === '"') i++;
    else if (body[i] === quote) return i;
  }
  return -1;
}

/** @returns {Map<string, { value: string, raw: string }>} */
export function parseDotenv(text) {
  const vars = new Map();
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=(\s*)(.*)$/);
    if (!m) continue;
    const [, key, gap, rest] = m;
    let raw = lines[i];
    let value;
    if (/^["'`]/.test(rest)) {
      // Quoted values may span several lines.
      const quote = rest[0];
      let body = rest.slice(1);
      let end = closingQuote(body, quote);
      let last = i;
      while (end === -1 && last + 1 < lines.length) {
        last++;
        body += `\n${lines[last]}`;
        end = closingQuote(body, quote);
      }
      if (end === -1) {
        // The quote is never closed: keep the value on its own line instead
        // of swallowing every variable that follows.
        value = rest.trim();
      } else {
        value = body.slice(0, end);
        raw = lines.slice(i, last + 1).join('\n');
        i = last;
      }
    } else if (gap && rest.startsWith('#')) {
      value = '';
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    vars.set(key, { value, raw });
  }
  return vars;
}

/**
 * Everything the checks need to know about the project's env files.
 * `values` is what the app will most likely see: env files layered over
 * the template's defaults.
 */
export function loadEnv(ctx) {
  if (ctx.cache.has('env')) return ctx.cache.get('env');

  const templateFile = TEMPLATES.find(ctx.exists) ?? null;
  const template = templateFile ? parseDotenv(ctx.read(templateFile)) : new Map();
  const files = ENV_FILES.filter(ctx.exists);
  const vars = new Map();
  for (const file of files) for (const [key, entry] of parseDotenv(ctx.read(file))) vars.set(key, entry);

  const values = new Map();
  for (const [key, entry] of template) values.set(key, entry.value);
  for (const [key, entry] of vars) values.set(key, entry.value);

  const target = templateFile === '.env.local.example' ? '.env.local' : '.env';
  const env = { templateFile, template, files, vars, values, target };
  ctx.cache.set('env', env);
  return env;
}
