"""Build a deterministic, self-contained installer. No router commands run here."""
from pathlib import Path
import tarfile, io, gzip, base64, hashlib, zipfile
root = Path(__file__).resolve().parents[1]
files = sorted(p for p in (root / 'files').rglob('*') if p.is_file() and 'etc/config/' not in p.as_posix())
manifest = '\n'.join(p.relative_to(root / 'files').as_posix() for p in files) + '\n'
raw = io.BytesIO()
with tarfile.open(fileobj=raw, mode='w') as tf:
    for p in files:
        info = tarfile.TarInfo('files/' + p.relative_to(root / 'files').as_posix())
        data = p.read_bytes()
        info.size = len(data)
        info.mode = 0o755 if '/libexec/' in info.name else 0o644
        info.mtime = 0
        tf.addfile(info, io.BytesIO(data))
    data = manifest.encode()
    info = tarfile.TarInfo('manifest'); info.size = len(data); info.mode = 0o644; info.mtime = 0
    tf.addfile(info, io.BytesIO(data))
payload = gzip.compress(raw.getvalue(), mtime=0)
sha = hashlib.sha256(payload).hexdigest()
script = (root / 'tools/install-header.sh').read_text(encoding='utf-8').rstrip() + '\n'
script = script.replace('@PAYLOAD_SHA@', sha)
script += '\n'.join(base64.b64encode(payload).decode()[i:i+76] for i in range(0, len(base64.b64encode(payload)), 76)) + '\n'
(root / 'install.sh').write_text(script, encoding='utf-8', newline='\n')
out = root / 'outputs'; out.mkdir(exist_ok=True)
(out / 'site-checker2-2.0.0-local.1.sh').write_text(script, encoding='utf-8', newline='\n')
digest = hashlib.sha256(script.encode()).hexdigest()
(out / 'site-checker2-2.0.0-local.1.sh.sha256').write_text(digest + '  site-checker2-2.0.0-local.1.sh\n')
with zipfile.ZipFile(out / 'Site_Checker_2_local.1.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for p in sorted(root.rglob('*')):
        rel = p.relative_to(root)
        if p.is_file() and not any(x in ('work', '.git', 'outputs', 'node_modules') for x in rel.parts):
            z.write(p, rel.as_posix())
print('Built installer and source archive:', digest)
