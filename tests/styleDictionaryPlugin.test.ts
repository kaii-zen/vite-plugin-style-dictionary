import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { castArray } from 'lodash-es';

vi.mock('vite', () => {
  const createServer = vi.fn();
  const createFilter = (includes: string[] | string) => {
    const includeList = castArray(includes);
    const includeSet = new Set(includeList);
    return (id: string) => includeSet.has(id);
  };
  return { createServer, createFilter };
});

vi.mock('style-dictionary', () => {
  const buildAllPlatformsMock = vi.fn().mockResolvedValue(undefined);
  class StyleDictionaryMock {
    static instances: StyleDictionaryMock[] = [];
    static buildAllPlatformsMock = buildAllPlatformsMock;
    config: unknown;
    constructor(config: unknown) {
      this.config = config;
      StyleDictionaryMock.instances.push(this);
    }
    buildAllPlatforms() {
      return buildAllPlatformsMock();
    }
  }

  return { default: StyleDictionaryMock };
});

import styleDictionaryPlugin from '../src/index';
import {
  createTokensLoader,
  getGeneratedFiles,
  isRelevantChange,
  parseTokenModule,
} from '../src/internal';
import { createServer } from 'vite';
import StyleDictionary, { type Config } from 'style-dictionary';

const StyleDictionaryMock = StyleDictionary as unknown as {
  instances: unknown[];
  buildAllPlatformsMock: ReturnType<typeof vi.fn>;
};
const createServerMock = createServer as unknown as ReturnType<typeof vi.fn>;

const originalArgv = process.argv.slice();
const originalVitestEnv = process.env.VITEST;

const resetVitestDetection = () => {
  process.argv = ['node', 'script.js'];
  delete process.env.VITEST;
};

const restoreVitestDetection = () => {
  process.argv = originalArgv;
  if (originalVitestEnv === undefined) {
    delete process.env.VITEST;
  } else {
    process.env.VITEST = originalVitestEnv;
  }
};

type Hook<T extends (...args: any[]) => any> = T | { handler: T };

const runHook = <T extends (...args: any[]) => any>(
  hook: Hook<T> | undefined,
  ...args: Parameters<T>
) => {
  if (!hook) return undefined;
  const handler = typeof hook === 'function' ? hook : hook.handler;
  return handler(...args);
};

beforeEach(() => {
  StyleDictionaryMock.instances = [];
  StyleDictionaryMock.buildAllPlatformsMock.mockClear();
  createServerMock.mockReset();
});

afterEach(() => {
  restoreVitestDetection();
});

describe('token loading', () => {
  it('loads tokens via ssrLoadModule and prefers default export', async () => {
    const root = '/root/project';
    const server = {
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: '/root/project/tokens.ts' }),
      },
      ssrLoadModule: vi.fn().mockResolvedValue({ default: { color: 'red' } }),
    };
    const loadTokens = createTokensLoader(() => server as never);

    const tokens = await loadTokens('/root/project/tokens.ts');

    expect(tokens).toEqual({ color: 'red' });
    expect(server.ssrLoadModule).toHaveBeenCalledWith('/root/project/tokens.ts');
  });

  it('falls back to module when default export is missing', async () => {
    const root = '/root/project';
    const moduleValue = { size: '12px' };
    const server = {
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: '/root/project/tokens.ts' }),
      },
      ssrLoadModule: vi.fn().mockResolvedValue(moduleValue),
    };
    const loadTokens = createTokensLoader(() => server as never);

    const tokens = await loadTokens('/root/project/tokens.ts');

    expect(tokens).toEqual(moduleValue);
  });

  it('resolves directory sources to index files', async () => {
    const root = '/root/project';
    const server = {
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({
          id: '/root/project/tokens/index.ts',
        }),
      },
      ssrLoadModule: vi.fn().mockResolvedValue({ default: { color: 'red' } }),
    };
    const loadTokens = createTokensLoader(() => server as never);

    const tokens = await loadTokens('/root/project/tokens');

    expect(tokens).toEqual({ color: 'red' });
    expect(server.ssrLoadModule).toHaveBeenCalledWith('/root/project/tokens/index.ts');
  });

  it('requires a default export object', async () => {
    const loadTokens = vi.fn().mockResolvedValue('not-an-object');

    await expect(
      parseTokenModule(
        { contents: '', filePath: '/root/project/tokens.ts' },
        loadTokens,
      ),
    ).rejects.toThrow('[style-dictionary] /root/project/tokens.ts must export a default object');
  });
});

