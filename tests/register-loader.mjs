import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Worker/esbuild supports extensionless TS imports; Node's test runner needs
// this narrowly scoped resolver to exercise the same source files directly.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) {
      const url = new URL(specifier, context.parentURL);
      if (!/\.[cm]?[jt]s$/.test(url.pathname)) {
        for (const suffix of ['.ts', '/index.ts']) {
          const candidate = new URL(url.href + suffix);
          if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
