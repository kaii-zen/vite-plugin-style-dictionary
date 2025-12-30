# vite-plugin-style-dictionary

> A Vite plugin that runs Style Dictionary through Vite's module graph so your tokens can be authored in TS/JS with aliases and HMR.

## Why

Style Dictionary runs in Node and loads files directly from disk. That means it does not see Vite transforms, TS path aliases, or your module graph, so TS token files and aliased imports often fail unless you add build steps or duplicate config. This plugin runs token loading through Vite itself, so your token entry can be real app code (TS/JS, aliases, imports) and Style Dictionary outputs still regenerate during dev, build, and tests without extra scripts. It does this by creating a lightweight Vite server and loading the token module via Vite's `ssrLoadModule`, then feeding the default export into Style Dictionary.

## Features

- Uses Vite's module graph (TS/JS tokens, aliases, and imports just work)
- Rebuilds outputs on relevant HMR changes
- Runs for build and test modes (no extra scripts)
- Minimal configuration (only your Style Dictionary config)

## Installation

npm:

    npm install -D vite-plugin-style-dictionary

pnpm:

    pnpm add -D vite-plugin-style-dictionary

yarn:

    yarn add -D vite-plugin-style-dictionary

## Usage

    // vite.config.ts
    import { defineConfig } from 'vite'
    import styleDictionaryPlugin from 'vite-plugin-style-dictionary'
    import sdConfig from './style-dictionary.config'

    export default defineConfig({
      plugins: [styleDictionaryPlugin(sdConfig)]
    })

## Style Dictionary Config

The plugin takes a standard Style Dictionary `Config` object.

    // style-dictionary.config.ts
    import type { Config } from 'style-dictionary'

    const config: Config = {
      source: ['src/theme/tokens/index.ts'],
      platforms: {
        scss: {
          transformGroup: 'scss',
          buildPath: 'src/theme/generated/',
          files: [{ destination: '_tokens.scss', format: 'scss/variables' }]
        },
        ts: {
          transformGroup: 'js',
          buildPath: 'src/theme/generated/',
          files: [{ destination: 'tokens.ts', format: 'javascript/es6' }]
        }
      }
    }

    export default config

## Options

    styleDictionaryPlugin(config)

The plugin does not introduce custom options. Pass your Style Dictionary `Config` as-is.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| config | `Config` | — | Style Dictionary configuration |

## Examples

### Split tokens across files

    // src/theme/tokens/colors.ts
    export default {
      color: {
        brand: { value: '#2798f5', type: 'color' }
      }
    }

    // src/theme/tokens/index.ts
    import colors from './colors'

    export default {
      ...colors
    }

## Compatibility

- Vite 7+
- Node.js 22+

## Limitations

- Token entry must export a default object.
- This plugin does not validate your Style Dictionary transforms/formats.

## Contributing

See `CONTRIBUTING.md` for workflow details and commit/PR conventions.

    npm install
    npm run dev
    npm run test

## License

MIT
