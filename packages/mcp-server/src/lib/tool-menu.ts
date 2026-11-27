import type { ToolManifest } from './package-root.js';
import type { ToolsetSelection } from './toolsets.js';

export const TOOL_MENU_URI = 'mimi-seed://tools/menu';
export const TOOL_SELECTION_URI = `${TOOL_MENU_URI}/{areas*}`;

export type MenuLanguage = 'ko' | 'en';
export interface ToolMenuArea {
  id: string;
  label: string;
  tools: string[];
}

const menuOrder = [
  'ga4', 'bigquery', 'playstore', 'appstore', 'video', 'youtube', 'firebase', 'googleads',
  'admob', 'drive', 'gsc', 'naver', 'instagram', 'threads', 'facebook', 'tiktok', 'crosspost',
  'ci', 'jenkins', 'checks', 'android', 'iam', 'billing', 'ai', 'auth',
];

const labels: Record<string, Record<MenuLanguage, string>> = {
  ga4: { ko: 'GA4', en: 'GA4' },
  playstore: { ko: 'Mobile Store · Google Play', en: 'Mobile Store · Google Play' },
  appstore: { ko: 'Mobile Store · Apple App Store', en: 'Mobile Store · Apple App Store' },
  video: { ko: 'YouTube · 영상 제작', en: 'YouTube · Video production' },
  youtube: { ko: 'YouTube · 업로드·채널 운영', en: 'YouTube · Upload and channel management' },
  naver: { ko: '네이버 서치어드바이저', en: 'Naver Search Advisor' },
  crosspost: { ko: '소셜 통합 게시', en: 'Cross-post to several social platforms' },
  checks: { ko: '출시 상태·제출 전 점검', en: 'Release status and submission checks' },
  android: { ko: 'Android 서명', en: 'Android signing' },
  ai: { ko: 'AI 초안 · 릴리스 노트 / 리뷰 답변', en: 'AI drafts · Release notes and review replies' },
  auth: { ko: '계정 연결·진단', en: 'Account connections and diagnostics' },
};

export function buildToolMenu(
  manifest: ToolManifest,
  selection: ToolsetSelection,
  lang: MenuLanguage,
): ToolMenuArea[] {
  const toolsByArea = new Map<string, string[]>();
  for (const [owner, domain] of Object.entries(manifest.domains)) {
    for (const name of domain.tools) {
      if (!selection.isToolEnabled(name) || Object.hasOwn(manifest.deprecated ?? {}, name)) continue;
      // 영상 제작 쪽에 등록된 YouTube 업로드 도구도 메뉴에서는 채널 운영에 넣는다.
      const area = owner === 'video' && name.startsWith('youtube_') ? 'youtube' : owner;
      const areas = new Set([area, ...(manifest.alsoInToolsets?.[name] ?? [])]);
      for (const id of areas) {
        const tools = toolsByArea.get(id) ?? [];
        tools.push(name);
        toolsByArea.set(id, tools);
      }
    }
  }
  const ids = new Set([...menuOrder, ...Object.keys(manifest.domains)]);
  return [...ids].flatMap((id) => {
    const tools = toolsByArea.get(id);
    const domain = manifest.domains[id];
    return tools && domain ? [{ id, label: labels[id]?.[lang] ?? domain.label, tools }] : [];
  });
}

export function formatToolMenu(menu: readonly ToolMenuArea[], lang: MenuLanguage): string {
  const question = lang === 'ko'
    ? '이번에 사용할 서비스를 골라주세요. 여러 개를 선택할 수 있습니다.'
    : 'Which services would you like to use? You can choose more than one.';
  return [question, '', ...menu.map(({ id, label }, index) => `${index + 1}. ${label} (${id})`)].join('\n');
}

export function selectToolMenu(menu: readonly ToolMenuArea[], input: string) {
  const entries = input.split(',').map((value) => value.trim().toLowerCase());
  const areas = entries.map((entry) =>
    /^\d+$/.test(entry)
      ? menu[Number(entry) - 1]
      : menu.find(({ id, label }) => id === entry || label.toLowerCase() === entry));
  if (areas.some((area) => area === undefined)) return null;
  const selected = [...new Set(areas.filter((area) => area !== undefined))];
  return {
    areas: selected.map(({ id, label }) => ({ id, label })),
    tools: [...new Set(selected.flatMap(({ tools }) => tools))],
  };
}
