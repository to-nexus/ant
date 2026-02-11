/**
 * Choice System
 * 
 * Triage 결과에 따른 사용자 선택 처리
 */

export * from './types';
export { ChoiceService } from './ChoiceService';

import { ChoiceService } from './ChoiceService';

// Singleton with Redis support (lazily initialized)
let redisChoiceService: ChoiceService | null = null;

/**
 * Get ChoiceService with Redis support for job workers.
 * Always requires ANT_REDIS_URL (unified distributed system).
 */
export async function getChoiceService(): Promise<ChoiceService> {
  if (redisChoiceService) {
    return redisChoiceService;
  }
  
  const redisUrl = process.env.ANT_REDIS_URL;
  if (!redisUrl) {
    throw new Error('[getChoiceService] ANT_REDIS_URL is required — Redis is always needed in the unified distributed system');
  }
  
  const { RedisStateStore } = await import('../state/RedisStateStore');
  const stateStore = new RedisStateStore({ url: redisUrl });
  redisChoiceService = new ChoiceService({ stateStore });
  
  console.log(`[getChoiceService] Created ChoiceService with Redis support`);
  return redisChoiceService;
}
