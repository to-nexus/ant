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
    <div className="flex items-center space-x-2">
      <span className="text-lg">{display.emoji}</span>
      <span className={`text-sm font-medium ${display.className}`}>
        {display.text}
      </span>
    </div>
  );
}