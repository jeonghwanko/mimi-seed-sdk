import { defineConfig } from 'vitest/config';

// 커버리지는 **게이트가 아니라 지도**다. 임계값을 걸지 않는 이유: 숫자를 맞추려고
// 의미 없는 테스트를 쓰게 되고, 이 저장소의 테스트 규약("함정을 테스트한다")과 정면으로
// 어긋난다. 목적은 "어느 모듈이 한 번도 실행되지 않는가"를 보이게 하는 것뿐이다.
//   npm run coverage
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.d.ts'],
    },
  },
});
