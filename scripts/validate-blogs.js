name: Update Blog Indexes

on:
  push:
    paths:
      - "blogs/**/*.md"

permissions:
  contents: write

jobs:
  validate-and-update:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Dependencies
        run: npm install

      # STEP 1
      - name: Validate Blogs
        run: node scripts/validate-blogs.js

      # STEP 2 (runs ONLY if validation passes)
      - name: Update Blog Indexes
        run: node scripts/update-indexes.js

      # STEP 3
      - name: Commit Updated JSON Files
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

          git add blogs/**/index.json
          git add blogs/categories.json
          git add generated/search-index.json

          if git diff --cached --quiet; then
            echo "No changes detected."
          else
            git commit -m "chore: auto-update blog indexes"
            git push
          fi
