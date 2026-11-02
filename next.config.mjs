export default {
  outputFileTracingIncludes: {
    '/api/*': [
      './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    ],
  },
};
