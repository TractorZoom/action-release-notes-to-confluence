## Release Notes To Confluence (GitHub Action)

Converts Release Drafter-styled GitHub release notes for a tag into Confluence storage-format HTML, expands PR details (including images), and publishes under a specified parent page. Images from PR bodies are downloaded, attached to the page, and inlined using Confluence attachment macros.

### Features
- Expand release notes by PR, including PR body and images
- Generate Confluence storage-format HTML with Expand macros per PR
- Create a Confluence page under a given parent page ID
- Upload local images as attachments and replace `<img>` tags with attachment macros
- Works on `release.published` or via manual `workflow_dispatch`

### Usage (Workflow)

```yaml
# yaml-language-server: $schema=https://json.schemastore.org/github-workflow.json
name: Release Notes To Confluence

on:
  release:
    types: [published]
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag (e.g. v1.2.3) to publish"
        required: true
        type: string

jobs:
  release-notes-to-confluence:
    name: Release Notes To Confluence
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./
        with:
          tag: ${{ inputs.tag || github.event.release.tag_name }}
          confluence-api-token: ${{ secrets.CONFLUENCE_API_TOKEN }}
          confluence-base-url: ${{ secrets.CONFLUENCE_BASE_URL }}
          confluence-email: ${{ secrets.CONFLUENCE_EMAIL }}
          confluence-space-key: ${{ secrets.CONFLUENCE_SPACE_KEY }}
          confluence-parent-page-id: ${{ secrets.CONFLUENCE_PARENT_PAGE_ID }}
          confluence-page-title-format: 'Release Notes for ${tag}'
```

Notes:
- If `tag` is omitted, the action infers it from the `release` event payload.
- Outputs:
  - `confluence-page-id`
  - `confluence-page-url`

### Inputs
- `tag`: Release tag (optional when triggered by release event)
- `github-token`: GitHub token (defaults to `github.token`)
- `confluence-api-token` (required)
- `confluence-base-url` (required) e.g. `https://your-domain.atlassian.net/wiki`
- `confluence-email` (required)
- `confluence-space-key` (required)
- `confluence-parent-page-id` (required)
- `confluence-page-title-format` (optional) supports `${tag}` and `${releaseName}`

### Development
This action is implemented in TypeScript and targets Node 20. Build artifacts are emitted to `dist/`.

Commands:
- Install: `yarn` [[memory:6394627]]
- Build: `yarn build`
- Dev (watch): `yarn dev`

### Local testing
You can run the action locally with a helper script:

1) Copy `examples/env.local.example` to `.env.local` and fill values (GitHub PAT, Confluence creds, repo owner/name, tag).
2) Build once:
   - `yarn build` [[memory:6394627]]
3) Run:
   - `yarn local -- --owner your-github-owner --repo your-repo --tag v1.2.3`

Notes:
- The script maps inputs to env vars like the GitHub runner (e.g., `INPUT_CONFLUENCE_API_TOKEN`).
- If you pass `--tag`, it overrides the `TAG` value in `.env.local`.
- All required inputs also fall back to environment variables:
  - `CONFLUENCE_API_TOKEN`, `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`,
    `CONFLUENCE_SPACE_KEY`, `CONFLUENCE_PARENT_PAGE_ID`, and optional `CONFLUENCE_PAGE_TITLE_FORMAT`.
- Outputs `confluence-page-id` and `confluence-page-url` in the action logs.

### How it works
1. Fetches the release by tag and parses categories and PR references from Release Drafter output (`- ... (#123)`).
2. Fetches each PR body, normalizes relative image links to the PR commit SHA, downloads images, and rewrites references to local `./assets/...` paths.
3. Produces Confluence storage-format HTML using Expand macros per PR.
4. Creates a Confluence page under the provided parent ID.
5. Uploads local images as page attachments and updates the page to use Confluence attachment macros for inline rendering.


