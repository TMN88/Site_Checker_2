"""Independently inspect embedded archive integrity and compare shipped bytes."""
from pathlib import Path, PurePosixPath
import base64, gzip, hashlib, io, re, tarfile, subprocess, sys
root = Path(__file__).resolve().parents[1]
script = (root / 'install.sh').read_bytes()
header, encoded = script.split(b'\n__SITE_CHECKER2_PAYLOAD__\n', 1)
payload = base64.b64decode(encoded)
expected = re.search(rb"echo '([a-f0-9]{64})  '", header).group(1).decode()
assert hashlib.sha256(payload).hexdigest() == expected
with tarfile.open(fileobj=io.BytesIO(gzip.decompress(payload)), mode='r:') as tf:
    names = tf.getnames()
    assert len(names) == len(set(names))
    manifest = tf.extractfile('manifest').read().decode().splitlines()
    assert set(names) == {'manifest'} | {'files/' + p for p in manifest}
    for name in names:
        parts = PurePosixPath(name).parts
        assert not name.startswith('/') and '..' not in parts
        info = tf.getmember(name)
        assert info.isfile()
        if name != 'manifest':
            source = root / name
            assert source.is_file(), name
            assert tf.extractfile(name).read() == source.read_bytes(), name
            assert b'\r\n' not in source.read_bytes(), name
            if '/libexec/' in name: assert info.mode == 0o755, name
    assert 'etc/config/site_checker2' not in manifest
out = root / 'outputs/site-checker2-2.0.0-local.1.sh'
assert out.read_bytes() == script
assert hashlib.sha256(script).hexdigest() in out.with_suffix('.sh.sha256').read_text()
assert b'@PAYLOAD_SHA@' not in header
if sys.platform == 'win32':
    sh = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe'
else:
    sh = Path('/bin/sh')
for file in [root/'install.sh', *list((root/'files/usr/libexec').glob('site-checker2*')), root/'files/usr/libexec/rpcd/site-checker2']:
    subprocess.run([str(sh), '-n', str(file)], check=True)
print('Installer verified:', len(manifest), 'owned files, checksum, source equality, paths, executable modes and shell syntax')
