import { textResult } from './mcp-response.js';

interface AppleCreation {
  success: boolean;
  productId?: string;
  internalId?: string;
  error?: string;
  priceSet?: boolean;
  priceError?: string;
  priceNearest?: Array<{ id: string; price: string }>;
  extraRegionsSet?: string[];
  localizationAdded?: boolean;
}

/** Product creation is durable even when its price setup failed. Never advise recreating it. */
export function appleCreationResult(result: AppleCreation, appId: string, subscription: boolean) {
  if (!result.success) return { ...textResult(`❌ 생성 실패: ${result.error ?? '알 수 없는 오류'}`), isError: true };
  const complete = result.priceSet === true;
  return {
    ...textResult([
      complete ? '✓ App Store 상품 생성·가격 설정 완료' : '⚠ App Store 상품 생성됨 — 가격 설정 미완료',
      `productId: ${result.productId}`,
      `internalId: ${result.internalId}`,
      complete ? '✓ 가격 설정됨' : `가격 오류: ${result.priceError ?? '요청 가격을 설정하지 못했습니다.'}`,
      !complete && result.priceNearest?.length ? `가장 가까운 가격: ${JSON.stringify(result.priceNearest)}` : '',
      !complete ? '상품은 이미 생성됐습니다. 생성 도구를 재실행하지 말고 이 상품의 가격·판매 지역을 수정하세요.' : '',
      result.extraRegionsSet?.length ? `✓ 추가 지역: ${result.extraRegionsSet.join(', ')}` : '',
      result.localizationAdded ? '✓ KRW 한국어 로컬라이제이션 추가됨' : '',
      '판매 전 현지화·심사용 스크린샷·리뷰 노트·심사 상태를 확인하세요.',
      `https://appstoreconnect.apple.com/apps/${appId}/distribution/${subscription ? 'subscriptions' : 'iaps'}`,
    ].filter(Boolean)),
    isError: !complete,
  };
}

// Additive provider fields: remain compatible with installed versions predating activation reporting.
interface GoogleCreation {
  success: boolean;
  productId?: string;
  active?: boolean;
  activationError?: string;
  error?: string;
  skippedRegions?: string[];
}

export function googleSubscriptionCreationResult(result: GoogleCreation, args: {
  packageName: string; price: number; currency: string; period: string;
}) {
  if (!result.success) return { ...textResult(`❌ 구독 생성 실패: ${result.error ?? '알 수 없는 오류'}`), isError: true };
  return {
    ...textResult([
      result.active === true ? '✓ Play 구독 생성·활성화 완료' : '⚠ Play 구독 생성됨 — 활성화 확인 필요',
      `productId: ${result.productId}`,
      `price: ${args.price} ${args.currency} / ${args.period}`,
      result.activationError ? `활성화 오류: ${result.activationError}` : '',
      result.active !== true ? '생성 도구를 재실행하지 말고 기존 기본 요금제 상태를 조회한 뒤 활성화하세요.' : '',
      result.skippedRegions?.length ? `⚠ 적용하지 못한 지역 통화: ${result.skippedRegions.join(', ')}` : '',
      `https://play.google.com/console/u/0/developers/-/app/-/subscriptions?package=${encodeURIComponent(args.packageName)}`,
    ].filter(Boolean)),
    isError: result.active === false || !!result.activationError,
  };
}
