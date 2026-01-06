import fs from 'node:fs';
import path from 'node:path';
import { normalizePath } from 'vite';

const VITE_FS_PREFIX = '/@fs/';

// Strip Windows verbatim path prefixes (\\?\ and //?/, including UNC) so Vite
// doesn't try to load literal "/@fs//?/" paths on Windows.
const WINDOWS_NAMESPACE_PREFIXES: Array<[RegExp, string]> = [
  [/^\\\\\?\\UNC\\/, '\\\\'],
  [/^\\\?\\UNC\\/, '\\\\'],
  [/^\\\\\?\\/, ''],
  [/^\\\?\\/, ''],
  [/^\/+\?\/UNC\//, '//'],
  [/^\/+\?\//, ''],
];

const toPosixPath = (value: string) => value.replace(/\\/g, '/');

const normalizeVitePath = (value: string, platform: NodeJS.Platform) =>
  platform === 'win32'
    ? path.posix.normalize(toPosixPath(value))
    : normalizePath(value);

const stripWindowsNamespace = (value: string) => {
  let result = value;
  for (const [pattern, replacement] of WINDOWS_NAMESPACE_PREFIXES) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

type RealpathSync = (value: string) => string;

const defaultRealpathSync = fs.realpathSync as RealpathSync;

export const normalizeViteIdForPlatform = (
  id: string,
  platform: NodeJS.Platform,
  realpathSync: RealpathSync = defaultRealpathSync,
) => {
  if (platform !== 'win32') return id;

  const prefix = id.startsWith(VITE_FS_PREFIX) ? VITE_FS_PREFIX : '';
  const rawPath = stripWindowsNamespace(prefix ? id.slice(prefix.length) : id);
  if (!path.win32.isAbsolute(rawPath)) return id;

  try {
    const resolvedPath = path.win32.resolve(rawPath);
    const realPath = stripWindowsNamespace(realpathSync(resolvedPath));
    return prefix ? `${prefix}${normalizeVitePath(realPath, platform)}` : realPath;
  } catch {
    return id;
  }
};

export const normalizeViteId = (id: string) =>
  normalizeViteIdForPlatform(id, process.platform, fs.realpathSync);
