#!/bin/bash
set -e

# ===========================================
# ANT CLI Server 설치 스크립트
# Ubuntu 24 + Docker 환경용
# ===========================================

echo "🚀 ANT CLI Server 설치를 시작합니다..."

# 변수 설정
INSTALL_DIR="/cross/ant/ant-cli"
SERVICE_NAME="ant-cli"
SERVICE_USER="cross"
WORKSPACE_DIR="/data/ant-workspaces"
IDE_HOME_DIR="/data/ant-ide-homes"

# Root 권한 확인
if [[ $EUID -ne 0 ]]; then
   echo "❌ 이 스크립트는 root 권한으로 실행해야 합니다."
   echo "   sudo ./install.sh"
   exit 1
fi

# Docker 설치 확인
if ! command -v docker &> /dev/null; then
    echo "❌ Docker가 설치되어 있지 않습니다."
    echo "   먼저 Docker를 설치해주세요:"
    echo "   curl -fsSL https://get.docker.com | sh"
    exit 1
fi

# Docker Compose 확인
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose가 설치되어 있지 않습니다."
    echo "   sudo apt install docker-compose-plugin"
    exit 1
fi

echo "✅ Docker 및 Docker Compose 확인 완료"

# cross 유저가 docker 그룹에 있는지 확인
if id "$SERVICE_USER" &>/dev/null; then
    if ! groups "$SERVICE_USER" | grep -q docker; then
        echo "🔧 $SERVICE_USER 유저를 docker 그룹에 추가합니다..."
        usermod -aG docker "$SERVICE_USER"
        echo "✅ docker 그룹 추가 완료"
    fi
else
    echo "⚠️  $SERVICE_USER 유저가 없습니다. 생성합니다..."
    useradd -m -s /bin/bash "$SERVICE_USER"
    usermod -aG docker "$SERVICE_USER"
fi

# 1. 설치 디렉토리 생성
echo "📁 설치 디렉토리 생성: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 2. 워크스페이스 및 IDE Home 디렉토리 생성
echo "📁 워크스페이스 디렉토리 생성: $WORKSPACE_DIR"
mkdir -p "$WORKSPACE_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$WORKSPACE_DIR"

echo "📁 IDE Home 디렉토리 생성: $IDE_HOME_DIR"
mkdir -p "$IDE_HOME_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$IDE_HOME_DIR"

# 3. 파일 복사
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📋 파일 복사 중..."

cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/ant-cli.service" "/etc/systemd/system/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 4. Dockerfile 및 소스 복사 (빌드용)
# monorepo 구조이므로 전체 복사
ANT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
echo "📋 ANT monorepo 복사 중: $ANT_ROOT -> $INSTALL_DIR/ant"
mkdir -p "$INSTALL_DIR/ant"
rsync -a --exclude='node_modules' --exclude='.git' --exclude='dist' "$ANT_ROOT/" "$INSTALL_DIR/ant/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/ant"

# 5. docker-compose.yml의 build context 수정
sed -i 's|context: \.\./\.\.|context: ./ant|' "$INSTALL_DIR/docker-compose.yml"
sed -i 's|dockerfile: packages/ant-cli/Dockerfile|dockerfile: ant/packages/ant-cli/Dockerfile|' "$INSTALL_DIR/docker-compose.yml"

# 6. 환경 변수 파일 생성 (없으면)
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "📝 환경 변수 파일 생성: $INSTALL_DIR/.env"
    cat > "$INSTALL_DIR/.env" << 'EOF'
# ANT CLI 환경 변수
ANT_CLI_PORT=4100
ANT_SERVER_MODE=local
ANT_WORKSPACE_BASE_PATH=/data/ant-workspaces
ANT_IDE_HOME_BASE_PATH=/data/ant-ide-homes

# LLM API Keys (필수 - 최소 하나 설정)
ANTHROPIC_API_KEY=

# IDE 설정
ANT_IDE_IMAGE=gitpod/openvscode-server:latest
ANT_IDE_PORT_RANGE_START=30000
ANT_IDE_PORT_RANGE_END=32767

# 타임존
TZ=Asia/Seoul
EOF
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
    echo ""
    echo "⚠️  중요: $INSTALL_DIR/.env 파일에 ANTHROPIC_API_KEY를 설정해주세요!"
    echo ""
else
    echo "⏭️  환경 변수 파일이 이미 존재합니다: $INSTALL_DIR/.env"
fi

# 7. Docker 이미지 빌드
echo "🔨 Docker 이미지 빌드 중... (첫 빌드는 시간이 걸릴 수 있습니다)"
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" docker compose build

# 8. IDE 이미지 미리 pull
echo "📦 IDE Docker 이미지 다운로드 중..."
sudo -u "$SERVICE_USER" docker pull gitpod/openvscode-server:latest

# 9. systemd 서비스 등록
echo "⚙️  systemd 서비스 등록 중..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 10. 서비스 시작
echo "🚀 서비스 시작 중..."
systemctl start "$SERVICE_NAME"

# 11. 상태 확인
sleep 5
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "✅ ======================================"
    echo "✅ ANT CLI Server 설치 완료!"
    echo "✅ ======================================"
    echo ""
    echo "📌 API 주소: http://$(hostname -I | awk '{print $1}'):4100"
    echo "📌 Health: http://$(hostname -I | awk '{print $1}'):4100/api/health"
    echo ""
    echo "📌 서비스 실행 유저: $SERVICE_USER"
    echo ""
    echo "📌 유용한 명령어:"
    echo "   상태 확인:    sudo systemctl status ant-cli"
    echo "   로그 확인:    sudo journalctl -u ant-cli -f"
    echo "   재시작:       sudo systemctl restart ant-cli"
    echo "   중지:         sudo systemctl stop ant-cli"
    echo "   설정 수정:    sudo nano $INSTALL_DIR/.env"
    echo ""
    echo "📌 경로:"
    echo "   워크스페이스: $WORKSPACE_DIR"
    echo "   IDE Home:     $IDE_HOME_DIR"
    echo "   설정 파일:    $INSTALL_DIR/.env"
    echo ""
    echo "⚠️  API Key 설정 후 서비스를 재시작하세요:"
    echo "   sudo nano $INSTALL_DIR/.env"
    echo "   sudo systemctl restart ant-cli"
else
    echo "❌ 서비스 시작에 실패했습니다."
    echo "   로그 확인: sudo journalctl -u ant-cli -e"
    exit 1
fi


