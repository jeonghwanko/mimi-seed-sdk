import { describe, it, expect } from 'vitest';
import * as readline from 'node:readline';
import { PassThrough } from 'node:stream';

// setup.ts 의 ask() 와 **같은 구조**를 검증한다 (ask 는 모듈 내부 함수라 여기 복제).
//
// 회귀: rl.close() 는 'close' 를 동기 발화한다. 답변 콜백에서 close 를 먼저 부르고 resolve 를
// 나중에 부르면 close 리스너의 resolve('') 가 promise 를 먼저 확정해, **모든 프롬프트가 빈 문자열**을
// 반환했다 → 마법사가 사용자의 'c'(연결)를 무시하고 전부 건너뛰었다. v0.5.0 에 실제로 나갔던 버그.
function ask(q: string, input: NodeJS.ReadableStream, output: NodeJS.WritableStream): Promise<string> {
  const rl = readline.createInterface({ input, output });
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: string) => {
      if (done) return;
      done = true;
      rl.close();
      resolve(value);
    };
    rl.question(q, (a) => finish(a.trim()));
    rl.on('close', () => finish(''));
  });
}

function pipes() {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  return { input, output };
}

describe('ask() — 프롬프트가 사용자의 답을 돌려준다', () => {
  it('입력한 값을 그대로 반환한다 (빈 문자열이 아니라)', async () => {
    const { input, output } = pipes();
    const p = ask('연결? ', input, output);
    input.write('c\n');
    await expect(p).resolves.toBe('c');
  });

  it('공백을 다듬는다', async () => {
    const { input, output } = pipes();
    const p = ask('? ', input, output);
    input.write('  2  \n');
    await expect(p).resolves.toBe('2');
  });

  it('엔터만 누르면 빈 문자열 (= 기본값 선택)', async () => {
    const { input, output } = pipes();
    const p = ask('? ', input, output);
    input.write('\n');
    await expect(p).resolves.toBe('');
  });

  it('EOF 면 빈 문자열로 진행한다 (영원히 멈추지 않는다)', async () => {
    const { input, output } = pipes();
    const p = ask('? ', input, output);
    input.end();
    await expect(p).resolves.toBe('');
  });
});
