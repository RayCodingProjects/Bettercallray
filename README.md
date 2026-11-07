# HABERVERSE

A personal cloud for notes and files that runs entirely on GitHub. GitHub Pages hosts the app, and your files live in the `HABERVERSE` folder of this repository. Open a document, type, and it saves itself back to that folder.

## What's in this repository

| Path | What it is |
| --- | --- |
| `index.html` | HABERVERSE, the file browser (folders, previews, upload, search) |
| `editor.html` | The document editor that HABERVERSE opens your documents in |
| `assets/` | Styles, scripts and the logo used by both pages |
| `HABERVERSE/` | **Your files.** Every document is a `.html` file here |
| `.github/workflows/pages.yml` | Publishes the app to GitHub Pages |

## Put it online (one time, about 5 minutes)

1. **Create a repository** on GitHub, for example `haberverse`.
   - **Private** keeps your notes to yourself. GitHub Pages on a private repository needs GitHub Pro, which is free for students through the [GitHub Student Developer Pack](https://education.github.com/pack).
   - **Public** works on a free account, but anyone can read the files in `HABERVERSE/` on github.com. The website itself never includes them.
2. **Upload everything in this folder** to the repository, including the hidden `.github` folder. With GitHub Desktop: clone the empty repository, copy these files into it, commit and push. On github.com: **Add file → Upload files** and drag the files in. If the `.github` folder doesn't come along, create the file `.github/workflows/pages.yml` with **Add file → Create new file** and paste its contents.
3. **Turn on Pages:** **Settings → Pages → Build and deployment → Source: GitHub Actions**. Then go to the **Actions** tab, open **Publish HABERVERSE** and press **Run workflow** (only needed the first time). After about a minute the site is live at `https://YOUR-NAME.github.io/haberverse/`.
4. **Create an access token** so HABERVERSE can save: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   - Repository access: **Only select repositories** → pick your HABERVERSE repository
   - Permissions → Repository permissions → **Contents: Read and write**
   - Set an expiration you're comfortable with, then copy the token (`github_pat_…`).
5. **Open your site.** HABERVERSE recognises the repository from the address, so you only paste the token. Do this once on each device; the token stays in that browser.

## How saving works

- HABERVERSE lists everything in the `HABERVERSE` folder of the repository.
- When you pause typing for a few seconds, the document is saved as a commit. It's also saved when you go back to your files or close the tab.
- Naming a document renames its file. Moving, renaming and deleting are commits too, so every earlier version stays in the repository history.
- Documents are standalone `.html` files: you can open them straight from GitHub or from your computer.
- Saving to `HABERVERSE/` doesn't republish the website.

## Use it on your computer instead

Open `index.html` in Chrome or Edge and choose **Folder on this computer**, then pick the `HABERVERSE` folder. Everything is read from and saved straight into that folder. **This browser only** keeps files inside the browser with no setup.

The computer folder and GitHub don't sync with each other; you use one at a time and can switch from the storage button at the bottom left.

## If something goes wrong

- **"GitHub didn't accept your access token"**: the token expired or was deleted. Make a new one and press **Reconnect GitHub**.
- **"Your token can't change this repository"**: the token needs **Contents: Read and write** on this repository.
- **The site shows a 404 page**: check that Pages uses **GitHub Actions** and that the **Publish HABERVERSE** workflow finished on the Actions tab.
- **Word, PDF, slides and spreadsheet import, and PDF export**: these load their tools from the internet the first time they're used.
