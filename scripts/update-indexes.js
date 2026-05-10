import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";

const BLOGS_DIR = "blogs";
const SEARCH_INDEX_PATH = "generated/search-index.json";
const CATEGORIES_PATH = "blogs/categories.json";
const STATE_PATH = ".generated/blog-state.json";

/* ---------------- HASH ---------------- */

function getHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/* ---------------- FS HELPERS ---------------- */

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

/* ---------------- FILE SCAN ---------------- */

async function getAllMarkdownFiles(dir) {
  let results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...await getAllMarkdownFiles(full));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }

  return results;
}

/* ---------------- METADATA ---------------- */

function buildMeta(frontmatter, filePath) {
  const normalized = filePath.replace(".md", "").replace(/\\/g, "/");
  const parts = normalized.split("/");

  const category = parts[1];
  const subcategory = parts[2];
  const slug = path.basename(filePath, ".md");

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    tags: frontmatter.tags || [],
    author: frontmatter.author,
    coverImage: frontmatter.coverImage,
    date: frontmatter.date,

    category,
    subcategory,
    slug,
    path: `/${normalized}`
  };
}

/* ---------------- INDEX UPDATERS ---------------- */

function upsert(list, item) {
  return [item, ...list.filter(i => i.path !== item.path)];
}

/* ---------------- MAIN ---------------- */

async function run() {
  const files = await getAllMarkdownFiles(BLOGS_DIR);

  const state = await readJson(STATE_PATH, {});
  const searchIndex = await readJson(SEARCH_INDEX_PATH, []);
  const categories = await readJson(CATEGORIES_PATH, { categories: [] });

  const newState = { ...state };

  let updatedSearch = [...searchIndex];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf-8");
    const hash = getHash(raw);

    const normalizedPath = file.replace(/\\/g, "/");

    // SKIP if unchanged
    if (state[normalizedPath] === hash) {
      continue;
    }

    const { data } = matter(raw);
    const meta = buildMeta(data, file);

    /* ---------------- SEARCH INDEX ---------------- */
    updatedSearch = upsert(updatedSearch, meta);

    /* ---------------- CATEGORY UPDATE ---------------- */
    let cat = categories.categories.find(c => c.slug === meta.category);

    if (!cat) {
      cat = { name: meta.category, slug: meta.category, subcategories: [] };
      categories.categories.push(cat);
    }

    let sub = cat.subcategories.find(s => s.slug === meta.subcategory);

    if (!sub) {
      cat.subcategories.push({
        name: meta.subcategory,
        slug: meta.subcategory,
        path: `/blogs/${meta.category}/${meta.subcategory}/index.json`
      });
    }

    /* ---------------- UPDATE STATE ---------------- */
    newState[normalizedPath] = hash;
  }

  /* ---------------- WRITE FILES ---------------- */

  await writeJson(SEARCH_INDEX_PATH, updatedSearch);
  await writeJson(CATEGORIES_PATH, categories);
  await writeJson(STATE_PATH, newState);

  console.log("✅ Incremental update complete");
}

run();
