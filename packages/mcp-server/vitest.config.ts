import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `#core/<path>.js` → packages/core/src/<path>.ts. 런타임(Node)은 package.json "imports" 로
// dist/core 를 보지만, 테스트는 빌드 없이 core **소스**를 봐야 한다 — tsconfig.lint.json 의 paths 와
// 같은 매핑이다(vite 는 paths 를 읽지 않는다). cli 의 vitest.config.ts 도 같은 alias 를 쓴다.
const coreSrc = fileURLToPath(new URL('../core/src/', import.meta.url)).replaceAll('\\', '/');

// 커버리지는 **게이트가 아니라 지도**다. 임계값을 걸지 않는 이유: 숫자를 맞추려고
// 의미 없는 테스트를 쓰게 되고, 이 저장소의 테스트 규약("함정을 테스트한다")과 정면으로
// 어긋난다. 목적은 "어느 모듈이 한 번도 실행되지 않는가"를 보이게 하는 것뿐이다.
//   npm run coverage
export default defineConfig({
  resolve: {
    alias: [{ find: /^#core\/(.+)\.js$/, replacement: `${coreSrc}$1.ts` }],
  },
  test: {
    // 기본 5초는 저장소 전체를 읽는 가드(hygiene·ai-model-parity·docs-drift)에 빠듯하다 — 부하 걸린
    // 로컬 머신이나 느린 windows-latest 러너에서 로직과 무관한 타임아웃 실패가 났다. 행(hang) 감지용
    // 상한으로만 쓰므로 넉넉하게 잡는다.
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
});
