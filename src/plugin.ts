import { createServer } from 'vite';
import type {
  Plugin,
  Logger,
  ResolvedConfig,
  ViteDevServer,
} from 'vite';
import StyleDictionary, { type Config } from 'style-dictionary';
import {
  createTokensLoader,
  getGeneratedFiles,
  isRelevantChange,
  normalizeSources,
  parseTokenModule,
  toAbsoluteGlobs,
  type TokensLoader,
} from './internal';

const PLUGIN_NAME = 'style-dictionary-plugin';
const PARSER_NAME = 'style-dictionary-vite-loader';
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
      if (!(await isRelevantChange(ctx.server, sources, ctx.file))) return undefined;

      await buildStyleDictionary(config, ctx.server.config.logger);

      return getGeneratedFiles(sdConfig, ctx.server.config.root)
        .map((file) => ctx.server.moduleGraph.getModuleById(file))
        .filter((mod): mod is NonNullable<typeof mod> => Boolean(mod));
    },
  };
}

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
