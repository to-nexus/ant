#!/bin/bash
set -e

# ===========================================
# ANT CLI 배포 스크립트
# VM에서 실행 (ECR 이미지 Pull & Deploy)
# ===========================================

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 ANT CLI 배포 시작...${NC}"

# 변수 설정
ECR_REGISTRY="${ECR_REGISTRY:-412381771241.dkr.ecr.ap-northeast-2.amazonaws.com}"
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
INSTALL_DIR="${INSTALL_DIR:-/cross/ant}"
COMPOSE_FILE="${INSTALL_DIR}/docker-compose.yml"

# 1. ECR 로그인
echo -e "${YELLOW}📦 ECR 로그인 중...${NC}"
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

# Docker config를 root 홈에도 복사 (Watchtower용)
if [ -f ~/.docker/config.json ]; then
    sudo mkdir -p /root/.docker
    sudo cp ~/.docker/config.json /root/.docker/config.json
fi

# 2. 최신 이미지 Pull
echo -e "${YELLOW}📥 최신 이미지 다운로드 중...${NC}"
docker compose -f ${COMPOSE_FILE} pull

# 3. 컨테이너 재시작
echo -e "${YELLOW}🔄 컨테이너 재시작 중...${NC}"
docker compose -f ${COMPOSE_FILE} up -d

# 4. 오래된 이미지 정리
echo -e "${YELLOW}🧹 오래된 이미지 정리 중...${NC}"
docker image prune -f

# 5. 상태 확인
echo -e "${YELLOW}📊 컨테이너 상태 확인...${NC}"
docker compose -f ${COMPOSE_FILE} ps

echo ""
echo -e "${GREEN}✅ 배포 완료!${NC}"
echo -e "   Health Check: curl http://localhost:4100/api/health"
