import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Pool } from 'pg';
import { migratePostgres,grantApplicationRole } from '../../server/src/storage/postgres/migrations.ts';
import { importSqliteFoundation } from '../../server/src/storage/postgres/import.ts';
import { importSqliteHistory } from '../../server/src/storage/postgres/history-import.ts';
import { createHistorySource } from '../helpers/history-source.mjs';
if(!process.env.TEST_DATABASE_URL||!process.env.TEST_APP_DATABASE_URL)throw new Error('Use npm run test:postgres for history-stage acceptance.');
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL,max:1}); const application=new Pool({connectionString:process.env.TEST_APP_DATABASE_URL,max:1});let dir;
before(async()=>{dir=await mkdtemp(path.join(os.tmpdir(),'uap-history-import-'));await migratePostgres(admin);await grantApplicationRole(admin,decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username));});
after(async()=>{await application.end();await admin.end();await rm(dir,{recursive:true,force:true});});
const stage=async source=>{await importSqliteFoundation(admin,{...source.options,apply:true});return importSqliteHistory(admin,{...source.options,apply:true});};
const count=async(table,org)=>Number((await admin.query(`SELECT count(*) AS count FROM uap.${table} WHERE organization_id=$1`,[org])).rows[0].count);

test('history stage requires an existing matching foundation and never creates metadata itself',async()=>{
 const source=createHistorySource(dir,'foundation-required');
 await assert.rejects(importSqliteHistory(admin,{...source.options,apply:true}),/foundation import is required/);
 assert.equal((await admin.query('SELECT count(*) AS count FROM uap.users WHERE id=$1',[source.userId])).rows[0].count,'0');
 assert.equal(await count('history_import_receipts',source.options.organizationId),0);
});

test('history stage preserves all generations, transcript identities, legacy kinds and LLM item indices without active auth state',async()=>{
 const source=createHistorySource(dir,'complete');const before=await readFile(source.sourcePath);const result=await stage(source);
 assert.equal(result.status,'applied');assert.deepEqual({conversations:result.counts.conversations,rows:result.counts.rows,items:result.counts.historyItems},{conversations:4,rows:4,items:2});
 const conversations=(await admin.query('SELECT agent_id,generation,next_seq,revision FROM uap.conversations WHERE organization_id=$1 ORDER BY agent_id,generation',[source.options.organizationId])).rows;
 const current=conversations.find(row=>row.agent_id===source.agentId&&row.generation==='3');assert.equal(current.next_seq,'1');assert.equal(current.revision,'0');
 const old=conversations.find(row=>row.agent_id===source.agentId&&row.generation==='1');assert.equal(old.next_seq,'5');assert.equal(old.revision,'8');
 const second=conversations.find(row=>row.agent_id===source.agentId&&row.generation==='2');assert.equal(second.next_seq,'4');assert.equal(second.revision,'11');
 const rows=(await admin.query('SELECT agent_id,generation,seq,updated_revision,kind,body,idempotency_key,idempotency_digest FROM uap.message_rows WHERE organization_id=$1 ORDER BY generation,seq',[source.options.organizationId])).rows;
 assert.equal(rows.length,4);assert.deepEqual(rows.map(row=>row.kind),['message','tool-call','notice','card']);
 for(let index=0;index<rows.length;index++){assert.equal(rows[index].agent_id,source.agentId);assert.equal(Number(rows[index].generation),source.rows[index].generation);assert.equal(Number(rows[index].seq),source.rows[index].seq);assert.deepEqual(rows[index].body,source.rows[index].body);assert.equal(rows[index].idempotency_key,null);assert.equal(rows[index].idempotency_digest,null);}
 const items=(await admin.query('SELECT generation,idx,item FROM uap.llm_items WHERE organization_id=$1 ORDER BY generation,idx',[source.options.organizationId])).rows;
 assert.deepEqual(items.map(item=>[item.generation,item.idx]),[['1','0'],['2','7']]);assert.equal(items[1].item.output,'Historical model output');
 const receipt=(await admin.query('SELECT * FROM uap.history_import_receipts WHERE organization_id=$1',[source.options.organizationId])).rows[0];
 assert.equal(receipt.metadata.runtimeState,'inactive_history_only');assert.equal(JSON.stringify(receipt).includes('Historical model input'),false);assert.equal(JSON.stringify(receipt).includes('NEVER-IMPORT-SESSION'),false);
 assert.equal(await count('import_receipts',source.options.organizationId),1);
 assert.deepEqual(await readFile(source.sourcePath),before);
 const repeat=await importSqliteHistory(admin,{...source.options,apply:true});assert.equal(repeat.status,'already_imported');assert.equal(repeat.receiptId,result.receiptId);
});

test('idempotent history staging rejects target tampering and changed source instead of trusting receipts',async()=>{
 const source=createHistorySource(dir,'tampered');await stage(source);
 await admin.query("UPDATE uap.message_rows SET body='{}'::jsonb WHERE organization_id=$1 AND seq=4",[source.options.organizationId]);
 await assert.rejects(importSqliteHistory(admin,{...source.options,apply:true}),/history has changed/);
 assert.equal(await count('history_import_receipts',source.options.organizationId),1);
 const precise=createHistorySource(dir,'precise-tamper');await stage(precise);
 await admin.query("UPDATE uap.message_rows SET body=jsonb_set(body,'{score}','0.10000000000000000000001'::jsonb) WHERE organization_id=$1 AND seq=1",[precise.options.organizationId]);
 await assert.rejects(importSqliteHistory(admin,{...precise.options,apply:true}),/represented losslessly/);
 const changed=createHistorySource(dir,'changed');await stage(changed);const db=new Database(changed.sourcePath);db.prepare('UPDATE llm_items SET item=? WHERE idx=7').run('{"type":"function_call_output","output":"Changed source"}');db.close();
 await assert.rejects(importSqliteHistory(admin,{...changed.options,apply:true}),/foundation import is required/);
});

