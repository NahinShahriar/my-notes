# Ledger — Personal Notebook (no DB, GitHub-as-database)

## এটা কীভাবে কাজ করে
Notes সব সময় থাকে তোমার GitHub repo-র `data/notes.json` ফাইলে। যখন তুমি "Save" চাপো, app সরাসরি GitHub Contents API দিয়ে ওই ফাইলে **commit** করে দেয়। তাই server/database কিছুই লাগে না — repo-ই database।

## Setup (৫ মিনিট)

### ১. Repo বানাও
GitHub-এ নতুন একটা repo বানাও (public বা private, দুটোই চলবে) — যেমন `my-notes`।

### ২. Token বানাও
GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → Generate new token
- Repository access: **শুধু ওই repo-টা** সিলেক্ট করো
- Permissions → **Contents: Read and write**
- Generate করে token-টা কপি করে রাখো (একবারই দেখাবে)

### ৩. ফাইলগুলো push করো
এই তিনটা ফাইল (`index.html`, `style.css`, `app.js`) repo-র root-এ push করো:
```bash
git init
git add index.html style.css app.js README.md
git commit -m "Ledger: initial setup"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

### ৪. GitHub Pages চালু করো
Repo → Settings → Pages → Source: **Deploy from a branch** → Branch: `main` / root → Save.
কিছুক্ষণ পর লিংক পাবে: `https://<username>.github.io/<repo>/`

### ৫. খুলে connect করো
ওই লিংকে ঢুকে username, repo নাম, branch (`main`), আর token বসাও। এটা প্রথমবার `data/notes.json` নিজে থেকেই তৈরি করে নেবে।

## যা যা করতে পারবে
- নতুন এন্ট্রি লেখা (title, date, categories, markdown content)
- Category দিয়ে filter, title/content দিয়ে search
- Edit / Delete — প্রতিটা একটা করে git commit
- Markdown preview (bold, heading, code, list, blockquote সব সাপোর্ট করে)
- Export — পুরো notes.json ডাউনলোড করে backup রাখা
- Sync — অন্য ডিভাইস থেকে বসানো নোট রিলোড করা

## নিরাপত্তা নোট
- Token শুধু তোমার browser-এর `localStorage`-এ থাকে, অন্য কোনো সার্ভারে যায় না।
- তাও, **fine-grained + একটা মাত্র repo + Contents only** স্কোপ দিয়ে বানানো ভালো, যাতে token leak হলেও ক্ষতি কম হয়।
- Public repo হলে notes সবাই দেখতে পারবে (raw JSON হিসেবে)। Private রাখতে চাইলে repo private করো — app ঠিকভাবেই কাজ করবে, কারণ সব read/write authenticated API দিয়ে হয়।
