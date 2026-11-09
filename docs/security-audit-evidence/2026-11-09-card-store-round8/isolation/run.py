#!/usr/bin/env python3
"""Run explicit offline Node checks with a clean environment and API guard."""
import argparse, json, os, shutil, subprocess, sys
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--cwd', required=True)
p.add_argument('--log', required=True)
p.add_argument('command', nargs=argparse.REMAINDER)
a = p.parse_args()
command = a.command[1:] if a.command[:1] == ['--'] else a.command
if not command or command[0] != 'node': p.error('explicit node command required')
if any(arg.startswith(('--env-file', '--import', '--require', '-r=')) or arg == '-r' for arg in command[1:]):
    p.error('custom env/preload flags rejected')
node = shutil.which('node')
if not node: p.error('node unavailable')
guard = str(Path(__file__).resolve().with_name('preload.cjs'))
env = {key: os.environ[key] for key in ('PATH', 'TMPDIR', 'LANG', 'TZ') if key in os.environ}
env.update({'CI': '1', 'NO_COLOR': '1'})
log = Path(a.log).resolve()
log.parent.mkdir(parents=True, exist_ok=True)
cmd = [node, '--require', guard, *command[1:]]
# Preserve every run, including failures. Never replace an earlier result.
with log.open('x') as out:
    result = subprocess.run(cmd, cwd=Path(a.cwd).resolve(), env=env, stdout=out, stderr=subprocess.STDOUT, timeout=90)
print(json.dumps({'exit': result.returncode, 'log': str(log), 'guard': guard}))
sys.exit(result.returncode)
