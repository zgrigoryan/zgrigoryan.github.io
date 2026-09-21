# Zara’s website

A static website with a browser editor for text, art, photographs, yoga videos, book and film reviews, and writing. No package installation or build is needed for the site.

## Add a post from the website

Open `index.html` and click **+ Add post**, or open `editor.html` directly.

1. Enter a title and choose a category.
2. Write in a text block. The toolbar provides bold, italic, headings, paragraphs, lists, quotes, and links. Select words before adding a link. Pasted text is inserted without outside formatting.
3. Use **+ Text**, **+ Photo / video**, or **+ Video link** to add blocks. Each image/video has a caption field; images also have a screen-reader description. Use the arrows to reorder blocks.
4. **Save draft** keeps the draft in this browser. Drafts also autosave as you edit, including attached files. **Preview** shows the post without publishing it.
5. Connect your GitHub account as described below, then click **Publish**. The editor uploads media and saves the post to your repository in one commit. GitHub Pages then deploys it.
6. To edit an existing post, select it under **Published**, make changes, and publish again.

The editor supports JPG, PNG, WebP, GIF, AVIF, MP4, and WebM, up to **20 MB per file** and **50 MB of new uploads per post**. For longer videos, use a YouTube or Vimeo link. Choose a browser-playable codec for uploaded videos (for example, H.264 in MP4). There is no live collaboration or Google Docs account integration.

Drafts are stored in IndexedDB on this browser and website address. They do not sync between devices, between a local preview and the live site, or between browsers. Clearing website data removes drafts. Check the save status before closing the editor. Published posts and uploaded media are stored in GitHub and available on other devices.

## Initial website setup (once)

This draft is local and has not been pushed or published. Upload these files and folders together to the root of the repository’s `main` branch:

- `index.html`
- `editor.html`
- `assets/`
- `content/`
- Any existing `images/` and `videos/` files you want to use

On GitHub, select **Add file → Upload files**, drag in the files/folders, enter a commit message, and save. Then open **Settings → Pages**, choose **Deploy from a branch**, select **main** and **/ (root)**, and save. The expected address is `https://zgrigoryan.github.io/`; the editor will be at `https://zgrigoryan.github.io/editor.html`.

Once you start publishing through the editor, GitHub contains your latest `content/posts.js` and `media/` files. Pull/sync those changes before uploading a local copy of the site again, so an older local `content/posts.js` does not replace your newer posts.

## Connect publishing

This version stays on GitHub Pages and uses a fine-grained personal access token; it does not require a separate server or content-service subscription.

1. Open [GitHub’s fine-grained token settings](https://github.com/settings/personal-access-tokens/new).
2. Select the resource owner `zgrigoryan`, choose **Only select repositories**, and select **zgrigoryan.github.io**.
3. Grant repository **Contents: Read and write**, set an expiration, and generate the token. Metadata read access is included by GitHub.
4. In the website editor, open **Publishing access**, paste the token, and select **Connect GitHub**.

Enter the token only in the editor’s password field. It is not saved in files, posts, localStorage, or IndexedDB; it stays in the current tab’s memory. Refreshing or disconnecting clears it, so reconnect when starting a new session. The editor URL is public, but GitHub enforces permission to publish. Branch protection or organization policies may require a different publishing flow.

The token and `main` branch must have write access, and GitHub Pages must use that branch for the post to reach the public site. The editor reports **Saved to GitHub** after the commit is accepted; that is not a guarantee that deployment has completed. Allow a few minutes and check the repository’s Pages/Actions status if the live site does not update.

## Files

- `index.html`: layout, palette, introductory text, and sample cards.
- `editor.html`, `assets/editor.css`, `assets/editor.js`: post editor and local drafts.
- `assets/github.js`: owner/repository/branch configuration and publishing.
- `assets/posts.js`, `assets/posts.css`: shared formatting, sanitization, and post rendering.
- `assets/collection.js`: published cards and post previews on the homepage.
- `content/posts.js`: published post data. Starts empty; the sample cards disappear after the first post.
- `media/`: created in GitHub by the editor for published uploads.

All media filenames are unique. Publishing updates only post data and new media, preserves other repository files, and refuses conflicting changes instead of force-pushing. Editing a post does not delete its older media files from the repository. Post deletion is not implemented.

The current name, introductory text, and sample illustrations are placeholders to customize. To enable the Letterboxd profile link on the starter film card, fill in `LETTERBOXD_USERNAME` in `index.html`. For published film posts, use the editor’s link tool to link your profile or reviews. Automatic Letterboxd import is not implemented.

## Preview and checks

Double-click `index.html` or `editor.html` for a quick local preview. For a consistent browser origin, run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`. Local drafts are separate from drafts on the published site.

Run `node tests/browser.cjs` to check editing, draft persistence, publishing errors, conflict protection, sanitization, and gallery rendering. Tests use installed Chrome and a simulated GitHub API; they do not publish anything. Set `CHROME_PATH` if Chrome is installed in a different location. Temporary screenshots are saved outside the repository.

References: [GitHub Pages setup](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [file uploads](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository), [token setup](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [Git trees and atomic changes](https://docs.github.com/en/rest/git/trees).
