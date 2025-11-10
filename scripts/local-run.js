// Local runner to execute the GitHub Action outside of GitHub.
// Usage:
//  1) Copy .env.example to .env (or .env.local) and fill values
//  2) yarn build
//  3) yarn local

const fs = require("fs");
const path = require("path");

// Load env from .env.local (if exists) then .env
try {
  require("dotenv").config({ path: path.resolve(".env.local") });
} catch {}
try {
  require("dotenv").config();
} catch {}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith("--")) {
      const value = argv[i + 1];
      args[key.slice(2)] = value;
      i++;
    }
  }
  return args;
}

function setInput(name, value) {
  if (value == null || value === "") return;
  // GitHub Actions' @actions/core getInput reads INPUT_<NAME> where NAME is uppercased
  // and only spaces are replaced with underscores. Hyphens are preserved.
  // To be safe, set both variants.
  const upper = name.toUpperCase();
  const hyphenVariant = `INPUT_${upper}`; // e.g., INPUT_CONFLUENCE-API-TOKEN
  const underscoreVariant = `INPUT_${upper.replace(/[- ]/g, "_")}`; // e.g., INPUT_CONFLUENCE_API_TOKEN
  process.env[hyphenVariant] = value;
  process.env[underscoreVariant] = value;
}

(async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Required context for @actions/github
  const owner = args.owner || process.env.OWNER;
  const repo = args.repo || process.env.REPO;

  console.log("owner", owner);
  console.log("repo", repo);

  if (!owner || !repo) {
    console.error("Missing owner/repo. Provide --owner <owner> --repo <repo> or set OWNER/REPO in .env.");
    process.exit(1);
  }
  process.env.GITHUB_REPOSITORY = `${owner}/${repo}`;

  // Tokens
  if (!process.env.GITHUB_TOKEN) {
    console.warn("No GITHUB_TOKEN set. Set a PAT in .env for local testing.");
  }

  console.log("confluence-api-token", process.env.CONFLUENCE_API_TOKEN);

  // Map action inputs to env
  setInput("tag", args.tag || process.env.TAG);
  setInput("github-token", process.env.GITHUB_TOKEN);
  setInput("confluence-api-token", process.env.CONFLUENCE_API_TOKEN);
  setInput("confluence-base-url", process.env.CONFLUENCE_BASE_URL);
  setInput("confluence-email", process.env.CONFLUENCE_EMAIL);
  setInput("confluence-space-key", process.env.CONFLUENCE_SPACE_KEY);
  setInput("confluence-parent-page-id", process.env.CONFLUENCE_PARENT_PAGE_ID);
  setInput("confluence-page-title-format", process.env.CONFLUENCE_PAGE_TITLE_FORMAT || "Release Notes for ${tag}");

  const distEntry = path.resolve(__dirname, "../dist/index.js");
  if (!fs.existsSync(distEntry)) {
    console.error("dist/index.js not found. Run `yarn build` first.");
    process.exit(1);
  }

  // Execute the action's entrypoint
  require(distEntry);
})(); 


