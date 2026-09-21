// Run with: node tests/browser.cjs
// Uses installed Chrome, a temporary profile, and a fake GitHub API. Never publishes.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zara-editor-test-'));
const chromePath = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let fixture = null;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/content/posts.js' && fixture) { res.setHeader('Content-Type', 'text/javascript'); return res.end('window.SITE_POSTS = ' + JSON.stringify(fixture) + ';'); }
  if (pathname.startsWith('/media/')) { res.setHeader('Content-Type', 'image/png'); return res.end(png); }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  });
});
const fakeAPI = `(() => {
  const original = window.fetch;
  const state = window.__mock = { posts: [], head: 'a'.repeat(40), trees: {}, commits: {}, calls: [], forbidden: false, conflict: false, installed: true, loseResponse: false };
  window.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://api.github.com/')) return original(url, options);
    const pathname = new URL(url).pathname.replace('/repos/zgrigoryan/zgrigoryan.github.io', '');
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ pathname, method, body });
    const response = (body, status = 200, raw = false) => new Response(raw ? body : JSON.stringify(body), { status });
    if (state.forbidden) return response({}, 403);
    if (!options.headers.Authorization?.includes('test-token')) return response({}, 401);
    if (!pathname) return response({ permissions: { push: true } });
    if (method === 'GET' && pathname === '/git/ref/heads/main') return response({ object: { sha: state.head } });
    if (method === 'GET' && pathname.startsWith('/git/commits/')) return response({ tree: { sha: 'base-tree' } });
    if (pathname === '/contents/content/posts.js') return response(Posts.serialize(state.posts), 200, true);
    if (pathname === '/contents/assets/collection.js') return response({}, state.installed ? 200 : 404);
    if (pathname === '/git/blobs') return response({ sha: 'blob-' + state.calls.length }, 201);
    if (pathname === '/git/trees') { const sha = 'tree-' + state.calls.length; state.trees[sha] = body; return response({ sha }, 201); }
    if (method === 'POST' && pathname === '/git/commits') { const sha = String(state.calls.length).padStart(40, '0'); state.commits[sha] = body; return response({ sha }, 201); }
    if (method === 'PATCH' && pathname === '/git/refs/heads/main') {
      if (state.conflict) return response({}, 422);
      state.head = body.sha;
      const tree = state.trees[state.commits[body.sha].tree];
      state.posts = Posts.parse(tree.tree.find(item => item.path === 'content/posts.js').content);
      if (state.loseResponse) throw new TypeError('Lost network response');
      return response({ object: { sha: state.head } });
    }
    throw new Error('Unexpected mock request: ' + method + ' ' + pathname);
  };
})();`;
let chrome;
let session;
let sequence = 0;
let buffer = '';
const pending = new Map();
const exceptions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function command(method, params = {}, target = session) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timed out: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(target ? { sessionId: target } : {}) }) + '\0');
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function until(expression, label) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error('Timed out: ' + label);
}
function pass(label) { console.log('PASS: ' + label); }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  chrome = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--remote-debugging-pipe', '--user-data-dir=' + temp], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  chrome.stdio[4].on('data', chunk => {
    buffer += chunk.toString();
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
      if (message.method === 'Page.javascriptDialogOpening') command('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
      const entry = pending.get(message.id);
      if (entry) { clearTimeout(entry.timer); pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
    }
  });
  const target = await command('Target.createTarget', { url: 'about:blank' }, null);
  session = (await command('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
  await command('Page.enable'); await command('Runtime.enable');
  await command('Network.enable');
  await command('Network.setBlockedURLs', { urls: ['https://raw.githubusercontent.com/*', 'https://www.youtube-nocookie.com/*', 'https://player.vimeo.com/*'] });
  await command('Page.addScriptToEvaluateOnNewDocument', { source: fakeAPI });
  await command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin + '/editor.html' });
  await until('document.querySelector(".rich-text") && document.querySelector("#draft-list").textContent.includes("No saved")', 'editor ready');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  pass('Editor loads at desktop width');
  assert.equal(await evaluate(`(() => { const result = Posts.cleanHTML('<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)" onclick="alert(1)">bad</a><p><b>safe</b></p>'); return !/script|onclick|onerror|<img/.test(result) && result.includes('<b>safe</b>'); })()`), true);
  assert.equal(await evaluate('Posts.videoEmbed("https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ")'), '');
  assert.equal(await evaluate('Posts.videoEmbed("https://youtu.be/dQw4w9WgXcQ")'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  pass('Formatted text and video URLs are sanitized');
  await evaluate(`document.querySelector('#post-title').value = 'Test — Հայաստան'; document.querySelector('#post-title').dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.rich-text').innerHTML = '<p>A review with Armenian text: Հայաստան.</p>'; document.querySelector('.rich-text').dispatchEvent(new Event('input', {bubbles:true}));`);
  await evaluate(`(() => { const text = document.querySelector('.rich-text p').firstChild; const range = document.createRange(); range.setStart(text,0); range.setEnd(text,8); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); document.querySelector('[aria-label="Bold"]').click(); })()`);
  assert.equal(await evaluate('Boolean(document.querySelector(".rich-text b, .rich-text strong"))'), true);
  pass('Rich-text toolbar applies formatting');
  await evaluate(`(() => { const binary = atob('${png.toString('base64')}'); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0)); const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'test.png', {type:'image/png'})); const input = document.querySelector('#media-input'); input.files = transfer.files; input.dispatchEvent(new Event('change', {bubbles:true})); document.querySelector('[data-field="caption"]').value = 'Photo caption'; document.querySelector('[data-field="alt"]').value = 'A test image'; document.querySelector('[data-field="caption"]').dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d'); context.fillStyle = '#839958'; context.fillRect(0,0,32,32);
    const stream = canvas.captureStream(10); const recorder = new MediaRecorder(stream, {mimeType:'video/webm'}); const chunks = [];
    const done = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = resolve; });
    recorder.start(); context.fillRect(0,0,20,20); await new Promise(resolve => setTimeout(resolve,250)); recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
    const transfer = new DataTransfer(); transfer.items.add(new File(chunks, 'practice.webm', {type:'video/webm'}));
    const input = document.querySelector('#media-input'); input.files = transfer.files; input.dispatchEvent(new Event('change',{bubbles:true}));
    const caption = document.querySelectorAll('[data-field="caption"]')[1]; caption.value = 'Video caption'; caption.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await evaluate(`document.querySelector('#add-embed').click(); document.querySelector('[data-field="url"]').value = 'https://youtu.be/dQw4w9WgXcQ'; document.querySelector('[data-field="url"]').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#save-draft').click();`);
  await until('document.querySelector("#save-status").textContent === "Draft saved on this browser"', 'draft saved');
  const previousDocument = await evaluate('performance.timeOrigin');
  await command('Page.reload');
  await until(`performance.timeOrigin !== ${previousDocument} && document.querySelectorAll(".content-block").length === 4`, 'draft restored');
  assert.equal(await evaluate('document.querySelector("#post-title").value'), 'Test — Հայաստան');
  assert.equal(await evaluate('document.querySelector("[data-field=caption]").value'), 'Photo caption');
  await until('document.querySelector(".media-preview img").naturalWidth > 0', 'restored image');
  await until('document.querySelector(".media-preview video").readyState >= 1', 'restored video metadata');
  assert.equal(await evaluate('document.querySelectorAll("[data-field=caption]")[1].value'), 'Video caption');
  await evaluate(`document.querySelectorAll('.content-block')[2].querySelector('[aria-label="Move block up"]').click()`);
  assert.equal(await evaluate('Boolean(document.querySelectorAll(".content-block")[1].querySelector("video"))'), true);
  await evaluate(`document.querySelectorAll('.content-block')[1].querySelector('[aria-label="Move block down"]').click()`);
  pass('Text, image/video files, and captions survive reload and reordering');
  await evaluate('document.querySelector("#preview-post").click()');
  await until('document.querySelector("#preview-dialog").open', 'preview opens');
  assert.equal(await evaluate('document.querySelector("#preview-content figcaption").textContent'), 'Photo caption');
  assert.equal(await evaluate('document.querySelectorAll("#preview-content iframe").length'), 1);
  await evaluate('document.querySelector(".close-dialog").click()');
  await evaluate('document.querySelector("#publish-post").click()');
  assert.equal(await evaluate('document.querySelector("#connection-panel").open && __mock.calls.length === 0'), true);
  pass('Preview renders mixed content; publishing requires owner credentials');
  await evaluate('document.querySelector("#github-token").value = "test-token"; document.querySelector("#connect").click()');
  await until('GitHubPublisher.connected() && !document.querySelector("#connect").disabled', 'GitHub connected');
  assert.equal(await evaluate('document.querySelector("#github-token").value'), '');
  await evaluate('__mock.forbidden = true; document.querySelector("#publish-post").click()');
  await until('!document.querySelector("#publish-post").disabled && document.querySelector("#editor-status").textContent.includes("refused")', 'permission failure');
  assert.equal(await evaluate('__mock.posts.length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".content-block").length'), 4);
  await evaluate('__mock.forbidden = false; __mock.conflict = true; document.querySelector("#publish-post").click()');
  await until('!document.querySelector("#publish-post").disabled && document.querySelector("#editor-status").textContent.includes("branch")', 'conflicting publish');
  assert.equal(await evaluate('__mock.posts.length'), 0);
  pass('Permission errors and branch conflicts preserve the draft and public content');
  await evaluate('__mock.conflict = false; __mock.loseResponse = true; document.querySelector("#publish-post").click()');
  await until('!document.querySelector("#commit-link").hidden', 'successful publish');
  fixture = await evaluate('__mock.posts');
  assert.equal(fixture.length, 1);
  assert.equal(fixture[0].blocks.length, 4);
  assert.equal(fixture[0].title, 'Test — Հայաստան');
  assert.equal(JSON.stringify(fixture).includes('test-token'), false);
  assert.equal(await evaluate('__mock.calls.filter(c=>c.method === "PATCH").every(c=>c.body.force === false)'), true);
  assert.equal(await evaluate('__mock.calls.filter(c=>c.pathname === "/git/trees").every(c=>c.body.base_tree === "base-tree")'), true);
  pass('Atomic publication preserves existing files, never force-pushes, and recovers a lost response');
  // Reopening and updating a post must keep its identity, not duplicate it.
  await evaluate(`document.querySelector('#post-title').value = 'Updated review'; document.querySelector('#post-title').dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#publish-post').click();`);
  await until('!document.querySelector("#publish-post").disabled && __mock.posts[0].title === "Updated review"', 'post update');
  assert.equal(await evaluate('__mock.posts.length'), 1);
  const stale = await evaluate(`(async () => { const post = __mock.posts[0]; try { await GitHubPublisher.publish({...post, baseRevision:'stale'}); return false; } catch (error) { return error.message.includes('changed since'); } })()`);
  assert.equal(stale, true);
  pass('Existing posts update without duplication; stale edits are rejected');
  fixture = await evaluate('__mock.posts');
  await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: true });
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  fs.writeFileSync(path.join(temp, 'editor-mobile.png'), Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport: true })).data, 'base64'));
  pass('Editor fits a 375px viewport');
  await command('Page.navigate', { url: origin + '/index.html' });
  await until('document.querySelectorAll(".entry").length === 1', 'published gallery');
  assert.equal(await evaluate('document.querySelector(".post-title").textContent'), 'Updated review');
  assert.equal(await evaluate('document.querySelector(".starter-note").hidden'), true);
  await evaluate('document.querySelector("[data-filter=books]").click()');
  assert.equal(await evaluate('document.querySelectorAll(".entry:not([hidden])").length'), 0);
  await evaluate('document.querySelector("[data-filter=all]").click(); document.querySelector(".card-open").click()');
  await until('document.querySelector("#entry-dialog").open', 'published post opens');
  assert.equal(await evaluate('document.querySelector("#dialog-content figcaption").textContent'), 'Photo caption');
  assert.equal(await evaluate('document.querySelector("#dialog-content img").alt'), 'A test image');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  pass('Published posts appear in the gallery with working filters, captions, and accessible media');
  assert.deepEqual(exceptions, []);
  console.log('Screenshots: ' + temp);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (chrome) { try { await command('Browser.close', {}, null); } catch {} chrome.kill(); }
  server.close();
  for (const entry of pending.values()) clearTimeout(entry.timer);
});
