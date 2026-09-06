/**
 * Chat turn buffer (in-flight streaming) — every mutation is a Lua script so
 * concurrent appenders cannot lose each other, plus the pause/worker-cycle
 * sequence counters.
 *
 * One layer of the RedisStateStore inheritance chain (see RedisCoreStore.ts —
 * the chain exists because tests instantiate via Object.create(prototype), so
 * methods must live on the prototype chain, not behind a ctx object).
 */

import type {
  TurnBufferData,
  PendingCardSnapshot,
  TurnBufferSnapshot,
} from '../../../core/ports/stateStore';
import {
  REDIS_TTL,
  getTurnBufferKey,
  getTurnBufferIndexKey,
  getTurnBufferIndexMember,
  parseTurnBufferIndexMember,
  getCancelledPauseSeqKey,
  getWorkerCycleSeqKey,
} from '../redisConstants';
import { logger } from '../../../utils/logger';
import { RedisIdeRegistryStore } from './RedisIdeRegistryStore';

export class RedisTurnBufferStore extends RedisIdeRegistryStore {
  // ============================================
  // Chat Turn Buffer (in-flight streaming)
  // ============================================

  async getTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<TurnBufferData | null> {
    const key = getTurnBufferKey(sessionKey, turnId, workerScope);
    const data = await this.redis.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as TurnBufferData;
    } catch (e) {
      logger.error(`Failed to parse turn buffer: ${key}`, { component: 'RedisStateStore' }, e);
      return null;
    }
  }

  // Every turn-buffer mutation is a Lua script: the buffer is one JSON blob
  // written concurrently by the LLM stream loop and the unawaited
  // ToolFileStreamer chain, so a JS-side GET → modify → SETEX loses whichever
  // write lands second (head-truncated `assistant_thinking` records).

  /** Shared Lua tail: persist `buf` (or drop the key when nothing remains). */
  private static readonly TURN_BUFFER_PERSIST_LUA = `
    local function hasContent(buf)
      if buf.text ~= nil and buf.text ~= '' then return true end
      if buf.thinking ~= nil and buf.thinking ~= '' then return true end
      if buf.pendingCards ~= nil then
        for _ in pairs(buf.pendingCards) do return true end
      end
      return false
    end
    local function persist(buf)
      if hasContent(buf) then
        redis.call('SETEX', KEYS[1], tonumber(ARGV[1]), cjson.encode(buf))
        redis.call('SADD', KEYS[2], ARGV[2])
        redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1]))
      else
        redis.call('DEL', KEYS[1])
        redis.call('SREM', KEYS[2], ARGV[2])
      end
    end
    local raw = redis.call('GET', KEYS[1])
    local buf = raw and cjson.decode(raw) or {}
  `;

  private static readonly TURN_BUFFER_APPEND_LUA = RedisTurnBufferStore.TURN_BUFFER_PERSIST_LUA + `
    local kind = ARGV[3]
    if kind == 'text' then
      buf.text = (buf.text or '') .. ARGV[4]
    elseif kind == 'thinking' then
      buf.thinking = (buf.thinking or '') .. ARGV[4]
    else
      local cards = buf.pendingCards or {}
      local card = cards[ARGV[5]]
      if card then
        card.streamedOutput = (card.streamedOutput or '') .. ARGV[4]
      else
        cards[ARGV[5]] = { cardId = ARGV[5], statusType = 'tool_action', metadata = cjson.decode('{}'), streamedOutput = ARGV[4] }
      end
      buf.pendingCards = cards
    end
    persist(buf)
    return 1
  `;

  private static readonly TURN_BUFFER_TAKE_LUA = RedisTurnBufferStore.TURN_BUFFER_PERSIST_LUA + `
    if raw == false then return false end
    local value = buf[ARGV[3]]
    buf[ARGV[3]] = nil
    persist(buf)
    return value
  `;

  private static readonly TURN_BUFFER_SET_CARD_LUA = RedisTurnBufferStore.TURN_BUFFER_PERSIST_LUA + `
    local card = cjson.decode(ARGV[3])
    local cards = buf.pendingCards or {}
    local existing = cards[card.cardId]
    if existing then
      local streamed = existing.streamedOutput
      for k, v in pairs(card) do existing[k] = v end
      existing.streamedOutput = streamed
    else
      cards[card.cardId] = card
    end
    buf.pendingCards = cards
    persist(buf)
    return 1
  `;

  private static readonly TURN_BUFFER_CLEAR_CARD_LUA = RedisTurnBufferStore.TURN_BUFFER_PERSIST_LUA + `
    if raw == false then return 0 end
    if buf.pendingCards == nil or buf.pendingCards[ARGV[3]] == nil then return 0 end
    buf.pendingCards[ARGV[3]] = nil
    local remaining = false
    for _ in pairs(buf.pendingCards) do remaining = true; break end
    if not remaining then buf.pendingCards = nil end
    persist(buf)
    return 1
  `;

  private async evalTurnBuffer(
    lua: string,
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    ...args: string[]
  ): Promise<unknown> {
    return this.redis.eval(
      lua,
      2,
      getTurnBufferKey(sessionKey, turnId, workerScope),
      getTurnBufferIndexKey(sessionKey),
      String(REDIS_TTL.CHAT.TURN_BUFFER),
      getTurnBufferIndexMember(turnId, workerScope),
      ...args,
    );
  }

  async appendToTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    kind: 'text' | 'thinking' | 'card_output',
    chunk: string,
    cardId?: string,
  ): Promise<void> {
    if (!chunk) return;
    if (kind === 'card_output' && !cardId) {
      throw new Error('appendToTurnBuffer: cardId required when kind=card_output');
    }
    await this.evalTurnBuffer(
      RedisTurnBufferStore.TURN_BUFFER_APPEND_LUA,
      sessionKey,
      turnId,
      workerScope,
      kind,
      chunk,
      cardId ?? '',
    );
  }

  async takeTurnBufferKind(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    kind: 'text' | 'thinking',
  ): Promise<string | undefined> {
    const result = await this.evalTurnBuffer(
      RedisTurnBufferStore.TURN_BUFFER_TAKE_LUA,
      sessionKey,
      turnId,
      workerScope,
      kind,
    );
    return typeof result === 'string' ? result : undefined;
  }

  async setTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    card: PendingCardSnapshot,
  ): Promise<void> {
    await this.evalTurnBuffer(
      RedisTurnBufferStore.TURN_BUFFER_SET_CARD_LUA,
      sessionKey,
      turnId,
      workerScope,
      JSON.stringify(card),
    );
  }

  async clearTurnBufferPendingCard(
    sessionKey: string,
    turnId: string,
    workerScope: string | undefined,
    cardId: string,
  ): Promise<void> {
    await this.evalTurnBuffer(
      RedisTurnBufferStore.TURN_BUFFER_CLEAR_CARD_LUA,
      sessionKey,
      turnId,
      workerScope,
      cardId,
    );
  }

  async clearTurnBuffer(
    sessionKey: string,
    turnId: string,
    workerScope?: string,
  ): Promise<void> {
    const key = getTurnBufferKey(sessionKey, turnId, workerScope);
    await this.redis.del(key);
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const member = getTurnBufferIndexMember(turnId, workerScope);
    await this.redis.srem(indexKey, member);
  }

  async clearAllTurnBuffersForFeature(sessionKey: string): Promise<void> {
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const members = await this.redis.smembers(indexKey);
    if (members.length === 0) {
      await this.redis.del(indexKey);
      return;
    }
    const pipeline = this.redis.pipeline();
    for (const member of members) {
      const { turnId, workerScope } = parseTurnBufferIndexMember(member);
      pipeline.del(getTurnBufferKey(sessionKey, turnId, workerScope));
    }
    pipeline.del(indexKey);
    await pipeline.exec();
  }

  async listActiveTurnBuffers(sessionKey: string): Promise<TurnBufferSnapshot[]> {
    const indexKey = getTurnBufferIndexKey(sessionKey);
    const members = await this.redis.smembers(indexKey);
    if (members.length === 0) return [];
    const snapshots: TurnBufferSnapshot[] = [];
    for (const member of members) {
      const { turnId, workerScope } = parseTurnBufferIndexMember(member);
      const buf = await this.getTurnBuffer(sessionKey, turnId, workerScope);
      if (!buf) {
        // Index stale — drop it.
        await this.redis.srem(indexKey, member);
        continue;
      }
      snapshots.push({
        turnId,
        workerScope,
        text: buf.text,
        thinking: buf.thinking,
        pendingCards: buf.pendingCards,
      });
    }
    return snapshots;
  }

  async nextPauseSeq(turnId: string): Promise<number> {
    const key = getCancelledPauseSeqKey(turnId);
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, REDIS_TTL.CHAT.CANCELLED_PAUSE_SEQ);
    return seq;
  }

  async getCurrentPauseSeq(turnId: string): Promise<number> {
    const key = getCancelledPauseSeqKey(turnId);
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  async nextWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    const key = getWorkerCycleSeqKey(turnId, taskKey);
    const seq = await this.redis.incr(key);
    await this.redis.expire(key, REDIS_TTL.CHAT.WORKER_CYCLE_SEQ);
    return seq;
  }

  async getCurrentWorkerCycleSeq(turnId: string, taskKey: string): Promise<number> {
    const key = getWorkerCycleSeqKey(turnId, taskKey);
    const raw = await this.redis.get(key);
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

}