test('partial target history without an identical receipt is never merged',async()=>{
 const source=createHistorySource(dir,'collision');await importSqliteFoundation(admin,{...source.options,apply:true});
 await admin.query('INSERT INTO uap.conversations(organization_id,agent_id,generation,next_seq,revision,created_at,updated_at)VALUES($1,$2,1,1,0,1,1)',[source.options.organizationId,source.agentId]);
 await assert.rejects(importSqliteHistory(admin,{...source.options,apply:true}),/Target history exists/);
 assert.equal(await count('conversations',source.options.organizationId),1);assert.equal(await count('message_rows',source.options.organizationId),0);assert.equal(await count('history_import_receipts',source.options.organizationId),0);
});

test('mid-history failure rolls back conversations, transcript rows, LLM context and receipt together',async()=>{
 const source=createHistorySource(dir,'rollback');await importSqliteFoundation(admin,{...source.options,apply:true});
 await admin.query(`CREATE FUNCTION uap.history_stage_test_failure()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'identified history fixture';END$$;CREATE TRIGGER history_stage_test_failure BEFORE INSERT ON uap.llm_items FOR EACH ROW EXECUTE FUNCTION uap.history_stage_test_failure()`);
 try{await assert.rejects(importSqliteHistory(admin,{...source.options,apply:true}),/rolled back/);}finally{await admin.query('DROP TRIGGER history_stage_test_failure ON uap.llm_items;DROP FUNCTION uap.history_stage_test_failure()');}
 for(const table of ['conversations','message_rows','llm_items','history_import_receipts'])assert.equal(await count(table,source.options.organizationId),0);
 assert.equal(await count('import_receipts',source.options.organizationId),1);assert.equal((await importSqliteHistory(admin,{...source.options,apply:true})).status,'applied');
});

test('application credentials cannot stage history or write its provenance receipts',async()=>{
 const source=createHistorySource(dir,'app-role');await importSqliteFoundation(admin,{...source.options,apply:true});
 await assert.rejects(importSqliteHistory(application,{...source.options,apply:true}),/privileged operator/);
 assert.equal(await count('history_import_receipts',source.options.organizationId),0);
 const appRole=decodeURIComponent(new URL(process.env.TEST_APP_DATABASE_URL).username);
 const privilege=(await admin.query("SELECT has_table_privilege($1,'uap.history_import_receipts','INSERT,UPDATE,DELETE,TRUNCATE')AS forbidden",[appRole])).rows[0];assert.equal(privilege.forbidden,false);
});


test('history receipt counts and database payload bounds cannot be bypassed with SQL writes',async()=>{
  const source=createHistorySource(dir,'receipt-numeric');await stage(source);
  await admin.query("UPDATE uap.history_import_receipts SET counts=jsonb_set(counts,'{rows}','4.00000000000000000000001'::jsonb) WHERE organization_id=$1",[source.options.organizationId]);
  await assert.rejects(importSqliteHistory(admin,{...source.options,apply:true}),/receipt mapping or counts/);
  const oversized=createHistorySource(dir,'oversized');await importSqliteFoundation(admin,{...oversized.options,apply:true});
  await admin.query('INSERT INTO uap.conversations(organization_id,agent_id,generation,next_seq,revision,created_at,updated_at)VALUES($1,$2,1,1,0,1,1)',[oversized.options.organizationId,oversized.agentId]);
  await assert.rejects(admin.query("INSERT INTO uap.message_rows(organization_id,agent_id,generation,seq,updated_revision,kind,body,created_at)VALUES($1,$2,1,1,1,'message',jsonb_build_object('type','message','text',repeat('x',2097152)),1)",[oversized.options.organizationId,oversized.agentId]),error=>error.code==='23514');
  await assert.rejects(admin.query("INSERT INTO uap.llm_items(organization_id,agent_id,generation,idx,item)VALUES($1,$2,1,0,jsonb_build_object('content',repeat('x',2097152)))",[oversized.options.organizationId,oversized.agentId]),error=>error.code==='23514');
  assert.equal(await count('message_rows',oversized.options.organizationId),0);assert.equal(await count('llm_items',oversized.options.organizationId),0);
});


test('history repeat verification allows JSONB formatting expansion without weakening source limits', async () => {
  const source = createHistorySource(dir, 'json-spacing');
  const body = { type: 'message', padding: 'x'.repeat(900000) };
  for (let index = 0; index < 14000; index++) body[`k${index}`] = 0;
  const encoded = JSON.stringify(body);
  assert.ok(Buffer.byteLength(encoded) <= 1048576);
  const database = new Database(source.sourcePath);
  database.prepare("UPDATE rows SET body=? WHERE kind='message' AND bot_id=?").run(encoded, source.agentId);
  database.close();
  await stage(source);
  const stored = await admin.query("SELECT octet_length(body::text) AS bytes FROM uap.message_rows WHERE organization_id=$1 AND kind='message'", [source.options.organizationId]);
  assert.ok(stored.rows[0].bytes > 1048576, 'PostgreSQL canonical spacing adds bytes');
  assert.equal((await importSqliteHistory(admin, { ...source.options, apply: true })).status, 'already_imported');
});
