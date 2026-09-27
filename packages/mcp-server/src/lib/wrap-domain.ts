// 도메인 모듈 전체를 친절 에러 번역기로 감싸는 프록시.
//
// firebase / ga4 / playstore register 가 같은 `new Proxy(...)` 블록을 각자 복사해 두고
// 있었다 — 번역기만 다르고 나머지는 글자 하나 다르지 않았다. 핸들러마다 try/catch 를
// 쓰지 않고도 raw GaxiosError(403 / SERVICE_DISABLED / edit 충돌 …)가 "다음에 뭘 할지"
// 메시지로 바뀌게 하는 장치라, 한 곳에 두고 규칙을 고정한다:
//
// - 함수가 아닌 export(상수 등)는 그대로 통과한다.
// - Promise 를 돌려주면 reject 만 번역한다. 동기 반환(sync factory 등)은 그대로 통과.
// - 동기 throw 도 같은 번역기를 거친다.
// - 번역기는 호출 인자를 받는다 — playstore 는 args[1] 이 packageName 이라는 규약으로
//   에러 안내에 패키지명을 싣는다.

export type ErrorTranslator = (err: unknown, args: readonly unknown[]) => Error;

export function wrapDomain<T extends object>(mod: T, translate: ErrorTranslator): T {
  return new Proxy(mod, {
    get(target, prop, receiver) {
      const orig: unknown = Reflect.get(target, prop, receiver);
      if (typeof orig !== 'function') return orig;
      return (...args: unknown[]) => {
        try {
          const out = (orig as (...a: unknown[]) => unknown)(...args);
          if (out && typeof (out as { then?: unknown }).then === 'function') {
            return (out as Promise<unknown>).catch((err) => {
              throw translate(err, args);
            });
          }
          return out;
        } catch (err) {
          throw translate(err, args);
        }
      };
    },
  });
}
