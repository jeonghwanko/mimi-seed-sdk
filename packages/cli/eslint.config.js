// 정확성 전용 린트 설정 — **포매팅 규칙은 일부러 하나도 없다.**
//
// 27,000 줄에 포매터를 붙이면 전 파일이 한 커밋에 재작성되고 git blame 이 통째로
// 날아간다. 이 저장소의 주석은 "왜 이렇게 짰는가"와 실사고 날짜를 담고 있어서
// blame 이 실제 자산이다. 그래서 스타일(따옴표·세미콜론·줄바꿈)은 건드리지 않고
// **버그가 되는 것만** 잡는다.
//
// 타입 인지 블록은 반드시 `files` 로 src 에만 걸어야 한다 — 전역으로 펼치면 tsconfig
// 밖에 있는 tsup.config.ts 에서 "type information 없음"으로 린트 전체가 죽는다.
//
// tsup 은 타입을 보지 않으므로 이 패키지에서는 린터가 유일한 정적 검사 보강이다.
// 같은 파일이 packages/mcp-server 에도 있다 (두 패키지는 서로를 import 하지 않는다).

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'assets/**', 'eslint.config.js'] },

  js.configs.recommended,

  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // 빌드 tsconfig 가 아니라 tsconfig.lint.json 을 쓴다 — 전자는 src/__tests__ 를
        // exclude 하므로 타입 인지 린트가 테스트 파일에서 전부 파싱 오류가 난다.
        project: './tsconfig.lint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 커맨드 핸들러는 동기 경로가 있어도 전부 async 로 통일한다 (라우터가 await 한다).
      '@typescript-eslint/require-await': 'off',

      // ── 버그로 이어지는 것 ─────────────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],

      // ── 이 코드베이스에서 의도적으로 쓰는 것 ───────────────────────────
      // 원격 MCP 응답과 감지된 프로젝트 파일은 스키마가 없다. any 를 막으면 가짜
      // 타입을 지어내게 되고, 그 타입이 곧 거짓말이 된다.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      // 사용자에게 보이는 문자열 조립에 숫자/불리언을 끼우는 것은 정상이다.
      '@typescript-eslint/restrict-template-expressions': 'off',
      // 빈 catch 는 "실패해도 진행"을 뜻하는 의도적 패턴이고 주석이 달려 있다.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  {
    // 테스트는 mock 특성상 타입 우회가 잦다.
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
);
