import { Button } from '../../common/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../common/card';

interface FileEditorProps {
  selectedFile: string;
  editedContent: string;
  hasChanges: boolean;
  saving: boolean;
  isImageFile: boolean;
  binaryPreviewUrl: string | null;
  onContentChange: (content: string) => void;
  onSave: () => void;
  onRevert: () => void;
}

export function FileEditor({
  selectedFile,
  editedContent,
  hasChanges,
  saving,
  isImageFile,
  binaryPreviewUrl,
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
            {isImageFile && binaryPreviewUrl && (
              <a
                href={binaryPreviewUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline self-center"
                title="새 탭에서 열기"
              >
                Open
              </a>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={onRevert}
              disabled={saving || (!hasChanges && !isImageFile)}
            >
              Revert
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              disabled={saving || !hasChanges || isImageFile}
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isImageFile ? (
          <div className="w-full">
            {binaryPreviewUrl ? (
              <div className="w-full flex justify-center">
                <img
                  src={binaryPreviewUrl}
                  alt={selectedFile}
                  className="max-w-full max-h-[60vh] object-contain rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">이미지 프리뷰를 불러오는 중...</div>
            )}
          </div>
        ) : (
          <textarea
            value={editedContent}
            onChange={(e) => onContentChange(e.target.value)}
            className="w-full h-64 p-3 font-mono text-sm border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="File content..."
            spellCheck={false}
          />
        )}
      </CardContent>
    </Card>
  );
}
