## ant-ide (OpenVSCode Server)

`pnpm start:ide`는 **Docker로 OpenVSCode Server**를 띄웁니다.

### 핵심: IDE에서 `/workspace`를 “프로젝트 루트”로 보이게 하기

기본값으로는 `ANT_WORKSPACE_BASE_PATH` 전체를 `/workspace`로 마운트하기 때문에 IDE 안에서 경로가 `/workspace/to.nexus/.../codebase`처럼 길어집니다.

원하는 프로젝트의 `codebase`를 바로 `/workspace`로 마운트하려면 아래처럼 실행하세요:

```bash
export ANT_IDE_CODEBASE_PATH="/Users/probe/dev/ant-workspaces/to.nexus/probe/ant-news-desk/codebase"
pnpm start:ide
```

그럼 IDE 내부에서 프로젝트 루트는 **`/workspace`**가 됩니다.

### 포트 변경

```bash
export ANT_IDE_PORT=4401
pnpm start:ide
```


