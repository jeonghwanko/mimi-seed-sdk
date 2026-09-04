import {
  saveAppStoreCredentials,
  type AppStoreCredentials,
} from './auth.js';
import {
  verifyAppStoreCredentials,
  type AppStoreVerifyResult,
} from './tools.js';

interface SetupDependencies {
  verify: (credentials: AppStoreCredentials) => Promise<AppStoreVerifyResult>;
  save: (credentials: AppStoreCredentials) => void;
}

const defaultDependencies: SetupDependencies = {
  verify: verifyAppStoreCredentials,
  save: saveAppStoreCredentials,
};

export interface ExistingSetupIntent {
  replacePrimaryKey: boolean;
  vendorNumber: string;
}

/** 기존 사용자의 익숙한 첫 질문(API Key 재설정)을 바꾸지 않는 대화 순서 계약. */
export async function collectExistingSetupIntent(
  ask: (question: string) => Promise<string>,
  prompts: { reconnect: string; vendorNumber: string },
): Promise<ExistingSetupIntent> {
  const reconnect = await ask(prompts.reconnect);
  const action = reconnect.trim().toLowerCase();
  if (action === 'y') {
    return { replacePrimaryKey: true, vendorNumber: '' };
  }
  if (action !== 'v') {
    return { replacePrimaryKey: false, vendorNumber: '' };
  }
  return {
    replacePrimaryKey: false,
    vendorNumber: await ask(prompts.vendorNumber),
  };
}

/** Apple API에서 실제로 쓸 수 있는 키인지 확인한 뒤에만 디스크에 저장한다. */
export async function verifyAndSaveAppStoreCredentials(
  credentials: AppStoreCredentials,
  dependencies: SetupDependencies = defaultDependencies,
): Promise<AppStoreVerifyResult> {
  const result = await dependencies.verify(credentials);
  if (result.ok) dependencies.save(credentials);
  return result;
}
