import { Play, Loader2, X } from 'lucide-react';
import { useState } from 'react';

interface DevServerSetupProps {
  projectId: string;
  defaultPort: number;
  onStart: (port: number) => Promise<void>;
  onClose: () => void;
  isStarting: boolean;
}

/**
 * DevServerSetup
 * 
 * 개발서버 실행 전 설정 UI
 * - 포트번호 입력/수정
 * - 실행 버튼
 */
export function DevServerSetup({ 
  projectId, 
  defaultPort, 
  onStart,
  onClose,
  isStarting 
}: DevServerSetupProps) {
  const [port, setPort] = useState(defaultPort);

  const handleStart = async () => {
    await onStart(port);
  };

  const handlePortChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(e.target.value, 10);
    if (!isNaN(value) && value > 0 && value <= 65535) {
      setPort(value);
    }
  };

  return (
    <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md">
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full"></div>
            <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
              Dev Server Setup
            </span>
          </div>
          
          <button
            onClick={onClose}
            className="p-1 text-blue-600 dark:text-blue-400 
                     hover:text-blue-800 dark:hover:text-blue-300 
                     rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Port Input */}
        <div className="flex items-center gap-3">
          <label 
            htmlFor="dev-server-port" 
            className="text-xs text-blue-700 dark:text-blue-300 font-medium whitespace-nowrap"
          >
            Port
          </label>
          <input
            id="dev-server-port"
            type="number"
            min="1"
            max="65535"
            value={port}
            onChange={handlePortChange}
            disabled={isStarting}
            className="flex-1 px-3 py-2 text-sm border border-blue-300 dark:border-blue-700 rounded-md 
                     bg-white dark:bg-gray-800 
                     text-gray-900 dark:text-gray-100
                     focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400
                     disabled:opacity-50 disabled:cursor-not-allowed"
            placeholder="Enter port number"
          />
        </div>

        {/* Start Button */}
        <button
          onClick={handleStart}
          disabled={isStarting}
          className="w-full px-4 py-2.5 bg-blue-600 dark:bg-blue-700 text-white rounded-md
                   hover:bg-blue-700 dark:hover:bg-blue-600 
                   disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors flex items-center justify-center gap-2
                   text-sm font-medium"
        >
          {isStarting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Starting Server...
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run Dev Server
            </>
          )}
        </button>
      </div>
    </div>
  );
}

