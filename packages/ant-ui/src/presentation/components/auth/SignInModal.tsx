/**
 * Sign In Modal
 * 
 * Simple email-based sign in for Cloud Mode
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';
import { Loader2 } from 'lucide-react';

export interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSignIn: (email: string) => Promise<void>;
}

export function SignInModal({ isOpen, onClose, onSignIn }: SignInModalProps) {
  const { t } = useTranslation('auth');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(undefined);
    
    // Email validation
    if (!email.includes('@')) {
      setError(t('signIn.invalidEmail'));
      return;
    }
    
    // Validate organization (must be to.nexus)
    const domain = email.split('@')[1];
    if (domain !== 'to.nexus') {
      setError(t('signIn.unsupportedOrg'));
      return;
    }
    
    setLoading(true);
    
    try {
      await onSignIn(email);
      setEmail('');
      onClose();
    } catch (err: any) {
      setError(err.message || t('signIn.failed'));
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('signIn.title')} size="sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="signin-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('signIn.emailLabel')}
          </label>
          <input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('signIn.emailPlaceholder')}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg 
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                     focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent
                     placeholder:text-gray-400 dark:placeholder:text-gray-500"
            required
            disabled={loading}
            autoFocus
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t('signIn.orgNote')}
          </p>
        </div>
        
        {error && (
          <div className="px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
        
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {t('common:button.cancel')}
          </button>
          <button
            type="submit"
            disabled={loading || !email}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600
                     text-white rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t('signIn.button')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

