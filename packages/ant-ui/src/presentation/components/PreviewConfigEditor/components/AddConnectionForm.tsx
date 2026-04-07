import { useState, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import type { ServiceConnection, ConnectionResolution } from '@/infrastructure/http/api';
import { RESOLUTION_COLORS, RESOLUTION_OPTIONS, CATEGORY_CHIP_COLORS } from '../constants';
import { ChipSelector } from './ChipSelector';

export function AddConnectionForm({
  onAdd,
  onCancel,
}: {
  onAdd: (conn: ServiceConnection) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<'business' | 'infrastructure'>('business');
  const [name, setName] = useState('');
  const [envVar, setEnvVar] = useState('');
  const [resType, setResType] = useState<'url' | 'docker' | 'ant-project'>('url');
  const [urlInput, setUrlInput] = useState('');
  const [dockerService, setDockerService] = useState('');
  const [connectionString, setConnectionString] = useState('');

  const allowedRes = RESOLUTION_OPTIONS[category] || ['url'];

  const derivedValue = useMemo(() => {
    if (resType === 'url') return urlInput;
    if (resType === 'docker') return connectionString;
    if (resType === 'ant-project') return '(auto)';
    return '';
  }, [resType, urlInput, connectionString]);

  const handleCategoryChange = (cat: string) => {
    const c = cat as 'business' | 'infrastructure';
    setCategory(c);
    const allowed = RESOLUTION_OPTIONS[c] || ['url'];
    if (!allowed.includes(resType)) setResType(allowed[0] as typeof resType);
  };

  const handleSubmit = () => {
    if (!name || !envVar) return;
    let resolution: ConnectionResolution;
    let value = '';
    if (resType === 'docker') {
      resolution = { type: 'docker', service: dockerService || name };
      value = connectionString;
    } else if (resType === 'ant-project') {
      resolution = { type: 'ant-project', projectId: 'self', feature: 'self' };
    } else {
      resolution = { type: 'url', url: urlInput };
      value = urlInput;
    }
    onAdd({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      category,
      envVar,
      value,
      resolution,
      source: '*',
    });
  };

  return (
    <div className="px-2.5 py-2.5 rounded-md border border-dashed border-gray-300 dark:border-gray-600 space-y-2.5">
      {/* A. Name + Cancel */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 px-2 py-1 text-xs font-medium rounded border border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
          placeholder="Connection name (e.g. PostgreSQL)"
        />
        <button onClick={onCancel} className="p-0.5 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0" title="Cancel">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* B. Category + Resolution chips */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <ChipSelector
          options={['business', 'infrastructure']}
          value={category}
          onChange={handleCategoryChange}
          colorMap={CATEGORY_CHIP_COLORS}
        />
        <span className="text-gray-300 dark:text-gray-600 text-xs">|</span>
        <ChipSelector
          options={allowedRes}
          value={resType}
          onChange={(v) => setResType(v as typeof resType)}
          colorMap={RESOLUTION_COLORS}
        />
      </div>

      {/* C. Resolution Detail */}
      <div className="space-y-1.5">
        {resType === 'url' && (
          <div>
            <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="http://localhost:3000/api"
              className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                       bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            />
          </div>
        )}
        {resType === 'docker' && (
          <>
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Service</label>
              <input
                type="text"
                value={dockerService}
                onChange={(e) => setDockerService(e.target.value)}
                placeholder="e.g. database, redis"
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                         bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 dark:text-gray-400 block mb-0.5">Connection</label>
              <input
                type="text"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                placeholder="postgres://user:pw@host:5432/db"
                className="w-full px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600
                         bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
              />
            </div>
          </>
        )}
        {resType === 'ant-project' && (
          <div className="text-[10px] text-gray-400 dark:text-gray-500 italic px-1">
            Project/feature will be configured after adding.
          </div>
        )}
      </div>

      {/* D. Env Injection Preview */}
      <div className="rounded border border-dashed border-gray-300 dark:border-gray-600 px-2.5 py-1.5">
        <div className="text-[9px] text-gray-400 dark:text-gray-500 mb-1 font-medium uppercase tracking-wider">.env</div>
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={envVar}
            onChange={(e) => setEnvVar(e.target.value)}
            className="w-32 px-1.5 py-0.5 text-[11px] font-mono rounded border border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200"
            placeholder="ENV_VAR"
          />
          <span className="text-[11px] text-gray-400 font-mono">=</span>
          <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400 break-all flex-1 min-w-0">
            {derivedValue || <span className="text-gray-300 dark:text-gray-600 italic">empty</span>}
          </span>
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!name || !envVar}
        className="flex items-center gap-1 px-3 py-1 text-xs font-medium rounded
                 bg-blue-600 text-white hover:bg-blue-700
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}
