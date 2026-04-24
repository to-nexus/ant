import { useState, useEffect, useRef, useCallback } from 'react';
import {
  useGitMenu,
  useGitOperation,
} from '@/domain/git-world';
import { useGithubRepo } from '@/domain/project-world';
import { MenuTriggerButton } from './components/MenuTriggerButton';
import { MenuDropdown } from './components/MenuDropdown';
import { useGitMenuActions } from './hooks/useGitMenuActions';

/**
 * Secondary Git control button — the GitHub icon with its dropdown
 * carrying Clone / Initialize / Publish / Push / Pull / Fetch.
 *
 * Sibling to `<GitStatusButton />`; both read the same `GitSnapshot`
 * through `git-world` selectors and dispatch through the same FSM
 * (`runGitOperation`) so the two buttons never disagree about
 * in-flight state or menu availability. This component owns only its
 * local dropdown visibility (open/closed + click-outside).
 */
export function GitMenuButton() {
  const githubRepo = useGithubRepo();
  const menu = useGitMenu(githubRepo);
  const op = useGitOperation();
  const isGitProcessing = op.status === 'running';

  const [showMenu, setShowMenu] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => setShowMenu(false), []);

  useEffect(() => {
    if (!showMenu) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const actions = useGitMenuActions({ onClose: handleClose });

  return (
    <div className="relative" ref={rootRef}>
      <MenuTriggerButton
        githubRepo={githubRepo}
        onToggle={() => setShowMenu((s) => !s)}
        disabled={isGitProcessing}
      />
      {showMenu && githubRepo && (
        <MenuDropdown
          menu={menu}
          handleClone={actions.handleClone}
          handleInitialize={actions.handleInitialize}
          handlePublish={actions.handlePublish}
          handlePush={actions.handlePush}
          handlePull={actions.handlePull}
          handleFetch={actions.handleFetch}
        />
      )}
    </div>
  );
}
