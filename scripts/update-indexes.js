import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { execSync } from "child_process";

const BLOGS_DIR = "blogs";
const SEARCH_INDEX_PATH = "generated/search-index.json";
const CATEGORIES_PATH = "blogs/categories.json";

function formatLabel(value) {
  return value
    .split("-")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Get changed markdown files
 */
function getChangedMarkdownFiles() {
  try {
    const output = execSync(
      `git diff --name-status HEAD~1 HEAD -- "blogs/**/*.md"`,
      { encoding: "utf-8" }
    );

    return output
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [status, file] = line.trim().split("\t");

        return {
          status,
          file,
        };
      });
  } catch (error) {
    console.error("Failed to detect changes:", error);
    return [];
  }
}

async function readJson(filePath, fallback = {}) {
  try {
    const data = await fs.readFile(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await fs.writeFile(
    filePath,
    JSON.stringify(data, null, 2),
    "utf-8"
  );
}

async function parseMarkdown(filePath) {
  const raw = await fs.readFile(filePath, "utf-8");
  const { data } = matter(raw);
  return data;
}

function buildBlogMetadata(frontmatter, filePath) {
  const normalizedPath = filePath
    .replace(".md", "")
    .replace(/\\/g, "/");

  const parts = normalizedPath.split("/");

  const folderCategory = parts[1];
  const folderSubcategory = parts[2];

  return {
    title: frontmatter.title,
    description: frontmatter.description,
    date: frontmatter.date,
    author: frontmatter.author,
    tags: frontmatter.tags || [],
    category: formatLabel(folderCategory),
    subcategory: formatLabel(folderSubcategory),
    coverImage: frontmatter.coverImage,
    slug: frontmatter.slug,
    draft: frontmatter.draft || false,
    path: `/${normalizedPath}`,
    readingTime: frontmatter.readingTime || "5 min",
    featured: frontmatter.featured || false,

    __folderCategory: folderCategory,
    __folderSubcategory: folderSubcategory,
  };
}

/**
 * Update categories.json
 */
async function updateCategoriesJson(blogMeta) {
  let categoriesJson = await readJson(CATEGORIES_PATH, {
    categories: [],
  });

  let category = categoriesJson.categories.find(
    c => c.slug === blogMeta.__folderCategory
  );

  if (!category) {
    category = {
      name: blogMeta.category,
      slug: blogMeta.__folderCategory,
      subcategories: [],
    };

    categoriesJson.categories.push(category);
  }

  let subcategory = category.subcategories.find(
    s => s.slug === blogMeta.__folderSubcategory
  );

  if (!subcategory) {
    category.subcategories.push({
      name: blogMeta.subcategory,
      slug: blogMeta.__folderSubcategory,
      path: `/blogs/${blogMeta.__folderCategory}/${blogMeta.__folderSubcategory}/index.json`,
    });
  }

  await writeJson(CATEGORIES_PATH, categoriesJson);

  console.log("Updated categories.json");
}

/**
 * Update local index.json
 */
async function updateCategoryIndex(blogMeta) {
  const indexPath = path.join(
    BLOGS_DIR,
    blogMeta.__folderCategory,
    blogMeta.__folderSubcategory,
    "index.json"
  );

  let indexJson = await readJson(indexPath, {
    category: blogMeta.category,
    subcategory: blogMeta.subcategory,
    slug: blogMeta.__folderSubcategory,
    blogs: [],
  });

  indexJson.blogs = indexJson.blogs.filter(
    blog => blog.slug !== blogMeta.slug
  );

  indexJson.blogs.unshift(blogMeta);

  await writeJson(indexPath, indexJson);

  console.log(`Updated ${indexPath}`);
}

/**
 * Update search-index.json
 */
async function updateSearchIndex(blogMeta) {
  let searchIndex = await readJson(SEARCH_INDEX_PATH, []);

  searchIndex = searchIndex.filter(
    blog => blog.slug !== blogMeta.slug
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
 * Remove deleted blogs
 */
async function removeDeletedBlog(filePath) {
  const slug = path.basename(filePath, ".md");

  let searchIndex = await readJson(SEARCH_INDEX_PATH, []);

  searchIndex = searchIndex.filter(
    blog => !blog.path.includes(slug)
  );

  await writeJson(SEARCH_INDEX_PATH, searchIndex);

  console.log(`Removed deleted blog: ${slug}`);
}

async function run() {
  const changes = getChangedMarkdownFiles();

  if (changes.length === 0) {
    console.log("No markdown changes detected.");
    return;
  }

  for (const change of changes) {
    const { status, file } = change;

    try {
      if (status === "D") {
        await removeDeletedBlog(file);
        continue;
      }

      const frontmatter = await parseMarkdown(file);

      const blogMeta = buildBlogMetadata(frontmatter, file);

      await updateCategoriesJson(blogMeta);

      await updateCategoryIndex(blogMeta);

      await updateSearchIndex(blogMeta);

      console.log(`Processed ${file}`);
    } catch (error) {
      console.error(`Failed processing ${file}:`, error);
    }
  }
}

run();
