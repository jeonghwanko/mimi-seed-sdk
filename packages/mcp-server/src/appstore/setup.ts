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

/** Apple API에서 실제로 쓸 수 있는 키인지 확인한 뒤에만 디스크에 저장한다. */
export async function verifyAndSaveAppStoreCredentials(
  credentials: AppStoreCredentials,
  dependencies: SetupDependencies = defaultDependencies,
): Promise<AppStoreVerifyResult> {
  const result = await dependencies.verify(credentials);
  if (result.ok) dependencies.save(credentials);
  return result;
}
