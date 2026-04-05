/**
 * Bridge — re-exports from core/context for backward compatibility.
 *
 * All logic has moved to core/context/. This file exists solely so that
 * existing import paths (e.g. `from '../utils/historyManager'`) keep working.
 */

export { compactRun as compactAndPruneHistory } from '../context';
