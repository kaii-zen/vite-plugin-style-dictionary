import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveConfig } from 'vite';
import type { Config } from 'style-dictionary';
import styleDictionaryPlugin from '../src/index';

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vite-sd-'));
  const tokensDir = path.join(root, 'src', 'theme', 'tokens');
  const tokensFile = path.join(tokensDir, 'index.ts');
  await fs.mkdir(tokensDir, { recursive: true });
  await fs.writeFile(
    tokensFile,
    "export default { color: { brand: { value: '#2798f5', type: 'color' } } };\n",
    'utf8',
  );

  const buildPath = path.join(root, 'style-dictionary');
  const outputFile = path.join(buildPath, 'tokens.json');

  return {
    root,
    buildPath,
    outputFile,
    sourceEntry: tokensFile,
  };
};

describe('style dictionary integration with resolved paths', () => {
  it('builds tokens when source resolves to a namespaced path', async () => {
    const fixture = await createFixture();
    try {
      const sdConfig: Config = {
        source: [fixture.sourceEntry],
        platforms: {
          json: {
            transformGroup: 'js',
            buildPath: fixture.buildPath,
            files: [{ destination: 'tokens.json', format: 'json' }],
          },
        },
      };

      await resolveConfig(
        {
          configFile: false,
          root: fixture.root,
          logLevel: 'silent',
          plugins: [styleDictionaryPlugin(sdConfig)],
        },
        'build',
        'production',
      );

      const output = await fs.readFile(fixture.outputFile, 'utf8');
      expect(output).toContain('"color"');
    } finally {
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });
});
