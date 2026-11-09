#!/usr/bin/env python3
"""Run only explicit local tests with a clean synthetic environment and Node guard."""
import argparse, os, subprocess, sys
p = argparse.ArgumentParser()
p.add_argument('--cwd', required=True)
p.add_argument('--log', required=True)
p.add_argument('--baseline-store')
p.add_argument('command', nargs=argparse.REMAINDER)
a = p.parse_args()
command = a.command[1:] if a.command[:1] == ['--'] else a.command
if not command: p.error('explicit test command required')
env = {key: os.environ[key] for key in ('PATH', 'TMPDIR', 'LANG', 'TZ') if key in os.environ}
env.update({'NODE_OPTIONS': '--require=/tmp/security-test-isolation-20261108/preload.cjs',
            'KC_SESSION_ENCRYPTION_KEY': 'offline-synthetic-session-key-for-tests-only-20261108',
            'CI': '1', 'NO_COLOR': '1', 'FORCE_COLOR': '0'})
if a.baseline_store: env['KC_ATOMIC_STORE_SOURCE'] = a.baseline_store
with open(a.log, 'w') as out:
    result = subprocess.run(command, cwd=a.cwd, env=env, stdout=out, stderr=subprocess.STDOUT)
print(f'exit={result.returncode} log={a.log}')
sys.exit(result.returncode)
