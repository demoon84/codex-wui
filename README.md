# Codex UI

Codex CLI GUI 애플리케이션(Tauri + React 기반 데스크톱 앱)

## 개요

Codex UI는 OpenAI Codex CLI를 데스크톱 환경에서 사용할 수 있도록 만든 GUI입니다.
워크스페이스/대화 관리, 스트리밍 출력, 파일 검색(`@`), CLI 제어 패널, MCP 서버 관리, MS Teams 연동 기능을 제공합니다.

## 주요 기능

- 실시간 응답 스트리밍 (타이핑 효과 + 사고 과정 표시)
- 워크스페이스/대화 관리
- 파일 검색 및 첨부 (`@` 입력으로 컨텍스트 메뉴 호출)
- Codex CLI 옵션 제어 (`sandbox`, `approval policy`, `model`, `web search` 등)
- MCP(Model Context Protocol) 서버 관리 (설치/제거/조회)
- MS Teams 웹훅 연동 (AI 응답을 Teams 채널에 전달)
- 다크/라이트 테마 지원 (12종 테마)
- SQLite 기반 상태 영속화
- 자동 업데이트 체크
- 다국어 지원 (한국어/영어)

## 사전 요구사항

- Node.js 20+
- Rust toolchain (Tauri 빌드용)
- Codex CLI (`npm install -g @openai/codex`)

## 개발 실행

```bash
npm install
npm run tauri dev
```

브라우저 스모크(타이핑 입력) 검증:

```bash
# 터미널 1
npm run dev:web

# 터미널 2
npm run smoke:playwright:typed
# 또는 타이핑 속도/대기시간 조정
PW_TYPE_DELAY_MS=40 PW_STREAM_WAIT_MS=2200 npm run smoke:playwright:typed
# 또는 인자로 타입 딜레이 전달
scripts/playwright-smoke-typed.sh http://localhost:5173 40
```

UI 스트리밍 타이핑 속도는 하단 상태바 `stream` 셀렉터(8/12/18/24/36/60ms)에서 변경할 수 있으며,
값은 브라우저 `localStorage`에 저장됩니다.

## 빌드

```bash
npm run build
```

Tauri 번들 결과물은 `src-tauri/target/release/bundle/` 아래에 생성됩니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| 데스크톱 런타임 | Tauri 2 |
| 프론트엔드 | React 18, TypeScript, Vite |
| 백엔드 | Rust |
| 데이터 저장소 | SQLite (rusqlite) |
| 스타일링 | Tailwind CSS |

## 프로젝트 구조

```
codex-wui/
├── src/                    # React 프론트엔드
│   ├── api/                # Tauri API 브릿지
│   ├── components/         # UI 컴포넌트
│   ├── i18n/               # 다국어 리소스
│   ├── utils/              # 유틸리티 함수
│   └── App.tsx             # 메인 앱 컴포넌트
├── src-tauri/              # Tauri(Rust) 백엔드
│   └── src/
│       ├── auth.rs         # 인증 관리
│       ├── codex.rs        # Codex CLI 연동
│       ├── db.rs           # SQLite 데이터베이스
│       ├── shell.rs        # 쉘 명령 실행
│       ├── teams.rs        # MS Teams 웹훅
│       └── lib.rs          # 앱 진입점
├── public/                 # 정적 파일
└── README.md
```

## 변경 이력

### 2026-02-08
- 실험적 App Server(JSON-RPC) 기능 제거 — 코드베이스 간소화
- MCP 서버 목록 파싱 버그 수정 (`--json` 플래그 활용)
- Settings 패널 레이아웃 클리핑 버그 수정

### 2026-02-07
- MS Teams 웹훅 연동 기능 추가
- 스트리밍 응답 처리 안정화
- 패키지 앱 PATH 문제 수정 (macOS)
