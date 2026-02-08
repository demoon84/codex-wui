// Korean translations
import type { Translations } from './en'

const ko: Translations = {
    // Common
    loading: '로딩 중...',

    // Login
    loginTitle: 'Codex 로그인',
    loginButton: '브라우저로 로그인',
    loginBusy: '로그인 중...',

    // Codex Install
    checkingEnv: '환경 확인 중...',
    installRequired: 'Codex CLI 설치 필요',
    installDescription1: 'Codex UI를 사용하려면 OpenAI Codex CLI가 필요합니다.',
    installDescription2: '아래 버튼을 클릭하여 자동으로 설치하세요.',
    installing: '설치 중...',
    preparing: '준비 중...',
    retry: '다시 시도',
    installButton: 'Codex CLI 설치',
    installHint: 'npm install -g @openai/codex 명령어를 실행합니다.',

    // Chat
    chatPlaceholder: '무엇이든 말해보세요',
    chatPlaceholderNoWorkspace: '워크스페이스를 열어 시작하세요...',
    chatPlaceholderLoading: '질문을 입력하면 현재 응답을 취소합니다...',
    startConversation: 'Codex와 대화를 시작하세요',
    stopResponse: '응답 중단',
    responseCancelled: '(응답이 취소됨)',
    errorOccurred: '오류가 발생했습니다: ',

    // Comments
    recentHistoryComment: '최근 3개 검색 기록 전달',

    // Sidebar

    // Status Bar
    yoloTooltipOn: 'full access: 모든 작업 자동 승인',
    yoloTooltipOff: 'permission: 작업 전 확인',

    // Approval Dialog
    approvalTitle: '이 계획을 진행할까요?',
    approvalReject: '거절',
    approvalApproving: '진행 중...',
    approvalApprove: '승인',

    // Model Selector
    selectModel: 'AI 모델 선택',
    thinkingBadge: '추론',

    // Model Descriptions
    'model.gpt-5.3-codex': '최신 최고 성능 코딩 모델, 복잡한 에이전트 작업에 최적화',
    'model.gpt-5.2-codex': '고급 코딩 모델, 엔지니어링 작업에 적합',
    'model.gpt-5.1-codex-max': '장기 에이전트 코딩 작업에 최적화',
    'model.gpt-5.1-codex-mini': '비용 효율적인 소형 코딩 모델',
    'model.o4-mini': '기본 모델, 빠른 응답',
    'model.gpt-4.1': '가장 스마트한 비추론 모델',
    'model.gpt-4o': '멀티모달 작업에 적합',

    // Context Menu
    searching: '검색 중...',
    navigate: '이동',
    select: '선택',
    close: '닫기',

    // Chat Panel
    copied: '복사됨!',
    copy: '복사',
    thinking: '생각중',
    'tool.search': '검색',
    'tool.fileRead': '파일 읽기',
    'tool.edit': '수정',
    'tool.command': '명령 실행',
    'tool.analyze': '분석',
    'tool.other': '작업',

    // Task Summary
    taskComplete: '작업 완료',

    // Terminal & Generation
    runningTerminal: '실행 중인 터미널',
    terminalOutput: '터미널 출력',
    generating: '생성중...',
}

export default ko
