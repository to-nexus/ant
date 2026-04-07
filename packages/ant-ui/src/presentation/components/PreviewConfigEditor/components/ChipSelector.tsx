/**
 * Chip/badge selector: renders a row of selectable chips.
 * Only one chip can be active at a time.
 */
export function ChipSelector({
  options,
  value,
  onChange,
  colorMap,
  disabled,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
  colorMap?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const isSelected = value === opt;
        const activeColor = colorMap?.[opt] || 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
        return (
          <button
            key={opt}
            onClick={() => !disabled && onChange(opt)}
            disabled={disabled}
            className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
              isSelected
                ? activeColor
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
