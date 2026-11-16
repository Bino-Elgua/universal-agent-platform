import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,readFile,rm,readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createHistorySource } from './helpers/history-source.mjs';
import { importSqliteHistory } from '../server/src/storage/postgres/history-import.ts';
import { inspectSqliteSource } from '../server/src/storage/postgres/import.ts';
async function fixture(work) { const dir=await mkdtemp(path.join(os.tmpdir(),'uap-history-source-')); try { await work(dir); } finally { await rm(dir,{recursive:true,force:true}); } }

test('history dry run reads all observed/current generations in one readonly snapshot and reports no bodies or sessions',async()=>fixture(async dir=>{
  const source=createHistorySource(dir,'source'); const before=await readFile(source.sourcePath); const files=await readdir(dir);
  const expectedDigest=inspectSqliteSource(source.sourcePath).sourceDigest;
  const report=await importSqliteHistory(null,source.options);
  assert.equal(report.status,'dry_run'); assert.equal(report.sourceDigest,expectedDigest);
  assert.equal(report.counts.conversations,4); assert.equal(report.counts.rows,4); assert.equal(report.counts.historyItems,2);
  assert.equal(report.counts.excludedRoomRows,1); assert.equal(report.counts.excludedRoomHistoryItems,1);
  assert.equal(report.counts.unmappedTables.auth_sessions,1); assert.equal(report.counts.unmappedTables.pending_turns,1);
  const serialized=JSON.stringify(report);
  for(const hidden of ['Historical user message','Historical model input','Excluded room text','NEVER-IMPORT-SESSION','NEVER-IMPORT-PENDING-TURN',source.sourcePath]) assert.equal(serialized.includes(hidden),false);
  assert.deepEqual(await readFile(source.sourcePath),before); assert.deepEqual(await readdir(dir),files);
}));

test('history rejects invalid generations, identities, row/body mismatches and ambiguous or lossy JSON before target I/O',async()=>fixture(async dir=>{
  const mutations=[
    db=>db.prepare('UPDATE rows SET updated_seq=3 WHERE generation=1').run(),
    db=>db.prepare('UPDATE rows SET generation=4 WHERE kind=?').run('message'),
    db=>db.prepare('UPDATE rows SET bot_id=? WHERE kind=?').run('missing-agent','message'),
    db=>db.prepare('UPDATE rows SET kind=? WHERE kind=?').run('unknown-kind','message'),
    db=>db.prepare('UPDATE rows SET body=? WHERE kind=?').run('{"type":"event"}','message'),
    db=>db.prepare('UPDATE rows SET body=? WHERE kind=?').run('{"type":"message","text":"a","text":"b"}','message'),
    db=>db.prepare('UPDATE rows SET body=? WHERE kind=?').run('{"type":"message","amount":9007199254740993}','message'),
    db=>db.prepare('UPDATE rows SET body=? WHERE kind=?').run('{"type":"message","amount":0.123456789012345678901}','message'),
    db=>db.prepare('UPDATE rows SET body=? WHERE kind=?').run('{"type":"message","text":"\\u0000"}','message'),
    db=>db.prepare('UPDATE llm_items SET item=? WHERE idx=7').run('[]'),
  ];
  for(let index=0;index<mutations.length;index++){
    const source=createHistorySource(dir,`invalid${index}`); const db=new Database(source.sourcePath); db.prepare('DELETE FROM rows WHERE bot_id=?').run(source.roomId); mutations[index](db); db.close();
    await assert.rejects(importSqliteHistory({connect:()=>{throw new Error('Unexpected target I/O');}},{...source.options,apply:true}),error=>error.name==='SqliteImportError'&&!error.message.includes('Unexpected target I/O'));
  }
}));

test('WAL history sources are rejected before SQLite opens and no source sidecar changes',async()=>fixture(async dir=>{
  const source=createHistorySource(dir,'wal'); const db=new Database(source.sourcePath);
  try{
    db.pragma('journal_mode=WAL'); db.prepare('UPDATE rows SET updated_seq=updated_seq+1').run();
    const paths=[source.sourcePath,source.sourcePath+'-wal',source.sourcePath+'-shm']; const before=await Promise.all(paths.map(file=>readFile(file)));
    await assert.rejects(importSqliteHistory(null,source.options),/rollback-journal backup/);
    assert.deepEqual(await Promise.all(paths.map(file=>readFile(file))),before);
  }finally{db.close();}
}));
