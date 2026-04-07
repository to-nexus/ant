/**
 * Creates the unseenArtifacts SSE handler (badge notifications).
 */
export function createUnseenArtifactsHandler(get: any): (data: any) => void {
  return (data: any) => {
    if (data.type === 'initial' || data.type === 'update') {
      const paths = data.paths || [];
      get().setUnseenArtifacts(paths);
    }
  };
}

/**
 * Creates the bridge SSE handler (Ant Desktop connection status).
 */
export function createBridgeHandler(get: any): (data: any) => void {
  return (data: any) => {
    get().setBridgeStatus(data);
  };
}

/**
 * Creates the transfer SSE handler.
 */
export function createTransferHandler(get: any): (data: any) => void {
  return (data: any) => {
    if (data.type === 'transfer-request-new') {
      get().incrementPendingTransferCount();
    } else if (data.type === 'transfer-request-cancelled') {
      get().decrementPendingTransferCount();
    } else if (data.type === 'transfer-request-resolved') {
      import('@/infrastructure/http/api').then(({ fetchTransferRequests }) => {
        fetchTransferRequests('sent').then(({ requests }) => {
          get().setSentRequests(requests);
        }).catch(() => {});
      });
    }
  };
}
