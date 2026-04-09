import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/domain/store';
import { type MaterialInfo, type NamingIssue } from '@ant/shared';
import type { FileNode } from '@/infrastructure/http/api';
import { Package, CheckCircle2, Circle, AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Upload, FileText } from 'lucide-react';

interface MaterialsSectionProps {
  materials: MaterialInfo[];
  namingIssues: NamingIssue[];
}

export function MaterialsSection({ materials, namingIssues }: MaterialsSectionProps) {
  const { t, i18n } = useTranslation('actions');
  const lang = i18n.language as 'en' | 'ko';
  const highlightArtifactDirs = useStore(s => s.highlightArtifactDirs);
  const fileTree = useStore(s => s.fileTree);

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
        <Package className="w-4 h-4" />
        {t('materials.sectionTitle')}
      </h3>

      <div className="space-y-2">
        {materials.map(material => (
          <MaterialRow
            key={material.path}
            material={material}
            lang={lang}
            fileTree={fileTree}
            onHighlight={(path) => highlightArtifactDirs([path])}
          />
        ))}

        {namingIssues.map(issue => (
          <NamingIssueRow key={issue.file} issue={issue} lang={lang} />
        ))}
      </div>
    </div>
  );
}

function MaterialRow({ material, lang, fileTree, onHighlight }: {
  material: MaterialInfo;
  lang: 'en' | 'ko';
  fileTree: FileNode[];
  onHighlight: (path: string) => void;
}) {
  const { t } = useTranslation('actions');
  const [collapsed, setCollapsed] = useState(false);

  if (material.present) {
    const files = getFilesInPath(fileTree, material.path);
    const hasFiles = files.length > 0;

    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 overflow-hidden">
        <button
          type="button"
          onClick={() => hasFiles ? setCollapsed(!collapsed) : onHighlight(material.path)}
          className="w-full px-3 py-2.5 flex items-start gap-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left group"
        >
          <CheckCircle2 className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-white">{material.name}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {material.description[lang] || material.description.en}
            </p>
          </div>
          {hasFiles && (
            collapsed
              ? <ChevronRight className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
              : <ChevronDown className="w-4 h-4 text-gray-400 mt-1 shrink-0" />
          )}
        </button>

        {hasFiles && !collapsed && (
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-1.5 space-y-0.5">
            {files.map(f => (
              <button
                key={f.path}
                type="button"
                onClick={() => onHighlight(f.path)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group"
              >
                <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span className="text-xs text-gray-600 dark:text-gray-300 truncate">{f.name}</span>
                {f.size != null && (
                  <span className="text-[10px] text-gray-400 ml-auto shrink-0">
                    {formatSize(f.size)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const isRequired = material.required;
  const hint = material.formatHint?.[lang] || material.formatHint?.en;

  return (
    <button
      type="button"
      onClick={() => onHighlight(material.path)}
      className={`w-full rounded-lg px-3 py-2.5 flex items-start gap-3 cursor-pointer transition-all group text-left border border-dashed ${
        isRequired
          ? 'bg-red-50/50 dark:bg-red-900/10 border-red-300 dark:border-red-800'
          : 'bg-gray-50/50 dark:bg-gray-800/20 border-gray-300 dark:border-gray-700 opacity-60'
      }`}
    >
      {isRequired
        ? <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
        : <Circle className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-medium ${isRequired ? 'text-red-700 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {material.name}{isRequired ? ' *' : ''}
        </div>
        <p className={`text-xs mt-0.5 ${isRequired ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
          {isRequired ? t('materials.requiredMissing') : t('materials.optionalMissing')}
        </p>
        {hint && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{hint}</p>
        )}
      </div>
      <Upload className="w-4 h-4 text-gray-400 mt-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}

function NamingIssueRow({ issue, lang }: { issue: NamingIssue; lang: 'en' | 'ko' }) {
  const { t } = useTranslation('actions');
  const hintText = issue.hint?.[lang] || issue.hint?.en;

  return (
    <div className="rounded-lg px-3 py-2.5 flex items-start gap-3 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-300 dark:border-amber-800">
      <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-amber-700 dark:text-amber-300">{issue.file}</div>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{t('materials.namingIssue')}</p>
        <p className="text-xs text-gray-500 mt-0.5">
          {t('materials.namingHint', { pattern: issue.expectedPattern })}
          {hintText && <span className="ml-1">({hintText})</span>}
        </p>
      </div>
    </div>
  );
}

function getFilesInPath(tree: FileNode[], dirPath: string): { name: string; path: string; size?: number }[] {
  const parts = dirPath.split('/');
  let nodes: FileNode[] = tree;
  for (const part of parts) {
    const found = nodes.find(n => n.name === part);
    if (!found || found.type !== 'directory' || !found.children) return [];
    nodes = found.children;
  }
  return nodes
    .filter(n => n.type === 'file')
    .map(n => ({ name: n.name, path: n.path, size: n.size }));
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
