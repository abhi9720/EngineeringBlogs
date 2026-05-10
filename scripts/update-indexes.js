import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

const BLOGS_DIR = "blogs";
const SEARCH_INDEX_PATH = "generated/search-index.json";
const CATEGORIES_PATH = "blogs/categories.json";

/**
 * Format folder name → UI label
 */
function formatLabel(value = "") {
  return value
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Recursively get all markdown files
 */
async function getAllMarkdownFiles(dir) {
  let results = [];

  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(await getAllMarkdownFiles(fullPath));
    } else if (entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * JSON helpers
 */
async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Parse markdown
 */
async function parseMarkdown(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  return matter(raw).data;
}

/**
 * Build metadata (NO frontmatter category/slug dependency)
 */
function buildBlogMetadata(frontmatter, filePath) {
  const normalizedPath = filePath.replace(".md", "").replace(/\\/g, "/");
  const parts = normalizedPath.split("/");

  const folderCategory = parts[1];
  const folderSubcategory = parts[2];
  const slug = path.basename(filePath, ".md");

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    author: frontmatter.author,
    tags: frontmatter.tags || [],
    coverImage: frontmatter.coverImage,
    featured: frontmatter.featured || false,
    draft: frontmatter.draft || false,

    category: formatLabel(folderCategory),
    subcategory: formatLabel(folderSubcategory),

    slug,
    path: `/${normalizedPath}`,

    __folderCategory: folderCategory,
    __folderSubcategory: folderSubcategory,
  };
}

/**
 * INDEX.JSON (local)
 */
async function updateCategoryIndex(blog) {
  const filePath = path.join(
    BLOGS_DIR,
    blog.__folderCategory,
    blog.__folderSubcategory,
    "index.json"
  );

  const data = await readJson(filePath, {
    category: blog.category,
    subcategory: blog.subcategory,
    blogs: []
  });

  // remove duplicates by PATH
  data.blogs = data.blogs.filter(b => b.path !== blog.path);

  data.blogs.unshift(blog);

  await writeJson(filePath, data);
}

/**
 * SEARCH INDEX (global)
 */
async function updateSearchIndex(blog) {
  const data = await readJson(SEARCH_INDEX_PATH, []);

  const updated = data.filter(b => b.path !== blog.path);

  updated.unshift({
    title: blog.title,
    description: blog.description,
    tags: blog.tags,
    category: blog.category,
    subcategory: blog.subcategory,
    slug: blog.slug,
    path: blog.path,
    author: blog.author,
    coverImage: blog.coverImage
  });

  await writeJson(SEARCH_INDEX_PATH, updated);
}

/**
 * CATEGORIES (global navigation)
 */
async function updateCategories(blog) {
  const data = await readJson(CATEGORIES_PATH, { categories: [] });

  let category = data.categories.find(
    c => c.slug === blog.__folderCategory
  );

  if (!category) {
    category = {
      name: blog.category,
      slug: blog.__folderCategory,
      subcategories: []
    };
    data.categories.push(category);
  }

  let sub = category.subcategories.find(
    s => s.slug === blog.__folderSubcategory
  );

  if (!sub) {
    category.subcategories.push({
      name: blog.subcategory,
      slug: blog.__folderSubcategory,
      path: `/blogs/${blog.__folderCategory}/${blog.__folderSubcategory}/index.json`
    });
  }

  await writeJson(CATEGORIES_PATH, data);
}

/**
 * FULL REBUILD (SAFE MODE)
 */
async function run() {
  const files = await getAllMarkdownFiles(BLOGS_DIR);

  const searchIndex = [];
  const categoriesCache = { categories: [] };

  for (const file of files) {
    const frontmatter = await parseMarkdown(file);
    const blog = buildBlogMetadata(frontmatter, file);

    if (blog.draft) continue;

    // update local index
    await updateCategoryIndex(blog);

    // collect for global rebuild
    searchIndex.push(blog);

    // categories update
    await updateCategories(blog);
  }

  // rebuild search index in one shot (prevents duplicates completely)
  const finalSearchIndex = searchIndex.map(b => ({
    title: b.title,
    description: b.description,
    tags: b.tags,
    category: b.category,
    subcategory: b.subcategory,
    slug: b.slug,
    path: b.path,
    author: b.author,
    coverImage: b.coverImage
  }));

  await writeJson(SEARCH_INDEX_PATH, finalSearchIndex);

  console.log("✅ All indexes rebuilt successfully");
}

run();
