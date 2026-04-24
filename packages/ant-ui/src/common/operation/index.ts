/**
 * common/operation — app-wide async operation dispatch primitives.
 */

export {
  OperationDispatcher,
  type OperationStatus,
  type OperationError,
  type OperationStateSnapshot,
  type OperationDispatcherOptions,
} from './OperationDispatcher';
export { useOperation, type UseOperationReturn } from './useOperation';
export { ConfirmAndDispatch, type ConfirmAndDispatchProps } from './ConfirmAndDispatch';
