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
  server: {
    port: 4200,
    open: false
    // 브라우저 자동 열기 방지
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvcHJvYmUvZGV2L2FudC9wYWNrYWdlcy9hbnQtdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9wcm9iZS9kZXYvYW50L3BhY2thZ2VzL2FudC11aS92aXRlLmNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvcHJvYmUvZGV2L2FudC9wYWNrYWdlcy9hbnQtdWkvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogJy9zcmMnLFxuICAgICAgJ0AvcHJlc2VudGF0aW9uJzogJy9zcmMvcHJlc2VudGF0aW9uJyxcbiAgICAgICdAL2FwcGxpY2F0aW9uJzogJy9zcmMvYXBwbGljYXRpb24nLFxuICAgICAgJ0AvZG9tYWluJzogJy9zcmMvZG9tYWluJyxcbiAgICAgICdAL2luZnJhc3RydWN0dXJlJzogJy9zcmMvaW5mcmFzdHJ1Y3R1cmUnLFxuICAgICAgJ0Avc2hhcmVkJzogJy9zcmMvc2hhcmVkJyxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBwb3J0OiA0MjAwLFxuICAgIG9wZW46IGZhbHNlLCAgLy8gXHVCRTBDXHVCNzdDXHVDNkIwXHVDODAwIFx1Qzc5MFx1QjNEOSBcdUM1RjRcdUFFMzAgXHVCQzI5XHVDOUMwXG4gIH0sXG59KSJdLAogICJtYXBwaW5ncyI6ICI7QUFBOFIsU0FBUyxvQkFBb0I7QUFDM1QsT0FBTyxXQUFXO0FBR2xCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxrQkFBa0I7QUFBQSxNQUNsQixpQkFBaUI7QUFBQSxNQUNqQixZQUFZO0FBQUEsTUFDWixvQkFBb0I7QUFBQSxNQUNwQixZQUFZO0FBQUEsSUFDZDtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQTtBQUFBLEVBQ1I7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
