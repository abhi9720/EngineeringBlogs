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

/* ---------------- HELPERS ---------------- */

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
      results.push(...(await getAllMarkdownFiles(full)));
    } else if (entry.name.endsWith(".md")) {
      results.push(full);
    }
  }

  return results;
}

/* ---------------- LABEL ---------------- */

function formatLabel(v) {
  return v
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ---------------- META ---------------- */

function buildMeta(frontmatter, filePath) {
  // Normalize to: blogs/category/[...hierarchy]/slug
  const normalized = filePath.replace(/\\/g, "/").replace(/\.md$/, "");
  const parts = normalized.split("/");

  // parts[0] = "blogs", parts[1] = category, parts[2..n-1] = hierarchy, parts[n] = slug
  const category = parts[1];
  const hierarchy = parts.slice(2, -1);
  const slug = parts[parts.length - 1];

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    author: frontmatter.author,
    tags: frontmatter.tags || [],
    coverImage: frontmatter.coverImage || "",
    draft: frontmatter.draft || false,

    category,
    hierarchy,
    slug,

    path: `/${normalized}`,
  };
}

/* ---------------- UPSERT ---------------- */

function upsert(list, item) {
  return [item, ...list.filter((i) => i.path !== item.path)];
}

/* ---------------- LOCAL INDEX CREATION ---------------- */
/*
 * For a file at blogs/backend/spring-boot/Web-Services-and-API-Design/my-post.md
 * we create index.json at EVERY ancestor dir (excluding the root "blogs/"):
 *   blogs/backend/index.json
 *   blogs/backend/spring-boot/index.json
 *   blogs/backend/spring-boot/Web-Services-and-API-Design/index.json
 */
async function updateLocalIndexes(meta, filePath) {
  const normalized = filePath.replace(/\\/g, "/"); // e.g. blogs/backend/spring-boot/post.md
  const parts = normalized.split("/");
  // parts = ["blogs", "backend", "spring-boot", "Web-Services-...", "post.md"]
  // We want dirs at depth 1 through parts.length-2 (everything except root and the file itself)

  for (let depth = 1; depth <= parts.length - 2; depth++) {
    const dirParts = parts.slice(0, depth + 1); // e.g. ["blogs","backend"]
    const dir = dirParts.join("/"); // e.g. "blogs/backend"
    const indexPath = path.join(process.cwd(), dir, "index.json");

    let existing = await readJson(indexPath, null);

    if (!existing) {
      existing = {
        name: formatLabel(dirParts[dirParts.length - 1]),
        path: `/${dir}`,
        blogs: [],
      };
    }

    existing.blogs = upsert(existing.blogs || [], meta);

    await writeJson(indexPath, existing);
  }
}

/* ---------------- CATEGORY TREE ---------------- */
/*
 * Each node uses its FULL absolute path from root so there are never duplicate roots.
 *
 * e.g. for ["backend", "spring-boot", "Web-Services-and-API-Design"]:
 *   root node  → path: "backend"
 *   child node → path: "backend/spring-boot"
 *   grandchild → path: "backend/spring-boot/Web-Services-and-API-Design"
 *
 * `insertIntoTree` is called with the full segments array and builds the path
 * incrementally so every `find()` always matches on an absolute key.
 */
function insertIntoTree(tree, segments, currentPath = "") {
  if (!segments.length) return;

  const [head, ...tail] = segments;
  const nodePath = currentPath ? `${currentPath}/${head}` : head;

  let node = tree.find((n) => n.path === nodePath);

  if (!node) {
    node = {
      name: formatLabel(head),
      slug: head,
      path: nodePath,
      blogCount: 0,
      children: [],
    };
    tree.push(node);
  }

  node.blogCount += 1;

  if (tail.length > 0) {
    insertIntoTree(node.children, tail, nodePath);
  }
}

/* ---------------- MAIN ---------------- */

async function run() {
  const files = await getAllMarkdownFiles(BLOGS_DIR);

  // State is preserved for incremental awareness (not used for categories/search rebuild)
  const state = await readJson(STATE_PATH, {});

  // ✅ Always start fresh so no stale/duplicate data survives across runs
  let updatedSearch = [];
  const categories = { categories: [] };
  const newState = {};

  for (const file of files) {
    const raw = await fs.readFile(file, "utf-8");
    const hash = getHash(raw);
    const normalizedPath = file.replace(/\\/g, "/");

    newState[normalizedPath] = hash;

    const { data } = matter(raw);
    const meta = buildMeta(data, file);

    // ── Search index ──────────────────────────────────────────────────────────
    updatedSearch = upsert(updatedSearch, meta);

    // ── Local index.json at every ancestor dir ────────────────────────────────
    await updateLocalIndexes(meta, file);

    // ── Category tree ─────────────────────────────────────────────────────────
    // Full segment path: [category, ...hierarchy]
    insertIntoTree(categories.categories, [meta.category, ...meta.hierarchy]);
  }

  /* ---------------- WRITE OUTPUTS ---------------- */

  await writeJson(SEARCH_INDEX_PATH, updatedSearch);
  await writeJson(CATEGORIES_PATH, categories);
  await writeJson(STATE_PATH, newState);

  console.log(`✅ Indexed ${files.length} blog(s)`);
  console.log(`   search-index  → ${SEARCH_INDEX_PATH}`);
  console.log(`   categories    → ${CATEGORIES_PATH}`);
  console.log(`   state         → ${STATE_PATH}`);
}

run();
