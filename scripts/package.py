#!/usr/bin/env python3
"""Create a self-contained, reproducible source delivery ZIP (no local secrets/caches)."""
from pathlib import Path
import argparse
import zipfile

ROOT = Path(__file__).resolve().parents[1]
INCLUDE = ['index.html', 'styles.css', 'README.md', 'package.json', '.replit', '.gitignore', 'vercel.json', 'src', 'data', 'assets', 'scripts', 'tests', 'docs']

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT.parent / 'CENTURY_Nations_and_Cities.zip')
    args=parser.parse_args()
    files=[]
    for name in INCLUDE:
        path=ROOT / name
        if path.is_file(): files.append(path)
        elif path.is_dir(): files.extend(p for p in path.rglob('*') if p.is_file() and not any(s in ['__pycache__','.cache','node_modules','test-results'] for s in p.relative_to(ROOT).parts) and p.suffix not in ['.pyc','.zip'])
        else: raise FileNotFoundError(path)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for path in sorted(set(files)):
            info=zipfile.ZipInfo('CENTURY_Nations_and_Cities/'+str(path.relative_to(ROOT)),date_time=(2026,10,19,0,0,0))
            info.external_attr=0o100644 << 16
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,path.read_bytes())
    with zipfile.ZipFile(args.output) as archive:
        bad=archive.testzip()
        if bad: raise RuntimeError('Corrupt ZIP entry: '+bad)
        names=set(archive.namelist())
        for name in ['index.html','src/main.js','src/core/game.js','src/render/renderer.js','assets/ai-textile.png','README.md']:
            assert 'CENTURY_Nations_and_Cities/'+name in names
    print(f'{args.output}: {len(files)} files, {args.output.stat().st_size:,} bytes, integrity verified')

if __name__=='__main__': main()
