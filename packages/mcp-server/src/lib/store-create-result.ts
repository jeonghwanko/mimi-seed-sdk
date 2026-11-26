import { textResult } from './mcp-response.js';
import { catalog } from '#core/lang.js';

/** Product-creation results — returned to the caller agent, so they follow the user's language. */
const C = catalog(
  {
    createFailed: (error: string) => `❌ 생성 실패: ${error}`,
    unknownError: '알 수 없는 오류',
    appleComplete: '✓ App Store 상품 생성·가격 설정 완료',
    applePriceIncomplete: '⚠ App Store 상품 생성됨 — 가격 설정 미완료',
    priceSet: '✓ 가격 설정됨',
    priceError: (error: string) => `가격 오류: ${error}`,
    priceNotSet: '요청 가격을 설정하지 못했습니다.',
    nearestPrice: (json: string) => `가장 가까운 가격: ${json}`,
    doNotRecreateApple: '상품은 이미 생성됐습니다. 생성 도구를 재실행하지 말고 이 상품의 가격·판매 지역을 수정하세요.',
    extraRegions: (regions: string) => `✓ 추가 지역: ${regions}`,
    localizationAdded: '✓ KRW 한국어 로컬라이제이션 추가됨',
    checkBeforeSale: '판매 전 현지화·심사용 스크린샷·리뷰 노트·심사 상태를 확인하세요.',
    subscriptionFailed: (error: string) => `❌ 구독 생성 실패: ${error}`,
    playComplete: '✓ Play 구독 생성·활성화 완료',
    playActivationPending: '⚠ Play 구독 생성됨 — 활성화 확인 필요',
    activationError: (error: string) => `활성화 오류: ${error}`,
    doNotRecreatePlay: '생성 도구를 재실행하지 말고 기존 기본 요금제 상태를 조회한 뒤 활성화하세요.',
    skippedRegions: (regions: string) => `⚠ 적용하지 못한 지역 통화: ${regions}`,
  },
  {
    createFailed: (error: string) => `❌ Creation failed: ${error}`,
    unknownError: 'Unknown error',
    appleComplete: '✓ App Store product created and price set',
    applePriceIncomplete: '⚠ App Store product created — price setup incomplete',
    priceSet: '✓ Price set',
    priceError: (error: string) => `Price error: ${error}`,
    priceNotSet: 'Could not set the requested price.',
    nearestPrice: (json: string) => `Nearest prices: ${json}`,
    doNotRecreateApple: 'The product has already been created. Do not run the create tool again; fix this product\'s price and sales regions instead.',
    extraRegions: (regions: string) => `✓ Additional regions: ${regions}`,
    localizationAdded: '✓ KRW Korean localization added',
    checkBeforeSale: 'Before selling, check the localizations, review screenshot, review notes, and review status.',
    subscriptionFailed: (error: string) => `❌ Subscription creation failed: ${error}`,
    playComplete: '✓ Play subscription created and activated',
    playActivationPending: '⚠ Play subscription created — activation needs checking',
    activationError: (error: string) => `Activation error: ${error}`,
    doNotRecreatePlay: 'Do not run the create tool again; look up the status of the existing base plan, then activate it.',
    skippedRegions: (regions: string) => `⚠ Regional currencies not applied: ${regions}`,
  },
);

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
  if (!result.success) return { ...textResult(C().createFailed(result.error ?? C().unknownError)), isError: true };
  const complete = result.priceSet === true;
  return {
    ...textResult([
      complete ? C().appleComplete : C().applePriceIncomplete,
      `productId: ${result.productId}`,
      `internalId: ${result.internalId}`,
      complete ? C().priceSet : C().priceError(result.priceError ?? C().priceNotSet),
      !complete && result.priceNearest?.length ? C().nearestPrice(JSON.stringify(result.priceNearest)) : '',
      !complete ? C().doNotRecreateApple : '',
      result.extraRegionsSet?.length ? C().extraRegions(result.extraRegionsSet.join(', ')) : '',
      result.localizationAdded ? C().localizationAdded : '',
      C().checkBeforeSale,
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
  if (!result.success) return { ...textResult(C().subscriptionFailed(result.error ?? C().unknownError)), isError: true };
  return {
    ...textResult([
      result.active === true ? C().playComplete : C().playActivationPending,
      `productId: ${result.productId}`,
      `price: ${args.price} ${args.currency} / ${args.period}`,
      result.activationError ? C().activationError(result.activationError) : '',
      result.active !== true ? C().doNotRecreatePlay : '',
      result.skippedRegions?.length ? C().skippedRegions(result.skippedRegions.join(', ')) : '',
      `https://play.google.com/console/u/0/developers/-/app/-/subscriptions?package=${encodeURIComponent(args.packageName)}`,
    ].filter(Boolean)),
    isError: result.active === false || !!result.activationError,
  };
}
