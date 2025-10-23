- page.tsx에서 원본코드를 (주석 또는 tabmenu와 무관한) 변형하지 말라했는데 import 문의 순서나 lint는 왜 마음대로 바꾸는거야? 예를 들어 import Link from 'next/link';
import { useEffect, useState, useCallback, memo } from 'react';
import { useAppKitAccount } from '@to-nexus/sdk/react';
import { Header } from '../../presentation/components/layout/Header';
import { Footer } from '../../presentation/components/layout/Footer';
import { RampPairCard } from '../../presentation/components/catalog/RampPairCard';
import { CookieConsentBottomSheet } from '../../presentation/components/ui/CookieConsentBottomSheet';
import { MetadataSection } from '../../presentation/components/catalog';
import { SessionGuard, useSession } from '../../presentation/components/providers/SessionProvider';
import { useI18n } from '../../presentation/contexts/I18nContext';
import { useAppStore } from '../../presentation/stores';
import { useIsPC } from '../../presentation/hooks/useIsPC';
import { 
  useGameAssets, 
  useProjectMetadata, 
  useRampPairs, 
  usePlayerInfo,
  useAllTokenBalances,
  useInitialMetadata
} from '../../business/queries';
import { inferTokenType } from '../../shared/utils';
이 부분을 import Link from 'next/link';
import { useState, useEffect, useCallback, memo } from 'react';
import { Header, Footer, CookieConsentBottomSheet, RampPairCard } from '../../presentation/components';
import { SessionGuard, useSession } from '../../presentation/components/providers';
import { useI18n } from '../../presentation/contexts/I18nContext';
import { useAppStore } from '../../presentation/stores';
import { useIsPC } from '../../presentation/hooks/useIsPC';
import { useAllTokenBalances, useInitialMetadata } from '../../business/queries';
import { inferTokenType } from '../../shared/utils';

이렇게 변형하는 것 자체를 하지말라는거야. 코드의 다른 부분도 미묘하게 바꾼게 있는데 원래대로 복구해. 또한 너마음대로 settimeout 시간을 100ms -> 1000ms 로 바꾸기도 했는데 시키지도 않은일을 왜한거야? 절대로 그러지말고 복구해.