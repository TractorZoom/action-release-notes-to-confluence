"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createConfluencePage = createConfluencePage;
exports.getCurrentVersion = getCurrentVersion;
exports.updateConfluencePage = updateConfluencePage;
exports.isHttpUrl = isHttpUrl;
exports.fixMarkdownStylePrLinksInHtml = fixMarkdownStylePrLinksInHtml;
exports.extractLocalImageSources = extractLocalImageSources;
exports.uploadAttachment = uploadAttachment;
async function createConfluencePage(params) {
    const { auth, spaceKey, parentId, title, htmlContent } = params;
    const endpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content`;
    const payload = {
        type: "page",
        title,
        space: { key: spaceKey },
        ancestors: [{ id: String(parentId) }],
        body: {
            storage: {
                value: htmlContent,
                representation: "storage",
            },
        },
    };
    const basic = Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64");
    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${basic}`,
            Accept: "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Confluence API error ${res.status}: ${text}`);
    }
    return res.json();
}
async function getCurrentVersion(auth, pageId) {
    const endpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content/${pageId}?expand=version`;
    const basic = Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64");
    const res = await fetch(endpoint, {
        headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Failed to fetch current version: ${res.status} ${t}`);
    }
    const data = await res.json();
    return data?.version?.number || 1;
}
async function updateConfluencePage(params) {
    const { auth, pageId, title, htmlContent } = params;
    const currentVersion = await getCurrentVersion(auth, pageId);
    const endpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content/${pageId}`;
    const basic = Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64");
    const payload = {
        id: String(pageId),
        type: "page",
        title,
        version: { number: currentVersion + 1 },
        body: {
            storage: {
                value: htmlContent,
                representation: "storage",
            },
        },
    };
    const res = await fetch(endpoint, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${basic}`,
            Accept: "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const t = await res.text();
        throw new Error(`Failed to update page HTML: ${res.status} ${t}`);
    }
    return res.json();
}
function isHttpUrl(u) {
    return /^https?:\/\//i.test(u);
}
function fixMarkdownStylePrLinksInHtml(html) {
    // Convert markdown-style PR links like [#123](https://...) to anchors
    return html.replace(/\[(#[0-9]+)\]\((https?:\/\/[^)]+)\)/g, (_m, text, url) => {
        return `<a href="${url}">${text}</a>`;
    });
}
function extractLocalImageSources(html) {
    const sources = new Set();
    const imgRegex = /<img [^>]*src="([^"]+)"[^>]*>/gi;
    let match;
    while ((match = imgRegex.exec(html)) !== null) {
        const src = match[1];
        if (!isHttpUrl(src)) {
            sources.add(src);
        }
    }
    return Array.from(sources);
}
async function uploadAttachment(params) {
    const { auth, pageId, fileName, fileBlob } = params;
    const endpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content/${pageId}/child/attachment`;
    const basic = Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64");
    const form = new FormData();
    form.append("file", fileBlob, fileName);
    const res = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/json",
            "X-Atlassian-Token": "no-check",
        },
        body: form,
    });
    if (res.ok) {
        return res.json();
    }
    // If attachment exists, update it
    const getEndpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(fileName)}`;
    const getRes = await fetch(getEndpoint, {
        headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });
    if (!getRes.ok) {
        const t = await getRes.text();
        throw new Error(`Failed to lookup attachment '${fileName}': ${getRes.status} ${t}`);
    }
    const data = await getRes.json();
    const existing = data?.results?.[0];
    if (!existing?.id) {
        const text = await res.text();
        throw new Error(`Failed to upload attachment '${fileName}': ${res.status} ${text}`);
    }
    const updateEndpoint = `${auth.baseUrl.replace(/\/$/, "")}/rest/api/content/${pageId}/child/attachment/${existing.id}/data`;
    const form2 = new FormData();
    form2.append("file", fileBlob, fileName);
    const updRes = await fetch(updateEndpoint, {
        method: "POST",
        headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/json",
            "X-Atlassian-Token": "no-check",
        },
        body: form2,
    });
    if (!updRes.ok) {
        const t = await updRes.text();
        throw new Error(`Failed to update attachment '${fileName}': ${updRes.status} ${t}`);
    }
    return updRes.json();
}
