import fs from 'node:fs';
import path from 'node:path';
import { normalizePath } from 'vite';

const VITE_FS_PREFIX = '/@fs/';

// Strip Windows verbatim path prefixes (\\?\ and //?/, including UNC) so Vite
// doesn't try to load literal "/@fs//?/" paths on Windows.
const WINDOWS_NAMESPACE_PREFIXES: Array<[RegExp, string]> = [
  [/^\\\\\?\\UNC\\/, '\\\\'],
  [/^\\\\\?\\/, ''],
  [/^\/\/\?\/UNC\//, '//'],
  [/^\/\/\?\//, ''],
];

const stripWindowsNamespace = (value: string) => {
  let result = value;
  for (const [pattern, replacement] of WINDOWS_NAMESPACE_PREFIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

export const normalizeViteId = (id: string) => {
  if (process.platform !== 'win32') return id;

  const prefix = id.startsWith(VITE_FS_PREFIX) ? VITE_FS_PREFIX : '';
  const rawPath = stripWindowsNamespace(prefix ? id.slice(prefix.length) : id);
  if (!path.win32.isAbsolute(rawPath)) return id;

  try {
    const resolvedPath = path.win32.resolve(rawPath);
    const realPath = stripWindowsNamespace(fs.realpathSync(resolvedPath));
    return prefix ? `${prefix}${normalizePath(realPath)}` : realPath;
  } catch {
    return id;
  }
};
