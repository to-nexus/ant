/**
 * Choice System
 * 
 * Triage 결과에 따른 사용자 선택 처리
 */

export * from './types';
export { ChoiceService } from './ChoiceService';

import { ChoiceService } from './ChoiceService';
import { resolveRedisUrl } from '../../core/config/redisUrl';

// Singleton with Redis support (lazily initialized)
let redisChoiceService: ChoiceService | null = null;

/**
 * Get ChoiceService with Redis support for job workers.
 * Redis is always required (unified distributed system); the URL resolves
 * via core/config/redisUrl.ts (local default / cloud fail-fast).
 */
export async function getChoiceService(): Promise<ChoiceService> {
  if (redisChoiceService) {
    return redisChoiceService;
  }
  
  const redisUrl = resolveRedisUrl();

  const { RedisStateStore } = await import('../state/RedisStateStore');
  const stateStore = new RedisStateStore({ url: redisUrl });
  redisChoiceService = new ChoiceService({ stateStore });
  
  console.log(`[getChoiceService] Created ChoiceService with Redis support`);
  return redisChoiceService;
}
