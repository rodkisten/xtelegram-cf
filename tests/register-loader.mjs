import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Worker/esbuild supports extensionless TS imports; Node's test runner needs
// this narrowly scoped resolver to exercise the same source files directly.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".yaml")) {
      return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url), "utf8"))};` };
    }
    return nextLoad(url, context);
  },
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
