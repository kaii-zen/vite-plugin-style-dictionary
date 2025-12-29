# Style Dictionary Vite Plugin

Vite plugin that runs Style Dictionary using Vite's module graph to load token modules (TS/JS/aliases supported).

## Usage

```ts
import { defineConfig } from 'vite';
import styleDictionaryPlugin from 'vite-plugin-style-dictionary';
import sdConfig from './style-dictionary.config';

export default defineConfig({
  plugins: [styleDictionaryPlugin(sdConfig)],
});
```

## Scripts

- `npm run build` - Build the plugin
- `npm run dev` - Watch build
- `npm run typecheck` - Type check
