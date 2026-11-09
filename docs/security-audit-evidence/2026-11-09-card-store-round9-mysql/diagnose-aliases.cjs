'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const E=__dirname,C=JSON.parse(fs.readFileSync(path.join(E,'context.json'),'utf8'));
const base=path.join(C.root,'services/kc-pay-gpt/acceptance/mysql-payment-hold');
const {readTarget,validateEnvironment}=require(path.join(base,'safety.cjs'));validateEnvironment(process.env);
const target=readTarget(path.join(E,'target.json'));
const mysql=createRequire(path.join(C.root,'services/kc-pay-gpt/mysql-store.js'))('mysql2/promise');
const {poolOptions}=require(path.join(base,'lab.cjs'));
const pool=mysql.createPool(poolOptions(target));
(async()=>{const results=[];try{for(const sql of fs.readFileSync(path.join(E,'sql/diagnose-aliases-01.sql'),'utf8').trim().split('\n')){
 if(!/^(SELECT|SHOW GRANTS)/.test(sql))throw Error('DIAGNOSTIC_NOT_READ_ONLY');
 try{const [rows]=await pool.query({sql,timeout:3000});results.push({sql,status:'PASS',rows});}
 catch(error){results.push({sql,status:'FAIL',code:error.code,errno:error.errno,sqlState:error.sqlState});}
}fs.writeFileSync(path.join(E,'diagnose-aliases-01.json'),JSON.stringify(results,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.map(({rows,...r})=>r)));
}finally{await pool.end();}})().catch(()=>{console.log('DIAGNOSTIC_FAILED');process.exitCode=1;});
