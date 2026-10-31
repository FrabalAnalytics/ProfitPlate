// Own the exact child processes used by browser QA, including Windows process trees.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../',import.meta.url));
const children=[];
const logs=[];
let cleaning;
function start(args,env={},visible=false){
  const child=spawn(process.execPath,args,{cwd,env:{...process.env,...env},windowsHide:true,detached:process.platform!=='win32',stdio:visible?'inherit':['ignore','pipe','pipe']});
  child.on('error',error=>logs.push(error.message));
  if(!visible)for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{logs.push(String(data));if(logs.length>80)logs.shift();});
  children.push(child);return child;
}
async function stop(child){
  if(!child.pid||child.exitCode!==null)return;
  if(process.platform==='win32'){
    const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    await once(kill,'exit');
  }else{
    try{process.kill(-child.pid,'SIGTERM');}catch{}
    await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,3000))]);
    if(child.exitCode===null)try{process.kill(-child.pid,'SIGKILL');}catch{}
  }
}
function cleanup(){return cleaning??=Promise.all(children.map(stop));}
async function free(port){
  const server=createServer();
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}
  catch{throw new Error(`Browser-test port ${port} is already in use. Stop that test run before starting another.`);}
  finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
async function ready(url,child){
  const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error('A browser-test server exited before it was ready.');
    try{if((await fetch(url,{signal:AbortSignal.timeout(3000)})).ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Timed out waiting for a local browser-test server.');
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void cleanup().finally(()=>process.exit(130));});
try{
  await free(54329);await free(3100);
  const fixture=start(['scripts/auth-test-server.mjs']);
  await ready('http://127.0.0.1:54329/health',fixture);
  const app=start(['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3100'],{PROFITPLATE_BROWSER_TEST:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54329',NEXT_PUBLIC_SUPABASE_ANON_KEY:'local-test-public-key',APP_URL:'http://127.0.0.1:3100'});
  await ready('http://127.0.0.1:3100/sign-in',app);
  console.log('Isolated browser-test servers ready. No hosted data is used.');
  const runner=start(['node_modules/@playwright/test/cli.js','test',...process.argv.slice(2)],{PROFITPLATE_EXTERNAL_TEST_SERVERS:'1'},true);
  const [code]=await once(runner,'exit');
  process.exitCode=code??1;
  if(code)console.error(logs.join('').slice(-10000));
}catch(error){console.error(error.message);console.error(logs.join('').slice(-10000));process.exitCode=1;}
finally{await cleanup();}
