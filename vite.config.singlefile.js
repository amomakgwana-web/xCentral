// ══════════════════════════════════════════════════════════════
// A second build, for the console as one file.
//
// The normal build (vite.config default) emits an ES module graph
// with lazily loaded chunks. That is the right shape for a server —
// the capture wizard's camera code is only fetched when someone opens
// it — but a browser will not load module scripts or dynamic chunks
// from file://, so a folder of those cannot be opened by
// double-clicking it.
//
// This config flattens the graph instead: one classic IIFE, every
// dynamic import pulled inline, which scripts/build-single-file.mjs
// then embeds in the HTML. The output has no imports left to resolve,
// so it runs from a disk path with nothing serving it.
// ══════════════════════════════════════════════════════════════
export default {
  build: {
    outDir: 'dist-single',
    // The console reads its records from the generated dataset, which
    // minifies to a few hundred kB. Warning about that on every build
    // is noise: it is the payload, not an accident.
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
};
