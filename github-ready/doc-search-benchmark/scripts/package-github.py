#!/usr/bin/env python3
"""Export a clean source tree, without local Git history or runtime/secret files."""
from pathlib import Path
import subprocess, shutil, zipfile
root=Path(__file__).resolve().parent.parent
out=root/'github-ready'
if out.exists():
    raise SystemExit('github-ready already exists. Move that previous export before creating another.')
files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=root).decode().split('\0')
secrets=[]
for envfile in [root/'.env.local',root/'.env']:
    if envfile.exists():
        for line in envfile.read_text().splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key,value=line.split('=',1);value=value.strip().strip('"').strip("'")
                if any(word in key.lower() for word in ['key','secret','password','database_url']) and len(value)>=12:secrets.append(value.encode())
for name in files:
    src=root/name
    if name and src.is_file() and not src.is_symlink():
        if any(secret in src.read_bytes() for secret in secrets):raise SystemExit('Refusing to export a file containing a configured credential: '+name)
destination=out/'doc-search-benchmark'
for name in sorted(set(files)):
    if not name: continue
    rel=Path(name)
    if rel.name.startswith('.env') and rel.name!='.env.example':raise SystemExit('Refusing to export an environment file with possible credentials.')
    if any(part in ['.git','.tools','data','node_modules','.vercel','.workflow-data','.next','.next-production','github-ready'] for part in rel.parts):raise SystemExit('Refusing a runtime/private path: '+name)
    src=root/rel
    if not src.is_file() or src.is_symlink():continue
    target=destination/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
archive=out/'doc-search-benchmark-github.zip'
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
    for file in sorted(destination.rglob('*')):
        if file.is_file():z.write(file,file.relative_to(out))
print('Clean source:',destination)
print('Upload package:',archive)
