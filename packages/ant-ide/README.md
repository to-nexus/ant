## ant-ide (OpenVSCode Server)

`pnpm start:ide`는 **Docker로 OpenVSCode Server**를 띄웁니다.

---

## 🚀 Ubuntu 24 서버에 설치하기 (systemctl 등록)

### 사전 요구사항

```bash
# Docker 설치 (설치 안되어 있으면)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu

# Docker Compose 플러그인 (보통 Docker에 포함)
sudo apt update && sudo apt install -y docker-compose-plugin
```

### 설치 방법

```bash
# 1. 프로젝트 클론 또는 복사
git clone <your-repo> /tmp/ant
cd /tmp/ant/packages/ant-ide

# 2. 설치 스크립트 실행
sudo chmod +x install.sh
sudo ./install.sh
```

### 설치 후 명령어

```bash
# 상태 확인
sudo systemctl status ant-ide

# 로그 확인
sudo journalctl -u ant-ide -f

# 재시작
sudo systemctl restart ant-ide

# 중지
sudo systemctl stop ant-ide

# 서비스 시작 (부팅 후 자동 시작됨)
sudo systemctl start ant-ide
```

### 설정 변경

```bash
# 환경 변수 수정
sudo nano /opt/ant/ant-ide/.env

# 변경 후 재시작
sudo systemctl restart ant-ide
```

**환경 변수:**
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `ANT_IDE_PORT` | `4400` | IDE 접속 포트 |
| `ANT_WORKSPACE_BASE_PATH` | `/cross` | 워크스페이스 기본 경로 (디스크 마운트) |

### 제거 방법

```bash
cd /tmp/ant/packages/ant-ide
sudo ./uninstall.sh
```

---

## 💻 로컬 개발용 (macOS/Linux)

### 핵심: IDE에서 `/workspace`를 "프로젝트 루트"로 보이게 하기

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

---

## 📁 파일 구조

```
packages/ant-ide/
├── docker-compose.yml    # Docker Compose 설정
├── ant-ide.service       # systemd 서비스 파일
├── install.sh            # 설치 스크립트
├── uninstall.sh          # 제거 스크립트
├── env.example           # 환경 변수 예시
├── package.json          # npm 스크립트
└── README.md
```
