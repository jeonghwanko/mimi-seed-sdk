import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {connectThreads} from '../threads/setup.js';
import {getAccount} from '../threads/api.js';
import {loadThreadsConfig,saveThreadsConfig} from '../threads/config.js';
vi.mock('../threads/api.js',()=>({getAccount:vi.fn(),fetchUserId:vi.fn()}));
let homeDir:string;
beforeEach(()=>{homeDir=fs.mkdtempSync(path.join(os.tmpdir(),'threads-browser-save-'));vi.mocked(getAccount).mockResolvedValue({id:'example-user',username:'example'});});
afterEach(()=>{fs.rmSync(homeDir,{recursive:true,force:true});vi.clearAllMocks();});
it('브라우저 응답의 실제 만료시간으로 지정 프로필에 저장하고 기본 계정은 보존한다',async()=>{
 const base={homeDir,startDir:homeDir};saveThreadsConfig({accessToken:'old-example',userId:'old-user'},base);
 const before=Date.now();expect((await connectThreads('new-example','example-user',true,{...base,profile:'example'},3600)).ok).toBe(true);
 const saved=loadThreadsConfig({...base,profile:'example'})!;expect(Date.parse(saved.expiresAt!)-before).toBeGreaterThanOrEqual(3600000);expect(Date.parse(saved.expiresAt!)-before).toBeLessThan(3601000);
 expect(loadThreadsConfig(base)?.accessToken).toBe('old-example');
});
it('검증 실패와 잘못된 만료시간에 기존 프로필을 덮어쓰지 않는다',async()=>{
 const opts={homeDir,startDir:homeDir,profile:'example'};saveThreadsConfig({accessToken:'old-example',userId:'old-user'},opts);
 vi.mocked(getAccount).mockRejectedValue(new Error('example-error'));
 expect((await connectThreads('new-example','example-user',true,opts,3600)).ok).toBe(false);
 expect((await connectThreads('new-example','example-user',true,opts,NaN)).ok).toBe(false);
 expect(loadThreadsConfig(opts)?.accessToken).toBe('old-example');
});
