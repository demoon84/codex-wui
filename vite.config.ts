import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [
        react(),
    ],
    base: './',
    server: {
        port: 5173,
        strictPort: true,
    },
    build: {
        rollupOptions: {
            input: {
                main: './index.html',
            },
            output: {
                manualChunks: {
                    // React core
                    'vendor-react': ['react', 'react-dom'],
                    // Markdown rendering pipeline
                    'vendor-markdown': [
                        'react-markdown',
                        'remark-gfm',
                        'rehype-highlight',
                    ],
                },
            },
        },
    },
})
