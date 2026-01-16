#!/bin/bash
set -e

# ===========================================
# ANT CLI Server 제거 스크립트
# ===========================================

echo "🗑️  ANT CLI Server 제거를 시작합니다..."

INSTALL_DIR="/cross/ant/ant-cli"
SERVICE_NAME="ant-cli"

# Root 권한 확인
if [[ $EUID -ne 0 ]]; then
   echo "❌ 이 스크립트는 root 권한으로 실행해야 합니다."
   echo "   sudo ./uninstall.sh"
   exit 1
fi

# 1. 서비스 중지
echo "⏹️  서비스 중지 중..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

# 2. 컨테이너 정리
echo "🧹 컨테이너 정리 중..."
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    docker compose down --remove-orphans 2>/dev/null || true
fi

# 기존 ant-cli 컨테이너 강제 삭제
docker rm -f ant-cli 2>/dev/null || true

# ant-ide- 로 시작하는 모든 IDE 컨테이너 정리
echo "🧹 IDE 컨테이너 정리 중..."
docker ps -a --filter "name=ant-ide-" -q | xargs -r docker rm -f 2>/dev/null || true

# 3. systemd 서비스 파일 삭제
echo "📄 서비스 파일 삭제 중..."
rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload

# 4. 설치 디렉토리 삭제 여부 확인
echo ""
read -p "📁 설치 디렉토리 삭제? ($INSTALL_DIR) [y/N]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    echo "✅ 설치 디렉토리 삭제 완료"
else
    echo "⏭️  설치 디렉토리 유지: $INSTALL_DIR"
fi

# 5. 워크스페이스 삭제 여부 확인
WORKSPACE_DIR="/data/ant-workspaces"
IDE_HOME_DIR="/data/ant-ide-homes"

echo ""
read -p "⚠️  워크스페이스 데이터 삭제? ($WORKSPACE_DIR, $IDE_HOME_DIR) [y/N]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$WORKSPACE_DIR"
    rm -rf "$IDE_HOME_DIR"
    echo "✅ 워크스페이스 데이터 삭제 완료"
else
    echo "⏭️  워크스페이스 데이터 유지"
fi

# 6. Docker 이미지 삭제 여부 확인
echo ""
read -p "🐳 Docker 이미지 삭제? (ant-cli:latest, gitpod/openvscode-server) [y/N]: " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    docker rmi ant-cli:latest 2>/dev/null || true
    docker rmi gitpod/openvscode-server:latest 2>/dev/null || true
    echo "✅ Docker 이미지 삭제 완료"
else
    echo "⏭️  Docker 이미지 유지"
fi

echo ""
echo "✅ ======================================"
echo "✅ ANT CLI Server 제거 완료!"
echo "✅ ======================================"


