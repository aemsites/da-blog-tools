# AEM Document Authoring (DA) Blog Tools

This project provides a collection of tools and plugins for implementing an AEM DA Edge Delivery Services blog project. It includes many common blocks and features a project might need.

## DA compatible

This specific repo has been _slightly_ modified to be compatible with DA's live preview.

## Blog features:
* **Publish to Date** workflow. [README](.github/workflows/README.md)
* **ID Generator** plugin. [README](tools/id/README.md)
* **Scheduler** plugin. [README](tools/scheduler/README.md)

## Getting started

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
