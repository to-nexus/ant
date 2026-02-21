import { useTranslation } from 'react-i18next';
import { ExternalLink, Terminal, Server, Laptop, CheckCircle, AlertCircle } from 'lucide-react';

export function LocalSetupGuide() {
  const { t } = useTranslation('explorer');
  const handleBackToHome = () => {
    // Navigate back to home page
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
            {t('localSetup.heroTitle')}
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
            {t('localSetup.heroDesc')}
          </p>
        </div>

        {/* Why Local? */}
        <div className="mb-12 p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
            {t('localSetup.benefitsTitle')}
          </h3>
          <ul className="space-y-2 text-gray-700 dark:text-gray-300">
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>{t('localSetup.directAccess')}</strong> {t('localSetup.directAccessDesc')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>{t('localSetup.preferredIde')}</strong> {t('localSetup.preferredIdeDesc')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>{t('localSetup.fullPrivacy')}</strong> {t('localSetup.fullPrivacyDesc')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>{t('localSetup.noAuth')}</strong> {t('localSetup.noAuthDesc')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-600 dark:text-green-400">✓</span>
              <span><strong>{t('localSetup.cloudFrontend')}</strong> {t('localSetup.cloudFrontendDesc')}</span>
            </li>
          </ul>
        </div>

        {/* Setup Steps */}
        <div className="space-y-6">
          <h3 className="text-2xl font-bold text-gray-900 dark:text-white">
            {t('localSetup.setupInstructions')}
          </h3>

          {/* Step 1 */}
          <div className="p-6 rounded-xl bg-white dark:bg-gray-800 shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                1
              </div>
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {t('localSetup.cloneRepo')}
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {t('localSetup.cloneRepoDesc')}
                </p>
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-gray-600 dark:text-gray-400">{t('localSetup.terminal')}</span>
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
                  {t('localSetup.viewOnGithub')}
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
                  {t('localSetup.installDeps')}
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {t('localSetup.installDepsDesc')}
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
                      <strong>Note:</strong> {t('localSetup.pnpmNote')} <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">npm install -g pnpm</code>
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
                  {t('localSetup.configEnv')}
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {t('localSetup.configEnvDesc')}
                </p>
                
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-xs mb-3">
                  <code className="text-gray-900 dark:text-gray-100">
                    cp packages/ant-cli/.env.example.local packages/ant-cli/.env
                  </code>
                </div>
                
                <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-xs">
                  <div className="text-gray-500 dark:text-gray-400 mb-1"># packages/ant-cli/.env (key settings)</div>
                  <code className="text-gray-900 dark:text-gray-100">
                    ANT_SERVER_MODE=local
                    <br />
                    ANT_CLI_PORT=4000
                    <br />
                    <br />
                    # Required: Redis for state/queue
                    <br />
                    ANT_REDIS_URL=redis://localhost:16379
                    <br />
                    <br />
                    # Required: Preview Worker URL
                    <br />
                    ANT_PREVIEW_WORKERS=http://localhost:8080
                    <br />
                    <br />
                    # Required: LLM API Key
                    <br />
                    ANTHROPIC_API_KEY=your_api_key_here
                  </code>
                </div>
                <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      <strong>Note:</strong> {t('localSetup.localCloudNote')} (<code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900">local:local</code> auto vs OAuth)
                    </p>
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
                  {t('localSetup.startServices')}
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {t('localSetup.startServicesDesc')}
                </p>
                
                {/* Redis */}
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    {t('localSetup.startRedis')}
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <code className="text-gray-900 dark:text-gray-100">
                      docker run -d -p 16379:6379 redis
                    </code>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t('localSetup.redisDesc')}
                  </p>
                </div>

                {/* API Server */}
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    {t('localSetup.startApi')}
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <code className="text-gray-900 dark:text-gray-100">
                      pnpm dev:server
                    </code>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t('localSetup.backendApi')} <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900">http://localhost:4000</code>
                  </p>
                </div>

                {/* Job Worker */}
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Server className="w-4 h-4" />
                    {t('localSetup.startWorker')}
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <code className="text-gray-900 dark:text-gray-100">
                      pnpm dev:worker
                    </code>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    {t('localSetup.workerDesc')}
                  </p>
                </div>

                {/* Preview Worker */}
                <div>
                  <h5 className="font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                    <Laptop className="w-4 h-4" />
                    {t('localSetup.startPreview')}
                  </h5>
                  <div className="bg-gray-100 dark:bg-gray-900 rounded-lg p-4 font-mono text-sm">
                    <code className="text-gray-900 dark:text-gray-100">
                      pnpm dev:preview-worker
                    </code>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                    Preview Worker on <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900">http://localhost:8080</code>
                  </p>
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
                  {t('localSetup.connectTitle')}
                </h4>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {t('localSetup.connectDesc')}
                </p>
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-green-900 dark:text-green-100 mb-2">
                        {t('localSetup.readyToConnect')}
                      </p>
                      <ol className="text-sm text-green-800 dark:text-green-200 space-y-1 list-decimal list-inside">
                        <li>{t('localSetup.step1Connect')}</li>
                        <li>{t('localSetup.step2Connect')}</li>
                        <li>{t('localSetup.step3Connect')}</li>
                      </ol>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-1 text-sm text-gray-600 dark:text-gray-400">
                  <div className="font-medium text-gray-900 dark:text-white mb-2">{t('localSetup.localServices')}</div>
                  <div>• Redis: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">localhost:16379</code></div>
                  <div>• API Server: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">http://localhost:4000</code></div>
                  <div>• Preview Worker: <code className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">http://localhost:8080</code></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Additional Resources */}
        <div className="mt-12 p-6 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
            {t('localSetup.needHelp')}
          </h3>
          <div className="space-y-2 text-blue-800 dark:text-blue-200">
            <a
              href="https://github.com/to-nexus/ant/blob/main/README.md"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              {t('localSetup.readDocs')}
            </a>
            <a
              href="https://github.com/to-nexus/ant/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:underline"
            >
              <ExternalLink className="w-4 h-4" />
              {t('localSetup.reportIssue')}
            </a>
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-12 text-center">
          <button
            onClick={handleBackToHome}
            className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            {t('localSetup.backToHome')}
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 mt-12">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-sm text-gray-600 dark:text-gray-400">
          <p>
            {t('localSetup.footer')}
          </p>
          <p className="mt-1">
            {t('localSetup.copyright')}
          </p>
        </div>
      </footer>
    </div>
  );
}
