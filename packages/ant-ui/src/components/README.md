# 공통 컴포넌트 사용 가이드

## CreateItemForm

새 아이템(워크스페이스, 피처 등)을 생성하기 위한 입력 폼 컴포넌트입니다.

### 기본 사용법

```tsx
import { CreateItemForm } from './CreateItemForm';

function MyComponent() {
  const [isOpen, setIsOpen] = useState(false);

  const handleSubmit = async (name: string) => {
    await createItem(name);
  };

  const handleCancel = () => {
    setIsOpen(false);
  };

  return (
    <CreateItemForm
      placeholder="Enter item name..."
      onSubmit={handleSubmit}
      onCancel={handleCancel}
      isOpen={isOpen}
    />
  );
}
```

### Props

- `placeholder`: string - 입력 필드의 플레이스홀더 텍스트
- `onSubmit`: (name: string) => Promise<void> - 생성 버튼 클릭 시 호출되는 함수
- `onCancel`: () => void - 취소 버튼 클릭 시 호출되는 함수
- `isOpen`: boolean - 폼의 표시 여부

### 특징

- **자동 외부 클릭 감지**: 폼 외부를 클릭하면 자동으로 닫힙니다
- **키보드 단축키**: 
  - Enter: 제출
  - Escape: 취소
- **자동 포커스**: 폼이 열리면 입력 필드에 자동 포커스
- **상태 초기화**: 폼이 닫힐 때 입력값 자동 초기화
- **로딩 상태**: 제출 중에는 버튼 비활성화

## ItemDropdown

아이템 목록을 드롭다운으로 표시하고 선택/생성/삭제할 수 있는 공통 컴포넌트입니다.

### 기본 사용법

```tsx
import { Folder } from 'lucide-react';
import { ItemDropdown } from './ItemDropdown';

function ProjectDropdown() {
  const projects = ['project1', 'project2'];
  const [selected, setSelected] = useState<string>();

  const handleCreate = async (name: string) => {
    await createProject(name);
  };

  const handleDelete = async (name: string) => {
    await deleteProject(name);
  };

  const items = projects.map(p => ({ name: p }));

  return (
    <ItemDropdown
      title="Workspace"
      icon={Folder}
      items={items}
      selectedItem={selected}
      onSelect={setSelected}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onItemCreated={() => fetchProjects()}
      placeholder="Select a workspace..."
      inputPlaceholder="Workspace name..."
    />
  );
}
```

### 커스텀 입력 폼 사용

`renderCreateForm` prop을 사용하여 커스텀 입력 폼을 제공할 수 있습니다:

```tsx
import { ItemDropdown } from './ItemDropdown';
import { CreateItemForm } from './CreateItemForm';

function CustomDropdown() {
  return (
    <ItemDropdown
      title="Custom Items"
      items={items}
      selectedItem={selected}
      onSelect={setSelected}
      onCreate={handleCreate}
      renderCreateForm={({ isOpen, onSubmit, onCancel, placeholder }) => (
        <div>
          {/* 커스텀 폼 UI */}
          <CreateItemForm
            placeholder={placeholder}
            onSubmit={onSubmit}
            onCancel={onCancel}
            isOpen={isOpen}
          />
          {/* 추가적인 커스텀 요소 */}
          {isOpen && <div className="text-xs text-gray-500 mt-2">추가 안내 메시지</div>}
        </div>
      )}
    />
  );
}
```

### Props

- `title`: string - 드롭다운 제목
- `icon?`: LucideIcon - 제목 옆에 표시할 아이콘
- `emoji?`: string - 제목 옆에 표시할 이모지
- `items`: Array<{ name: string; path?: string }> - 아이템 목록
- `selectedItem`: string | undefined - 현재 선택된 아이템
- `onSelect`: (itemName: string) => void - 아이템 선택 시 호출
- `onCreate`: (itemName: string) => Promise<void> - 아이템 생성 시 호출
- `onDelete?`: (itemName: string) => Promise<void> - 아이템 삭제 시 호출 (선택사항)
- `onItemCreated?`: () => void - 아이템 생성 후 호출 (목록 새로고침 등)
- `placeholder?`: string - 드롭다운 플레이스홀더 (기본값: "Select an item...")
- `inputPlaceholder?`: string - 입력 필드 플레이스홀더 (기본값: "Item name...")
- `renderCreateForm?`: (props) => React.ReactNode - 커스텀 입력 폼 렌더러

### 특징

- **빈 목록 처리**: 아이템이 없을 때 자동으로 메시지 표시
- **삭제 확인**: 삭제 버튼 클릭 시 확인 다이얼로그 표시
- **외부 클릭 감지**: 드롭다운/폼 외부 클릭 시 자동으로 닫힘
- **선택 강조**: 선택된 아이템 시각적 강조
- **확장 가능**: `renderCreateForm`으로 입력 폼 커스터마이징 가능

## Cancel 버튼 버그 해결

이전에 발생했던 "Cancel 버튼을 눌러도 다시 열리는" 버그는 다음과 같이 해결되었습니다:

1. **이벤트 전파 방지**: `e.stopPropagation()` 사용
2. **독립적인 폼 컴포넌트**: CreateItemForm을 별도 컴포넌트로 분리
3. **외부 클릭 감지 개선**: 타이머를 사용하여 버튼 클릭과 외부 클릭 이벤트 분리
4. **명확한 상태 관리**: isOpen 상태를 부모에서 관리하고 자식에게 전달

## 예제: ProjectDropdown

```tsx
import { Folder } from 'lucide-react';
import { useStore } from '../lib/store';
import { createProject, deleteProject } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';

export function ProjectDropdown() {
  const { projects, selectedProject, setSelectedProject, fetchProjects } = useStore();

  const handleCreateProject = async (projectName: string) => {
    await createProject(projectName);
  };

  const handleDeleteProject = async (projectName: string) => {
    await deleteProject(projectName);
  };

  const projectItems = projects.map((p: string) => ({ name: p }));

  return (
    <ItemDropdown
      title="Workspace"
      icon={Folder}
      items={projectItems}
      selectedItem={selectedProject}
      onSelect={setSelectedProject}
      onCreate={handleCreateProject}
      onDelete={handleDeleteProject}
      onItemCreated={fetchProjects}
      placeholder="Select a workspace..."
      inputPlaceholder="Workspace name..."
    />
  );
}
```

## 예제: FeatureDropdown

```tsx
import { GitBranch } from 'lucide-react';
import { useStore } from '../lib/store';
import { createFeature, deleteFeature } from '../lib/api';
import { ItemDropdown } from './ItemDropdown';

export function FeatureDropdown() {
  const { 
    features, 
    selectedProject, 
    selectedFeature, 
    setSelectedFeature, 
    fetchFeatures,
    refreshFileTree
  } = useStore();

  const handleCreateFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await createFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const handleDeleteFeature = async (featureName: string) => {
    if (!selectedProject) {
      throw new Error('No project selected');
    }
    await deleteFeature(selectedProject, featureName);
    await refreshFileTree();
  };

  const featureItems = features.map((f) => ({ name: f.name, path: f.path }));

  if (!selectedProject) {
    return null;
  }

  return (
    <ItemDropdown
      title="Features"
      icon={GitBranch}
      items={featureItems}
      selectedItem={selectedFeature}
      onSelect={setSelectedFeature}
      onCreate={handleCreateFeature}
      onDelete={handleDeleteFeature}
      onItemCreated={fetchFeatures}
      placeholder="Select a feature..."
      inputPlaceholder="Feature name..."
    />
  );
}
```
