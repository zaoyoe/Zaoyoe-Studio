const fs = require('node:fs');
const { spawn } = require('node:child_process');
const root = '/Volumes/chao/AI/xianyu_profit_calculator';
const previous = JSON.parse(fs.readFileSync('/tmp/security-round2-regression-commands.json','utf8'));
const commands = previous.filter(x => x.name !== 'kc-full').map(x => ({...x, name: x.name + '-verified'}));
commands[0].args.push('tests/security-round2-zpay-amount.test.js');
const env = {...process.env, NODE_OPTIONS: '--require=/tmp/security-test-isolation-20261108/preload.cjs', NO_COLOR:'1', FORCE_COLOR:'0'};
fs.writeFileSync('/tmp/security-round2-final-verification-commands.json', JSON.stringify(commands,null,2)+'\n');
(async () => {
const results = await Promise.allSettled(commands.map(command => new Promise(resolve => {
  const output = '/tmp/security-' + command.name + '.tap';
  const fd = fs.openSync(output, 'w', 0o600);
  const startedAt = new Date().toISOString();
  const child = spawn(command.command, command.args, {cwd: root, env, stdio: ['ignore',fd,fd]});
  child.on('error', e => resolve({name:command.name,error:e.message,output}));
  child.on('exit', (code,signal) => {fs.closeSync(fd); resolve({name:command.name,startedAt,finishedAt:new Date().toISOString(),code,signal,output});});
})));
fs.writeFileSync('/tmp/security-round2-final-verification-results.json',JSON.stringify(results,null,2)+'\n');
for (const result of results) console.log(JSON.stringify(result));
})().catch(error => { console.error(error); process.exitCode = 1; });
