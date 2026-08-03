/**
 * Bundle the Electron main process (ESM) and preload (CJS — sandboxed
 * preloads must be CommonJS) with esbuild.
 *
 * Bundling strategy: EVERYTHING is inlined except `electron` and the native
 * / runtime-provided modules. Workspace packages (`@moonshot-ai/*`) must be
 * bundled because their package entries point at TypeScript sources that the
 * Node runtime cannot load directly (no extension resolution) — the CLI
 * solves this by inlining them at build time, and the shell does the same.
 * `*.md?raw` imports (prompt sources) are inlined as text, mirroring the
 * tsdown raw-text plugin used by the CLI bundles.
 */

import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const rawTextPlugin = {
  name: 'raw-text',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => {
      const file = args.path.replace(/\?raw$/, '');
      return {
        path: resolve(dirname(args.importer ?? root), file),
        namespace: 'raw-text',
      };
    });
    build.onLoad({ filter: /.*/, namespace: 'raw-text' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

await rm(`${root}dist`, { recursive: true, force: true });

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  // Native modules and the Electron runtime are resolved at runtime; every
  // other dependency (including all @moonshot-ai/* workspace packages) is
  // inlined into the bundle.
  external: ['electron', 'node-pty', '@mariozechner/clipboard', 'ssh2'],
  plugins: [rawTextPlugin],
  sourcemap: true,
  logLevel: 'info',
};

await build({
  ...shared,
  entryPoints: [`${root}src/main/index.ts`],
  format: 'esm',
  outfile: `${root}dist/main/index.js`,
  // Bundled CJS deps (fastify ecosystem, MCP SDK, …) emit dynamic `require()`
  // calls that Node's ESM loader rejects ("Dynamic require ... is not
  // supported"). Point `require` at the real module loader via createRequire.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

await build({
  ...shared,
  entryPoints: [`${root}src/preload/index.ts`],
  format: 'cjs',
  outfile: `${root}dist/preload/index.cjs`,
});

console.log('Built apps/kimi-desktop/dist (main/index.js, preload/index.cjs)');
