#!/usr/bin/env python3
"""Authorized one-shot local setup. Never discovers or connects to an existing database."""
from pathlib import Path
import os,subprocess,json,time,signal,re
E=Path(__file__).resolve().parent
C=json.loads((E/'context.json').read_text());L=Path(C['lab']);R=Path(C['root'])
assert L.parent==Path('/private/tmp') and L.name=='kc-hold-'+C['runId']
assert not (L/'data/auto.cnf').exists(), 'fresh datadir only; never reuse this script'
env={k:os.environ[k] for k in ['PATH','TMPDIR','LANG'] if k in os.environ}
env.update({'HOME':str(L/'home'),'TZ':'UTC','MYSQL_HISTFILE':'/dev/null'})
base=[C['mysqld'],'--no-defaults','--basedir='+str(Path(C['mysqld']).parent.parent),'--datadir='+str(L/'data')]
with (E/'logs/initialize-01.log').open('x') as out:
 r=subprocess.run(base+['--initialize-insecure','--log-error='+str(L/'initialize.log')],env=env,stdout=out,stderr=subprocess.STDOUT,timeout=90,umask=0o077)
assert r.returncode==0, 'initialize failed; preserved logs and datadir'
(E/'logs/mysqld-initialize.log').write_bytes((L/'initialize.log').read_bytes())
args=base+['--socket='+str(L/'mysql.sock'),'--pid-file='+str(L/'mysql.pid'),'--log-error='+str(L/'server.log'),'--tmpdir='+str(L/'tmp'),'--secure-file-priv='+str(L/'files'),'--local-infile=OFF','--mysqlx=OFF','--skip-log-bin','--bind-address=127.0.0.1','--port=23316','--skip-name-resolve','--partial-revokes=OFF','--max-connections=12','--innodb-buffer-pool-size=64M','--innodb-redo-log-capacity=64M','--innodb-flush-log-at-trx-commit=1']
def start(stage, networking):
 log=(E/'logs'/('mysqld-launch-'+stage+'.log')).open('x')
 p=subprocess.Popen(args+['--skip-networking='+('OFF' if networking else 'ON')],env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,umask=0o077)
 log.close()
 with (E/('process-'+stage+'.json')).open('x') as f:json.dump({'pid':p.pid,'args':args+['--skip-networking='+('OFF' if networking else 'ON')],'new_datadir':str(L/'data'),'networking':networking},f,indent=2);f.write('\n')
 for _ in range(150):
  assert p.poll() is None,'mysqld exited; inspect private lab/server.log'
  if (L/'mysql.sock').exists() and (L/'mysql.pid').exists():
   if int((L/'mysql.pid').read_text().strip())==p.pid:return p
  time.sleep(.1)
 raise RuntimeError('startup timeout; do not touch another server')
client=[C['mysql'],'--no-defaults','--no-login-paths','--protocol=SOCKET','--socket='+str(L/'mysql.sock'),'--user=root','--batch','--raw','--skip-column-names','--connect-timeout=2']
def sql(name, sqlfile):
 with (E/'logs'/(name+'.log')).open('x') as out:
  r=subprocess.run(client,input=sqlfile.read_bytes(),env=env,stdout=out,stderr=subprocess.STDOUT,timeout=30)
 assert r.returncode==0,'SQL failed; no retry or cleanup'
 return (E/'logs'/(name+'.log')).read_text()
socket=start('socket',False)
identity=sql('identity-before-01',E/'sql/identity-before.sql').strip().split('\t')
assert len(identity)==6 and Path(identity[0]).resolve()==(L/'data').resolve() and identity[1]==str(L/'mysql.sock')
assert re.fullmatch(r'8\.4\.\d+(?:[-+].*)?',identity[2]) and identity[3]=='1' and identity[5]=='0'
assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}',identity[4])
# Only now send the reviewed DDL to the verified new instance, with TCP disabled.
fixture=sql('fixture-01',E/'sql/fixture.sql')
assert identity[4] in fixture
sql('root-hardening-01',E/'sql/root-hardening.sql')
assert int((L/'mysql.pid').read_text().strip())==socket.pid
os.kill(socket.pid,signal.SIGTERM);socket.wait(timeout=30);assert socket.returncode==0
check=subprocess.run(['lsof','-nP','-iTCP:23316','-sTCP:LISTEN'],env=env,capture_output=True,text=True,timeout=5)
assert check.returncode==1 and not check.stdout,'port acquired by another process; stop'
tcp=start('loopback',True)
for _ in range(100):
 check=subprocess.run(['lsof','-nP','-a','-p',str(tcp.pid),'-iTCP','-sTCP:LISTEN','-Fn'],env=env,capture_output=True,text=True,timeout=5)
 names=[line[1:] for line in check.stdout.splitlines() if line.startswith('n')]
 if names:break
 time.sleep(.1)
assert names==['127.0.0.1:23316'],'unexpected bind; preserve and stop'
with (E/'listener-01.json').open('x') as f:json.dump({'pid':tcp.pid,'listeners':names,'port_was_unoccupied':True,'no_existing_data':True,'socket_only_bootstrap':True,'no_mysqlx':True,'no_option_files':True,'isolated_datadir':str(L/'data')},f,indent=2);f.write('\n')
target={'runId':C['runId'],'host':'127.0.0.1','port':23316,'database':C['database'],'user':'kc_fault_harness','serverUuid':identity[4]}
with (E/'target.json').open('x',opener=lambda p,flags:os.open(p,flags,0o600)) as f:json.dump(target,f,indent=2);f.write('\n')
print(json.dumps({'setup':'PASS','mysql_version':identity[2],'pid':tcp.pid,'bind':names,'target':str(E/'target.json'),'fixture':'applied only to new isolated lab','lab_root':str(L)}))
