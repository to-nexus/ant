interface ConfigEditorHeaderProps {
  hasChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onDiscardChanges: () => void;
}

export function ConfigEditorHeader({
  hasChanges,
  isSaving,
  onSave,
  onDiscardChanges
}: ConfigEditorHeaderProps) {
  return (
    <div className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2 text-gray-900 dark:text-white">
          <span>⚙️</span>
          <span>Project Configuration</span>
        </h3>
        <div className="flex items-center gap-4">
          <button
            onClick={onDiscardChanges}
            disabled={!hasChanges}
            className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
              hasChanges
                ? 'text-yellow-600 dark:text-yellow-400 hover:text-yellow-700 dark:hover:text-yellow-300'
                : 'text-gray-400 dark:text-gray-600'
            }`}
            title={
              !hasChanges
                ? 'No changes to discard'
                : 'Discard Changes'
            }
          >
            ↺
          </button>
          <button
            onClick={onSave}
            disabled={isSaving || !hasChanges}
            className={`transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xl ${
              hasChanges && !isSaving
                ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
                : 'text-gray-400 dark:text-gray-600'
            }`}
            title={
              isSaving
                ? 'Saving...'
                : !hasChanges
                ? 'No changes to save'
                : 'Save Changes'
            }
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}
