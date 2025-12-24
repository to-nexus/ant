import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';

/**
 * ✅ 완전히 리팩토링된 Session Loader
 * 
 * **핵심 원칙**:
 * 1. SSOT는 project-feature 조합
 * 2. Git branch는 project-feature를 추종
 * 3. Session restore 완료 전까지 branch switch 대기
 * 
 * **동작**:
 * 1. 페이지 로드 시 project-last-features 매핑에서 마지막 feature 확인
 * 2. startSessionRestore(expectedFeature) 호출 → 이 시점부터 branch manager가 대기
 * 3. Project 선택
 * 4. Feature 목록 로드 대기
 * 5. expectedFeature 설정 (있으면 해당 feature, 없으면 undefined)
 * 6. completeSessionRestore() 호출 → branch manager가 실행
 */
export function useSessionLoader(connectionStatus: string) {
  const hasRestoredRef = useRef(false);
  
  useEffect(() => {
    // Only restore session after successful connection AND only once
    if (connectionStatus !== 'connected' || hasRestoredRef.current) return;
    
    hasRestoredRef.current = true;
    console.log('[useSessionLoader] 🚀 Starting session restoration (one-time)');

    // Restore selected project and feature
    (async () => {
      try {
        // ✅ Step 1: Load saved project from sessionStorage
        const savedProject = sessionStorage.getItem('ant-ui:selected-project');

        if (!savedProject) {
          console.log('[useSessionLoader] No saved project found');
          // No session to restore, complete immediately
          useStore.getState().completeSessionRestore();
          return;
        }

        const projectId = JSON.parse(savedProject);
        
        // Verify project still exists
        const currentProjects = useStore.getState().projects;
        if (!currentProjects.includes(projectId)) {
          console.log('[useSessionLoader] Saved project no longer exists, clearing');
          sessionStorage.removeItem('ant-ui:selected-project');
          sessionStorage.removeItem('ant-ui:project-last-features');
          useStore.getState().completeSessionRestore();
          return;
        }
        
        console.log('[useSessionLoader] Restoring project:', projectId);
        
        // ✅ Step 2: Check project-last-features mapping to get expected feature
        const projectFeatures = JSON.parse(sessionStorage.getItem('ant-ui:project-last-features') || '{}');
        const expectedFeature = projectFeatures[projectId];  // Can be undefined (base branch)
        
        console.log('[useSessionLoader] Expected feature for project:', expectedFeature || 'undefined (base)');
        
        // ✅ Step 3: Start session restore with expected feature
        // This signals useFeatureBranchManager to WAIT before any branch switching
        useStore.getState().startSessionRestore(expectedFeature);
        
        // ✅ Step 4: Set project (will trigger fetchFeatures)
        useStore.getState().setSelectedProject(projectId);
        
        // ✅ Step 5: Wait for features to load (with timeout)
        const maxAttempts = 100;  // 10 seconds max
        let attempts = 0;
        
        const pollForFeatures = setInterval(() => {
          const currentFeatures = useStore.getState().features;
          const isSessionRestoring = useStore.getState().isSessionRestoring;
          
          // Stop if not restoring anymore (might have been cancelled)
          if (!isSessionRestoring) {
            clearInterval(pollForFeatures);
            return;
          }
          
          // Timeout
          if (attempts >= maxAttempts) {
            console.warn('[useSessionLoader] ⚠️ Feature loading timeout, proceeding with undefined');
            clearInterval(pollForFeatures);
            useStore.getState().setSelectedFeature(undefined);
            useStore.getState().completeSessionRestore();
            return;
          }
          
          // Features loaded (or we're on base branch)
          const featuresLoaded = currentFeatures.length > 0 || expectedFeature === undefined;
          
          if (featuresLoaded) {
            clearInterval(pollForFeatures);
            
            // ✅ Step 6: Set feature based on what we expected
            if (expectedFeature === undefined) {
              // We expect base branch (no feature)
              console.log('[useSessionLoader] ✅ Restoring to base branch (undefined)');
              useStore.getState().setSelectedFeature(undefined);
              useStore.getState().completeSessionRestore();
            } else {
              // We expect a specific feature
              const featureExists = currentFeatures.some(f => f.name === expectedFeature);
              
              if (featureExists) {
                console.log('[useSessionLoader] ✅ Restoring feature:', expectedFeature);
                useStore.getState().setSelectedFeature(expectedFeature);
                useStore.getState().completeSessionRestore();
              } else {
                console.warn('[useSessionLoader] ⚠️ Expected feature not found, setting to undefined');
                useStore.getState().setSelectedFeature(undefined);
                useStore.getState().completeSessionRestore();
              }
            }
          }
          
          attempts++;
        }, 100);
        
      } catch (error) {
        console.error('[useSessionLoader] Failed to restore session:', error);
        // On error, complete restore to unblock branch manager
        useStore.getState().completeSessionRestore();
      }
      
      // ✅ Verify agent and work type were restored correctly
      const currentAgent = useStore.getState().selectedAgent;
      const currentJobType = useStore.getState().selectedJobType;
      console.log('[useSessionLoader] Current agent:', currentAgent);
      console.log('[useSessionLoader] Current job type:', currentJobType);
    })();
  }, [connectionStatus]);
}
