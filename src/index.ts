import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";
import { expandRelease } from "./expandReleaseNotes";
import { RepoRef, ReleaseInfo } from "./types";
import {
  ConfluenceAuth,
  createConfluencePage,
  extractLocalImageSources,
  fixMarkdownStylePrLinksInHtml,
  isHttpUrl,
  updateConfluencePage,
  uploadAttachment,
} from "./confluence";

function inferTagFromContext(): string | undefined {
  const { context } = github;
  if (context.eventName === "release" && (context.payload as any)?.release?.tag_name) {
    return (context.payload as any).release.tag_name;
  }
  // Fallback for tag refs
  const ref = context.ref; // e.g., refs/tags/v1.2.3
  if (ref && ref.startsWith("refs/tags/")) {
    return ref.replace("refs/tags/", "");
  }
  return undefined;
}

function interpolateTitle(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_m, key) => vars[key] ?? "");
}

async function getReleaseByTag(
  token: string,
  repo: RepoRef,
  tag: string,
): Promise<ReleaseInfo> {
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

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
    const confluenceApiToken =
      core.getInput("confluence-api-token") || process.env.CONFLUENCE_API_TOKEN || "";
    const confluenceBaseUrl =
      core.getInput("confluence-base-url") || process.env.CONFLUENCE_BASE_URL || "";
    const confluenceEmail =
      core.getInput("confluence-email") || process.env.CONFLUENCE_EMAIL || "";
    const confluenceSpaceKey =
      core.getInput("confluence-space-key") || process.env.CONFLUENCE_SPACE_KEY || "";
    const confluenceParentPageId =
      core.getInput("confluence-parent-page-id") || process.env.CONFLUENCE_PARENT_PAGE_ID || "";
    const titleTemplate =
      core.getInput("confluence-page-title-format") ||
      process.env.CONFLUENCE_PAGE_TITLE_FORMAT ||
      "Release Notes for ${tag}";

    const explicitTag = core.getInput("tag") || process.env.TAG;
    const tag = explicitTag || inferTagFromContext();
    if (!tag) {
      throw new Error(
        "No tag provided. Provide 'tag' input or trigger this action from a 'release' event.",
      );
    }
    const repo: RepoRef = { owner: github.context.repo.owner, repo: github.context.repo.repo };

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
      throw new Error(
        "Input required and not supplied: confluence-parent-page-id (or CONFLUENCE_PARENT_PAGE_ID)",
      );
    }

    core.info(`Fetching release for tag ${tag} from ${repo.owner}/${repo.repo}...`);
    const release = await getReleaseByTag(githubToken, repo, tag);
    core.info(`Found release: ${release.name}`);

    // Expand release notes: PRs, images, HTML
    const expanded = await expandRelease(githubToken, repo, release);

    // Prepare Confluence auth and content
    const auth: ConfluenceAuth = {
      baseUrl: confluenceBaseUrl,
      email: confluenceEmail,
      apiToken: confluenceApiToken,
    };
    const pageTitle = interpolateTitle(titleTemplate, {
      tag: release.tagName,
      releaseName: release.name,
    });
    let initialHtml = fixMarkdownStylePrLinksInHtml(expanded.confluenceHtml);

    core.info(
      `Creating Confluence page in space '${confluenceSpaceKey}' under parent '${confluenceParentPageId}'...`,
    );
    const created = await createConfluencePage({
      auth,
      spaceKey: confluenceSpaceKey,
      parentId: confluenceParentPageId,
      title: pageTitle,
      htmlContent: initialHtml,
    });
    const pageId: string = created?.id;
    const webui: string = created?._links?.webui || "";
    const base: string = created?._links?.base || confluenceBaseUrl;
    const url = `${base}${webui}`;
    core.setOutput("confluence-page-id", pageId);
    core.setOutput("confluence-page-url", url);
    core.info(`Page created. ID: ${pageId}`);
    if (webui) {
      core.info(`URL: ${url}`);
    }

    // Upload attachments for local images referenced by HTML
    const localSources = extractLocalImageSources(initialHtml);
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
        await uploadAttachment({
          auth,
          pageId,
          fileName: filename,
          fileBlob: blob,
        });
        core.info(`Uploaded attachment: ${filename}`);
      }
    }

    // Replace local <img> tags with Confluence attachment macros and update page
    let finalHtml = initialHtml.replace(
      /<img ([^>]*?)src="([^"]+)"([^>]*)>/gi,
      (_m, pre, src, post) => {
        if (isHttpUrl(src)) {
          return `<img ${pre}src="${src}"${post}>`;
        }
        const filename = path.basename(src);
        return `<ac:image><ri:attachment ri:filename="${filename}" /></ac:image>`;
      },
    );
    await updateConfluencePage({
      auth,
      pageId,
      title: pageTitle,
      htmlContent: finalHtml,
    });
    core.info("Page updated with attachment image macros.");
  } catch (err: any) {
    core.setFailed(err?.message ?? String(err));
  }
}

run();


