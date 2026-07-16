import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ensureFreshAccessToken } from './auth/google-auth.js';

/** tool-manifest.json 의 형태. 테스트들도 이 타입을 import 해 캐스트 드리프트를 막는다. */
export type ToolManifest = { total: number; domains: Record<string, string[]> };

// assets/agent-guide.md = docs/agent-guide.md 의 배포용 사본 (npm 배포본에는 docs/ 가 없다).
// 갱신은 `npm run plugin:sync`, 드리프트는 prompts-resources.test.ts 가 잡는다.
// 읽기 실패는 정상 설치에서 불가능하다(files 화이트리스트에 포함) — 그래서 폴백은 가이드
// 요약본이 아니라 "깨진 설치" 신호 + 원본 포인터만 담는다. 요약본을 하나 더 관리하지 않는다.
const AGENT_GUIDE_FALLBACK = [
  '# Mimi Seed agent guide — 자산 누락 (degraded)',
  '',
  '⚠️ 이 설치본에서 assets/agent-guide.md 를 읽지 못했습니다 — 패키지가 손상됐습니다.',
  '`npx -y @yoonion/mimi-seed-mcp` 재설치(필요 시 npx 캐시 정리) 후 새 세션을 여세요.',
  '',
  '가이드 전문: https://github.com/jeonghwanko/mimi-seed-sdk/blob/main/docs/agent-guide.md',
  '최소 안전수칙: 스토어 제출·승격·삭제·공개 게시는 사용자 명시 동의 없이 실행하지 않는다.',
].join('\n');

