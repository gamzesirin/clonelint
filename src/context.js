import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_FILE = '.clonelint.json';

/** Read-only view of the project directory shared by all checks. */
export function createContext(cwd) {
  const resolve = (...parts) => path.join(cwd, ...parts);
  const read = (file) => {
    try {
      return fs.readFileSync(resolve(file), 'utf8').replace(/^﻿/, '');
    } catch {
      return null;
    }
  };
  // Files that exist but are not valid JSON; reported by diagnose().
  const invalid = new Map();
  const json = (file) => {
    const text = read(file);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      invalid.set(file, err.message);
      return null;
    }
  };
  const exists = (file) => fs.existsSync(resolve(file));
  const mtime = (file) => {
    try {
      return fs.statSync(resolve(file)).mtimeMs;
    } catch {
      return null;
    }
  };

  const pkg = json('package.json');
  // Parsed up front so a broken file is reported whatever --only/--skip select.
  json('composer.json');
  const declared = json(CONFIG_FILE) ?? pkg?.clonelint;
  const config = declared && typeof declared === 'object' && !Array.isArray(declared) ? declared : {};

  return {
    cwd,
    resolve,
    read,
    json,
    exists,
    mtime,
    invalid,
    config,
    projectName: pkg?.name ?? path.basename(cwd),
    cache: new Map(),
  };
}
