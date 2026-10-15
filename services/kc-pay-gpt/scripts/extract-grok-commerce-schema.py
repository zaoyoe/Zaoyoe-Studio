#!/usr/bin/env python3
"""Extract bounded Commerce descriptors from saved public Grok JS assets.
This offline maintainer tool never opens a browser or sends network requests.
Review and run financial-flow tests before adopting a regenerated schema.
"""
import argparse
import re,base64,json

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('assets_directory', type=str)
parser.add_argument('--output', default=str(__import__('pathlib').Path(__file__).resolve().parent.parent / 'grok-commerce-schema.json'))
args = parser.parse_args()
from pathlib import Path

def wire(b):
 d={};p=0
 def var():
  nonlocal p
  n=0;s=0
  while p<len(b):
   v=b[p];p+=1;n|=(v&127)<<s
   if not v&128:return n
   s+=7
  raise ValueError('truncated')
 while p<len(b):
  key=var();f=key>>3;t=key&7
  if t==0:v=var()
  elif t==2:n=var();v=b[p:p+n];p+=n
  elif t==1:v=b[p:p+8];p+=8
  elif t==5:v=b[p:p+4];p+=4
  else:raise ValueError(t)
  d.setdefault(f,[]).append(v)
 return d

def text(d,k,default=''):return d.get(k,[default.encode()])[0].decode()
def num(d,k,default=0):return d.get(k,[default])[0]
messages={};enums={};services={}
def enum(b,prefix):
 d=wire(b);name=prefix+'.'+text(d,1)
 enums[name]={str(num(v,2)):text(v,1) for v in map(wire,d.get(2,[]))}
def message(b,prefix):
 d=wire(b);name=prefix+'.'+text(d,1);fields={}
 for f in map(wire,d.get(2,[])):
  n=text(f,1);j=text(f,10) or re.sub(r'_([a-z])',lambda m:m[1].upper(),n)
  fields[str(num(f,3))]={'name':j,'type':num(f,5),'ref':text(f,6),'repeated':num(f,4)==3}
 messages[name]=fields
 for b in d.get(3,[]):message(b,name)
 for b in d.get(4,[]):enum(b,name)
for path in Path(args.assets_directory).glob('*.js'):
 s=path.read_text()
 for m in re.finditer(r'\.fileDesc\)\("([A-Za-z0-9+/=]+)"',s):
  d=wire(base64.b64decode(m[1]+"="*((-len(m[1]))%4)));prefix='.'+text(d,2)
  for b in d.get(4,[]):message(b,prefix)
  for b in d.get(5,[]):enum(b,prefix)
  for b in d.get(6,[]):
   z=wire(b);name=prefix+'.'+text(z,1)
   services[name]={text(t,1):{'input':text(t,2),'output':text(t,3)} for t in map(wire,z.get(2,[]))}
# Standard dependency descriptors have no embedded base64 in the site chunks.
messages['.google.protobuf.Timestamp']={'1':{'name':'seconds','type':3,'ref':'','repeated':False},'2':{'name':'nanos','type':5,'ref':'','repeated':False}}
roots={name:value for name,value in services.items() if name.startswith('.commerce.') and any(x in name for x in ['PrePurchaseService','AcquisitionService','SubscriptionService'])}
keepm={};keepe={}
def visit(n):
 if n in keepm or n in keepe:return
 if n in enums:keepe[n]=enums[n];return
 if n not in messages:raise ValueError('missing '+n)
 keepm[n]=messages[n]
 for f in messages[n].values():
  if f['ref']:visit(f['ref'])
for svc,methods in roots.items():
 for method,types in methods.items():
  if method in ['CreateCheckoutSession','GetCheckoutSession','AdoptCheckoutSession','GetCartForSession','Acquire','GetAcquisitionStatus','EstimateTax','CancelAcquisition','GetSubscriptions']:
   for n in types.values():visit(n)
methods={svc.lstrip('.')+'/'+method:types for svc,ms in roots.items() for method,types in ms.items() if types['input'] in keepm}
output={'provenance':'Read-only descriptors from official grok.com /plans public assets, 2026-10-13; no private API calls.','methods':methods,'messages':keepm,'enums':keepe}
Path(args.output).write_text(json.dumps(output,indent=2)+'\n')
print(f'Extracted {len(keepm)} messages, {len(keepe)} enums and {len(methods)} methods to {args.output}')
