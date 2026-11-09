import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveConfig } from 'vite';

const repoRoot = path.resolve(import.meta.dirname, '..');

// The fixture lives under node_modules so its config file resolves `vite` and `style-dictionary`.
const createFixture = async () => {
  const fixturesDir = path.join(repoRoot, 'node_modules', '.fixtures');
  await fs.mkdir(fixturesDir, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixturesDir, 'token-server-'));
  await fs.writeFile(
    path.join(root, 'tokens.ts'),
    "export default { color: { brand: { value: '#2798f5', type: 'color' } } };\n",
    'utf8',
  );

  const pluginEntry = path
    .relative(root, path.join(repoRoot, 'src', 'index.ts'))
    .split(path.sep)
    .join('/');
  const buildPath = path.join(root, 'style-dictionary').split(path.sep).join('/');
  const configFile = path.join(root, 'vite.config.mjs');
  await fs.writeFile(
    configFile,
    `import styleDictionaryPlugin from '${pluginEntry}';

// Records every config it is resolved with, like a plugin that keeps mode-dependent state.
function probe() {
  const commands = [];
  return { name: 'probe', commands, configResolved: (config) => commands.push(config.command) };
}

export default {
  plugins: [
    styleDictionaryPlugin({
      source: ['tokens.ts'],
      platforms: {
        json: {
          transformGroup: 'js',
          buildPath: '${buildPath}/',
          files: [{ destination: 'tokens.json', format: 'json' }],
        },
      },
    }),
    probe(),
  ],
};
`,
    'utf8',
  );

  return {
    root,
    configFile,
    outputFile: path.join(root, 'style-dictionary', 'tokens.json'),
  };
};

describe('token build server', () => {
  it("builds tokens without reconfiguring the host build's plugins", async () => {
    const fixture = await createFixture();
    try {
      const resolved = await resolveConfig(
        { configFile: fixture.configFile, root: fixture.root, logLevel: 'silent' },
        'build',
        'production',
      );

      const probe = resolved.plugins.find((plugin) => plugin.name === 'probe') as unknown as {
        commands: string[];
      };
      expect(probe.commands).toEqual(['build']);

      const output = JSON.parse(await fs.readFile(fixture.outputFile, 'utf8'));
      expect(output.color.brand.value).toBe('#2798f5');
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  }, 30_000);
});
