# HABERVERSE

A personal cloud for notes and files that runs entirely on GitHub. GitHub Pages hosts the app, and your files live in the `HABERVERSE` folder of this same repository. Open the site and your files are there; open a document, type, and it saves itself back to that folder.

## What's in this repository

| Path | What it is |
| --- | --- |
| `index.html` | HABERVERSE, the file browser (folders, previews, upload, search) |
| `editor.html` | The document editor that HABERVERSE opens your documents in |
| `assets/` | Styles, scripts, settings (`assets/js/config.js`) and the logo |
| `HABERVERSE/` | **Your files.** Every document is a `.html` file here |
| `.github/workflows/pages.yml` | Publishes the app to GitHub Pages |

## Put it online (one time)

1. **Create a repository** on GitHub, for example `haberverse`.
   - **Public**: works on a free account, and your files show up without signing in. Anyone can also read the files in `HABERVERSE/` on github.com (the website itself never includes them).
   - **Private**: only you can read your files. GitHub Pages on a private repository needs GitHub Pro, which is free for students through the [GitHub Student Developer Pack](https://education.github.com/pack). The first time on each device, HABERVERSE asks for your token before it shows your files.
2. **Upload everything in this folder** to the repository, including the hidden `.github` folder. With GitHub Desktop: clone the empty repository, copy these files into it, commit and push. On github.com: **Add file → Upload files** and drag the files in. If the `.github` folder doesn't come along, create `.github/workflows/pages.yml` with **Add file → Create new file** and paste its contents.
3. **Turn on Pages:** **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then on the **Actions** tab open **Publish HABERVERSE** and press **Run workflow** (only the first time). About a minute later the site is live at `https://YOUR-NAME.github.io/haberverse/`.
4. **Create an access token** for saving: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access: **Only select repositories** → pick this repository
   - Permissions → Repository permissions → **Contents: Read and write**
   - Pick an expiration, create it and copy it (`github_pat_…`).

## Using it

- **Open the site.** HABERVERSE reads the repository from the address and shows everything in `HABERVERSE/` straight away. There's nothing to choose or set up.
- **The first time you change something on a device** (new document, typing, upload, rename…), a box asks for your access token. Paste it once; from then on that device saves automatically. The token stays in that browser only.
- **Saving:** when you pause typing for a few seconds the document is saved as a commit to `HABERVERSE/`. It's also saved when you go back to your files or close the tab. Naming a document renames its file. Every earlier version stays in the repository history.
- **The button at the bottom left** shows whether this device can save. Its menu opens the folder on GitHub or disconnects the device (forgets the token).
- Documents are standalone `.html` files, so they also open straight from GitHub or from your computer.
- Saving into `HABERVERSE/` doesn't republish the website.

## Opening it from your computer

GitHub Pages is the easy way. If you open `index.html` straight from your computer (or use a custom domain), HABERVERSE can't read the repository from the address: it asks for it the first time, or you can write `owner` and `repo` in `assets/js/config.js`.

## If something goes wrong

- **"GitHub didn't accept your access token"**: the token expired or was deleted. Make a new one; HABERVERSE asks for it automatically.
- **"This token can't see that repository"**: when creating the token, pick this repository under **Repository access**.
- **"Your token can't change this repository"**: the token needs **Contents: Read and write**.
- **"GitHub limits how often your files can be looked at without a token"**: GitHub allows about 60 looks an hour without a token. Connect your token and the limit goes away.
- **The site shows a 404 page**: check that Pages uses **GitHub Actions** and that **Publish HABERVERSE** finished on the Actions tab.
- **Word, PDF, slides and spreadsheet import, and PDF export** load their tools from the internet the first time they're used.
