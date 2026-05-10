import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Ajv from "ajv";

const ajv = new Ajv();

// Load schema
const schema = JSON.parse(
  fs.readFileSync("blog-schema.json", "utf-8")
);

const validate = ajv.compile(schema);

/**
 * Get all markdown files recursively
 */
function getAllMarkdownFiles(dir) {
  let results = [];

  const list = fs.readdirSync(dir);

  list.forEach((file) => {
    const filePath = path.join(dir, file);

    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      results = results.concat(getAllMarkdownFiles(filePath));
    } else if (file.endsWith(".md")) {
      results.push(filePath);
    }
  });

  return results;
}

const files = getAllMarkdownFiles("blogs");

let hasError = false;

files.forEach((file) => {
  const content = fs.readFileSync(file, "utf-8");

  const parsed = matter(content);

  const data = parsed.data;

  const valid = validate(data);

  if (!valid) {
    console.log(`❌ Validation failed in: ${file}`);
    console.log(validate.errors);
    hasError = true;
  } else {
    console.log(`✅ Valid: ${file}`);
  }
});

if (hasError) {
  process.exit(1);
}

console.log("🎉 All blogs are valid!");
