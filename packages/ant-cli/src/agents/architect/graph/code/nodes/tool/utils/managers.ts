/**
 * Tool Result Managers
 * 싱글톤 매니저 인스턴스
 */

import { TokenBudgetManager } from '../../../../../../../core/utils/tokenBudget';
import { ToolResultManager } from '../../../../../../../core/utils/toolResultManager';

export const tokenManager = new TokenBudgetManager();
export const toolResultManager = new ToolResultManager(tokenManager, {
  maxReadFileTokens: 8000,
});

