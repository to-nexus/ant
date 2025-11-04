interface ConnectionStatusProps {
  status: 'connected' | 'disconnected' | 'error';
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const getStatusDisplay = () => {
    switch (status) {
      case 'connected':
        return {
          emoji: '🟢',
          text: 'Connected',
          className: 'text-green-600'
        };
      case 'disconnected':
        return {
          emoji: '🔴',
          text: 'Disconnected',
          className: 'text-red-600'
        };
      case 'error':
        return {
          emoji: '🟡',
          text: 'Connection Error',
          className: 'text-yellow-600'
        };
      default:
        return {
          emoji: '⚪',
          text: 'Unknown',
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