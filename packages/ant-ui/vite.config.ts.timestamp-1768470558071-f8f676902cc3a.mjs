// vite.config.ts
import { defineConfig } from "file:///Users/probe/dev/ant/node_modules/.pnpm/vite@5.4.21_@types+node@24.8.1/node_modules/vite/dist/node/index.js";
import react from "file:///Users/probe/dev/ant/node_modules/.pnpm/@vitejs+plugin-react@4.7.0_vite@5.4.21_@types+node@24.8.1_/node_modules/@vitejs/plugin-react/dist/index.js";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
      "@/presentation": "/src/presentation",
      "@/application": "/src/application",
      "@/domain": "/src/domain",
      "@/infrastructure": "/src/infrastructure",
      "@/shared": "/src/shared"
    }
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        ".js": "jsx"
        // Allow JSX in .js files
      }
    }
  },
  server: {
    port: 4200,
    open: false
    // 브라우저 자동 열기 방지
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcHJvYmUvZGV2L2FudC9wYWNrYWdlcy9hbnQtdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9wcm9iZS9kZXYvYW50L3BhY2thZ2VzL2FudC11aS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcHJvYmUvZGV2L2FudC9wYWNrYWdlcy9hbnQtdWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogJy9zcmMnLFxuICAgICAgJ0AvcHJlc2VudGF0aW9uJzogJy9zcmMvcHJlc2VudGF0aW9uJyxcbiAgICAgICdAL2FwcGxpY2F0aW9uJzogJy9zcmMvYXBwbGljYXRpb24nLFxuICAgICAgJ0AvZG9tYWluJzogJy9zcmMvZG9tYWluJyxcbiAgICAgICdAL2luZnJhc3RydWN0dXJlJzogJy9zcmMvaW5mcmFzdHJ1Y3R1cmUnLFxuICAgICAgJ0Avc2hhcmVkJzogJy9zcmMvc2hhcmVkJyxcbiAgICB9LFxuICB9LFxuICBvcHRpbWl6ZURlcHM6IHtcbiAgICBlc2J1aWxkT3B0aW9uczoge1xuICAgICAgbG9hZGVyOiB7XG4gICAgICAgICcuanMnOiAnanN4JywgIC8vIEFsbG93IEpTWCBpbiAuanMgZmlsZXNcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNDIwMCxcbiAgICBvcGVuOiBmYWxzZSwgIC8vIFx1QkUwQ1x1Qjc3Q1x1QzZCMFx1QzgwMCBcdUM3OTBcdUIzRDkgXHVDNUY0XHVBRTMwIFx1QkMyOVx1QzlDMFxuICB9LFxufSkiXSwKICAibWFwcGluZ3MiOiAiO0FBQThSLFNBQVMsb0JBQW9CO0FBQzNULE9BQU8sV0FBVztBQUdsQixJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSztBQUFBLE1BQ0wsa0JBQWtCO0FBQUEsTUFDbEIsaUJBQWlCO0FBQUEsTUFDakIsWUFBWTtBQUFBLE1BQ1osb0JBQW9CO0FBQUEsTUFDcEIsWUFBWTtBQUFBLElBQ2Q7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixnQkFBZ0I7QUFBQSxNQUNkLFFBQVE7QUFBQSxRQUNOLE9BQU87QUFBQTtBQUFBLE1BQ1Q7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBO0FBQUEsRUFDUjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
