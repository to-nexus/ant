import { ExternalLink, Terminal, Server, Laptop, CheckCircle, AlertCircle } from 'lucide-react';
import { useStore } from '@/domain/store';

export function LocalSetupGuide() {
  const backendMode = useStore((state) => state.backendMode);
  const setBackendMode = useStore((state) => state.setBackendMode);
  
  // ✅ Read backend URL from environment variables
  const localBackendBase = import.meta.env.VITE_LOCAL_BACKEND_BASE || 'http://localhost:4100/api';
  const backendUrl = localBackendBase.replace('/api', ''); // Remove /api suffix for display
  const backendPort = new URL(backendUrl).port || '4100';
  
  const handleBackToHome = () => {
    // ✅ Cloud Backend를 사용 중이었다면 Cloud 모드 유지
    // backendMode는 변경하지 않고 홈으로만 이동
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 transition-colors pt-[60px]">{/* pt-[60px] for GNB */}

      {/* Main Content */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="mb-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-blue-100 dark:bg-blue-900">
            <Laptop className="w-8 h-8 text-blue-600 dark:text-blue-400" />
          </div>
          <h2 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Run ANT Works on Your Local Machine
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            Get full control over your development environment by running ANT Works locally. 
            Access your local files directly and use your preferred IDE.
          </p>
        </div>

        {/* Why Local? */}
        <div className="mb-12 p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            Benefits of Local Mode
          </h3>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>Direct File Access:</strong> Work with your local codebase without uploading</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>Your Preferred IDE:</strong> Use Cursor, VS Code, or any editor you love</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>Full Privacy:</strong> All data stays on your machine</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>No Authentication:</strong> Skip sign-up, start coding immediately</span>
            </li>
          </ul>
        </div>

        {/* Setup Steps */}
        <div className="space-y-6">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
            Setup Instructions
          </h3>

          {/* Step 1 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                1
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Clone the Repository
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Clone the ANT Works repository from GitHub to your local machine.
                </p>
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-600 dark:text-gray-400">Terminal</span>
                    <Terminal className="w-4 h-4 text-gray-400" />
                  </div>
                  <code className="text-gray-900 dark:text-gray-100">
                    git clone https://github.com/to-nexus/ant.git
                    <br />
                    cd ant
                  </code>
                </div>
                <a
                  href="https://github.com/to-nexus/ant"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 mt-3 text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ExternalLink className="w-4 h-4" />
                  View on GitHub
                </a>
              </div>
            </div>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                2
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Install Dependencies
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Install all required packages using pnpm (Node.js v22+ required).
                </p>
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm mb-3">
                  <code className="text-gray-900 dark:text-gray-100">
                    pnpm install
                  </code>
                </div>
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> If you don't have pnpm, install it with: <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">npm install -g pnpm</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                3
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Configure Environment
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Set up environment variables for local development.
                </p>
                
                {/* Backend Config */}
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    Backend (ant-cli)
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-xs">
                    <div className="text-gray-500 dark:text-gray-400 mb-1"># packages/ant-cli/.env</div>
                    <code className="text-gray-900 dark:text-gray-100">
                      ANT_SERVER_MODE=local
                      <br />
                      PORT={backendPort}
                      <br />
                      WORKSPACES_PATH=~/ant-workspaces
                      <br />
                      <br />
                      # LLM Provider (required)
                      <br />
                      AI_MODEL_PROVIDER=anthropic
                      <br />
                      ANTHROPIC_API_KEY=your_api_key_here
                      <br />
                      <br />
                      # Optional: specify model
                      <br />
                      # AI_MODEL_NAME=claude-3-5-sonnet-20241022
                    </code>
                  </div>
                  <div className="mt-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                    <p className="text-xs text-blue-700 dark:text-blue-300">
                      <strong>Note:</strong> <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900">WORKSPACES_PATH</code> can be absolute, relative, or use <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900">~/path</code> (tilde expansion supported)
                    </p>
                  </div>
                </div>

                {/* Frontend Config */}
                <div>
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Laptop className="w-4 h-4" />
                    Frontend (ant-ui)
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-xs">
                    <div className="text-gray-500 dark:text-gray-400 mb-1"># packages/ant-ui/.env</div>
                    <code className="text-gray-900 dark:text-gray-100">
                      VITE_FRONTEND_MODE=local
                      <br />
                      VITE_TARGET_BACKEND_MODE=local
                      <br />
                      VITE_LOCAL_BACKEND_BASE={localBackendBase}
                      <br />
                      VITE_CLOUD_BACKEND_BASE=https://api.ant.works/api
                    </code>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                4
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Start Development Servers
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Launch both backend and frontend servers.
                </p>
                
                {/* Option 1: All-in-one */}
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2">
                    Option 1: Start Everything (Recommended)
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <code className="text-gray-900 dark:text-gray-100">
                      pnpm dev
                    </code>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    This starts ant-cli (backend), ant-ui (frontend), and ant-ide (web IDE) together.
                  </p>
                </div>

                {/* Option 2: Separate terminals */}
                <div>
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2">
                    Option 2: Separate Terminals
                  </h5>
                  <div className="space-y-2">
                    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1"># Terminal 1: Backend</div>
                      <code className="text-gray-900 dark:text-gray-100">
                        pnpm dev:cli
                      </code>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1"># Terminal 2: Frontend</div>
                      <code className="text-gray-900 dark:text-gray-100">
                        pnpm dev:ui
                      </code>
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                      <div className="text-gray-500 dark:text-gray-400 text-xs mb-1"># Terminal 3: Web IDE (optional)</div>
                      <code className="text-gray-900 dark:text-gray-100">
                        pnpm dev:ide
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Step 5 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center font-bold">
                ✓
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  Access the Application
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  Open your browser and navigate to the local frontend.
                </p>
                <a
                  href="http://localhost:4200"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 text-white bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 rounded-lg shadow-md hover:shadow-lg transition-all font-medium"
                >
                  <ExternalLink className="w-5 h-5" />
                  Open http://localhost:4200
                </a>
                <div className="mt-4 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <div>• Backend API: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">{backendUrl}</code></div>
                  <div>• Frontend UI: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">http://localhost:4200</code></div>
                  <div>• Web IDE: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">http://localhost:4400</code></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Resources */}
        <div className="mt-12 p-6 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
            Need Help?
          </h3>
          <div className="space-y-2 text-blue-800 dark:text-blue-200">
            <a
              href="https://github.com/to-nexus/ant/blob/main/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              Read the Documentation
            </a>
            <a
              href="https://github.com/to-nexus/ant/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              Report an Issue
            </a>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-12 text-center">
          <button
            onClick={handleBackToHome}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            ANT Works - AI-Native Development Platform
          </p>
          <p className="mt-1">
            © 2025 Nexus. Open Source under MIT License.
          </p>
        </div>
      </footer>
    </div>
  );
}

