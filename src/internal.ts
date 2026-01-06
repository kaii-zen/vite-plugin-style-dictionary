import { createFilter } from 'vite';
import type { ModuleNode, ViteDevServer } from 'vite';
import type { Config } from 'style-dictionary';
import type { DesignTokens, ParserOptions } from 'style-dictionary/types';
import path from 'node:path';
import { castArray } from 'lodash-es';
import { normalizeViteId } from './path-utils';

const DEFAULT_ENTRY = path.resolve(process.cwd(), 'tokens.ts');
export type TokensLoader = (filePath?: string) => Promise<DesignTokens>;

export async function parseTokenModule(
  { contents: _contents, filePath }: ParserOptions,
  loadTokens: TokensLoader,
): Promise<DesignTokens> {
  const sourceFile = filePath ?? DEFAULT_ENTRY;
  const tokens = await loadTokens(filePath);

  if (!tokens || typeof tokens !== 'object') {
    throw new Error(
      `[style-dictionary] ${sourceFile} must export a default object`,
    );
  }

  return tokens;
}

export function createTokensLoader(
  getServer: () => ViteDevServer | null,
): TokensLoader {
  return async (filePath) => {
    const server = getServer();
    if (!server) {
      throw new Error('[style-dictionary] Vite server is not available');
    }

    const sourceFile = normalizeViteId(filePath ?? DEFAULT_ENTRY);
    const entryFile = await resolveTokenEntry(server, sourceFile);
    const moduleId =
      normalizeViteId(
        entryFile ?? toViteModuleId(server.config.root, sourceFile),
      );
    const module = await server.ssrLoadModule(moduleId);
    return (module?.default ?? module) as DesignTokens;
  };
}

export const normalizeSources = (source?: string[] | string) =>
  source ? castArray(source) : [];

const isGlob = (source: string) => /[*?[\]]/.test(source);

export async function resolveSourceEntries(
  server: ViteDevServer,
  source?: string[] | string,
): Promise<string[]> {
  const sources = normalizeSources(source);
  const { root } = server.config;
  return Promise.all(
    sources.map(async (entry) => {
      if (isGlob(entry)) return entry;
      const absoluteSource = path.isAbsolute(entry)
        ? entry
        : path.join(root, entry);
      const resolved = await resolveTokenEntry(server, absoluteSource);
      return resolved ?? absoluteSource;
    }),
  );
}

export const toAbsoluteGlobs = (root: string, sources: string[]) =>
  sources.map((source) =>
    path.isAbsolute(source) ? source : path.join(root, source),
  );

export async function isRelevantChange(
  server: ViteDevServer,
  sources: string[],
  changedFile: string,
): Promise<boolean> {
  const { root } = server.config;
  const include = createFilter(toAbsoluteGlobs(root, sources));
  if (include(changedFile)) return true;

  const entryFiles = await Promise.all(
    sources.filter((source) => !isGlob(source)).map(async (source) => {
      const absoluteSource = path.isAbsolute(source)
        ? source
        : path.join(root, source);
      const resolved = await resolveTokenEntry(server, absoluteSource);
      return resolved ?? absoluteSource;
    }),
  );
  const entryModules = entryFiles.flatMap((file) =>
    Array.from(server.moduleGraph.getModulesByFile(file) ?? []),
  );
  if (entryModules.length === 0) return false;

  const changedModules = server.moduleGraph.getModulesByFile(changedFile);
  if (!changedModules?.size) return false;

  const tokenGraph = collectModuleGraph(entryModules);
  for (const mod of changedModules) {
    if (tokenGraph.has(mod)) return true;
  }

  return false;
}

function collectModuleGraph(
  queue: ModuleNode[],
  visited: Set<ModuleNode> = new Set<ModuleNode>(),
): Set<ModuleNode> {
  if (queue.length === 0) return visited;

  const [current, ...rest] = queue;
  if (!current || visited.has(current)) {
    return collectModuleGraph(rest, visited);
  }

  const next = [...current.importedModules, ...current.ssrImportedModules];
  return collectModuleGraph([...rest, ...next], new Set([...visited, current]));
}

export function toViteModuleId(root: string, filePath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedFile = path.resolve(filePath);

  if (normalizedFile.startsWith(`${normalizedRoot}${path.sep}`)) {
    const rel = path.relative(normalizedRoot, normalizedFile);
    return `/${rel.split(path.sep).join('/')}`;
  }

  return `/@fs/${normalizedFile.split(path.sep).join('/')}`;
}

async function resolveTokenEntry(
  server: ViteDevServer,
  sourceFile: string,
): Promise<string | null> {
  const normalizedSource = normalizeViteId(sourceFile);
  const resolved = await server.pluginContainer.resolveId(
    normalizedSource,
    undefined,
    { ssr: true },
  );
  if (
    !resolved?.id ||
    resolved.id.startsWith('\0') ||
    resolved.id.startsWith('virtual:')
  ) {
    return null;
  }
  return normalizeViteId(resolved.id);
}

export const getGeneratedFiles = ({ platforms }: Config, root: string): string[] =>
  Object.values(platforms ?? {})
    .map(({ buildPath, files }) => ({
      buildPath: path.resolve(root, buildPath || ''),
      files: castArray(files),
    }))
    .flatMap(({ buildPath, files }) =>
      files.map(({ destination }) =>
        path.resolve(buildPath, destination || ''),
      ),
    );
