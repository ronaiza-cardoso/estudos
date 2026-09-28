import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = 'http://127.0.0.1:5183';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5182,
    strictPort: true, // falhar alto é melhor que cair na porta da API
    open: false, // nunca abrir o navegador padrão do usuário
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
});
