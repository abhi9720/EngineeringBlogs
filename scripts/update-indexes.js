import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { execSync } from "child_process";

const BLOGS_DIR = "blogs";
const SEARCH_INDEX_PATH = "generated/search-index.json";

/**
 * Get changed markdown files from latest commit
 */
function getChangedMarkdownFiles() {
  try {
    const output = execSync(
      `git diff --name-only HEAD~1 HEAD -- "blogs/**/*.md"`,
      { encoding: "utf-8" }
    );

    return output
      .split("\n")
      .map((file) => file.trim())
      .filter((file) => file.endsWith(".md"));
  } catch (error) {
    console.error("Failed to get changed files:", error);
    return [];
  }
}

/**
 * Read JSON safely
 */
async function readJson(filePath, fallback = {}) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

/**
 * Write JSON prettified
 */
async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await fs.writeFile(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

/**
 * Parse markdown frontmatter
 */
async function parseMarkdown(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");

  const { data } = matter(raw);

  return data;
}

/**
 * Build blog metadata object
 */
function buildBlogMetadata(frontmatter, filePath) {
  const normalizedPath = filePath
    .replace(".md", "")
    .replace(/\\/g, "/");

  const parts = normalizedPath.split("/");

  const category = parts[1];
  const subcategory = parts[2];

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    author: frontmatter.author,
    tags: frontmatter.tags || [],
    category: frontmatter.category,
    subcategory: frontmatter.subcategory,
    coverImage: frontmatter.coverImage,
    slug: frontmatter.slug,
    draft: frontmatter.draft || false,
    path: `/${normalizedPath}`,
    readingTime: frontmatter.readingTime || "5 min",
    featured: frontmatter.featured || false,

    __folderCategory: category,
    __folderSubcategory: subcategory,
  };
}

/**
 * Update category index.json
 */
async function updateCategoryIndex(blogMeta) {
  const indexPath = path.join(
    BLOGS_DIR,
    blogMeta.__folderCategory,
    blogMeta.__folderSubcategory,
    "index.json"
  );

  let indexJson = await readJson(indexPath, {
    category: blogMeta.__folderCategory,
    subcategory: blogMeta.__folderSubcategory,
    slug: blogMeta.__folderSubcategory,
    blogs: [],
  });

  indexJson.blogs = indexJson.blogs.filter(
    (blog) => blog.slug !== blogMeta.slug
  );

  indexJson.blogs.unshift({
    title: blogMeta.title,
    description: blogMeta.description,
    date: blogMeta.date,
    author: blogMeta.author,
    tags: blogMeta.tags,
    category: blogMeta.category,
    subcategory: blogMeta.subcategory,
    coverImage: blogMeta.coverImage,
    slug: blogMeta.slug,
    draft: blogMeta.draft,
    path: blogMeta.path,
    readingTime: blogMeta.readingTime,
    featured: blogMeta.featured,
  });

  await writeJson(indexPath, indexJson);

  console.log(`Updated ${indexPath}`);
}

/**
 * Update global search index
 */
async function updateSearchIndex(blogMeta) {
  let searchIndex = await readJson(SEARCH_INDEX_PATH, []);

  searchIndex = searchIndex.filter(
    (blog) => blog.slug !== blogMeta.slug
  );

  searchIndex.unshift({
    title: blogMeta.title,
    description: blogMeta.description,
    slug: blogMeta.slug,
    tags: blogMeta.tags,
    category: blogMeta.category,
    subcategory: blogMeta.subcategory,
    path: blogMeta.path,
    author: blogMeta.author,
    coverImage: blogMeta.coverImage,
  });

  await writeJson(SEARCH_INDEX_PATH, searchIndex);

  console.log("Updated search-index.json");
}

/**
 * Main runner
 */
async function run() {
  const changedFiles = getChangedMarkdownFiles();

  if (changedFiles.length === 0) {
    console.log("No markdown changes detected.");
    return;
  }

  console.log("Changed markdown files:");
  console.log(changedFiles);

  for (const file of changedFiles) {
    try {
      const frontmatter = await parseMarkdown(file);

      const blogMeta = buildBlogMetadata(frontmatter, file);

      await updateCategoryIndex(blogMeta);

      await updateSearchIndex(blogMeta);

      console.log(`Processed: ${file}`);
    } catch (error) {
      console.error(`Failed processing ${file}:`, error);
    }
  }
}

run();
