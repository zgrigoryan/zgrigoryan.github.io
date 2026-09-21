/* Publishing uses GitHub's API. The access token never leaves this closure. */
(() => {
  const repository = 'zgrigoryan/zgrigoryan.github.io';
  const branch = 'main';
  const postPath = 'content/posts.js';
  const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  let token = '';
  async function request(path, { method = 'GET', body, raw = false, missing = false } = {}) {
    if (!token) throw new Error('Connect GitHub under Publishing access first. Your draft stays saved here.');
    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
        method,
        headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2026-03-10', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        cache: 'no-store',
        signal: AbortSignal.timeout(120000),
      });
    } catch { throw new Error('Could not reach GitHub. Your draft is still saved. Check your connection and try again.'); }
    if (response.status === 404 && missing) return null;
    if (!response.ok) {
      const messages = {
        401: 'GitHub rejected the token. It may have expired. Reconnect with a valid token.',
        403: 'GitHub refused this request. Check the token’s Contents permission, repository rules, and API rate limit.',
        404: 'GitHub could not find this repository or branch, or this token cannot access it.',
        409: 'The repository changed during publishing. Reopen the latest post before trying again.',
        422: 'GitHub could not save this change. The branch may have changed or require a pull request. Your draft is still saved.',
      };
      throw new Error(messages[response.status] || `GitHub returned an error (${response.status}). Your draft is still saved.`);
    }
    return raw ? response.text() : response.json();
  }
  async function snapshot() {
    const ref = await request(`/git/ref/heads/${branch}`);
    const commit = await request(`/git/commits/${ref.object.sha}`);
    const source = await request(`/contents/${postPath}?ref=${ref.object.sha}`, { raw: true, missing: true });
    return { head: ref.object.sha, tree: commit.tree.sha, posts: source === null ? [] : Posts.parse(source) };
  }
  async function connect(value) {
    token = value.trim();
    try {
      const repo = await request('');
      if (repo.permissions?.push === false) throw new Error('This account does not have permission to publish to this repository.');
      return await snapshot();
    } catch (error) { token = ''; throw error; }
  }
  async function base64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(binary);
  }
  function validateDraft(draft) {
    if (!/^[\w-]+$/.test(draft.id) || !draft.title.trim() || draft.title.length > 180 || !Posts.categories[draft.category]) throw new Error('Add a title and choose a category before publishing.');
    if (!Array.isArray(draft.blocks) || !draft.blocks.length) throw new Error('Add some text, an image, or a video first.');
    if (!draft.blocks.some(block => {
      if (['image', 'video', 'embed'].includes(block.type)) return true;
      const text = document.createElement('div');
      text.innerHTML = Posts.cleanHTML(block.html);
      return Boolean(text.textContent.trim());
    })) throw new Error('Add some text, an image, or a video first.');
    let size = 0;
    for (const block of draft.blocks) {
      if (block.type === 'embed' && !Posts.videoEmbed(block.url)) throw new Error('Use a valid YouTube or Vimeo link, or remove the empty video block.');
      if (['image', 'video'].includes(block.type)) {
        if (block.file instanceof Blob) {
          if (!types[block.file.type] || !block.file.type.startsWith(block.type + '/') || block.file.size > 20 * 1024 * 1024) throw new Error('Each upload must use a supported image/video format and be 20 MB or smaller.');
          size += block.file.size;
        } else if (!Posts.mediaSource(block)) throw new Error('A media file is missing. Add it again before publishing.');
      }
    }
    if (size > 50 * 1024 * 1024) throw new Error('Keep new uploads under 50 MB per post. Use video links for larger videos.');
  }
  async function publish(draft, progress = () => {}) {
    validateDraft(draft);
    progress('Checking the latest version…');
    const current = await snapshot();
    const previous = current.posts.find(post => post.id === draft.id);
    if ((previous?.revision || null) !== (draft.baseRevision || null)) throw new Error('This post has changed since you opened it. Your draft is saved. Open the latest published version before publishing again.');
    const installed = await request(`/contents/assets/collection.js?ref=${current.head}`, { missing: true });
    if (!installed) throw new Error('Upload the website files to GitHub once before publishing posts. See the README’s initial setup steps. Your draft is saved.');
    const changes = [];
    const blocks = [];
    let uploaded = 0;
    const total = draft.blocks.filter(block => block.file instanceof Blob).length;
    for (const block of draft.blocks) {
      if (block.type === 'text') {
        const html = Posts.cleanHTML(block.html);
        const text = document.createElement('div'); text.innerHTML = html;
        if (text.textContent.trim()) blocks.push({ type: 'text', html });
      } else if (block.type === 'embed') {
        blocks.push({ type: 'embed', url: block.url, caption: String(block.caption || '') });
      } else if (['image', 'video'].includes(block.type)) {
        let src = block.src;
        if (block.file instanceof Blob) {
          progress(`Uploading media ${++uploaded} of ${total}…`);
          src = `media/${crypto.randomUUID()}.${types[block.file.type]}`;
          const blob = await request('/git/blobs', { method: 'POST', body: { content: await base64(block.file), encoding: 'base64' } });
          changes.push({ path: src, mode: '100644', type: 'blob', sha: blob.sha });
        }
        blocks.push({ type: block.type, src, caption: String(block.caption || ''), ...(block.type === 'image' ? { alt: String(block.alt || '') } : {}) });
      }
    }
    if (!blocks.length) throw new Error('Add some text, an image, or a video first.');
    const post = { id: draft.id, title: draft.title.trim(), category: draft.category, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), revision: crypto.randomUUID(), blocks };
    const posts = [post, ...current.posts.filter(item => item.id !== post.id)];
    changes.push({ path: postPath, mode: '100644', type: 'blob', content: Posts.serialize(posts) });
    progress('Saving the post and media together…');
    const tree = await request('/git/trees', { method: 'POST', body: { base_tree: current.tree, tree: changes } });
    const commit = await request('/git/commits', { method: 'POST', body: { message: `${previous ? 'Update' : 'Add'} post: ${post.title}`, tree: tree.sha, parents: [current.head] } });
    try {
      await request(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
    } catch (error) {
      // A lost response can occur after GitHub has already accepted the commit.
      try {
        const latest = await snapshot();
        if (!latest.posts.some(item => item.id === post.id && item.revision === post.revision)) throw error;
      } catch { throw error; }
    }
    return { post, posts, url: `https://github.com/${repository}/commit/${commit.sha}` };
  }
  window.GitHubPublisher = { connect, disconnect: () => { token = ''; }, connected: () => Boolean(token), publish, validateDraft };
})();
