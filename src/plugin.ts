import { createServer } from 'vite';
import type {
  InlineConfig,
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
  resolveSourceEntries,
  toAbsoluteGlobs,
  type TokensLoader,
} from './internal';

const PLUGIN_NAME = 'style-dictionary-plugin';
const PARSER_NAME = 'style-dictionary-vite-loader';
const MATCH_ANY_FILE = /./;
// Set on the token server's config, so this plugin's own instance there stays inactive. Vite
// keeps unknown keys, so it reaches the resolved config.
const TOKEN_SERVER_FLAG = 'styleDictionaryTokenServer';
const tokenServerMarker = { [TOKEN_SERVER_FLAG]: true };

export default function styleDictionaryPlugin(sdConfig: Config): Plugin {
  let devServer: ViteDevServer | null = null;
  const loadTokens = createTokensLoader(() => devServer);
  const config = withSilentLogging(addViteParser(sdConfig, loadTokens));
  const sources = normalizeSources(config.source);

  return {
    name: PLUGIN_NAME,
    enforce: 'pre',
    async configureServer(server) {
      if (isTestRun(server.config) || isTokenServer(server.config)) return;
      devServer = server;
      server.watcher.add(toAbsoluteGlobs(server.config.root, sources));
      await buildStyleDictionary(config, server.config.logger, server);
    },
    async configResolved(resolved) {
      if (isTokenServer(resolved)) return;
      if (isTestRun(resolved)) {
        await withTokenServer(resolved, async (server) => {
          devServer = server;
          try {
            await buildStyleDictionary(config, resolved.logger, server);
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
          await buildStyleDictionary(config, resolved.logger, server);
        } finally {
          devServer = null;
        }
      });
    },
    async handleHotUpdate(ctx) {
      if (isTestRun(ctx.server.config)) return undefined;
      if (!(await isRelevantChange(ctx.server, sources, ctx.file))) return undefined;

      await buildStyleDictionary(config, ctx.server.config.logger, ctx.server);

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
  const buildServer = await createServer({
    ...tokenServerSettings(config),
    root: config.root,
    mode,
    logLevel: config.logLevel,
    ...tokenServerMarker,
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

// The token server loads the host's config file again rather than reusing the host's plugins: a
// plugin instance belongs to one Vite instance, and the token server's `configResolved` would
// reconfigure the host's instances for a dev server in the middle of a build. Loading the file
// gives the token server fresh instances of the same plugins.
function tokenServerSettings(config: ResolvedConfig): InlineConfig {
  if (config.configFile && config.mode !== 'test') {
    return { configFile: config.configFile };
  }
  return {
    configFile: false,
    // The build loads token files in Node, so it externalizes dependencies as usual even when the
    // host inlines them all (e.g. Vitest browser mode sets `noExternal: true`), which would make
    // Vite evaluate CommonJS packages such as React as ESM.
    resolve: { ...config.resolve, noExternal: [], external: [] },
    define: config.define,
    css: config.css,
  };
}

const withTokenServer = withBuildServer;

const isTokenServer = (config: ResolvedConfig) =>
  Boolean((config as Record<string, unknown>)[TOKEN_SERVER_FLAG]);

const isTestRun = (config?: ResolvedConfig) =>
  config?.mode === 'test' ||
  isVitestCli() ||
  Boolean(config?.plugins?.some((plugin) => plugin.name.startsWith('vitest:')));

const isVitestCli = () =>
  !!process.env.VITEST || process.argv.some((arg) => arg.includes('vitest'));

async function buildStyleDictionary(
  sdConfig: Config,
  logger: Logger,
  server: ViteDevServer,
) {
  try {
    const sources = await resolveSourceEntries(server, sdConfig.source);
    const config =
      sources.length > 0 ? { ...sdConfig, source: sources } : sdConfig;
    const sd = new StyleDictionary(config);
    await sd.buildAllPlatforms();
  } catch (error) {
    logger.error('[vite:style-dictionary] Build failed:', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