describe('build timing and HMR behavior', () => {
  it('builds on dev server startup and on relevant HMR changes', async () => {
    resetVitestDetection();
    const root = '/root/project';
    const tokensFile = path.join(root, 'tokens.ts');
    const depFile = path.join(root, 'colors.ts');
    const entryModule = {
      importedModules: new Set<unknown>(),
      ssrImportedModules: new Set<unknown>(),
    };
    const depModule = {
      importedModules: new Set<unknown>(),
      ssrImportedModules: new Set<unknown>(),
    };
    entryModule.importedModules.add(depModule);

    const server = {
      config: {
        root,
        mode: 'development',
        command: 'serve',
        logger: { error: vi.fn() },
      },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: tokensFile }),
      },
      watcher: { add: vi.fn() },
      moduleGraph: {
        getModulesByFile: (file: string) => {
          if (file === tokensFile) return new Set([entryModule]);
          if (file === depFile) return new Set([depModule]);
          return new Set();
        },
        getModuleById: vi.fn().mockReturnValue({ id: 'generated' }),
      },
    };

    const plugin = styleDictionaryPlugin({
      source: ['tokens.ts'],
      platforms: {
        web: {
          buildPath: 'dist',
          files: [{ destination: 'tokens.json' }],
        },
      },
    });

    await runHook(plugin.configureServer, server as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).toHaveBeenCalledTimes(1);
    expect(server.watcher.add).toHaveBeenCalledWith([tokensFile]);

    await runHook(plugin.handleHotUpdate, {
      file: depFile,
      server: server as never,
    } as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).toHaveBeenCalledTimes(2);

    await runHook(plugin.handleHotUpdate, {
      file: path.join(root, 'unrelated.ts'),
      server: server as never,
    } as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).toHaveBeenCalledTimes(2);
  });

  it('builds before build command completes', async () => {
    resetVitestDetection();
    const root = '/root/project';
    const close = vi.fn().mockResolvedValue(undefined);
    createServerMock.mockResolvedValue({
      close,
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: path.join(root, 'tokens.ts') }),
      },
    });

    const plugin = styleDictionaryPlugin({
      source: ['tokens.ts'],
      platforms: {
        web: {
          buildPath: 'dist',
          files: [{ destination: 'tokens.json' }],
        },
      },
    });

    const otherPlugin = { name: 'other' };

    await runHook(plugin.configResolved, {
      root,
      mode: 'production',
      command: 'build',
      logger: { error: vi.fn() },
      logLevel: 'info',
      resolve: {},
      define: {},
      css: {},
      plugins: [plugin, otherPlugin],
    } as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: [otherPlugin],
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('builds once in test mode without attaching watchers', async () => {
    const root = '/root/project';
    const close = vi.fn().mockResolvedValue(undefined);
    createServerMock.mockResolvedValue({
      close,
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: path.join(root, 'tokens.ts') }),
      },
    });

    const plugin = styleDictionaryPlugin({
      source: ['tokens.ts'],
      platforms: {
        web: {
          buildPath: 'dist',
          files: [{ destination: 'tokens.json' }],
        },
      },
    });

    const watcher = { add: vi.fn() };

    await runHook(plugin.configureServer, {
      config: {
        root,
        mode: 'test',
        command: 'serve',
        logger: { error: vi.fn() },
      },
      watcher,
      moduleGraph: {
        getModulesByFile: () => new Set(),
        getModuleById: vi.fn(),
      },
    } as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).not.toHaveBeenCalled();
    expect(watcher.add).not.toHaveBeenCalled();

    await runHook(plugin.configResolved, {
      root,
      mode: 'test',
      command: 'serve',
      logger: { error: vi.fn() },
      logLevel: 'info',
      resolve: {},
      define: {},
      css: {},
      plugins: [plugin],
    } as never);

    expect(StyleDictionaryMock.buildAllPlatformsMock).toHaveBeenCalledTimes(1);
    expect(createServer).toHaveBeenCalledWith(
      expect.objectContaining({
        plugins: [],
        server: expect.objectContaining({
          watch: null,
          hmr: false,
          middlewareMode: true,
        }),
      }),
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('resolves directory sources before building', async () => {
    resetVitestDetection();
    const root = '/root/project';
    const entryFile = path.join(root, 'tokens', 'index.ts');
    const server = {
      config: {
        root,
        mode: 'development',
        command: 'serve',
        logger: { error: vi.fn() },
      },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: entryFile }),
      },
      watcher: { add: vi.fn() },
      moduleGraph: {
        getModuleByFile: vi.fn(),
      },
    };

    const plugin = styleDictionaryPlugin({
      source: ['tokens'],
      platforms: {
        web: {
          buildPath: 'dist',
          files: [{ destination: 'tokens.json' }],
        },
      },
    });

    await runHook(plugin.configureServer, server as never);

    const instance = StyleDictionaryMock.instances[0] as
      | { config: Config }
      | undefined;
    if (!instance) {
      throw new Error('Expected StyleDictionary to be instantiated');
    }
    expect(castArray(instance.config.source)).toEqual([entryFile]);
  });
});

