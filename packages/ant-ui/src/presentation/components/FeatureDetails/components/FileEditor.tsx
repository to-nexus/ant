import { Button } from '../../common/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../common/card';

interface FileEditorProps {
  selectedFile: string;
  editedContent: string;
  hasChanges: boolean;
  saving: boolean;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onRevert: () => void;
}

export function FileEditor({
  selectedFile,
  editedContent,
  hasChanges,
  saving,
  onContentChange,
  onSave,
  onRevert
}: FileEditorProps) {
  return (
    <Card className="flex-1">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">File Editor</CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              {selectedFile}
              {hasChanges && <span className="text-orange-500 ml-2">● Modified</span>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onRevert}
              disabled={saving || !hasChanges}
            >
              Revert
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || !hasChanges}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <textarea
          value={editedContent}
          onChange={(e) => onContentChange(e.target.value)}
          className="w-full h-64 p-3 font-mono text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="File content..."
          spellCheck={false}
        />
      </CardContent>
    </Card>
  );
}
