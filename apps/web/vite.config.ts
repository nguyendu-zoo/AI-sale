import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: false,
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            // WebSocket errors provide a Socket, which must not receive an HTTP JSON response.
            if (!response || !('writeHead' in response) || response.headersSent || response.writableEnded) return;
            response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({
              statusCode: 503,
              code: 'API_UNAVAILABLE',
              message: 'Dịch vụ API chưa sẵn sàng. Hãy khởi động backend và kiểm tra PostgreSQL/Redis.',
            }));
          });
        },
      },
      '/socket.io': { target: 'http://127.0.0.1:3000', ws: true, changeOrigin: false },
    },
  },
  build: { sourcemap: true },
});
