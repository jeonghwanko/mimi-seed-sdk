/** 심사 제출 전 선언 — 연령 등급 설문, 수출 규정(암호화), 판매 지역. */
import type { ToolRegistrar } from '../../lib/tool-registrar.js';
import { z } from 'zod';
import * as appstoreDeclarations from '../../appstore/declarations.js';
import { textResult } from '../../lib/mcp-response.js';

/** appstore_{get,update}_age_rating · appstore_declare_encryption · appstore_get_availability · appstore_set_territory_availability */
export function registerDeclarationTools(server: ToolRegistrar) {
  // ─── 심사 제출 전 선언 ───
  // 비어 있으면 제출이 막히거나 심사에서 반려되는 항목들. Console 에서만 되는 줄 알았던 것들이다.

  server.tool(
    'appstore_get_age_rating',
    [
      '앱의 연령 등급 설문(ageRatingDeclaration) 현재 값을 읽는다 — 읽기 전용.',
      'appInfo 에 딸린 단일 리소스이며, 편집 가능한 appInfo 를 자동으로 고른다.',
      '수정 전에 이걸로 현재 답변을 먼저 확인할 것.',
    ].join(' '),
    { appId: z.string().describe('App Store 앱 ID (appstore_list_apps 결과)') },
    async ({ appId }) => {
      const { appInfoId, declarationId, declaration } = await appstoreDeclarations.getAgeRating(appId);
      const filled = Object.entries(declaration).filter(([, v]) => v !== undefined && v !== null);
      return textResult([
        `연령 등급 선언 (appInfo ${appInfoId}${declarationId ? ` · declaration ${declarationId}` : ' · 선언 없음'})`,
        ...filled.map(([k, v]) => `  ${k}: ${v}`),
        filled.length === 0 ? '  (아직 답변된 항목 없음)' : '',
      ].filter(Boolean));
    },
  );

  const FREQ = z.enum(['NONE', 'INFREQUENT_OR_MILD', 'FREQUENT_OR_INTENSE', 'INFREQUENT', 'FREQUENT']);
  const freq = (what: string) => FREQ.optional().describe(`${what} — NONE / INFREQUENT_OR_MILD / FREQUENT_OR_INTENSE`);

  server.tool(
    'appstore_update_age_rating',
    [
      '연령 등급 설문을 갱신한다 — PATCH /v1/ageRatingDeclarations/{id}.',
      '넘긴 필드만 바뀐다 (부분 갱신). 전체를 다시 보낼 필요 없다.',
      '미완성이면 심사 제출이 막히므로 첫 출시 전 반드시 채워야 한다.',
      'Play 의 콘텐츠 등급 설문과 달리 Apple 은 이렇게 API 로 답변할 수 있다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      violenceCartoonOrFantasy: freq('만화/판타지 폭력'),
      violenceRealistic: freq('사실적 폭력'),
      violenceRealisticProlongedGraphicOrSadistic: freq('지속적·잔혹한 사실적 폭력'),
      profanityOrCrudeHumor: freq('욕설/저속한 유머'),
      matureOrSuggestiveThemes: freq('성인/암시적 주제'),
      horrorOrFearThemes: freq('공포/공포 유발 주제'),
      sexualContentOrNudity: freq('성적 콘텐츠 또는 노출'),
      sexualContentGraphicAndNudity: freq('노골적 성적 콘텐츠·노출'),
      alcoholTobaccoOrDrugUseOrReferences: freq('음주/흡연/약물'),
      medicalOrTreatmentInformation: freq('의료/치료 정보'),
      gamblingSimulated: freq('모의 도박'),
      contests: freq('경품/콘테스트'),
      gunsOrOtherWeapons: freq('총기·무기'),
      gambling: z.boolean().optional().describe('실제 도박 포함 여부'),
      lootBox: z.boolean().optional().describe('확률형 아이템(루트박스) 포함 여부'),
      unrestrictedWebAccess: z.boolean().optional().describe('제한 없는 웹 접근'),
      userGeneratedContent: z.boolean().optional().describe('사용자 생성 콘텐츠'),
      socialMedia: z.boolean().optional().describe('UGC를 피드·탐색 방식으로 재배포·확산·상호작용하는 소셜 미디어 기능'),
      socialMediaAgeRestricted: z.boolean().optional().describe('소셜 미디어 기능을 13세 미만 사용자에게 비활성화'),
      messagingAndChat: z.boolean().optional().describe('메시지/채팅 기능'),
      advertising: z.boolean().optional().describe('광고 포함'),
      healthOrWellnessTopics: z.boolean().optional().describe('건강/웰니스 주제'),
      parentalControls: z.boolean().optional().describe('자녀 보호 기능 제공'),
      ageAssurance: z.boolean().optional().describe('연령 확인 장치 제공'),
      kidsAgeBand: z
        .enum(['FIVE_AND_UNDER', 'SIX_TO_EIGHT', 'NINE_TO_ELEVEN'])
        .optional()
        .describe('키즈 카테고리 대상 연령대 (키즈 앱만)'),
      ageRatingOverrideV2: z
        .enum(['NONE', 'NINE_PLUS', 'THIRTEEN_PLUS', 'SIXTEEN_PLUS', 'EIGHTEEN_PLUS', 'UNRATED'])
        .optional()
        .describe('산출 등급을 더 높게 덮어쓸 때만'),
      koreaAgeRatingOverride: z
        .enum(['NONE', 'FIFTEEN_PLUS', 'NINETEEN_PLUS'])
        .optional()
        .describe('한국 등급 별도 지정 (게임물관리위원회 등급을 반영해야 할 때)'),
      developerAgeRatingInfoUrl: z.string().optional().describe('등급 근거 안내 URL'),
    },
    async ({ appId, ...declaration }) => {
      const { declarationId, declaration: after } = await appstoreDeclarations.updateAgeRating({
        appId,
        declaration: declaration,
      });
      const changed = Object.keys(declaration).filter(
        (k) => (declaration as Record<string, unknown>)[k] !== undefined,
      );
      return textResult([
        `✅ 연령 등급 갱신 (${changed.length}개 항목) — declaration ${declarationId}`,
        ...changed.map((k) => `  ${k}: ${String(after[k])}`),
      ]);
    },
  );

  server.tool(
    'appstore_declare_encryption',
    [
      '수출 규정(암호화) 선언을 만들고 선택한 빌드에 연결한다 — POST /v1/appEncryptionDeclarations.',
      'Info.plist 의 ITSAppUsesNonExemptEncryption 이 있으면 보통 이 선언이 필요 없다 —',
      '그게 없어서 ASC 가 "수출 규정 정보 누락"으로 제출을 막을 때 쓰는 경로다.',
      '⚠️ 법적 신고 성격의 선언이다. 값은 반드시 사용자에게 확인받고 넣을 것.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      appDescription: z.string().describe('앱이 사용하는 암호화에 대한 설명 (심사용)'),
      containsProprietaryCryptography: z.boolean().describe('자체 개발한 암호화를 포함하는가'),
      containsThirdPartyCryptography: z.boolean().describe('서드파티 암호화를 포함하는가'),
      availableOnFrenchStore: z.boolean().describe('프랑스 스토어에 배포하는가 (프랑스는 별도 신고 규정)'),
      buildIds: z
        .array(z.string())
        .optional()
        .describe('이 선언을 연결할 빌드 ID들 (appstore_list_builds 결과). 생략 시 선언만 생성'),
    },
    async ({ appId, buildIds, ...attrs }) => {
      const r = await appstoreDeclarations.declareEncryption({ appId, buildIds, ...attrs });
      return textResult([
        '✅ 수출 규정 선언 생성',
        `  declarationId: ${r.declarationId}`,
        `  상태: ${r.state ?? '(응답에 없음)'}`,
        `  연결된 빌드: ${r.attachedBuilds}개`,
        r.state === 'IN_REVIEW' ? '  Apple 검토 중 — 승인되면 빌드에 반영된다.' : '',
      ].filter(Boolean));
    },
  );

  server.tool(
    'appstore_get_availability',
    [
      '앱의 판매 지역 상태를 읽는다 — GET /v1/apps/{id}/appAvailabilityV2.',
      '판매 중/중지 지역 수와 신규 지역 자동 포함 여부를 보여준다.',
      'includeTerritories=true 면 지역별 행(id·available·releaseDate)까지 — 이 id 가 변경 도구의 입력이다.',
    ].join(' '),
    {
      appId: z.string().describe('App Store 앱 ID'),
      includeTerritories: z.boolean().optional().describe('지역 목록까지 반환 (기본 false)'),
    },
    async ({ appId, includeTerritories }) => {
      const r = await appstoreDeclarations.getAvailability({ appId, includeTerritories });
      const lines = [
        `판매 지역 (availability ${r.availabilityId ?? '없음'})`,
        `  판매 중: ${r.availableCount}개 · 중지: ${r.unavailableCount}개`,
        `  신규 지역 자동 포함: ${r.availableInNewTerritories === undefined ? '알 수 없음' : r.availableInNewTerritories}`,
      ];
      if (r.territories) {
        for (const t of r.territories) {
          lines.push(
            `  ${t.id}: ${t.available ? '판매' : '중지'}` +
              (t.releaseDate ? ` · 출시일 ${t.releaseDate}` : '') +
              (t.preOrderEnabled ? ' · 사전주문' : ''),
          );
        }
      }
      return textResult(lines.join('\n'));
    },
  );

  server.tool(
    'appstore_set_territory_availability',
    [
      '지역별 판매 여부·출시일을 바꾼다 — PATCH /v1/territoryAvailabilities/{id}.',
      'id 는 appstore_get_availability(includeTerritories=true) 결과에서 가져올 것 — 지역 코드를 추측해 넣지 말 것.',
      '한 지역이 실패해도 나머지는 계속 진행하고, 지역별 성공/실패를 그대로 보고한다.',
      '⚠️ available=false 는 그 지역에서 앱을 내리는 동작이다.',
    ].join(' '),
    {
      territories: z
        .array(
          z.object({
            id: z.string().describe('territoryAvailability 리소스 id'),
            available: z.boolean().optional().describe('판매 여부'),
            releaseDate: z.string().optional().describe('출시일 (YYYY-MM-DD)'),
            preOrderEnabled: z.boolean().optional().describe('사전주문 활성화'),
          }),
        )
        .min(1)
        .describe('변경할 지역 목록'),
      confirm: z.boolean().optional().describe('true 명시 시에만 실제 변경. 생략/false 면 변경 예정 목록만 반환.'),
    },
    async ({ territories, confirm }) => {
      if (!confirm) {
        return textResult([
          `🛑 dry-run — ${territories.length}개 지역, 아직 바꾸지 않았다.`,
          ...territories.map(
            (t) =>
              `  ${t.id}: ` +
              [
                t.available === undefined ? '' : `판매=${t.available}`,
                t.releaseDate ? `출시일=${t.releaseDate}` : '',
                t.preOrderEnabled === undefined ? '' : `사전주문=${t.preOrderEnabled}`,
              ].filter(Boolean).join(' · '),
          ),
          '',
          '실행하려면 confirm: true 로 다시 호출.',
        ]);
      }
      const results = await appstoreDeclarations.setTerritoryAvailability({ territories });
      const ok = results.filter((r) => r.ok).length;
      return textResult([
        `지역 변경: 성공 ${ok} / 실패 ${results.length - ok}`,
        ...results.filter((r) => !r.ok).map((r) => `  ✗ ${r.id}: ${r.error}`),
      ]);
    },
  );
}
