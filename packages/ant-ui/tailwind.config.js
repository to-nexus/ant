export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Primary Brand Colors
        primary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49'
        },
        
        // Extended Gray Palette
        gray: {
          850: '#1a202c'  // gray-850 (between 800 and 900)
        },
        
        // Semantic Colors for Task Status
        status: {
          todo: {
            light: '#3b82f6',      // blue-500
            dark: '#60a5fa',       // blue-400
            bg: {
              light: '#eff6ff',    // blue-50
              dark: '#1e3a8a'      // blue-900
            }
          },
          progress: {
            light: '#f97316',      // orange-500
            dark: '#fb923c',       // orange-400
            bg: {
              light: '#fff7ed',    // orange-50
              dark: '#7c2d12'      // orange-900
            }
          },
          completed: {
            light: '#22c55e',      // green-500
            dark: '#4ade80',       // green-400
            bg: {
              light: '#f0fdf4',    // green-50
              dark: '#14532d'      // green-900
            }
          }
        },
        
        // Semantic UI Colors
        ui: {
          bg: {
            primary: {
              light: '#ffffff',
              dark: '#111827'      // gray-900
            },
            secondary: {
              light: '#f9fafb',    // gray-50
              dark: '#1f2937'      // gray-800
            },
            tertiary: {
              light: '#f3f4f6',    // gray-100
              dark: '#374151'      // gray-700
            }
          },
          text: {
            primary: {
              light: '#111827',    // gray-900
              dark: '#f9fafb'      // gray-50
            },
            secondary: {
              light: '#4b5563',    // gray-600
              dark: '#d1d5db'      // gray-300
            },
            tertiary: {
              light: '#6b7280',    // gray-500
              dark: '#9ca3af'      // gray-400
            },
            muted: {
              light: '#9ca3af',    // gray-400
              dark: '#6b7280'      // gray-500
            }
          },
          border: {
            light: '#e5e7eb',      // gray-200
            dark: '#374151'        // gray-700
          },
          border_strong: {
            light: '#d1d5db',      // gray-300
            dark: '#4b5563'        // gray-600
          }
        },
        
        // Badge & Tag Colors
        badge: {
          feature: {
            light: '#3b82f6',
            dark: '#60a5fa',
            bg: { light: '#dbeafe', dark: '#1e3a8a' }
          },
          setup: {
            light: '#8b5cf6',
            dark: '#a78bfa',
            bg: { light: '#ede9fe', dark: '#5b21b6' }
          },
          error: {
            light: '#ef4444',
            dark: '#f87171',
            bg: { light: '#fee2e2', dark: '#7f1d1d' }
          },
          final: {
            light: '#10b981',
            dark: '#34d399',
            bg: { light: '#d1fae5', dark: '#065f46' }
          }
        }
      },
      keyframes: {
        wiggle: {
          '0%, 100%': { transform: 'rotate(-10deg)' },
          '50%': { transform: 'rotate(10deg)' }
        },
        gradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' }
        },
        shine: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        gradient: 'gradient 2s ease infinite',
        shine: 'shine 0.8s ease-in-out'
      }
    }
  },
  plugins: []
};