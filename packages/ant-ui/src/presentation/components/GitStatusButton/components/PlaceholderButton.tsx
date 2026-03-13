import { Button } from '../../common/button';

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
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium
                   opacity-50 cursor-default
                   text-gray-600 dark:text-gray-400
                   border-gray-300 dark:border-gray-600
                   bg-gray-50 dark:bg-gray-800/50"
      >
        {message}
      </Button>
    </div>
  );
}
