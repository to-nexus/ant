export default {
  darkMode: 'class', // Enable class-based dark mode
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        'display': ['Space Grotesk', 'system-ui', 'sans-serif'],
      },
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
        
        // Semantic UI Colors (GitHub/VS Code inspired)
        ui: {
          bg: {
            // App 최하위 배경 (body)
            base: {
              light: '#f6f8fa',    // 약간 회색빛 (GitHub style)
              dark: '#0d1117'      // 매우 어두운 회색
            },
            // 메인 카드/패널 배경 (MainPanel boards)
            primary: {
              light: '#ffffff',    // 순백 (카드처럼 떠보이게)
              dark: '#161b22'      // dark gray-900
            },
            // 사이드바/보조 영역 (Explorer)
            secondary: {
              light: '#f8f9fa',    // 조금 더 밝은 회색
              dark: '#1f2937'      // gray-800
            },
            // 중첩된 요소 (Explorer 내부)
            tertiary: {
              light: '#ffffff',    // 순백
              dark: '#374151'      // gray-700
            },
            // 호버/활성 상태
            hover: {
              light: '#f3f4f6',    // gray-100
              dark: '#30363d'      // 약간 밝은 회색
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
            subtle: {
              light: '#e5e7eb',    // gray-200 - 미묘한 경계선
              dark: '#30363d'      // 어두운 회색
            },
            normal: {
              light: '#d1d5db',    // gray-300 - 일반 경계선
              dark: '#374151'      // gray-700
            },
            emphasis: {
              light: '#9ca3af',    // gray-400 - 강조 경계선
              dark: '#4b5563'      // gray-600
            }
          },
          // Legacy support
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