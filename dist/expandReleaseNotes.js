"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseReleaseBodyIntoCategories = parseReleaseBodyIntoCategories;
exports.downloadImageToAssets = downloadImageToAssets;
exports.expandRelease = expandRelease;
const core = __importStar(require("@actions/core"));
const marked_1 = require("marked");
const fs = __importStar(require("fs"));
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const github_1 = require("@actions/github");
function ensureDirSync(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}
function parseReleaseBodyIntoCategories(body) {
    const lines = (body || "").split("\n");
    const categories = [];
    let current = { title: "Uncategorized", prs: [] };
    for (const line of lines) {
        const catMatch = line.match(/^##\s+(.*)/);
        const prMatch = line.match(/-\s+.*\(#(\d+)\)/);
        if (catMatch) {
            if (current.prs.length)
                categories.push(current);
            current = { title: catMatch[1].trim(), prs: [] };
        }
        else if (prMatch) {
            current.prs.push({
                line: line.trim(),
                number: parseInt(prMatch[1], 10),
            });
        }
    }
    if (current.prs.length)
        categories.push(current);
    return categories;
}
function getImageExtensionFromContentType(contentType) {
    const ct = (contentType || "").toLowerCase();
    if (ct.includes("jpeg") || ct.includes("jpg"))
        return ".jpg";
    if (ct.includes("gif"))
        return ".gif";
    if (ct.includes("webp"))
        return ".webp";
    if (ct.includes("svg"))
        return ".svg";
    if (ct.includes("png"))
        return ".png";
    return ".png";
}
async function downloadImageToAssets(url, outputDir, token, index) {
    const headers = {};
    if (token) {
        headers["Authorization"] = `token ${token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
        core.warning(`Failed to download ${url}: ${res.status}`);
        return null;
    }
    const ext = getImageExtensionFromContentType(res.headers.get("content-type"));
    const filename = `image-${index}${ext}`;
    const filepath = path.join(outputDir, filename);
    const arrayBuffer = await res.arrayBuffer();
    await fsp.writeFile(filepath, Buffer.from(arrayBuffer));
    return `./assets/${filename}`;
}
function fixRelativeMarkdownImagesToRawUrls(text, repo, refSha) {
    // Convert ![alt](relative/path.png) to raw github URL
    return text.replace(/!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g, (_m, alt, p) => `![${alt}](https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${refSha}/${p})`);
}
function htmlFromMarkdown(md) {
    return marked_1.marked.parse(md);
}
async function expandRelease(octokitToken, repo, release) {
    const octokit = (0, github_1.getOctokit)(octokitToken);
    const outputDir = path.resolve(`./expanded-release-${release.tagName}`);
    const assetsDir = path.join(outputDir, "assets");
    ensureDirSync(assetsDir);
    const categories = parseReleaseBodyIntoCategories(release.body || "");
    if (!categories.length) {
        core.warning("No categories or PRs found in release notes.");
    }
    let markdownOut = `# ${release.name}\n\n`;
    let confluenceOut = ``;
    let imgIndex = 1;
    for (const category of categories) {
        core.info(`Processing category: ${category.title}`);
        markdownOut += `## ${category.title}\n`;
        confluenceOut += `<h2>${category.title}</h2>\n`;
        for (const prItem of category.prs) {
            const number = prItem.number;
            core.info(`Fetching PR #${number}...`);
            const { data: pr } = await octokit.rest.pulls.get({
                owner: repo.owner,
                repo: repo.repo,
                pull_number: number,
            });
            const mergedAt = pr.merged_at ? new Date(pr.merged_at).toLocaleDateString() : "Not merged";
            let prBody = pr.body || "_(no description provided)_";
            prBody = prBody.replace("Summary by CodeRabbit", "AI Summary");
            // Stabilize relative images to specific commit SHA
            prBody = fixRelativeMarkdownImagesToRawUrls(prBody, repo, pr.head.sha);
            // Gather image URLs from HTML <img> and markdown images
            const imgUrls = [
                ...prBody.matchAll(/<img [^>]*src="([^"]+)"[^>]*>/g),
                ...prBody.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g),
            ].map((m) => m[1]);
            for (const url of imgUrls) {
                // Download and replace with local path
                const localPath = await downloadImageToAssets(url, assetsDir, octokitToken, imgIndex);
                if (localPath) {
                    prBody = prBody.split(url).join(localPath);
                    imgIndex++;
                }
            }
            const titleWithoutPrefix = pr.title.replace(/^[^:]*:\s*/g, "");
            // Markdown details block
            markdownOut += `<details>\n<summary>${titleWithoutPrefix}</summary>\n\n`;
            markdownOut += `**Merged:** ${mergedAt} by @${pr.user?.login}\n\n`;
            markdownOut += `**PR LINK:** [#${number}](${pr.html_url})\n\n`;
            markdownOut += `${prBody}\n\n</details>\n\n`;
            // Confluence expand macro with HTML body
            const prBodyHTML = htmlFromMarkdown(prBody);
            confluenceOut += `
<ac:structured-macro ac:name="expand">
  <ac:parameter ac:name="title">${titleWithoutPrefix}</ac:parameter>
  <ac:rich-text-body>
    <p><strong>Merged:</strong> ${mergedAt} by @${pr.user?.login}</p>
    <p><strong>PR LINK:</strong> <a href="${pr.html_url}">#${number}</a></p>
    ${prBodyHTML}
  </ac:rich-text-body>
</ac:structured-macro>
`;
        }
    }
    // Persist convenience artifacts (optional usage)
    await fsp.writeFile(path.join(outputDir, `expanded-release-${release.tagName}.md`), markdownOut, "utf8");
    await fsp.writeFile(path.join(outputDir, `expanded-release-${release.tagName}.confluence.html`), confluenceOut, "utf8");
    return { markdown: markdownOut, confluenceHtml: confluenceOut, assetsDir };
}
