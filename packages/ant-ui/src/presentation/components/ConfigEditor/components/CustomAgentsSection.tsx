import { useTranslation } from 'react-i18next';
import { Bot, ArrowRight } from 'lucide-react';
import { useStore } from '@/domain/store';
import { SectionCard } from '../aurora';

/**
 * Settings → Agents — slim pointer card. Definition management moved to the
 * account-scoped Agent Settings screen (profile menu → main panel tab), which
 * works without a selected project; this card only routes there. The
 * `c3p-agents` TOC anchor is preserved.
 */
export function CustomAgentsSection() {
  const { t } = useTranslation('config');
  const openMainPanelTab = useStore((state) => state.openMainPanelTab);

  return (
    <SectionCard
      id="c3p-agents"
      icon={<Bot className="w-4 h-4" />}
      title={t('agents.title', '유니버설 에이전트')}
      description={t('agents.pointerDescription', '에이전트/잡 정의는 계정 단위로 관리됩니다. 프로필 메뉴의 "에이전트 설정" 화면에서 정의 파일, 도구, 인텐트를 편집하세요.')}
    >
      <button
        type="button"
        onClick={() => openMainPanelTab('agentSettings')}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors hover:bg-[color:var(--bg-hover)]"
        style={{ border: '1px solid var(--border-2)', color: 'var(--text-2)' }}
      >
        <Bot className="w-4 h-4" style={{ color: 'var(--violet-500)' }} />
        {t('agents.openSettings', '에이전트 설정 열기')}
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </SectionCard>
  );
}
