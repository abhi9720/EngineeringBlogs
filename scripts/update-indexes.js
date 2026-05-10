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

/* ---------------- LABEL ---------------- */

function formatLabel(value) {
  return value
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ---------------- METADATA ---------------- */

function buildMeta(frontmatter, filePath) {
  const normalized = filePath.replace(/\\/g, "/").replace(".md", "");
  const parts = normalized.split("/");

  const category = parts[1];

  // 🔥 FIX: capture ALL nesting levels after category
  const hierarchy = parts.slice(2, parts.length - 1); // everything except file

  const slug = parts[parts.length - 1];

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    tags: frontmatter.tags || [],
    author: frontmatter.author,
    coverImage: frontmatter.coverImage,
    date: frontmatter.date,

    category,
    hierarchy, // 👈 NEW (important)
    slug,
    path: `/${normalized}`
  };
}

/* ---------------- UPSERT ---------------- */

function upsert(list, item) {
  return [item, ...list.filter(i => i.path !== item.path)];
}

/* ---------------- LOCAL INDEX ---------------- */

async function updateLocalIndex(meta) {
  const dirPath = path.join(BLOGS_DIR, meta.category, ...meta.hierarchy);

  const indexPath = path.join(dirPath, "index.json");

  const data = await readJson(indexPath, {
    category: meta.category,
    hierarchy: meta.hierarchy,
    blogs: []
  });

  data.blogs = data.blogs.filter(b => b.path !== meta.path);
  data.blogs.unshift(meta);

  await writeJson(indexPath, data);
}

/* ---------------- CATEGORY TREE (FIXED) ---------------- */

function insertIntoTree(tree, pathParts, meta) {
  if (!pathParts.length) return;

  const [current, ...rest] = pathParts;

  let node = tree.find(n => n.slug === current);

  if (!node) {
    node = {
      name: formatLabel(current),
      slug: current,
      children: [],
      blogCount: 0
    };
    tree.push(node);
  }

  if (rest.length === 0) {
    node.blogCount += 1;
    return;
  }

  insertIntoTree(node.children, rest, meta);
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

    if (state[normalizedPath] === hash) continue;

    const { data } = matter(raw);
    const meta = buildMeta(data, file);

    /* ---------------- SEARCH INDEX ---------------- */
    updatedSearch = upsert(updatedSearch, meta);

    /* ---------------- LOCAL INDEX ---------------- */
    await updateLocalIndex(meta);

    /* ---------------- CATEGORY TREE (FIXED) ---------------- */
    const pathParts = [meta.category, ...meta.hierarchy];

    insertIntoTree(categories.categories, pathParts, meta);

    /* ---------------- STATE ---------------- */
    newState[normalizedPath] = hash;
  }

  /* ---------------- WRITE ---------------- */

  await writeJson(SEARCH_INDEX_PATH, updatedSearch);
  await writeJson(CATEGORIES_PATH, categories);
  await writeJson(STATE_PATH, newState);

  console.log("✅ Fully fixed: infinite nested category support enabled");
}

run();
