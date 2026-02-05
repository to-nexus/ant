/**
 * Choice System
 * 
 * Triage 결과에 따른 사용자 선택 처리
 */

export * from './types';
export { ChoiceService, choiceService } from './ChoiceService';

// Import for internal use
import { ChoiceService, choiceService as defaultChoiceService } from './ChoiceService';

// Singleton with Redis support (lazily initialized)
let redisChoiceService: ChoiceService | null = null;

/**
 * Get ChoiceService with Redis support for job workers
 * Creates a new instance with Redis stateStore if ANT_REDIS_URL is set
 */
export async function getChoiceService(): Promise<ChoiceService> {
  // Return cached instance if available
  if (redisChoiceService) {
    return redisChoiceService;
  }
  
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    console.log(`[getChoiceService] ANT_REDIS_URL not set, using local choiceService`);
    return defaultChoiceService;
  }
  
  try {
    const { RedisStateStore } = await import('../state/RedisStateStore');
    
    const stateStore = new RedisStateStore({ url: redisUrl });
    redisChoiceService = new ChoiceService({ stateStore });
    
    console.log(`[getChoiceService] Created ChoiceService with Redis support`);
    return redisChoiceService;
  } catch (error) {
    console.error(`[getChoiceService] Failed to create Redis ChoiceService:`, error);
    return defaultChoiceService;
  }
}