function readPackageAsset(relativePath: string): string | null {
  try {
    // src/ 와 dist/ 모두 패키지 루트 바로 아래라 ../ 가 같은 곳을 가리킨다 (index.ts 의 package.json 읽기와 동일 패턴).
    return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

/** 도메인 id → 라벨·필요 자격증명·한줄 요약. 키 집합은 tool-manifest.json 의 domains 와
 *  일치해야 한다 (prompts-resources.test.ts 가 강제) — 도메인을 추가하면 여기도 추가할 것. */
const DOMAIN_SUMMARY: Record<string, { label: string; credential: string; summary: string }> = {
  playstore: {
    label: 'Google Play',
    credential: 'Google OAuth (CI/헤드리스는 Play 서비스 계정)',
    summary: '리스팅·트랙 릴리스·이미지·리뷰 답변·통계·서비스 계정 등록',
  },
  appstore: {
    label: 'App Store Connect',
    credential: 'ASC API 키 (mimi-seed auth appstore)',
    summary: '버전·빌드 attach·What\'s New·스크린샷·IAP 심사 메타데이터·심사 제출',
  },
  firebase: {
    label: 'Firebase',
    credential: 'Google OAuth',
    summary: '프로젝트/앱 생성·설정 파일 다운로드·서비스 활성화',
  },
  admob: {
    label: 'AdMob',
    credential: 'Google OAuth',
    summary: '앱·광고 단위 생성, 오늘 수익·기간 리포트',
  },
  iam: {
    label: 'Google Cloud IAM',
    credential: 'Google OAuth',
    summary: '서비스 계정 생성·키 발급·IAM 정책 바인딩',
  },
  bigquery: {
    label: 'BigQuery',
    credential: 'Google OAuth (또는 BigQuery 서비스 계정)',
    summary: '쿼리 실행·데이터셋/테이블/스키마 조회',
  },
  ga4: {
    label: 'Google Analytics 4',
    credential: 'Google OAuth',
    summary: '계정/속성·데이터 스트림 관리, 리포트 실행',
  },
  gsc: {
    label: 'Search Console',
    credential: 'Google OAuth',
    summary: 'URL 검사·검색 성과 분석·사이트맵 제출',
  },
  googleads: {
    label: 'Google Ads',
    credential: 'Google Ads 설정 (mimi-seed auth googleads, adwords 스코프)',
    summary: '캠페인 목록·캠페인/UAC 리포트',
  },
  ci: {
    label: 'CI (GitHub Actions / GitLab)',
    credential: 'GitHub/GitLab 토큰 (mimi-seed auth ci)',
    summary: '워크플로 조회·빌드 트리거/상태/취소 — Jenkins 빌드는 대상 아님',
  },
  jenkins: {
    label: 'Jenkins',
    credential: 'Jenkins URL + API 토큰 (mimi-seed auth jenkins)',
    summary: '크리덴셜·keystore 업로드·잡 생성/수정 — 빌드 트리거 도구는 없음',
  },
  android: {
    label: 'Android 서명',
    credential: '없음 (로컬 파일 작업)',
    summary: 'keystore 생성·서명 설정·Jenkins 로 Play SA 업로드',
  },
  facebook: {
    label: 'Facebook',
    credential: 'Facebook 페이지 토큰 (mimi-seed auth facebook)',
    summary: '페이지 텍스트/사진/링크 포스팅',
  },
  instagram: {
    label: 'Instagram',
    credential: 'Instagram 토큰 (mimi-seed auth instagram)',
    summary: '사진·캐러셀·릴스 포스팅',
  },
  threads: {
    label: 'Threads',
    credential: 'Threads 토큰 (mimi-seed auth threads)',
    summary: '텍스트/이미지 포스팅·토큰 갱신',
  },
  checks: {
    label: '출시 점검',
    credential: '점검 대상 스토어의 자격증명',
    summary: '제출 전 위험 점검·스크린샷 규격 검증·릴리스 상태',
  },
  ai: {
    label: 'AI 생성',
    credential: 'ANTHROPIC_API_KEY 환경변수',
    summary: '커밋 기반 릴리스 노트·리뷰 답변 초안 생성',
  },
  auth: {
    label: '연결/진단',
    credential: '없음 (이것이 셋업 도구)',
    summary: '전체 연결 상태 스캔(mimi_seed_status)·OAuth 시작·원격 크리덴셜 동기화',
  },
};

export function registerResources(server: McpServer) {
  server.resource(
    'auth-status',
    'mimi-seed://auth/status',
    { description: 'Google OAuth 인증 상태 — fresh / refreshed / expired / unauthenticated', mimeType: 'application/json' },
    async () => {
      const r = await ensureFreshAccessToken();
      const ok = r.status === 'fresh' || r.status === 'refreshed';
      return {
        contents: [{
          uri: 'mimi-seed://auth/status',
          mimeType: 'application/json',
          text: JSON.stringify({
            status: r.status,
            authenticated: ok,
            msUntilExpiry: ok ? (r as { msUntilExpiry: number }).msUntilExpiry : null,
            error: !ok ? (r as { error: unknown }).error : null,
            hint: !ok ? 'Run: npx -y @yoonion/mimi-seed-mcp mimi-seed-auth' : null,
          }, null, 2),
        }],
      };
    },
  );

  server.resource(
    'agent-guide',
    'mimi-seed://agent/guide',
    {
      description: 'Mimi Seed 에이전트 운영 규약 전문 (docs/agent-guide.md) — deferred 도구 로딩·ToolSearch select: 배치·호출 순서·비가역 액션 안전수칙',
      mimeType: 'text/markdown',
    },
    async () => ({
      contents: [{
        uri: 'mimi-seed://agent/guide',
        mimeType: 'text/markdown',
        text: readPackageAsset('../assets/agent-guide.md') ?? AGENT_GUIDE_FALLBACK,
      }],
    }),
  );

  server.resource(
    'tools-catalog',
    'mimi-seed://tools/catalog',
    {
      description: '150+ 도구 전체 카탈로그 — 도메인별 도구 목록·필요 자격증명·한줄 요약. "mimi-seed 로 뭘 할 수 있어?" 에는 이 리소스를 읽고 답하세요.',
      mimeType: 'application/json',
    },
    async () => {
      // LLM 이 읽는 페이로드라 compact 로 직렬화한다 (pretty 들여쓰기는 ~40% 바이트 낭비).
      let payload: string;
      try {
        const raw = readFileSync(new URL('../tool-manifest.json', import.meta.url), 'utf8');
        const manifest = JSON.parse(raw) as ToolManifest;
        if (typeof manifest?.total !== 'number' || typeof manifest?.domains !== 'object' || manifest.domains === null) {
          throw new Error('tool-manifest.json 의 형태가 예상과 다릅니다');
        }
        payload = JSON.stringify({
          total: manifest.total,
          deferredHint:
            'Claude Code 에서는 도구 schema 가 lazy 로드됩니다 — 호출 전 ToolSearch(query="select:<tool,...>") 로 선로드하세요. 상세: mimi-seed://agent/guide',
          domains: Object.entries(manifest.domains).map(([id, tools]) => ({
            id,
            label: DOMAIN_SUMMARY[id]?.label ?? id,
            credential: DOMAIN_SUMMARY[id]?.credential ?? '알 수 없음',
            summary: DOMAIN_SUMMARY[id]?.summary ?? '',
            toolCount: tools.length,
            tools,
          })),
        });
      } catch (e) {
        // 가짜 성공(빈 카탈로그)을 서빙하지 않는다 — 깨진 설치임을 명시적으로 알린다.
        payload = JSON.stringify({
          error:
            'tool-manifest.json 을 읽지 못했습니다 — 패키지가 손상됐습니다. `npx -y @yoonion/mimi-seed-mcp` 재설치 후 새 세션을 여세요.',
          detail: e instanceof Error ? e.message : String(e),
          total: null,
          domains: [],
        });
      }
      return {
        contents: [{
          uri: 'mimi-seed://tools/catalog',
          mimeType: 'application/json',
          text: payload,
        }],
      };
    },
  );
}
