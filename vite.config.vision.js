// Builds the vision harness — a page that exposes the vision modules on
// `window` so tests can drive them in a real browser against real
// canvases and a real JPEG encoder. It is not part of the console and
// never ships with it, which is why it has its own config and its own
// output directory.
export default {
  root: 'tests/vision',
  build: {
    outDir: '../../dist-vision',
    emptyOutDir: true,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
};
