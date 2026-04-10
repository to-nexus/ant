# Directives (채팅 입력 텍스트)

시나리오별 채팅 입력은 workspace-fixtures가 아닌 단일 소스에서 관리:

→ [`packages/ant-cli/tests/intents/documents/directives.json`](../../../../packages/ant-cli/tests/intents/documents/directives.json)

- `_triage:1-1` ~ `_triage:6-3`: 수동 triage 테스트 시나리오 (이 README의 테스트 매트릭스 대응)
- `create-fe:directive` 등: 자동 intent-acceptance 테스트용
- `_runtime:*`: 런타임 감지 테스트용
