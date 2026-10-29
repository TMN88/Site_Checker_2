const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const sh = process.env.TEST_SH || (process.platform === 'win32'
  ? path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/git/usr/bin/sh.exe')
  : '/bin/sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'site-checker2-test-'));
const posix = s => s.replaceAll('\\', '/');
const argsFile = path.join(tmp, 'args');
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'));
fs.writeFileSync(path.join(tmp, 'curl'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_FILE"\nprintf "%s" "$MOCK_RESULT"\nexit "$MOCK_EXIT"\n');
fs.chmodSync(path.join(tmp, 'curl'), 0o755);
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
function probe(result = '200|0.125', exit = 0, args = ['https://youtube.com/']) {
  if (fs.existsSync(argsFile)) fs.unlinkSync(argsFile);
  const run = spawnSync(sh, ['-c', 'exec sh "$PROBE" "$TEST_URL" "$TEST_CONNECT" "$TEST_TOTAL"'], {
    encoding: 'utf8', timeout: 5000,
    env: { ...baseEnv, PATH: [tmp, path.dirname(sh), process.env.PATH || process.env.Path].join(path.delimiter),
      MOCK_RESULT: result, MOCK_EXIT: String(exit), ARGS_FILE: posix(argsFile),
      PROBE: posix(path.resolve(__dirname, '../files/usr/libexec/site-checker2-probe')),
      TEST_URL: args[0], TEST_CONNECT: args[1] || '3', TEST_TOTAL: args[2] || '5' }
  });
  assert.ifError(run.error);
  assert.equal(run.stderr, '');
  return { result: JSON.parse(run.stdout), args: fs.existsSync(argsFile) ? fs.readFileSync(argsFile, 'utf8').trim().split('\n') : [] };
}
test('records HTTP code and milliseconds using upstream request profile', () => {
  const p = probe();
  assert.deepEqual(p.result, { status: 'available', reason: 'none', http_code: 200, elapsed_ms: 125, curl_exit: 0 });
  assert.equal(p.args[0], '-q');
  for (const item of ['--location', '--range', '0-65535', '--speed-time', '--speed-limit', '--connect-timeout', '--max-time', '--proto-redir', '=http,https', '--max-redirs']) assert.ok(p.args.includes(item), item);
  assert.deepEqual(p.args.slice(-2), ['--', 'https://youtube.com/']);
});
for (const [rc, reason, status] of [[6,'dns_error','unavailable'], [7,'connect_error','unavailable'], [28,'timeout','unavailable'], [60,'tls_error','error'], [47,'redirect_limit','error']]) {
  test(`curl failure ${rc} cannot become success`, () => {
    assert.deepEqual(probe('200|1.5', rc).result, { status, reason, http_code: 200, elapsed_ms: 1500, curl_exit: rc });
  });
}
for (const code of [403, 404, 429, 500]) test(`HTTP ${code} is ambiguous, not proof of blocking`, () => {
  const p = probe(`${code}|0.01`).result;
  assert.equal(p.status, 'error'); assert.equal(p.reason, 'http_error');
});
for (const url of ['file:///etc/passwd', 'https://x/;reboot', 'https://user:secret@x/', '-K/etc/passwd', 'https://x/$(reboot)', 'https://x/\nreboot', 'https://x/"', 'https://x/`reboot`']) {
  test(`rejects unsafe destination ${JSON.stringify(url)}`, () => {
    const p = probe('', 0, [url]); assert.equal(p.result.reason, 'invalid_url'); assert.deepEqual(p.args, []);
  });
}
test('rejects unbounded and malformed timeouts before launching curl', () => {
  for (const args of [['https://x/', '0', '5'], ['https://x/', '3', '9999'], ['https://x/', '5', '3'], ['https://x/', '3;reboot', '5']]) {
    const p = probe('', 0, args); assert.equal(p.result.reason, 'invalid_timeout'); assert.deepEqual(p.args, []);
  }
});
test('malformed curl output always returns valid JSON', () => {
  const p = probe('"secret"|NaN').result;
  assert.equal(p.http_code, 0); assert.equal(p.elapsed_ms, 0); assert.equal(p.status, 'error');
});
