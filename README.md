# Codex UI

Codex CLI GUI 애플리케이션 - Electron 기반 데스크톱 앱

![Codex UI](https://img.shields.io/badge/version-1.0.0-blue) ![Electron](https://img.shields.io/badge/Electron-30.x-47848F) ![React](https://img.shields.io/badge/React-18.x-61DAFB)

## 개요

Codex UI는 OpenAI Codex CLI를 위한 그래픽 인터페이스입니다. Antigravity 스타일의 모던한 UI로 AI 코딩 어시스턴트와 대화할 수 있습니다.

## 주요 기능

- 🎨 **Antigravity 스타일 UI** - 다크 테마 기반의 모던한 인터페이스
- 💬 **실시간 스트리밍** - AI 응답을 실시간으로 확인
- 📁 **워크스페이스 관리** - 여러 프로젝트 폴더를 관리
- 🔍 **파일 검색** - `@` 입력으로 빠른 파일 참조
- 📊 **진행 상황 표시** - 태스크 진행 상태 시각화
- 🎯 **YOLO 모드** - 자동 승인 모드로 빠른 작업

## 설치

### 사전 요구사항

- Node.js 20.x 이상
- Codex CLI (`npm install -g @openai/codex`)

### 개발 환경

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev
```

### 빌드

```bash
# Windows 설치 파일 생성
npm run build
```

빌드 결과물: `release/Codex UI Setup 1.0.0.exe`

## 기술 스택

| 영역 | 기술 |
|------|------|
| 프레임워크 | Electron 30.x |
| 프론트엔드 | React 18, TypeScript |
| 빌드 도구 | Vite |
| 데이터베이스 | sql.js (SQLite WebAssembly) |
| 스타일링 | Tailwind CSS |
| 패키징 | electron-builder |

## 프로젝트 구조

```
codex-wui/
├── electron/           # Electron 메인 프로세스
│   ├── main.ts         # 메인 엔트리
│   ├── preload.ts      # Preload 스크립트
│   ├── db.ts           # SQLite 데이터베이스
│   └── codex-service.ts # Codex CLI 통신
├── src/                # React 프론트엔드
│   ├── App.tsx         # 메인 앱 컴포넌트
│   ├── components/     # UI 컴포넌트
│   └── themes.ts       # 테마 설정
├── public/             # 정적 파일
└── release/            # 빌드 결과물
```
