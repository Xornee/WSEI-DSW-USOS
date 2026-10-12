#!/usr/bin/env python3
"""Refresh a short-lived local controller kubeconfig without printing its token."""
from pathlib import Path
import json, subprocess, os
base = Path.home() / '.kube/usos-local'
args = ['kubectl', '--kubeconfig', str(base/'config'), '--context', 'usos-local', '-n', 'usos-login']
def run(*extra): return subprocess.check_output([*args, *extra], text=True)
config = json.loads(run('config', 'view', '--raw', '--flatten', '--minify', '-o', 'json'))
assert config['contexts'][0]['context']['cluster'] == 'usos-local'
identity = json.loads(run('auth', 'whoami', '-o', 'json'))
assert identity['status']['userInfo']['username'] == 'minikube-user'
# The credential is held in memory and written directly to a private file, never logged.
token = run('create', 'token', 'browser-controller', '--duration=24h').strip()
result = {'apiVersion':'v1','kind':'Config','clusters':config['clusters'],
  'users':[{'name':'browser-controller','user':{'token':token}}],
  'contexts':[{'name':'usos-worker-controller','context':{'cluster':'usos-local','user':'browser-controller','namespace':'usos-login'}}],
  'current-context':'usos-worker-controller'}
p = base/'controller.json'
fd = os.open(p, os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as out: json.dump(result,out)
os.chmod(p,0o600)
print('Controller config refreshed (24h token); private path:',p)
