/**
 * ChatStatusAdapter — wraps ChatAPIClient into ChatStatusReporter interface
 *
 * This adapter isolates tool handlers from the concrete ChatAPIClient singleton.
 * Handlers call ctx.chatStatus.* methods; tests can provide a mock implementation.
 */

import type { ChatStatusReporter } from './types';

/**
 * Create a ChatStatusReporter backed by the global ChatAPIClient singleton.
 * Returns a no-op reporter if ChatAPIClient is unavailable.
 */
export function createChatStatusReporter(): ChatStatusReporter {
  // Lazy import to avoid circular dependencies in worker processes
  const getClient = async () => {
    const { getChatAPIClient } = await import('../../../core/adapters/ChatAPIClient');
    return getChatAPIClient();
  };

  return {
    async showStatus(key, data) {
      const client = await getClient();
      return client.showChatStatus(key as any, data);
    },
    async removeStatus(index, key) {
      const client = await getClient();
      await client.removeChatStatus(index, key as any);
    },

    async addReadingFile(path) {
      const client = await getClient();
      return client.addReadingFile(path);
    },
    async addReadComplete(path, mergeIndex, error) {
      const client = await getClient();
      await client.addReadComplete(path, mergeIndex, error);
    },

    async addReadingSource(filename, startLine, endLine) {
      const client = await getClient();
      return client.addReadingSource(filename, startLine, endLine);
    },
    async addReadSourceComplete(filename, mergeIndex, opts) {
      const client = await getClient();
      await client.addReadSourceComplete(filename, mergeIndex, opts);
    },

    startFileEdit(_path) {
      // Currently no separate start event in ChatAPIClient
    },
    async completeFileEdit(path, oldStr, newStr) {
      const client = await getClient();
      await client.completeFileEdit(path, oldStr, newStr);
    },
    async failFileEdit(path, error) {
      const client = await getClient();
      await client.failFileEdit(path, error);
    },
    async completeFileDeletion(path) {
      const client = await getClient();
      await client.completeFileDeletion(path);
    },
    async completeFileCreation(path, content, stats) {
      const client = await getClient();
      await client.completeFileCreation(path, content, stats);
    },
    async failFileCreation(path, error) {
      const client = await getClient();
      await client.failFileCreation(path, error);
    },

    async commandStart(command) {
      const client = await getClient();
      return client.commandStart(command);
    },
    async streamCommandOutput(command, output) {
      const client = await getClient();
      await client.streamCommandOutput(command, output);
    },
    async commandComplete(command, success, exitCode, output) {
      const client = await getClient();
      await client.commandComplete(command, success, exitCode, output);
    },

    async finalizeMessage() {
      const client = await getClient();
      await client.finalizeMessage();
    },
  };
}

/**
 * No-op ChatStatusReporter for testing or contexts where UI is unavailable.
 */
export function createNoopChatStatusReporter(): ChatStatusReporter {
  return {
    async showStatus() { return undefined; },
    async removeStatus() {},
    async addReadingFile() { return undefined; },
    async addReadComplete() {},
    async addReadingSource() { return undefined; },
    async addReadSourceComplete() {},
    startFileEdit() {},
    async completeFileEdit() {},
    async failFileEdit() {},
    async completeFileDeletion() {},
    async completeFileCreation() {},
    async failFileCreation() {},
    async commandStart() { return undefined; },
    async streamCommandOutput() {},
    async commandComplete() {},
    async finalizeMessage() {},
  };
}
