#!/usr/bin/env python3
"""Export a clean source tree, without local Git history or runtime/secret files."""
from pathlib import Path
import subprocess, shutil, zipfile, argparse, re
root=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--name',help='Create a named candidate under github-ready without replacing prior exports.')
args=parser.parse_args()
if args.name and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,79}',args.name):
    raise SystemExit('Release name must contain only letters, numbers, dots, underscores or hyphens.')
out=root/'github-ready'
if args.name:out=out/args.name
try:out.resolve().relative_to(root)
except ValueError:raise SystemExit('Release output must stay within the project.')
if out.exists():
    raise SystemExit('Export directory already exists. Use a new --name; existing releases are never overwritten.')
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
files=[name for name in files if name and not name.endswith('.tsbuildinfo') and Path(name).parts[0]!='github-ready']
secrets=[]
for envfile in [root/'.env.local',root/'.env']:
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);value=value.strip().strip('"').strip("'")
                if any(word in key.lower() for word in ['key','secret','password','database_url','token']) and len(value)>=12:secrets.append(value.encode())
for name in files:
    src=root/name
    if name and src.is_file() and not src.is_symlink():
        if any(secret in src.read_bytes() for secret in secrets):raise SystemExit('Refusing to export a file containing a configured credential: '+name)
destination=out/'doc-search-benchmark'
for name in sorted(set(files)):
    if not name: continue
    rel=Path(name)
    if rel.name.startswith('.env') and rel.name!='.env.example':raise SystemExit('Refusing to export an environment file with possible credentials.')
    if any(part in ['.git','.tools','data','node_modules','.vercel','.workflow-data','.next','.next-production','github-ready','reports','test-results','playwright-report'] for part in rel.parts):raise SystemExit('Refusing a runtime/private path: '+name)
    src=root/rel
    if not src.is_file() or src.is_symlink():continue
    target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
archive=out/'doc-search-benchmark-github.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted(destination.rglob('*')):
        if file.is_file():z.write(file,file.relative_to(out))
print('Clean source:',destination)
print('Upload package:',archive)
