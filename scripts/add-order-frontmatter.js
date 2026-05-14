import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";

const BLOGS_DIR = "blogs";
const DRY_RUN = process.argv.includes("--dry-run");
const BLOG_ORDER_GAP = 10;
const COMPARISON_ORDER_START = 100;
const COMPARISON_ORDER_GAP = 10;
const DEFAULT_ORDER = 999;

let dryRunSummary = { filesToUpdate: 0, filesToMove: 0, comparisonDetected: 0 };

function isComparisonBlog(data, filename) {
  if (data.type === "comparison") return true;
  const title = (data.title || filename).toLowerCase();
  return title.includes(" vs ") || title.includes("vs ");
}

async function getAllMarkdownFiles(dir) {
  let results = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await getAllMarkdownFiles(full)));
    } else if (entry.name.endsWith(".md") && entry.name !== "index.md" && !entry.name.startsWith("index.")) {
      results.push(full);
    }
  }
  return results;
}

async function processDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md" && !e.name.startsWith("index."))
    .map((e) => ({ name: e.name, fullPath: path.join(dir, e.name) }));

  if (mdFiles.length === 0) return;

  // Read all frontmatter first to classify
  const withMeta = [];
  for (const f of mdFiles) {
    try {
      const raw = await fs.readFile(f.fullPath, "utf-8");
      const { data } = matter(raw);
      const isComparison = isComparisonBlog(data, f.name);
      withMeta.push({ ...f, raw, data, isComparison, hasExistingOrder: data.order !== undefined && data.order !== null });
    } catch (e) {
      console.error(`  [SKIP] Could not parse ${f.fullPath}: ${e.message}`);
    }
  }

  // Separate normal vs comparison
  const normal = withMeta.filter((m) => !m.isComparison).sort((a, b) => a.name.localeCompare(b.name));
  const comparison = withMeta.filter((m) => m.isComparison).sort((a, b) => a.name.localeCompare(b.name));

  // Assign orders
  let order = BLOG_ORDER_GAP;
  for (const m of normal) {
    if (!m.hasExistingOrder) {
      m.newOrder = order;
      order += BLOG_ORDER_GAP;
    }
  }

  order = COMPARISON_ORDER_START;
  for (const m of comparison) {
    if (!m.hasExistingOrder) {
      m.newOrder = order;
      order += COMPARISON_ORDER_GAP;
    }
  }

  // Apply changes
  for (const m of withMeta) {
    const changes = {};

    if (!m.hasExistingOrder) {
      changes.order = m.newOrder;
    }

    if (m.isComparison && m.data.type !== "comparison") {
      changes.type = "comparison";
    }

    if (Object.keys(changes).length === 0) continue;

    dryRunSummary.filesToUpdate++;

    if (m.isComparison && !m.hasExistingOrder) {
      dryRunSummary.comparisonDetected++;
    }

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] ${path.relative(BLOGS_DIR, m.fullPath)}`);
      for (const [k, v] of Object.entries(changes)) {
        console.log(`    add ${k}: ${v}`);
      }
    } else {
      // Inject changes into frontmatter
      const updated = matter.stringify(m.raw.replace(/^---[\s\S]*?---\n*/, ""), {
        ...m.data,
        ...changes,
      });
      await fs.writeFile(m.fullPath, updated, "utf-8");
    }
  }
}

async function moveKotlinBlog() {
  const src = path.join(BLOGS_DIR, "backend", "programming", "java", "core-java", "kotlin-for-backend.md");
  const dstDir = path.join(BLOGS_DIR, "backend", "frameworks");
  const dst = path.join(dstDir, "kotlin-for-backend.md");

  const exists = await fs.stat(src).then(() => true).catch(() => false);
  if (!exists) {
    console.log("  [SKIP] kotlin-for-backend.md not found at source path");
    return;
  }

  dryRunSummary.filesToMove++;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Move kotlin-for-backend.md`);
    console.log(`    from: ${src}`);
    console.log(`    to:   ${dst}`);
  } else {
    await fs.mkdir(dstDir, { recursive: true });
    await fs.rename(src, dst);
    console.log("  [MOVE] kotlin-for-backend.md → frameworks/");
  }
}

async function processDirectoryTree(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const full = path.join(dirPath, entry.name);
      await processDirectory(full);
      await processDirectoryTree(full);
    }
  }
}

async function run() {
  console.log(DRY_RUN ? "=== DRY RUN MODE ===" : "=== LIVE MIGRATION ===");
  console.log("");

  // Phase 1: Process all directories recursively for frontmatter
  console.log("Phase 1: Adding order + type to frontmatter...");
  await processDirectoryTree(BLOGS_DIR);
  console.log("");

  // Phase 2: Move kotlin-for-backend.md
  console.log("Phase 2: Moving kotlin-for-backend.md...");
  await moveKotlinBlog();
  console.log("");

  // Summary
  console.log("=== SUMMARY ===");
  console.log(`  Files to update / updated: ${dryRunSummary.filesToUpdate}`);
  console.log(`  Comparison blogs detected: ${dryRunSummary.comparisonDetected}`);
  console.log(`  Files to move / moved:     ${dryRunSummary.filesToMove}`);
  console.log(`  Mode:                      ${DRY_RUN ? "DRY RUN (no changes written)" : "LIVE"}`);

  if (!DRY_RUN) {
    console.log("\n✅ Migration complete.");
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
