import ReactDOM from 'react-dom/client';
import App from './presentation/App';
import './index.css';

// ✅ Disable browser's automatic scroll restoration
// This prevents conflicts with Virtuoso's scroll management in chat
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <App />
);