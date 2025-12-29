import { createServer, createFilter } from 'vite';
import type {
  Plugin,
  Logger,
  ModuleNode,
  ResolvedConfig,
  ViteDevServer,
} from 'vite';
import StyleDictionary, { type Config } from 'style-dictionary';
import type { DesignTokens, ParserOptions } from 'style-dictionary/types';
import path from 'node:path';
import _ from 'lodash';

const PLUGIN_NAME = 'style-dictionary-plugin';
const PARSER_NAME = 'style-dictionary-vite-loader';
const DEFAULT_ENTRY = path.resolve(process.cwd(), 'tokens.ts');
const MATCH_ANY_FILE = /./;

export default function styleDictionaryPlugin(sdConfig: Config): Plugin {
  let devServer: ViteDevServer | null = null;
  const loadTokens = createTokensLoader(() => devServer);
  const config = withSilentLogging(addViteParser(sdConfig, loadTokens));
  const sources = normalizeSources(config.source);

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',
    async configureServer(server) {
      if (isTestRun(server.config)) return;
      devServer = server;
      server.watcher.add(toAbsoluteGlobs(server.config.root, sources));
      await buildStyleDictionary(config, server.config.logger);
    },
    async configResolved(resolved) {
      if (isTestRun(resolved)) {
        await withTokenServer(resolved, async (server) => {
          devServer = server;
          try {
            await buildStyleDictionary(config, resolved.logger);
          } finally {
            devServer = null;
          }
        });
        return;
      }
      if (resolved.command === 'serve') return;
      await withTokenServer(resolved, async (server) => {
        devServer = server;
        try {
          await buildStyleDictionary(config, resolved.logger);
        } finally {
          devServer = null;
        }
      });
    },
    async handleHotUpdate(ctx) {
      if (isTestRun(ctx.server.config)) return undefined;
      if (!isRelevantChange(ctx.server, sources, ctx.file)) return undefined;

      await buildStyleDictionary(config, ctx.server.config.logger);

      return getGeneratedFiles(sdConfig, ctx.server.config.root)
        .map((file) => ctx.server.moduleGraph.getModuleById(file))
        .filter((mod): mod is NonNullable<typeof mod> => Boolean(mod));
    },
  };
}

type TokensLoader = (filePath?: string) => Promise<DesignTokens>;

function addViteParser(config: Config, loadTokens: TokensLoader): Config {
  const parsers = new Set(config.parsers ?? []);
  parsers.add(PARSER_NAME);

  return {
    ...config,
    parsers: Array.from(parsers),
    hooks: {
      ...config.hooks,
      parsers: {
        ...config.hooks?.parsers,
        [PARSER_NAME]: {
          pattern: MATCH_ANY_FILE,
          parser: (options) => parseTokenModule(options, loadTokens),
        },
      },
    },
  };
}

function withSilentLogging(config: Config): Config {
  return {
    ...config,
    log: {
      ...config.log,
      verbosity: 'silent',
    },
  };
}

async function parseTokenModule(
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

function createTokensLoader(
  getServer: () => ViteDevServer | null,
): TokensLoader {
  return async (filePath) => {
    const server = getServer();
    if (!server) {
      throw new Error('[style-dictionary] Vite server is not available');
    }

    const sourceFile = filePath ?? DEFAULT_ENTRY;
    const moduleId = toViteModuleId(server.config.root, sourceFile);
    const module = await server.ssrLoadModule(moduleId);
    return (module?.default ?? module) as DesignTokens;
  };
}

async function withBuildServer(
  config: ResolvedConfig,
  run: (server: ViteDevServer) => Promise<void>,
) {
  const mode = config.mode === 'test' ? 'development' : config.mode;
  const plugins =
    config.mode === 'test' ? [] : filterTokenPlugins(config.plugins);
  const buildServer = await createServer({
    configFile: false,
    root: config.root,
    mode,
    logLevel: config.logLevel,
    resolve: config.resolve,
    define: config.define,
    css: config.css,
    plugins,
    server: {
      middlewareMode: true,
      hmr: false,
      watch: null,
    },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });

  try {
    await run(buildServer);
  } finally {
    await buildServer.close();
  }
}

const withTokenServer = withBuildServer;

const normalizeSources = (source?: string[] | string) => _.castArray(source);

const isTestRun = (config?: ResolvedConfig) =>
  config?.mode === 'test' ||
  isVitestCli() ||
  Boolean(config?.plugins?.some((plugin) => plugin.name.startsWith('vitest:')));

const isVitestCli = () =>
  !!process.env.VITEST || process.argv.some((arg) => arg.includes('vitest'));

const filterTokenPlugins = (plugins: readonly Plugin[]) =>
  plugins.filter(
    (plugin) =>
      plugin.name !== PLUGIN_NAME && !plugin.name.startsWith('vitest:'),
  );

const toAbsoluteGlobs = (root: string, sources: string[]) =>
  sources.map((source) =>
    path.isAbsolute(source) ? source : path.join(root, source),
  );

function isRelevantChange(
  server: ViteDevServer,
  sources: string[],
  changedFile: string,
) {
  const { root } = server.config;
  const include = createFilter(toAbsoluteGlobs(root, sources));
  if (include(changedFile)) return true;

  const isGlob = (source: string) => /[*?[\]]/.test(source);
  const entryFiles = sources
    .filter((source) => !isGlob(source))
    .map((source) =>
      path.isAbsolute(source) ? source : path.join(root, source),
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

function toViteModuleId(root: string, filePath: string) {
  const normalizedRoot = path.resolve(root);
  const normalizedFile = path.resolve(filePath);

  if (normalizedFile.startsWith(`${normalizedRoot}${path.sep}`)) {
    const rel = path.relative(normalizedRoot, normalizedFile);
    return `/${rel.split(path.sep).join('/')}`;
  }

  return `/@fs/${normalizedFile.split(path.sep).join('/')}`;
}

async function buildStyleDictionary(sdConfig: Config, logger: Logger) {
  try {
    const sd = new StyleDictionary(sdConfig);
    await sd.buildAllPlatforms();
  } catch (error) {
    logger.error('[vite:style-dictionary] Build failed:', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

const getGeneratedFiles = ({ platforms }: Config, root: string): string[] =>
  Object.values(platforms ?? {})
    .map(({ buildPath, files }) => ({
      buildPath: path.resolve(root, buildPath || ''),
      files: _.castArray(files),
    }))
    .flatMap(({ buildPath, files }) =>
      files.map(({ destination }) =>
        path.resolve(buildPath, destination || ''),
      ),
    );
