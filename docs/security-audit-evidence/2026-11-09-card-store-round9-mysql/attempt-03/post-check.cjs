'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const E=__dirname,C=JSON.parse(fs.readFileSync(path.join(E,'context.json'),'utf8'));
const base=path.join(C.root,'services/kc-pay-gpt/acceptance/mysql-payment-hold');
const {readTarget,validateEnvironment}=require(path.join(base,'safety.cjs'));validateEnvironment(process.env);
const target=readTarget(path.join(E,'target.json'));
const mysql=createRequire(path.join(C.root,'services/kc-pay-gpt/mysql-store.js'))('mysql2/promise');
const {poolOptions}=require(path.join(base,'lab.cjs'));const pool=mysql.createPool(poolOptions(target));
(async()=>{try{
 const rows=[];for(const sql of fs.readFileSync(path.join(E,'sql/post-check.sql'),'utf8').trim().split('\n')){
  assert.match(sql,/^SELECT /);const [result]=await pool.query({sql,timeout:3000});rows.push(result);
 }
 assert.equal(rows[0][0].server_uuid,target.serverUuid);assert.equal(rows[0][0].db,target.database);
 assert.equal(path.resolve(rows[0][0].datadir),path.join(C.lab,'data'));
 assert.equal(Number(rows[1][0].total),1);assert.equal(Number(rows[1][0].held),1);assert.equal(Number(rows[1][0].reusable),0);
 for(const row of rows.slice(2))assert.equal(Number(row[0].count),0);
 fs.writeFileSync(path.join(E,'post-check.json'),JSON.stringify({status:'PASS',readOnly:true,rows},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({status:'PASS',held:1,reusable:0,unrelatedBusinessTablesEmpty:true}));
}finally{await pool.end();}})().catch(()=>{console.log('{"status":"FAIL","error":"LAB_POST_CHECK_FAILED"}');process.exitCode=1;});
