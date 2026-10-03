// A check returns a list of results. `fix` is optional: { label, run } where
// run() applies the fix and throws if it could not.

export const ok = (message) => ({ status: 'ok', message });
export const warn = (message, hint, fix) => ({ status: 'warn', message, hint, fix });
export const fail = (message, hint, fix) => ({ status: 'fail', message, hint, fix });

/** Config values may be written as a single item instead of a list. */
export const toArray = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value : [value]);

export function list(items, max = 6) {
  const shown = items.slice(0, max).join(', ');
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}
