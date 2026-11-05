import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['.ngrok-free.dev'],
    hmr: { clientPort: 443 },
    proxy: { '/api': 'http://localhost:3000', '/uploads': 'http://localhost:3000', '/demo': 'http://localhost:3000' },
  },
});
