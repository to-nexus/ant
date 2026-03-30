import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './presentation/App';
import './index.css';
import './i18n';

if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <BrowserRouter basename="/app">
    <App />
  </BrowserRouter>
);