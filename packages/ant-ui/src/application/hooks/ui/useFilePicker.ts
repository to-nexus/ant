/**
 * Hidden file/folder input driven by one imperative opener.
 *
 * The single owner of "open the OS picker" for every tree in the app. A
 * browser input is EITHER file-mode OR folder-mode (`webkitdirectory` turns
 * the picker into a directory chooser), so the caller states which one it
 * wants per pick and the input is remounted to match — that remount is also
 * what makes re-selecting the same path fire `change` again.
 */

import { createElement, useEffect, useRef, useState } from 'react';

export interface FilePickerOptions {
  /** Folder mode (`webkitdirectory`): picks a directory, files carry `webkitRelativePath`. */
  directory?: boolean;
  /** `accept` attribute. Browsers ignore it in folder mode — filter after the pick instead. */
  accept?: string;
}

export type OpenFilePicker = (
  onFiles: (files: FileList) => void,
  opts?: FilePickerOptions,
) => void;

export function useFilePicker(): [React.ReactNode, OpenFilePicker] {
  const inputRef = useRef<HTMLInputElement>(null);
  const handlerRef = useRef<((files: FileList) => void) | null>(null);
  const [pick, setPick] = useState<{ seq: number; directory: boolean; accept?: string }>({
    seq: 0,
    directory: false,
  });

  const open: OpenFilePicker = (onFiles, opts) => {
    handlerRef.current = onFiles;
    setPick((prev) => ({ seq: prev.seq + 1, directory: !!opts?.directory, accept: opts?.accept }));
  };

  // Click only after the remounted input is committed, never on first render.
  useEffect(() => {
    if (pick.seq > 0) inputRef.current?.click();
  }, [pick.seq]);

  const node = createElement('input', {
    key: `${pick.directory ? 'dir' : 'file'}-${pick.seq}`,
    ref: inputRef,
    type: 'file',
    multiple: true,
    className: 'hidden',
    accept: pick.accept,
    ...(pick.directory ? ({ webkitdirectory: '' } as Record<string, string>) : {}),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) handlerRef.current?.(e.target.files);
    },
  });

  return [node, open];
}
