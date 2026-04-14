/**
 * Redis Constants - Re-export from core/constants/redis
 * 
 * Canonical source: core/constants/redis.ts
 * This file exists for backward compatibility with infrastructure/periphery/composition consumers.
 */
export {
  APP_PREFIX,
  REDIS_DOMAINS,
  REDIS_KEYS,
  REDIS_TTL,
  CHANNEL_DOMAINS,
  REDIS_CHANNELS,
  getRealtimeBroadcastChannel,
  getRealtimeWorkflowChannel,
  parseChannelUserContext,
  getChatSyncChannel,
} from '../../core/constants/redis';
