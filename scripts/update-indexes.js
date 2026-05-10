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

  await fs.writeFile(
    file,
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

/* ---------------- LABEL ---------------- */

function formatLabel(value) {
  return value
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/* ---------------- FILE SCAN ---------------- */

async function getAllMarkdownFiles(dir) {
  let results = [];

  const entries = await fs.readdir(dir, {
    withFileTypes: true
  });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...await getAllMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

/* ---------------- META ---------------- */

function buildMeta(frontmatter, filePath) {
  const normalized = filePath
    .replace(/\\/g, "/")
    .replace(".md", "");

  const parts = normalized.split("/");

  // blogs/backend/springboot/spring-data-jpa/file
  // [blogs, backend, springboot, spring-data-jpa, file]

  const category = parts[1];

  // all folders after category except file
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

    path: `/${normalized}`
  };
}

/* ---------------- UPSERT ---------------- */

function upsert(list, item) {
  return [
    item,
    ...list.filter(existing => existing.path !== item.path)
  ];
}

/* ---------------- SEARCH INDEX ---------------- */

async function updateSearchIndex(meta, currentSearchIndex) {
  return upsert(currentSearchIndex, meta);
}

/* ---------------- LOCAL INDEXES ---------------- */

async function updateLocalIndexes(meta, filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const dir = path.dirname(normalized);

  const dirPath = path.join(process.cwd(), dir);

  const indexPath = path.join(dirPath, "index.json");

  await fs.mkdir(dirPath, { recursive: true });

  const existing = await readJson(indexPath, {
    name: formatLabel(path.basename(dir)),
    path: `/${dir}`,
    blogs: []
  });

  existing.blogs = upsert(existing.blogs || [], meta);

  await writeJson(indexPath, existing);
}
/* ---------------- CATEGORY TREE ---------------- */

function insertIntoTree(tree, parts) {
  if (!parts.length) return;

  const [current, ...rest] = parts;

  let node = tree.find(
    item => item.path === parts.join("/")
  );

  if (!node) {
    node = {
      name: formatLabel(current),
      slug: current,
      path: parts.join("/"),
      blogCount: 0,
      children: []
    };

    tree.push(node);
  }

  node.blogCount += 1;

  if (rest.length > 0) {
    insertIntoTree(
      node.children,
      rest
    );
  }
}

/* ---------------- MAIN ---------------- */

async function run() {
  const files = await getAllMarkdownFiles(BLOGS_DIR);

  const state = await readJson(STATE_PATH, {});
  const searchIndex = await readJson(SEARCH_INDEX_PATH, []);

  const categories = {
    categories: []
  };

  const newState = {};

  let updatedSearch = [];

  for (const file of files) {
    const raw = await fs.readFile(file, "utf-8");

    const hash = getHash(raw);

    const normalizedPath = file.replace(/\\/g, "/");

    newState[normalizedPath] = hash;

    const { data } = matter(raw);

    const meta = buildMeta(data, file);

    /* ---------------- SEARCH INDEX ---------------- */

    updatedSearch = await updateSearchIndex(
      meta,
      updatedSearch
    );

    /* ---------------- LOCAL INDEXES ---------------- */

    await updateLocalIndexes(meta, file);

    /* ---------------- CATEGORY TREE ---------------- */

    const parts = [
      meta.category,
      ...meta.hierarchy
    ];

    insertIntoTree(
      categories.categories,
      parts
    );
  }

  /* ---------------- WRITE OUTPUTS ---------------- */

  await writeJson(
    SEARCH_INDEX_PATH,
    updatedSearch
  );

  await writeJson(
    CATEGORIES_PATH,
    categories
  );

  await writeJson(
    STATE_PATH,
    newState
  );

  console.log("✅ Blog indexing complete");
}

run();
