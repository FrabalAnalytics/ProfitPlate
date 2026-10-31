import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { projectRoot, installAuthFixture, applyMigrations } from './database-test-support.mjs';

const tempRoot=path.resolve(projectRoot,'.db-test');
await mkdir(tempRoot,{recursive:true});
const temp=await mkdtemp(path.join(tempRoot,'postgres-'));
const port=await new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{const assigned=server.address().port;server.close(()=>resolve(assigned));});
});
const password=randomBytes(24).toString('hex');
const postgres=new EmbeddedPostgres({databaseDir:temp,user:'postgres',password,port,persistent:true,
  postgresFlags:['-h','127.0.0.1'],onLog(){},onError(message){if (String(message).includes('FATAL')) console.error('PostgreSQL startup failed.');}});
let started=false;
async function run(script,args=[]) {
  const child=spawn(process.execPath,[path.join(projectRoot,'scripts',script),...args],{
    cwd:projectRoot,windowsHide:true,stdio:'inherit',env:{...process.env,
      PROFITPLATE_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/profitplate_test`}});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${script} failed (${code})`)));});
}
try {
  await postgres.initialise();
  await postgres.start(); started=true;
  const client=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'postgres'});
  await client.connect();
  await client.query('create database profitplate_test');
  await client.end();
  const setup=new Client({host:'127.0.0.1',port,user:'postgres',password,database:'profitplate_test'});
  await setup.connect();
  try {
    const adapter={exec:sql=>setup.query(sql)};
    await installAuthFixture(adapter); await applyMigrations(adapter);
  } finally { await setup.end(); }
  if (!process.argv.includes('--types-only')) {
    await run('test-database.mjs',['--native']);
    await run('test-inventory.mjs',['--native']);
    await run('test-catalogue-import.mjs',['--native']);
    await run('test-business.mjs',['--native']);
    await run('test-reporting.mjs',['--native']);
    await run('test-database-concurrency.mjs');
    await run('test-inventory-concurrency.mjs');
  }
  if (process.argv.includes('--types') || process.argv.includes('--types-only')) await run('generate-database-types.mjs',['--test-database']);
} finally {
  if (started) {
    if (process.platform==='win32') {
      // pg_ctl performs a graceful shutdown; the package's Windows stop uses taskkill.
      const { pg_ctl }=await import('@embedded-postgres/windows-x64');
      const exited=once(postgres.process,'exit');
      const stop=spawn(pg_ctl,['stop','-D',temp,'-m','fast','-w','-t','15'],{windowsHide:true,stdio:'ignore'});
      const code=await new Promise((resolve,reject)=>{stop.once('error',reject);stop.once('exit',resolve);});
      if (code!==0) throw new Error('Could not stop the isolated PostgreSQL server');
      await exited;
      postgres.process=undefined;
    } else await postgres.stop();
  }
  // Only remove this run's freshly created directory within the known workspace root.
  const resolved=path.resolve(temp);
  if (path.dirname(resolved)!==tempRoot || !path.basename(resolved).startsWith('postgres-')) throw new Error('Unsafe test cleanup path');
  await rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}
