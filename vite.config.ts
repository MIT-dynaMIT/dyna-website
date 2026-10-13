import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'static-route-entry-pages',
      apply: 'build',
      enforce: 'post',
      generateBundle(_, bundle) {
        const index = bundle['index.html']
        if (!index || index.type !== 'asset') {
          this.error('Missing built index.html for static route entry pages')
        }

        // Keep these in sync with the public routes in src/main.tsx.
        // Static hosts need real entry pages for direct visits and refreshes.
        for (const route of ['board', 'apply']) {
          this.emitFile({
            type: 'asset',
            fileName: `${route}/index.html`,
            source: index.source,
          })
        }
      },
    },
  ],
  assetsInclude: ['**/*.csv'], // Add CSV files to the assets
  build: {
    rollupOptions: {
      input: {
        main: './index.html',
      },
    },
    outDir: 'dist',
    copyPublicDir: true
  },
})
