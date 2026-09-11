/**
 * Upload progress + result surface — the single owner of "what is this upload
 * doing, and how did it end".
 *
 * Extracted from ArtifactsPanel, where it was inline and therefore reachable
 * by exactly one screen. The agent- and pipeline-definition screens had no
 * equivalent: their only feedback channel was a detail-pane error strip that
 * is not mounted until a node is selected, so a toolbar-level upload finished
 * (or failed, or hit a 409) with nothing visible anywhere.
 *
 * `notice` is the short-lived refusal line — a drop the caller cannot accept,
 * a server verdict with no file work behind it. It shares the card's corner so
 * a user watches one place, never two.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** Result tone. `warning` = it landed, but something was skipped or ignored. */
export type UploadTone = 'success' | 'warning';

export interface UploadStatus {
  loaded: number;
  total: number;
  fileCount: number;
  /** Human-facing destination; '' renders the count-only label. */
  targetDir: string;
  completed?: boolean;
  /** Completion line. Absent → the caller's default `upload.complete`. */
  summary?: string;
  tone?: UploadTone;
}

const NOTICE_MS = 3000;
const LINGER_MS = 3000;

export interface UploadStatusApi {
  status: UploadStatus | null;
  notice: string | null;
  /** Opens the card and returns the signal to hand the upload call. */
  begin: (fileCount: number, targetDir: string) => AbortSignal;
  progress: (loaded: number, total: number) => void;
  /** Completed state + auto-dismiss after a linger. */
  finish: (summary?: string, tone?: UploadTone) => void;
  /** Close the card without a completion frame — the caller reports the error. */
  fail: () => void;
  showNotice: (message: string) => void;
  dismissNotice: () => void;
  dismiss: () => void;
  /** X button: dismiss a finished card, abort an in-flight one. */
  cancel: () => void;
}

export function useUploadStatus(): UploadStatusApi {
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const lingerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The X button reads this, so `cancel` stays a stable callback rather than
  // re-created on every progress frame.
  const completedRef = useRef(false);

  useEffect(
    () => () => {
      if (lingerRef.current) clearTimeout(lingerRef.current);
      if (noticeRef.current) clearTimeout(noticeRef.current);
    },
    [],
  );

  const dismiss = useCallback(() => {
    if (lingerRef.current) {
      clearTimeout(lingerRef.current);
      lingerRef.current = null;
    }
    completedRef.current = false;
    setStatus(null);
  }, []);

  const begin = useCallback(
    (fileCount: number, targetDir: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      dismiss();
      completedRef.current = false;
      setStatus({ loaded: 0, total: 0, fileCount, targetDir });
      return controller.signal;
    },
    [dismiss],
  );

  const progress = useCallback((loaded: number, total: number) => {
    setStatus((prev) => (prev ? { ...prev, loaded, total } : prev));
  }, []);

  const finish = useCallback(
    (summary?: string, tone: UploadTone = 'success') => {
      abortRef.current = null;
      completedRef.current = true;
      setStatus((prev) =>
        prev ? { ...prev, loaded: prev.total, completed: true, summary, tone } : prev,
      );
      if (lingerRef.current) clearTimeout(lingerRef.current);
      lingerRef.current = setTimeout(dismiss, LINGER_MS);
    },
    [dismiss],
  );

  const fail = useCallback(() => {
    abortRef.current = null;
    completedRef.current = false;
    setStatus(null);
  }, []);

  const showNotice = useCallback((message: string) => {
    if (noticeRef.current) clearTimeout(noticeRef.current);
    setNotice(message);
    noticeRef.current = setTimeout(() => setNotice(null), NOTICE_MS);
  }, []);

  const dismissNotice = useCallback(() => {
    if (noticeRef.current) {
      clearTimeout(noticeRef.current);
      noticeRef.current = null;
    }
    setNotice(null);
  }, []);

  const cancel = useCallback(() => {
    if (completedRef.current) dismiss();
    else abortRef.current?.abort();
  }, [dismiss]);

  return { status, notice, begin, progress, finish, fail, showNotice, dismissNotice, dismiss, cancel };
}
