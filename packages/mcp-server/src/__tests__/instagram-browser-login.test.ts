import { openSystemBrowser } from '../auth/browser.js';
import { request } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectInstagramInBrowser } from '../instagram/browser-login.js';
import { connectInstagram } from '../instagram/setup.js';
import { fetchWithTimeout } from '../lib/http.js';
vi.mock('../auth/browser.js', () => ({ openSystemBrowser: vi.fn() }));
vi.mock('../lib/http.js', () => ({ fetchWithTimeout: vi.fn() }));
vi.mock('../instagram/setup.js', () => ({ connectInstagram: vi.fn() }));
const json=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status});
let start:{state:string;codeChallenge:string;callbackPort:number};
const receive=(params:Record<string,string>,path='/instagram/callback')=>new Promise<number>((resolve,reject)=>{
 const req=request(`http://127.0.0.1:${start.callbackPort}${path}?${new URLSearchParams(params)}`,res=>{res.resume();res.on('end',()=>resolve(res.statusCode!));});req.on('error',reject);req.end();
});
const good=()=>receive({state:start.state,code:'example-code',ticket:'example-ticket'});
const opts={webBase:'https://broker.example',profile:'example',timeoutMs:2000};
beforeEach(()=>{
 vi.mocked(connectInstagram).mockResolvedValue({ok:true,text:'connected'});
 vi.mocked(fetchWithTimeout).mockImplementation(async(url,init)=>{
  if(String(url).endsWith('/start')){start=JSON.parse(String(init?.body));return json({authorizationUrl:'https://broker.example/api/instagram-auth/authorize?ticket=example-ticket'});}
  const body=JSON.parse(String(init?.body));expect(createHash('sha256').update(body.codeVerifier).digest('base64url')).toBe(start.codeChallenge);
  expect(body).toMatchObject({code:'example-code',ticket:'example-ticket'});
  return json({accessToken:'example-token',userId:'example-user',expiresInSeconds:3600});
 });
});
afterEach(()=>vi.clearAllMocks());
describe('Instagram browser login',()=>{
 it('uses the existing browser session and saves after the callback',async()=>{
  vi.mocked(openSystemBrowser).mockImplementation(async()=>{await good();});
  await connectInstagramInBrowser(opts);
  expect(openSystemBrowser).toHaveBeenCalledWith('https://broker.example/api/instagram-auth/authorize?ticket=example-ticket');
  expect(connectInstagram).toHaveBeenCalledTimes(1);
 });
 it('정상 승인 후 선택한 프로필과 실제 만료시간을 검증 저장 경로에 전달한다',async()=>{
  await expect(connectInstagramInBrowser({...opts,openBrowser:async()=>{await good();}})).resolves.toEqual({ok:true,text:'connected'});
  expect(connectInstagram).toHaveBeenCalledWith('example-token',undefined,true,expect.objectContaining({profile:'example'}),3600);
 });
 it('잘못된 state와 경로는 무시하고 정상 콜백만 처리한다',async()=>{
  await connectInstagramInBrowser({...opts,openBrowser:async()=>{expect(await receive({state:'0'.repeat(64)})).toBe(400);expect(await receive({state:start.state},'/wrong')).toBe(404);expect(await good()).toBe(200);}});
  expect(connectInstagram).toHaveBeenCalledTimes(1);
 });
 it('권한 거절시 저장하지 않는다',async()=>{
  await expect(connectInstagramInBrowser({...opts,openBrowser:async()=>{await receive({state:start.state,error:'access_denied'});}})).rejects.toMatchObject({code:'denied'});expect(connectInstagram).not.toHaveBeenCalled();
 });
 it('시간 초과시 저장하지 않고 서버를 종료한다',async()=>{
  await expect(connectInstagramInBrowser({...opts,timeoutMs:30,openBrowser:async()=>{}})).rejects.toMatchObject({code:'timeout'});expect(connectInstagram).not.toHaveBeenCalled();await expect(good()).rejects.toThrow();
 });
 it('미배포 서버 오류에 비밀값을 출력하거나 토큰 입력으로 전환하지 않는다',async()=>{
  vi.mocked(fetchWithTimeout).mockResolvedValue(json({error:'example-secret'},503));await expect(connectInstagramInBrowser(opts)).rejects.toThrow('Instagram browser login: unavailable');expect(connectInstagram).not.toHaveBeenCalled();
 });
 it('외부 URL과 HTTP 브로커를 거부한다',async()=>{
  vi.mocked(fetchWithTimeout).mockResolvedValue(json({authorizationUrl:'https://evil.example/'}));await expect(connectInstagramInBrowser(opts)).rejects.toMatchObject({code:'configuration'});await expect(connectInstagramInBrowser({...opts,webBase:'http://broker.example'})).rejects.toMatchObject({code:'configuration'});
 });
 it('검증 실패를 성공으로 표시하지 않는다',async()=>{
  vi.mocked(connectInstagram).mockResolvedValue({ok:false,text:'example-secret'});await expect(connectInstagramInBrowser({...opts,openBrowser:async()=>{await good();}})).rejects.toThrow('Instagram browser login: validation');
 });
 it('자동 브라우저 실행이 실패해도 표시된 URL로 승인할 수 있다',async()=>{
  const onUrl=vi.fn(()=>{void good();});await connectInstagramInBrowser({...opts,onUrl,openBrowser:async()=>{throw new Error('no browser');}});expect(onUrl).toHaveBeenCalled();
 });
});
