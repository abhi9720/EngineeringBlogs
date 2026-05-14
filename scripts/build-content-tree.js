import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

const BLOGS_DIR = "blogs";
const CONTENT_TREE_PATH = "generated/content-tree.json";
const SEARCH_INDEX_PATH = "generated/search-index.json";

function stripNumericPrefix(name) {
  return name.replace(/^\d+-/, "");
}

function formatLabel(name) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function slugFromPath(filePath) {
  return path.basename(filePath).replace(/\.md$/, "").replace(/^\d+[\.\s-]+/, "");
}

function getNodePath(dirPath) {
  return "/" + dirPath.replace(/\\/g, "/");
}

function priority(blog) {
  return blog.type === "comparison" ? 1 : 0;
}

function blogSort(a, b) {
  const pa = priority(a);
  const pb = priority(b);
  if (pa !== pb) return pa - pb;
  if (a.order !== b.order) return a.order - b.order;
  return a.title.localeCompare(b.title);
}

function categorySort(a, b) {
  return a.id.localeCompare(b.id);
}

async function readMdFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const mdFiles = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md") && !entry.name.startsWith("index.")) {
      mdFiles.push(path.join(dir, entry.name));
    }
  }

  return mdFiles;
}

async function readSubdirectories(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const subdirs = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      subdirs.push(path.join(dir, entry.name));
    }
  }

  return subdirs.sort();
}

async function hasMdFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.some((e) => e.isFile() && e.name.endsWith(".md"));
}

async function buildTree(dirPath) {
  const dirName = path.basename(dirPath);
  const displayName = stripNumericPrefix(dirName);

  const node = {
    id: dirName,
    kind: "category",
    name: formatLabel(displayName),
    path: getNodePath(dirPath),
    blogs: [],
    categories: [],
  };

  // Read blogs from this directory
  const mdFiles = await readMdFiles(dirPath);
  for (const file of mdFiles) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const { data } = matter(raw);

      if (data.draft) continue;

      const normalizedPath = file.replace(/\\/g, "/").replace(/\.md$/, "");
      const slug = slugFromPath(file);

      node.blogs.push({
        id: slug,
        kind: "blog",
        title: data.title || slug,
        description: data.description || "",
        date: data.date || "",
        author: data.author || "",
        tags: data.tags || [],
        coverImage: data.coverImage || "",
        draft: data.draft || false,
        type: data.type || "tutorial",
        order: data.order !== undefined ? data.order : 999,
        path: `/${normalizedPath}`,
        file: file.replace(/\\/g, "/"),
      });
    } catch (e) {
      console.error(`  [SKIP] Could not parse ${file}: ${e.message}`);
    }
  }

  // Sort blogs: comparison last, then order, then title
  node.blogs.sort(blogSort);

  // Recursively build subcategories
  const subdirs = await readSubdirectories(dirPath);
  for (const subdir of subdirs) {
    const childNode = await buildTree(subdir);
    if (childNode) {
      node.categories.push(childNode);
    }
  }

  // Sort categories by name (numeric prefix handles logical order)
  node.categories.sort(categorySort);

  // Return null only if completely empty
  if (node.blogs.length === 0 && node.categories.length === 0) {
    return null;
  }

  return node;
}

function flattenTree(node, depth = 0) {
  const entries = [];

  if (node.kind === "category") {
    for (const blog of node.blogs) {
      entries.push({
        title: blog.title,
        description: blog.description,
        path: blog.path,
        tags: blog.tags,
        type: blog.type,
        date: blog.date,
        category: node.path.split("/").filter(Boolean).slice(1)[0] || "",
      });
    }
    for (const cat of node.categories) {
      entries.push(...flattenTree(cat, depth + 1));
    }
  }

  return entries;
}

async function run() {
  console.log("Building content tree...");

  const tree = await buildTree(BLOGS_DIR);
  if (!tree) {
    console.error("ERROR: No content found in blogs/");
    process.exit(1);
  }

  console.log(`  Categories: ${countCategories(tree)}`);
  console.log(`  Blogs: ${countBlogs(tree)}`);

  // Write content-tree.json
  await fs.mkdir(path.dirname(CONTENT_TREE_PATH), { recursive: true });
  await fs.writeFile(CONTENT_TREE_PATH, JSON.stringify(tree, null, 2));
  console.log(`  Written: ${CONTENT_TREE_PATH}`);

  // Build and write search-index.json (with retry for Windows locking)
  const searchIndex = flattenTree(tree);
  const searchJson = JSON.stringify(searchIndex, null, 2);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.writeFile(SEARCH_INDEX_PATH, searchJson);
      break;
    } catch (e) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 500));
      } else {
        throw e;
      }
    }
  }
  console.log(`  Written: ${SEARCH_INDEX_PATH} (${searchIndex.length} entries)`);

  console.log("\n✅ Content tree generated.");
}

function countBlogs(node) {
  if (node.kind !== "category") return 0;
  let count = node.blogs.length;
  for (const cat of node.categories) {
    count += countBlogs(cat);
  }
  return count;
}

function countCategories(node) {
  if (node.kind !== "category") return 0;
  let count = 1;
  for (const cat of node.categories) {
    count += countCategories(cat);
  }
  return count;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
