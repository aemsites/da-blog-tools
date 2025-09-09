# AEM Document Authoring (DA) Blog Tools

This project provides a collection of tools and plugins for implementing an AEM DA Edge Delivery Services blog project. It includes many common blocks and features a project might need.

> try them out here: [da-blog-tools](https://da.live/#/aemsites/da-blog-tools) (ask for access)

## DA compatible

This specific repo has been _slightly_ modified to be compatible with DA's live preview.

## Blog tools features:
- **Publish to Date** workflow. [README](.github/workflows/README.md)
- **ID Generator** plugin. [README](tools/id/README.md)
- **Meta ID** plugin. [README](tools/meta-id/README.md)
- **Scheduler** plugin. [README](tools/scheduler/README.md)
- **Tagger** plugin. [README](tools/tags/README.md)
- **DA Library** plugin. [README](tools/plugins/da-library/README.md)
- **Preflight** plugin. [README](tools/plugins/preflight/README.md)

### Enabling plugins:

> Site _CONFIG_ > _library_ (sheet)

| title       | path                                                                         | icon                                                        | ref | format | experience |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- | --- | ------ | ---------- |
| ID Generate | `/tools/id/generate-id.html`                                                 |
| Meta ID     | `/tools/meta-id/meta-id.html`                                                | 
| Scheduler   | `/tools/scheduler/scheduler.html`                                            | `https://da.live/blocks/edit/img/S2_icon_Calendar_20_N.svg` |     |        | dialog     |
| Tags        | `/tools/tags/tags.html`                                                      |
| DA Library  | `/tools/plugins/da-library/da-library.html?content=/docs/library/alist.json` |
| Preflight   | `/tools/plugins/preflight/preflight.html`                                    | `/tools/plugins/preflight/preflight-icon.svg` | | | fullsize-dialog|

> NOTE: you can also run these plugins without copying any code to your repo by making the path: `https://main--da-blog-tools--aemsites.aem.live/{path-to-plugin}`


## Getting started developing

### 1. Github
1. Use this template to make a new repo.
1. Install [AEM Code Sync](https://github.com/apps/aem-code-sync).

### 2. DA content
1. Browse to https://da.live/start.
2. Follow the steps.

### 3. Local development
1. Clone your new repo to your computer.
1. Install the AEM CLI using your terminal: `sudo npm install -g @adobe/aem-cli`
1. Start the AEM CLI: `aem up`.
1. Open the `{repo}` folder in your favorite code editor and buil something.
1. **Recommended:** Install common npm packages like linting and testing: `npm i`.
