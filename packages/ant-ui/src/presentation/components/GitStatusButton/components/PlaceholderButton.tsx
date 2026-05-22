import { Button } from '@/presentation/components/aurora';

interface PlaceholderButtonProps {
  message: string;
}

export function PlaceholderButton({ message }: PlaceholderButtonProps) {
  return (
    <div className="flex items-center flex-1">
      <Button
        variant="outline"
        size="sm"
        disabled
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium opacity-50 cursor-default"
        style={{
          color: 'var(--text-3)',
          border: '1px solid var(--border-1)',
          background: 'var(--surface-2)',
        }}
      >
        {message}
      </Button>
    </div>
  );
}
