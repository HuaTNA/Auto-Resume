import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const scanRoots = [join(root, "src"), join(root, "public", "icons", "birch")];
const allowedColors = new Set([
  "#1E1A14", "#E8E1D0", "#F5EFE0", "#FDFAF3",
  "#EBE2CC", "#B8A98A", "#9A8468", "#7A6A50",
  "#EDE7D3",
]);
const violations = [];

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)]));
  return nested.flat();
}

for (const base of scanRoots) {
  for (const file of await files(base)) {
    if (![".ts", ".tsx", ".css", ".svg"].includes(extname(file))) continue;
    const source = await readFile(file, "utf8");
    const path = relative(root, file);
    const lines = source.split("\n");
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/#[0-9a-fA-F]{6}/g)) {
        if (!allowedColors.has(match[0].toUpperCase())) violations.push(`${path}:${index + 1} color ${match[0]}`);
      }
      const hardRules = [
        [/(?:linear|radial)-gradient/, "gradient"],
        [/lucide-react|material-symbols-outlined/, "non-birch icon"],
        [/(?:bg|text|border)-(?:white|black)(?:\b|\/)/, "pure black/white utility"],
        [/font-(?:bold|semibold|extrabold|black)|font-sans/, "forbidden font weight/family"],
        [/backdrop-blur|blur-|animate-spin|rotate-|scale-/, "aggressive motion/effect"],
      ];
      for (const [pattern, label] of hardRules) if (pattern.test(line)) violations.push(`${path}:${index + 1} ${label}`);
      for (const match of line.matchAll(/rounded-\[(\d+)px\]/g)) {
        if (!new Set([4, 6, 8, 10, 12, 14, 16]).has(Number(match[1]))) violations.push(`${path}:${index + 1} radius ${match[1]}px`);
      }
      if (/rounded-full/.test(line) && !/size-1 rounded-full/.test(line)) violations.push(`${path}:${index + 1} pill radius`);
      if (extname(file) === ".svg" && /\bstroke=/.test(line)) violations.push(`${path}:${index + 1} outlined SVG`);
    });
  }
}

if (violations.length) {
  console.error(`Hua UI check failed (${violations.length})\n${violations.join("\n")}`);
  process.exit(1);
}

console.log("Hua UI check passed");
