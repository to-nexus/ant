/**
 * Go 에러 패턴
 * 
 * Go 컴파일러, go vet, go mod 등의 에러 출력을 분석하여 구조화된 진단 결과를 생성.
 */

import { ErrorPattern, ErrorLayer, DiagnosisResult } from '../types';

export const GO_PATTERNS: ErrorPattern[] = [
  // ========================================
  // ENVIRONMENT LAYER - 사용자 액션 필요
  // ========================================
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /GOROOT.*not\s+set/i,
      /cannot\s+find\s+GOROOT/i,
      /GOROOT.*does\s+not\s+exist/i,
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'GOROOT is not set or points to a non-existent directory',
      rootCause: 'Go installation is missing or GOROOT environment variable is misconfigured',
      suggestedActions: [
        'Verify Go installation: go version',
        'Set GOROOT: export GOROOT=$(go env GOROOT)',
        'Reinstall Go: https://go.dev/dl/',
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical',
    }),
  },
  {
    layer: ErrorLayer.ENVIRONMENT,
    patterns: [
      /GOPATH.*not\s+set/i,
      /cannot\s+find\s+GOPATH/i,
    ],
    severity: 'major',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'environment_issue',
      layer: ErrorLayer.ENVIRONMENT,
      message: 'GOPATH is not set',
      rootCause: 'GOPATH environment variable is not configured (Go < 1.11 without modules)',
      suggestedActions: [
        'Set GOPATH: export GOPATH=$HOME/go',
        'Or use Go modules (go mod init) to avoid GOPATH dependency',
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'major',
    }),
  },

  // ========================================
  // TOOLCHAIN LAYER - Go 설치 문제
  // ========================================
  {
    layer: ErrorLayer.TOOLCHAIN,
    patterns: [
      /command\s+not\s+found:\s*go\b/,
      /go:\s*command\s+not\s+found/,
      /'go'\s+is\s+not\s+recognized/,
      /exec:\s*"go":\s*executable\s+file\s+not\s+found/,
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: () => ({
      type: 'missing_build_tool',
      layer: ErrorLayer.TOOLCHAIN,
      message: 'Go toolchain is not installed or not in PATH',
      rootCause: 'Go binary is not available in the system PATH',
      suggestedActions: [
        'Install Go: https://go.dev/dl/',
        'Verify PATH includes Go bin: echo $PATH',
        'Check Go version: go version',
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical',
    }),
  },
  {
    layer: ErrorLayer.TOOLCHAIN,
    patterns: [
      /go:\s+module.*requires\s+go\s+>=?\s*([\d.]+)/,
      /go:\s+go\.mod\s+requires\s+go\s+>=?\s*([\d.]+)/,
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: (match) => ({
      type: 'version_mismatch',
      layer: ErrorLayer.TOOLCHAIN,
      message: `Module requires a newer Go version: ${match[1] || 'unknown'}`,
      rootCause: 'Installed Go version is older than what go.mod requires',
      suggestedActions: [
        'Upgrade Go: https://go.dev/dl/',
        'Check current version: go version',
        'Or lower the go directive in go.mod if compatible',
      ],
      isRetryable: false,
      canLLMFix: false,
      severity: 'critical',
    }),
  },

  // ========================================
  // DEPENDENCY LAYER - 패키지/모듈 문제
  // ========================================
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /no\s+required\s+module\s+provides\s+package\s+(\S+)/,
      /cannot\s+find\s+module\s+providing\s+package\s+(\S+)/,
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'missing_dependency',
      layer: ErrorLayer.DEPENDENCY,
      message: `Missing Go module: ${match[1] || 'unknown package'}`,
      rootCause: 'Required module is not listed in go.mod',
      suggestedActions: [
        `Run: go get ${match[1] || '<package>'}`,
        'Then run: go mod tidy',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical',
    }),
  },
  {
    layer: ErrorLayer.DEPENDENCY,
    patterns: [
      /go:\s+(\S+)@(\S+):\s+verifying\s+module.*SECURITY\s+ERROR/i,
      /go:\s+(\S+):\s+checksum\s+mismatch/,
    ],
    severity: 'critical',
    canLLMFix: false,
    diagnosis: (match) => ({
      type: 'dependency_integrity',
      layer: ErrorLayer.DEPENDENCY,
      message: `Module checksum verification failed: ${match[1] || 'unknown'}`,
      rootCause: 'Module checksum in go.sum does not match downloaded module',
      suggestedActions: [
        'Delete go.sum and run: go mod tidy',
        'Check GONOSUMCHECK / GOFLAGS env vars',
        'Verify module source integrity',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical',
    }),
  },

  // ========================================
  // CONFIGURATION LAYER - go.mod 설정 문제
  // ========================================
  {
    layer: ErrorLayer.CONFIGURATION,
    patterns: [
      /go\.mod.*not\s+found/i,
      /no\s+go\.mod\s+file/i,
      /outside\s+.*module/i,
    ],
    severity: 'critical',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'missing_config',
      layer: ErrorLayer.CONFIGURATION,
      message: 'go.mod not found - project is not initialized as a Go module',
      rootCause: 'Missing go.mod file in project root',
      suggestedActions: [
        'Initialize module: go mod init <module-name>',
        'Ensure commands are run from the directory containing go.mod',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'critical',
    }),
  },

  // ========================================
  // CODE LAYER - 소스 코드 에러
  // ========================================
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /undefined:\s+(\w+)/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'type_error',
      layer: ErrorLayer.CODE,
      message: `Undefined identifier: ${match[1] || 'unknown'}`,
      rootCause: 'Referenced identifier is not declared in scope',
      suggestedActions: [
        'Check for typos in the identifier name',
        'Ensure the identifier is declared or imported',
        'Check package visibility (uppercase = exported)',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major',
    }),
  },
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /cannot\s+refer\s+to\s+unexported\s+name\s+(\S+)/,
      /(\w+)\.(\w+)\s+.*unexported/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'type_error',
      layer: ErrorLayer.CODE,
      message: `Cannot access unexported name: ${match[1] || 'unknown'}`,
      rootCause: 'Attempting to access a lowercase (unexported) identifier from another package',
      suggestedActions: [
        'Capitalize the first letter to export the identifier',
        'Or access it from within the same package',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major',
    }),
  },
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /imported\s+and\s+not\s+used:\s+"([^"]+)"/,
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'lint_error',
      layer: ErrorLayer.CODE,
      message: `Imported and not used: "${match[1] || 'unknown'}"`,
      rootCause: 'Go requires all imports to be used',
      suggestedActions: [
        `Remove unused import: "${match[1] || 'unknown'}"`,
        'Or use the imported package',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'minor',
    }),
  },
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /declared\s+(and|but)\s+not\s+used/,
    ],
    severity: 'minor',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'lint_error',
      layer: ErrorLayer.CODE,
      message: 'Variable declared but not used',
      rootCause: 'Go requires all declared variables to be used',
      suggestedActions: [
        'Remove the unused variable declaration',
        'Or use the variable (assign with _ if intentionally unused)',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'minor',
    }),
  },
  {
    layer: ErrorLayer.CODE,
    patterns: [
      /cannot\s+use\s+(.+?)\s+\(.*type\s+(.+?)\)\s+as\s+type\s+(.+)/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: (match) => ({
      type: 'type_error',
      layer: ErrorLayer.CODE,
      message: `Type mismatch: cannot use ${match[2] || 'unknown'} as ${match[3] || 'unknown'}`,
      rootCause: 'Incompatible types in assignment or function argument',
      suggestedActions: [
        'Check type compatibility and add conversion if needed',
        'Verify function parameter types match argument types',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major',
    }),
  },

  // ========================================
  // BUILD LAYER - 빌드 프로세스 문제
  // ========================================
  {
    layer: ErrorLayer.BUILD,
    patterns: [
      /build\s+constraints\s+exclude\s+all\s+Go\s+files/,
      /no\s+Go\s+files\s+in/,
    ],
    severity: 'major',
    canLLMFix: true,
    diagnosis: () => ({
      type: 'build_error',
      layer: ErrorLayer.BUILD,
      message: 'No Go files found in build target',
      rootCause: 'Build constraints exclude all files, or directory has no .go files',
      suggestedActions: [
        'Check build tags and GOOS/GOARCH settings',
        'Verify .go files exist in the target directory',
        'Ensure build constraint comments (//go:build) are correct',
      ],
      isRetryable: true,
      canLLMFix: true,
      severity: 'major',
    }),
  },
];
