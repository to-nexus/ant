#!/bin/bash
set -e

# ===========================================
# ANT IDE 제거 스크립트
# ===========================================

echo "🗑️  ANT IDE 제거를 시작합니다..."

SERVICE_NAME="ant-ide"
INSTALL_DIR="/cross/ant/ant-ide"

# Root 권한 확인
if [[ $EUID -ne 0 ]]; then
   echo "❌ 이 스크립트는 root 권한으로 실행해야 합니다."
   echo "   sudo ./uninstall.sh"
   exit 1
fi

# 1. 서비스 중지 및 비활성화
echo "⏹️  서비스 중지 중..."
systemctl stop "$SERVICE_NAME" 2>/dev/null || true
systemctl disable "$SERVICE_NAME" 2>/dev/null || true

# 2. Docker 컨테이너 정리
echo "🐳 Docker 컨테이너 정리 중..."
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
    cd "$INSTALL_DIR"
    docker compose down --remove-orphans 2>/dev/null || true
fi

# 기존 컨테이너 정리 (혹시 남아있으면)
docker stop ant-openvscode 2>/dev/null || true
docker rm ant-openvscode 2>/dev/null || true

# 3. systemd 서비스 파일 제거
echo "🗂️  서비스 파일 제거 중..."
rm -f "/etc/systemd/system/$SERVICE_NAME.service"
systemctl daemon-reload

# 4. 설치 디렉토리 제거
read -p "⚠️  설치 디렉토리를 삭제하시겠습니까? ($INSTALL_DIR) [y/N]: " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    echo "✅ 설치 디렉토리 삭제 완료"
else
    echo "⏭️  설치 디렉토리 유지"
fi

# 워크스페이스 디렉토리는 보존 (디스크 마운트)
echo ""
echo "✅ ANT IDE 제거 완료!"
echo "📌 워크스페이스 데이터는 보존됩니다: /cross"
echo "   (마운트된 디스크 데이터는 유지됩니다)"

