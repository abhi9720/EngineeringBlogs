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

/* ---------------- METADATA (FIXED LOGIC) ---------------- */

function buildMeta(frontmatter, filePath) {
  const normalized = filePath.replace(/\\/g, "/").replace(".md", "");
  const parts = normalized.split("/");

  const category = parts[1];

  let subcategory = null;
  let slug;

  // ✅ FIX: detect structure properly
  if (parts.length === 4) {
    // blogs/backend/springboot/file.md
    subcategory = parts[2];
    slug = parts[3];
  } else {
    // blogs/backend/file.md (flat blog)
    slug = parts[2];
  }

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

/* ---------------- UPSERT ---------------- */

function upsert(list, item) {
  return [item, ...list.filter(i => i.path !== item.path)];
}

/* ---------------- LOCAL INDEX (FIXED) ---------------- */

async function updateLocalIndex(meta) {
  let indexPath;

  // ✅ FIX: correct folder routing
  if (!meta.subcategory) {
    // flat category index → blogs/backend/index.json
    indexPath = path.join(BLOGS_DIR, meta.category, "index.json");
  } else {
    // nested index → blogs/backend/springboot/index.json
    indexPath = path.join(BLOGS_DIR, meta.category, meta.subcategory, "index.json");
  }

  const data = await readJson(indexPath, {
    category: meta.category,
    subcategory: meta.subcategory || null,
    blogs: []
  });

  data.blogs = data.blogs.filter(b => b.path !== meta.path);
  data.blogs.unshift(meta);

  await writeJson(indexPath, data);
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

    // skip unchanged
    if (state[normalizedPath] === hash) continue;

    const { data } = matter(raw);
    const meta = buildMeta(data, file);

    /* ---------------- SEARCH INDEX ---------------- */
    updatedSearch = upsert(updatedSearch, meta);

    /* ---------------- LOCAL INDEX ---------------- */
    await updateLocalIndex(meta);

    /* ---------------- CATEGORY TREE ---------------- */
    let cat = categories.categories.find(c => c.slug === meta.category);

    if (!cat) {
      cat = {
        name: meta.category,
        slug: meta.category,
        subcategories: []
      };
      categories.categories.push(cat);
    }

    if (meta.subcategory) {
      let sub = cat.subcategories.find(s => s.slug === meta.subcategory);

      if (!sub) {
        cat.subcategories.push({
          name: meta.subcategory,
          slug: meta.subcategory,
          path: `/blogs/${meta.category}/${meta.subcategory}/index.json`
        });
      }
    }

    /* ---------------- STATE UPDATE ---------------- */
    newState[normalizedPath] = hash;
  }

  /* ---------------- WRITE OUTPUTS ---------------- */

  await writeJson(SEARCH_INDEX_PATH, updatedSearch);
  await writeJson(CATEGORIES_PATH, categories);
  await writeJson(STATE_PATH, newState);

  console.log("✅ Fixed incremental indexing (flat + nested support)");
}

run();
