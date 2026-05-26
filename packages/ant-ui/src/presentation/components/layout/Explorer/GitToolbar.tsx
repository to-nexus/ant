
import { GitStatusButton } from '../../GitStatusButton';
import { GitMenuButton } from '../../GitMenuButton';

/**
 * Inline Git toolbar that sits directly under the active project row
 * (spec §5.4 / §6.2 T8). Owns no Git state — it just composes the
 * existing `<GitStatusButton />` (commit / push / pull / sync /
 * publish + discard) and `<GitMenuButton />` (Clone / Init / Publish /
 * Push / Pull / Fetch dropdown) so they share the same `git-world`
 * snapshot + FSM. 브랜치 라인(현재 브랜치 + ahead/behind 카운터)과 변경사항
 * 접기/펼치기 토글은 `<GitStatusButton />` 이 직접 렌더한다 — 동일한 요소
 * 그룹에 묶어두어 Git 관련 어포던스를 한 곳에서 노출한다.
 *
 * Aurora-toned container per B3 handoff: subtle surface-2 panel with
 * a hairline border, 12px radius, 8px padding, side-indented 10px to
 * align with row padding. Sits OUTSIDE the project RowList so it
 * doesn't scroll with the row collection.
 *
 * Layout (B3 handoff parity): branch line / changes panel 이 toolbar
 * 전체 너비를 사용하도록 단일 column 으로 평탄화한다. GitMenuButton 은
 * `<GitStatusButton menuSlot=... />` 의 top action row 마지막 슬롯으로
 * 주입되어 ActionButton + discard + GitMenuButton 이 같은 row 를 구성하고,
 * 그 아래 branch row 와 changes panel 은 toolbar 컨테이너의 우측 끝까지
 * 확장된다.
 */
export function GitToolbar() {
  return (
    <div
      style={{
        margin: '2px 10px 8px',
        padding: 8,
        background: 'color-mix(in srgb, var(--surface-2) 60%, transparent)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <GitStatusButton menuSlot={<GitMenuButton />} />
    </div>
  );
}
