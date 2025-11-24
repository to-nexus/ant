## ⚙️ Configuration Files Environment Rules

**You are working on BUILD TOOL CONFIGURATION FILES**

This code runs **in Node.js during build/development**, NOT in production runtime.

---

### ✅ Environment Detection Confirmed

**Detected indicators:**
- Project type: Configuration file
- File patterns: `*.config.ts`, `*.config.js`, `*.config.mjs`
- Examples: `vite.config.ts`, `webpack.config.js`, `rollup.config.js`, `jest.config.ts`
- Execution: Build time, development server startup

---

### ✅ ALLOWED: Full Node.js API Access

**All Node.js built-in modules are available:**

```typescript
// ✅ Full access to Node.js APIs in config files
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ✅ Config files run in Node.js, NOT in browser
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

**These files execute BEFORE the app runs, so Node.js APIs are safe to use.**

---

### 🎯 Common Configuration Patterns

#### 1. **Vite Configuration**

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path'; // ✅ OK! Config runs in Node.js

export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // ✅ Node.js path module OK
      '@components': path.resolve(__dirname, './src/components'),
      '@utils': path.resolve(__dirname, './src/utils')
    }
  },
  
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true
      }
    }
  },
  
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          utils: ['lodash', 'date-fns']
        }
      }
    }
  },
  
  // ✅ Load environment variables
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version)
  }
});

// ✅ Conditional config based on mode
export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  
  return {
    plugins: [react()],
    build: {
      minify: !isDev,
      sourcemap: isDev
    }
  };
});

// ✅ Read external files
import fs from 'fs';
const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify(packageJson.version)
  }
});
```

#### 2. **TypeScript Configuration**

```jsonc
// tsconfig.json (JSON format - no Node.js code)
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    
    // Path aliases (resolved at build time)
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@components/*": ["src/components/*"],
      "@utils/*": ["src/utils/*"]
    },
    
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "build"]
}
```

#### 3. **Webpack Configuration**

```typescript
// webpack.config.ts
import webpack from 'webpack';
import path from 'path'; // ✅ OK! Config runs in Node.js
import HtmlWebpackPlugin from 'html-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';

const config: webpack.Configuration = {
  entry: './src/index.tsx',
  
  output: {
    path: path.resolve(__dirname, 'dist'), // ✅ Node.js path module OK
    filename: '[name].[contenthash].js',
    clean: true
  },
  
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader']
      }
    ]
  },
  
  plugins: [
    new HtmlWebpackPlugin({
      template: './index.html'
    }),
    new MiniCssExtractPlugin({
      filename: '[name].[contenthash].css'
    }),
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
    })
  ],
  
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true
  }
};

export default config;
```

#### 4. **Rollup Configuration**

```typescript
// rollup.config.ts
import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import path from 'path'; // ✅ OK!

export default defineConfig({
  input: 'src/index.ts',
  
  output: [
    {
      file: 'dist/bundle.esm.js',
      format: 'esm',
      sourcemap: true
    },
    {
      file: 'dist/bundle.cjs.js',
      format: 'cjs',
      sourcemap: true
    }
  ],
  
  plugins: [
    resolve(),
    commonjs(),
    typescript({
      tsconfig: path.resolve(__dirname, 'tsconfig.json')
    })
  ],
  
  external: ['react', 'react-dom'] // Don't bundle peer dependencies
});
```

#### 5. **ESLint Configuration**

```typescript
// eslint.config.mjs
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import path from 'path'; // ✅ OK!

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: path.resolve(__dirname, 'tsconfig.json')
      }
    },
    plugins: {
      '@typescript-eslint': typescript
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  }
];
```

#### 6. **Tailwind Configuration**

```typescript
// tailwind.config.ts
import type { Config } from 'tailwindcss';
import path from 'path'; // ✅ OK!

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#8b5cf6'
      }
    }
  },
  
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography')
  ]
};

export default config;
```

#### 7. **Jest Configuration**

```typescript
// jest.config.ts
import type { Config } from 'jest';
import path from 'path'; // ✅ OK!

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  
  roots: ['<rootDir>/src'],
  
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '\\.(css|less|scss)$': 'identity-obj-proxy'
  },
  
  setupFilesAfterEnv: [
    '<rootDir>/src/test/setup.ts'
  ],
  
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/test/**'
  ]
};

export default config;
```

#### 8. **PostCSS Configuration**

```typescript
// postcss.config.ts
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import path from 'path'; // ✅ OK!

export default {
  plugins: [
    tailwindcss(path.resolve(__dirname, 'tailwind.config.ts')),
    autoprefixer
  ]
};
```

---

### 🎯 Environment-Specific Configuration

```typescript
// ✅ Load different config based on NODE_ENV
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development';
  const isProduction = mode === 'production';
  
  return {
    build: {
      minify: isProduction,
      sourcemap: isDevelopment ? 'inline' : false
    },
    
    define: {
      __DEV__: JSON.stringify(isDevelopment)
    },
    
    server: {
      port: isDevelopment ? 3000 : 8080
    }
  };
});

// ✅ Load environment-specific files
import fs from 'fs';
import path from 'path';

const env = process.env.NODE_ENV || 'development';
const envFile = path.resolve(__dirname, `.env.${env}`);

if (fs.existsSync(envFile)) {
  const envVars = fs.readFileSync(envFile, 'utf-8');
  // Parse and use env vars
}
```

---

### ⚡ Common Patterns

```typescript
// ✅ Path aliases (used by bundler, NOT runtime)
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@utils': path.resolve(__dirname, 'src/utils')
    }
  }
});

// ✅ Code splitting
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor';
          }
          if (id.includes('src/utils')) {
            return 'utils';
          }
        }
      }
    }
  }
});

// ✅ Plugin customization
import { Plugin } from 'vite';

function myCustomPlugin(): Plugin {
  return {
    name: 'my-custom-plugin',
    
    configResolved(config) {
      console.log('Config resolved:', config);
    },
    
    transform(code, id) {
      if (id.endsWith('.custom')) {
        return {
          code: code.replace('OLD', 'NEW'),
          map: null
        };
      }
    }
  };
}

export default defineConfig({
  plugins: [myCustomPlugin()]
});
```

---

### 📋 Final Checklist

- [ ] Used Node.js modules freely (`fs`, `path`, etc.) - config files run in Node.js
- [ ] Path aliases defined with `path.resolve()` for cross-platform compatibility
- [ ] Environment-specific configuration handled (`development` vs `production`)
- [ ] Proper TypeScript types for config (e.g., `defineConfig` helpers)
- [ ] Plugins and loaders configured correctly
- [ ] External dependencies excluded from bundle when appropriate
- [ ] Source maps enabled for development
- [ ] Minification enabled for production

**Config files are the bridge between development and production—they run in Node.js, not in the app runtime!**

