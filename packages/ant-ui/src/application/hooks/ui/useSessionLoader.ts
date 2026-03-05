import { useEffect, useRef } from 'react';
import { useStore } from '@/domain/store';
import { loadFromStorage, removeFromStorage, STORAGE_KEYS } from '@/domain/store/storage';

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
    const tRestore = performance.now();
    console.log(`[Timing] useSessionLoader start @${Math.round(tRestore)}ms`);

    // Restore selected project and feature
    (async () => {
      try {
        // ✅ Step 1: Load saved project (prefer sessionStorage, fallback to localStorage backup)
        const projectId = loadFromStorage(STORAGE_KEYS.SELECTED_PROJECT) as string | null;

        if (!projectId) {
          console.log('[useSessionLoader] No saved project found');
          useStore.getState().completeSessionRestore();
          return;
        }
        
        // Verify project still exists
        const currentProjects = useStore.getState().projects;
        if (!currentProjects.includes(projectId)) {
          console.log('[useSessionLoader] Saved project no longer exists, clearing');
          removeFromStorage(STORAGE_KEYS.SELECTED_PROJECT);
          removeFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES);
          useStore.getState().completeSessionRestore();
          return;
        }
        
        // ✅ Step 2: Check project-last-features mapping to get expected feature
        const projectFeatures = (loadFromStorage(STORAGE_KEYS.PROJECT_LAST_FEATURES) || {}) as Record<string, string | undefined>;
        const expectedFeature = projectFeatures[projectId];
        
        console.log(`[Timing] sessionLoader: startSessionRestore +${Math.round(performance.now() - tRestore)}ms (project=${projectId}, feature=${expectedFeature})`);
        
        // ✅ Step 3: Start session restore with expected feature
        useStore.getState().startSessionRestore(expectedFeature);
        
        // ✅ Step 4: Set project (will trigger fetchFeatures)
        useStore.getState().setSelectedProject(projectId);
        console.log(`[Timing] sessionLoader: setSelectedProject done +${Math.round(performance.now() - tRestore)}ms`);
        
        // ✅ Step 5: Wait for features to load (with timeout)
        const maxAttempts = 100;  // 10 seconds max
        let attempts = 0;
        
        const pollForFeatures = setInterval(() => {
          const currentFeatures = useStore.getState().features;
          const isSessionRestoring = useStore.getState().isSessionRestoring;
          
          if (!isSessionRestoring) {
            clearInterval(pollForFeatures);
            return;
          }
          
          if (attempts >= maxAttempts) {
            console.warn(`[Timing] sessionLoader: feature poll TIMEOUT +${Math.round(performance.now() - tRestore)}ms`);
            clearInterval(pollForFeatures);
            useStore.getState().setSelectedFeature(undefined);
            useStore.getState().completeSessionRestore();
            return;
          }
          
          const featuresLoaded = currentFeatures.length > 0 || expectedFeature === undefined;
          
          if (featuresLoaded) {
            clearInterval(pollForFeatures);
            console.log(`[Timing] sessionLoader: features loaded (polls=${attempts}) +${Math.round(performance.now() - tRestore)}ms`);
            
            if (expectedFeature === undefined) {
              useStore.getState().setSelectedFeature(undefined);
              useStore.getState().completeSessionRestore();
            } else {
              const featureExists = currentFeatures.some(f => f.name === expectedFeature);
              
              if (featureExists) {
                useStore.getState().setSelectedFeature(expectedFeature);
              } else {
                console.warn('[useSessionLoader] Expected feature not found, setting to undefined');
                useStore.getState().setSelectedFeature(undefined);
              }
              useStore.getState().completeSessionRestore();
            }
            console.log(`[Timing] sessionLoader: completeSessionRestore +${Math.round(performance.now() - tRestore)}ms`);
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
