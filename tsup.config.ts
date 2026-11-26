import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  minify: true,
  target: 'es2020',
  // Keep `node:` specifiers (Node 20+, Bun and Deno all support them).
  removeNodeProtocol: false,
  // Let CommonJS users call require('validmail')(email) directly.
  footer: ({ format }) =>
    format === 'cjs' ? { js: 'var __d=module.exports.default;for(var __k in module.exports)if(!(__k in __d))__d[__k]=module.exports[__k];__d.default=__d;module.exports=__d;' } : {},
});
