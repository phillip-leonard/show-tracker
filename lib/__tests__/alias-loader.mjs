// Minimal ESM loader hook so plain `node` can resolve this repo's `@/foo`
// path alias (defined in jsconfig.json for the Next.js/webpack build) when
// running a unit test file directly, without pulling in the full Next.js
// toolchain. Registered via `--experimental-loader` on the node invocation
// in the test's own file header comment.
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..', '..');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rest = specifier.slice(2);
    const withExt = /\.(js|json)$/.test(rest) ? rest : `${rest}.js`;
    const resolved = pathToFileURL(path.join(root, withExt)).href;
    return nextResolve(resolved, context);
  }
  return nextResolve(specifier, context);
}

// `import config from '@/config/x.json'` is how the Next.js build reads a
// JSON config, with no import attribute. Plain node refuses a JSON import
// without `with { type: 'json' }`, so a .json file is handed to node as a
// module whose default export is the parsed file — what webpack gives it.
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const json = await readFile(fileURLToPath(url), 'utf8');
    return { format: 'module', source: `export default ${json};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
