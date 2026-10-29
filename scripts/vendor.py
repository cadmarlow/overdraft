"""Mirror the exact upstream Three.js commit and its required addon modules."""
from pathlib import Path
import concurrent.futures, re, urllib.request, posixpath

ROOT = Path(__file__).resolve().parents[1]
COMMIT = 'b3396270682287470d161658ac01084d25e8dba6'
BASE = f'https://cdn.jsdelivr.net/gh/mrdoob/three.js@{COMMIT}/'
pending = {'LICENSE', 'build/three.webgpu.js', 'build/three.tsl.js', 'build/three.core.js'}
for path in (ROOT / 'js').glob('*.js'):
    pending.update('examples/jsm/' + x for x in re.findall(r"['\"]three/addons/([^'\"]+)['\"]", path.read_text()))
seen = set()

def fetch(path):
    destination = ROOT / 'vendor/three' / path
    if destination.exists():
        body = destination.read_text()
    else:
        body = urllib.request.urlopen(BASE + path, timeout=60).read().decode()
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(body)
    return path, body

while pending:
    batch = pending - seen
    if not batch:
        break
    pending = set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        for path, body in executor.map(fetch, batch):
            seen.add(path)
            for spec in re.findall(r"(?:from\s*|import\s*\()\s*['\"]([^'\"]+)['\"]", body):
                if spec.startswith('.') and spec.endswith('.js'):
                    pending.add(posixpath.normpath(posixpath.join(posixpath.dirname(path), spec)))
    print(f'{len(seen)} modules mirrored', flush=True)
print('Three.js dependency mirror complete.')