describe('HMR relevance and generated outputs', () => {
  it('treats token source and its imports as relevant for rebuilds', async () => {
    const root = '/root/project';
    const tokensFile = path.join(root, 'tokens.ts');
    const depFile = path.join(root, 'colors.ts');
    const entryModule = {
      importedModules: new Set<unknown>(),
      ssrImportedModules: new Set<unknown>(),
    };
    const depModule = {
      importedModules: new Set<unknown>(),
      ssrImportedModules: new Set<unknown>(),
    };
    entryModule.importedModules.add(depModule);

    const server = {
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: tokensFile }),
      },
      moduleGraph: {
        getModulesByFile: (file: string) => {
          if (file === tokensFile) return new Set([entryModule]);
          if (file === depFile) return new Set([depModule]);
          return new Set();
        },
      },
    };

    expect(await isRelevantChange(server as never, ['tokens.ts'], tokensFile)).toBe(true);
    expect(await isRelevantChange(server as never, ['tokens.ts'], depFile)).toBe(true);
    expect(
      await isRelevantChange(
        server as never,
        ['tokens.ts'],
        path.join(root, 'unrelated.ts'),
      ),
    ).toBe(false);
  });

  it('treats directory token sources as relevant for rebuilds', async () => {
    const root = '/root/project';
    const tokensDir = path.join(root, 'tokens');
    const entryFile = path.join(tokensDir, 'index.ts');
    const entryModule = {
      importedModules: new Set<unknown>(),
      ssrImportedModules: new Set<unknown>(),
    };

    const server = {
      config: { root },
      pluginContainer: {
        resolveId: vi.fn().mockResolvedValue({ id: entryFile }),
      },
      moduleGraph: {
        getModulesByFile: (file: string) => {
          if (file === entryFile) return new Set([entryModule]);
          return new Set();
        },
      },
    };

    expect(await isRelevantChange(server as never, ['tokens'], entryFile)).toBe(true);
  });

  it('resolves generated file destinations with buildPath', () => {
    const root = '/root/project';
    const files = getGeneratedFiles(
      {
        platforms: {
          web: {
            buildPath: 'dist',
            files: { destination: 'tokens.json' },
          },
          ios: {
            buildPath: '/absolute',
            files: [{ destination: 'tokens.plist' }],
          },
        },
      } as unknown as Config,
      root,
    );

    expect(files).toEqual([
      path.resolve(root, 'dist', 'tokens.json'),
      path.resolve('/absolute', 'tokens.plist'),
    ]);
    files.forEach((file) => expect(path.isAbsolute(file)).toBe(true));
  });
});
