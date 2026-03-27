import os, subprocess, time, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'start-all.bat'
LOG = ROOT / 'snowchat_backend.log'

def run_start(skip_kafka=True, no_frontend=True, no_keycloak=True, extra_args=None, timeout=40):
    env = os.environ.copy()
    if skip_kafka:
        extra = 'no-kafka'
    else:
        extra = ''
    if no_frontend:
        env['NO_FRONTEND'] = '1'
    if no_keycloak:
        env['NO_KEYCLOAK'] = '1'
    args = ['cmd','/c', str(SCRIPT), 'debug']
    if extra:
        args.append(extra)
    if extra_args:
        args.extend(extra_args)
    if LOG.exists():
        try: LOG.unlink()
        except Exception: pass
    proc = subprocess.Popen(args, cwd=ROOT, env=env)
    start = time.time()
    while time.time() - start < timeout:
        if LOG.exists() and LOG.stat().st_size > 0:
            text = LOG.read_text(encoding='utf-8', errors='ignore')
            if 'SUMMARY' in text:
                proc.terminate()
                return 0, text
        time.sleep(1)
    proc.terminate()
    return 1, LOG.read_text(encoding='utf-8', errors='ignore') if LOG.exists() else ''

def test_start_all_minimal():
    code, log = run_start()
    assert code == 0, f"start-all failed; log:\n{log}"  # Expect summary reached
    assert 'Event streaming' in log
    assert 'Frontend' in log
    assert 'Backend Auto.' in log
