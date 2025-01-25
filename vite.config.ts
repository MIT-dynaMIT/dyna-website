import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
