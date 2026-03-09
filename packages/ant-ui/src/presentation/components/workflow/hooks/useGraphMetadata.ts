/**
 * useGraphMetadata Hook
 * 
 * Agent-Job 조합에 대한 LangGraph 메타데이터 로드
 */

import { useState, useEffect } from 'react';
import { WorkflowGraphMetadata } from '@/domain/models/workflow';

import { API_BASE, authFetch } from '@/infrastructure/http/api';

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
        const response = await authFetch(
          `${API_BASE()}/agents/${agent}/jobs/${job}/graph-metadata`
        );
        
        if (!response.ok) {
          throw new Error(`Failed to load graph metadata: ${response.statusText}`);
        }
        
        const data = await response.json();
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

