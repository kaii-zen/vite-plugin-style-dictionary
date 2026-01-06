import fs from 'node:fs';
import path from 'node:path';
import { normalizePath } from 'vite';

const VITE_FS_PREFIX = '/@fs/';

const stripWindowsNamespace = (value: string) =>
  value
    .replace(/^\\\\\?\\UNC\\/, '\\\\')
    .replace(/^\\\\\?\\/, '')
    .replace(/^\/\/\?\/UNC\//, '//')
    .replace(/^\/\/\?\//, '');

export const normalizeViteId = (id: string) => {
  if (process.platform !== 'win32') return id;

  const hasFsPrefix = id.startsWith(VITE_FS_PREFIX);
  const rawPath = stripWindowsNamespace(
    hasFsPrefix ? id.slice(VITE_FS_PREFIX.length) : id,
  );
  if (!path.win32.isAbsolute(rawPath)) return id;

  try {
    const resolvedPath = path.win32.resolve(rawPath);
    const realPath = stripWindowsNamespace(fs.realpathSync(resolvedPath));
    return hasFsPrefix
      ? `${VITE_FS_PREFIX}${normalizePath(realPath)}`
      : realPath;
  } catch {
    return id;
  }
};
