/**
 * useGraphMetadata Hook
 * 
 * Agent-Job 조합에 대한 LangGraph 메타데이터 로드
 */

import { useState, useEffect } from 'react';
import { WorkflowGraphMetadata } from '@/types/workflow';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api';

export function useGraphMetadata(agent: string, job: string) {
  const [metadata, setMetadata] = useState<WorkflowGraphMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    if (!agent || !job) {
      setLoading(false);
      return;
    }
    
    async function loadMetadata() {
      setLoading(true);
      setError(null);
      
      try {
        console.log(`[useGraphMetadata] Fetching metadata for ${agent}/${job}`);
        
        const response = await fetch(
          `${API_BASE}/agents/${agent}/jobs/${job}/graph-metadata`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to load graph metadata: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`[useGraphMetadata] Loaded ${data.nodes?.length || 0} nodes`);
        setMetadata(data);
      } catch (err) {
        console.error('[useGraphMetadata] Error:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    }
    
    loadMetadata();
  }, [agent, job]);
  
  return { metadata, loading, error };
}

