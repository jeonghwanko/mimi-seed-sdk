// core 는 설치되지 않는 소스 패키지라 자기 devDependencies 가 없다. 그래서 린트 규칙은 mcp-server 의
// 설정을 그대로 빌려 온다 — 그 파일의 import(@eslint/js, typescript-eslint)는 mcp-server/node_modules
// 에서 풀린다. 타입 인지 규칙만 core 의 tsconfig.json 을 보도록 바꾼다. 실행은 mcp-server 의
// `npm run lint`(= `eslint . ../core`)가 한다 — ESLint 는 파일마다 가장 가까운 설정을 찾는다.

import base from '../mcp-server/eslint.config.js';

export default base.map((config) =>
  config.languageOptions?.parserOptions?.project
    ? {
        ...config,
        languageOptions: {
          ...config.languageOptions,
          parserOptions: {
            ...config.languageOptions.parserOptions,
            project: './tsconfig.json',
            tsconfigRootDir: import.meta.dirname,
          },
        },
      }
    : config,
);
