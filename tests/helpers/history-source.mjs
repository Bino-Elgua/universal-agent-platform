import Database from 'better-sqlite3';
import path from 'node:path';

export function createHistorySource(dir, suffix) {
  const sourcePath = path.join(dir, `${suffix}.sqlite`);
  const userId = `history_owner_${suffix}`;
  const agentId = `history_agent_${suffix}`;
  const secondAgentId = `history_empty_${suffix}`;
  const roomId = `history_room_${suffix}`;
  const source = new Database(sourcePath);
  source.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,name TEXT,created_at INTEGER);
    CREATE TABLE bots(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,kind TEXT,generation INTEGER,label TEXT,created_at INTEGER,updated_at INTEGER);
    CREATE TABLE rows(bot_id TEXT,generation INTEGER,seq INTEGER,updated_seq INTEGER,kind TEXT,body TEXT,created_at INTEGER,PRIMARY KEY(bot_id,generation,seq));
    CREATE TABLE llm_items(bot_id TEXT,generation INTEGER,idx INTEGER,item TEXT,PRIMARY KEY(bot_id,generation,idx));
    CREATE TABLE auth_sessions(token TEXT,user_id TEXT);
    CREATE TABLE pending_turns(bot_id TEXT,state TEXT);
    CREATE TABLE approvals(id TEXT,bot_id TEXT,status TEXT);`);
  source.prepare('INSERT INTO users VALUES(?,?,?,?)').run(userId, `${userId}@example.test`, 'History Owner',1000);
  const insertBot = source.prepare('INSERT INTO bots VALUES(?,?,?,?,?,?,?,?)');
  insertBot.run(agentId,userId,'History Agent','agent',3,'Research',1100,9000);
  insertBot.run(secondAgentId,userId,'Empty Current Agent','agent',2,'',1200,4000);
  insertBot.run(roomId,userId,'Unimported Room','room',1,'',1100,9000);
  const insertRow = source.prepare('INSERT INTO rows VALUES(?,?,?,?,?,?,?)');
  const rows = [
    { generation: 1,seq: 1,revision: 2,kind: 'message',body: {type:'message',role:'user',text:'Historical user message Ș',score:0.1},createdAt:2000 },
    { generation: 1,seq: 4,revision: 8,kind:'tool-call',body:{type:'tool-call',callId:'legacy-call',name:'read_file',status:'done',label:'Read a file',summary:'Historical tool output'},createdAt:2200 },
    { generation:2,seq:2,revision:9,kind:'notice',body:{type:'notice',text:'Historical notice',tone:'info'},createdAt:3000 },
    { generation:2,seq:3,revision:11,kind:'card',body:{type:'card',card:'approval',approvalId:'not-an-active-grant',status:'pending'},createdAt:3100 },
  ];
  for (const row of rows) insertRow.run(agentId,row.generation,row.seq,row.revision,row.kind,JSON.stringify(row.body),row.createdAt);
  insertRow.run(roomId,1,1,1,'message',JSON.stringify({type:'message',role:'assistant',text:'Excluded room text'}),2500);
  const insertItem = source.prepare('INSERT INTO llm_items VALUES(?,?,?,?)');
  insertItem.run(agentId,1,0,JSON.stringify({type:'message',role:'user',content:[{type:'input_text',text:'Historical model input'}]}));
  insertItem.run(agentId,2,7,JSON.stringify({type:'function_call_output',call_id:'legacy-call',output:'Historical model output'}));
  insertItem.run(roomId,1,0,JSON.stringify({type:'message',role:'assistant',content:'Excluded model context'}));
  source.prepare('INSERT INTO auth_sessions VALUES(?,?)').run('NEVER-IMPORT-SESSION',userId);
  source.prepare('INSERT INTO pending_turns VALUES(?,?)').run(agentId,'NEVER-IMPORT-PENDING-TURN');
  source.prepare('INSERT INTO approvals VALUES(?,?,?)').run('not-an-active-grant',agentId,'pending');
  source.close();
  return { sourcePath,userId,agentId,secondAgentId,roomId, rows,
    options:{sourcePath,organizationId:`history_org_${suffix}`,organizationSlug:`history-${suffix}`,organizationName:'History organization',workspaceId:`history_ws_${suffix}`,workspaceName:'History workspace'} };
}
