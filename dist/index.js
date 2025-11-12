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
const core = __importStar(require("@actions/core"));
const github = __importStar(require("@actions/github"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const expandReleaseNotes_1 = require("./expandReleaseNotes");
const confluence_1 = require("./confluence");
function inferTagFromContext() {
    const { context } = github;
    if (context.eventName === "release" && context.payload?.release?.tag_name) {
        return context.payload.release.tag_name;
    }
    // Fallback for tag refs
    const ref = context.ref; // e.g., refs/tags/v1.2.3
    if (ref && ref.startsWith("refs/tags/")) {
        return ref.replace("refs/tags/", "");
    }
    return undefined;
}
function interpolateTitle(template, vars) {
    return template.replace(/\$\{(\w+)\}/g, (_m, key) => vars[key] ?? "");
}
async function getReleaseByTag(token, repo, tag) {
    const octokit = github.getOctokit(token);
    const { data: rel } = await octokit.rest.repos.getReleaseByTag({
        owner: repo.owner,
        repo: repo.repo,
        tag,
    });
    return {
        name: rel.name || rel.tag_name || tag,
        tagName: rel.tag_name || tag,
        body: rel.body || "",
    };
}
async function run() {
    try {
        const githubToken = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
        const confluenceApiToken = core.getInput("confluence-api-token") || process.env.CONFLUENCE_API_TOKEN || "";
        const confluenceBaseUrl = core.getInput("confluence-base-url") || process.env.CONFLUENCE_BASE_URL || "";
        const confluenceEmail = core.getInput("confluence-email") || process.env.CONFLUENCE_EMAIL || "";
        const confluenceSpaceKey = core.getInput("confluence-space-key") || process.env.CONFLUENCE_SPACE_KEY || "";
        const confluenceParentPageId = core.getInput("confluence-parent-page-id") || process.env.CONFLUENCE_PARENT_PAGE_ID || "";
        const titleTemplate = core.getInput("confluence-page-title-format") ||
            process.env.CONFLUENCE_PAGE_TITLE_FORMAT ||
            "Release Notes for ${tag}";
        const explicitTag = core.getInput("tag") || process.env.TAG;
        const tag = explicitTag || inferTagFromContext();
        if (!tag) {
            throw new Error("No tag provided. Provide 'tag' input or trigger this action from a 'release' event.");
        }
        const repo = { owner: github.context.repo.owner, repo: github.context.repo.repo };
        // Validate required inputs after env fallbacks
        if (!confluenceApiToken) {
            throw new Error("Input required and not supplied: confluence-api-token (or CONFLUENCE_API_TOKEN)");
        }
        if (!confluenceBaseUrl) {
            throw new Error("Input required and not supplied: confluence-base-url (or CONFLUENCE_BASE_URL)");
        }
        if (!confluenceEmail) {
            throw new Error("Input required and not supplied: confluence-email (or CONFLUENCE_EMAIL)");
        }
        if (!confluenceSpaceKey) {
            throw new Error("Input required and not supplied: confluence-space-key (or CONFLUENCE_SPACE_KEY)");
        }
        if (!confluenceParentPageId) {
            throw new Error("Input required and not supplied: confluence-parent-page-id (or CONFLUENCE_PARENT_PAGE_ID)");
        }
        core.info(`Fetching release for tag ${tag} from ${repo.owner}/${repo.repo}...`);
        const release = await getReleaseByTag(githubToken, repo, tag);
        core.info(`Found release: ${release.name}`);
        // Expand release notes: PRs, images, HTML
        const expanded = await (0, expandReleaseNotes_1.expandRelease)(githubToken, repo, release);
        // Prepare Confluence auth and content
        const auth = {
            baseUrl: confluenceBaseUrl,
            email: confluenceEmail,
            apiToken: confluenceApiToken,
        };
        const pageTitle = interpolateTitle(titleTemplate, {
            tag: release.tagName,
            releaseName: release.name,
        });
        let initialHtml = (0, confluence_1.fixMarkdownStylePrLinksInHtml)(expanded.confluenceHtml);
        core.info(`Creating Confluence page in space '${confluenceSpaceKey}' under parent '${confluenceParentPageId}'...`);
        const created = await (0, confluence_1.createConfluencePage)({
            auth,
            spaceKey: confluenceSpaceKey,
            parentId: confluenceParentPageId,
            title: pageTitle,
            htmlContent: initialHtml,
        });
        const pageId = created?.id;
        const webui = created?._links?.webui || "";
        const base = created?._links?.base || confluenceBaseUrl;
        const url = `${base}${webui}`;
        core.setOutput("confluence-page-id", pageId);
        core.setOutput("confluence-page-url", url);
        core.info(`Page created. ID: ${pageId}`);
        if (webui) {
            core.info(`URL: ${url}`);
        }
        // Upload attachments for local images referenced by HTML
        const localSources = (0, confluence_1.extractLocalImageSources)(initialHtml);
        if (localSources.length) {
            core.info(`Uploading ${localSources.length} local image(s) as attachments...`);
            for (const src of localSources) {
                const filename = path.basename(src);
                const absoluteImagePath = path.resolve(`./expanded-release-${release.tagName}`, src);
                if (!fs.existsSync(absoluteImagePath)) {
                    core.warning(`Image not found on disk, skipping: ${absoluteImagePath}`);
                    continue;
                }
                const blob = new Blob([fs.readFileSync(absoluteImagePath)]);
                await (0, confluence_1.uploadAttachment)({
                    auth,
                    pageId,
                    fileName: filename,
                    fileBlob: blob,
                });
                core.info(`Uploaded attachment: ${filename}`);
            }
        }
        // Replace local <img> tags with Confluence attachment macros and update page
        let finalHtml = initialHtml.replace(/<img ([^>]*?)src="([^"]+)"([^>]*)>/gi, (_m, pre, src, post) => {
            if ((0, confluence_1.isHttpUrl)(src)) {
                return `<img ${pre}src="${src}"${post}>`;
            }
            const filename = path.basename(src);
            return `<ac:image><ri:attachment ri:filename="${filename}" /></ac:image>`;
        });
        await (0, confluence_1.updateConfluencePage)({
            auth,
            pageId,
            title: pageTitle,
            htmlContent: finalHtml,
        });
        core.info("Page updated with attachment image macros.");
    }
    catch (err) {
        core.setFailed(err?.message ?? String(err));
    }
}
run();
