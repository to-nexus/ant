import { useTranslation } from 'react-i18next';

interface ConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'error';
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { t } = useTranslation('common');

  const getStatusDisplay = () => {
    switch (status) {
      case 'connected':
        return {
          emoji: '🟢',
          text: t('status.connected'),
          className: 'text-green-600'
        };
      case 'disconnected':
        return {
          emoji: '🔴',
          text: t('status.disconnected'),
          className: 'text-red-600'
        };
      case 'error':
        return {
          emoji: '🟡',
          text: t('status.connectionError'),
          className: 'text-yellow-600'
        };
      default:
        return {
          emoji: '⚪',
          text: t('status.unknown'),
          className: 'text-gray-600'
        };
    }
  };

  const display = getStatusDisplay();

  return (
    <div className="flex items-center gap-1.5" title={display.text}>
      <span className="text-sm">{display.emoji}</span>
      <span className={`hidden sm:inline text-xs font-medium ${display.className}`}>{display.text}</span>
    </div>
  );
}