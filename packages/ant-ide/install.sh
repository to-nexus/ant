#!/bin/bash
set -e

# ===========================================
# ANT IDE (OpenVSCode Server) 설치 스크립트
# Ubuntu 24 + Docker 환경용
# ===========================================

echo "🚀 ANT IDE 설치를 시작합니다..."

# 변수 설정
INSTALL_DIR="/cross/ant/ant-ide"
SERVICE_NAME="ant-ide"
SERVICE_USER="cross"
WORKSPACE_DIR="/cross"

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

# Docker Compose 확인 (Docker 내장 또는 플러그인)
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose가 설치되어 있지 않습니다."
    echo "   Docker Desktop을 사용하거나 docker-compose-plugin을 설치해주세요:"
    echo "   sudo apt install docker-compose-plugin"
    exit 1
fi

echo "✅ Docker 및 Docker Compose 확인 완료"

# 0. cross 유저가 docker 그룹에 있는지 확인
if ! groups "$SERVICE_USER" | grep -q docker; then
    echo "🔧 $SERVICE_USER 유저를 docker 그룹에 추가합니다..."
    usermod -aG docker "$SERVICE_USER"
    echo "✅ docker 그룹 추가 완료 (재로그인 후 적용)"
fi

# 1. 설치 디렉토리 생성 및 권한 설정
echo "📁 설치 디렉토리 생성: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 2. 워크스페이스 디렉토리 확인 (디스크 마운트 경로)
echo "📁 워크스페이스 디렉토리 확인: $WORKSPACE_DIR"
if [ ! -d "$WORKSPACE_DIR" ]; then
    echo "⚠️  워크스페이스 디렉토리가 없습니다: $WORKSPACE_DIR"
    echo "   디스크가 마운트되어 있는지 확인하세요."
    exit 1
fi

# 3. 파일 복사
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "📋 파일 복사 중..."

cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/"
cp "$SCRIPT_DIR/ant-ide.service" "/etc/systemd/system/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# 4. 환경 변수 파일 생성 (없으면)
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "📝 환경 변수 파일 생성: $INSTALL_DIR/.env"
    cat > "$INSTALL_DIR/.env" << EOF
# ANT IDE 환경 변수
ANT_IDE_PORT=4400
ANT_WORKSPACE_BASE_PATH=$WORKSPACE_DIR
EOF
    chown "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR/.env"
else
    echo "⏭️  환경 변수 파일이 이미 존재합니다: $INSTALL_DIR/.env"
fi

# 5. systemd 서비스 등록
echo "⚙️  systemd 서비스 등록 중..."
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

# 6. Docker 이미지 미리 pull (cross 유저로)
echo "📦 Docker 이미지 다운로드 중..."
sudo -u "$SERVICE_USER" docker pull gitpod/openvscode-server:latest

# 7. 서비스 시작
echo "🚀 서비스 시작 중..."
systemctl start "$SERVICE_NAME"

# 8. 상태 확인
sleep 3
if systemctl is-active --quiet "$SERVICE_NAME"; then
    echo ""
    echo "✅ ======================================"
    echo "✅ ANT IDE 설치 완료!"
    echo "✅ ======================================"
    echo ""
    echo "📌 접속 주소: http://$(hostname -I | awk '{print $1}'):4400"
    echo ""
    echo "📌 서비스 실행 유저: $SERVICE_USER"
    echo ""
    echo "📌 유용한 명령어:"
    echo "   상태 확인:    sudo systemctl status ant-ide"
    echo "   로그 확인:    sudo journalctl -u ant-ide -f"
    echo "   재시작:       sudo systemctl restart ant-ide"
    echo "   중지:         sudo systemctl stop ant-ide"
    echo "   설정 수정:    sudo nano /opt/ant/ant-ide/.env"
    echo ""
    echo "📌 워크스페이스 경로: $WORKSPACE_DIR"
else
    echo "❌ 서비스 시작에 실패했습니다."
    echo "   로그 확인: sudo journalctl -u ant-ide -e"
    exit 1
fi
