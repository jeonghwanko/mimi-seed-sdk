// 로컬 HTTP 서버를 띄우고 /cli/connect가 리다이렉트하는 토큰을 수신.

import http from "node:http";
import { AddressInfo } from "node:net";
import { catalog } from "./i18n.js";

// 브라우저 콜백 페이지 + 타임아웃 메시지. 사용자가 읽는 유일한 출력이다.
const M = catalog(
  {
    htmlLang: "ko",
    connected: "✓ Mimi Seed 연결 완료",
    backToTerminal: "터미널로 돌아가세요.",
    timeout: (seconds: number) => `${seconds}초 안에 연결되지 않았습니다.`,
  },
  {
    htmlLang: "en",
    connected: "✓ Mimi Seed connected",
    backToTerminal: "You can go back to your terminal.",
    timeout: (seconds: number) => `Not connected within ${seconds}s.`,
  },
);

export interface HandshakeResult {
  token: string;
  prefix: string;
}

export async function awaitHandshake(
  timeoutMs: number,
): Promise<{ port: number; promise: Promise<HandshakeResult> }> {
  let resolve!: (r: HandshakeResult) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<HandshakeResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end();
      return;
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/cb") {
      res.statusCode = 404;
      res.end();
      return;
    }
    const token = url.searchParams.get("token");
    const prefix = url.searchParams.get("prefix") ?? "";
    if (!token) {
      res.statusCode = 400;
      res.end("token missing");
      return;
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html lang="${M().htmlLang}"><body style="font-family:system-ui;padding:40px;max-width:480px;margin:auto">
<h2>${M().connected}</h2>
<p>${M().backToTerminal}</p>
<script>setTimeout(()=>window.close(),1000)</script>
</body></html>`);

    resolve({ token, prefix });
    setTimeout(() => server.close(), 500);
  });

  server.on("error", reject);

  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const port = (server.address() as AddressInfo).port;

  const timer = setTimeout(() => {
    server.close();
    reject(new Error(M().timeout(timeoutMs / 1000)));
  }, timeoutMs);
  promise.finally(() => clearTimeout(timer));

  return { port, promise };
}
