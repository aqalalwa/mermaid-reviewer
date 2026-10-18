<div align="center">
  <img src="public/logo.png" alt="Mermaid Reviewer Logo" width="64" height="64" />
  <h1>Mermaid Reviewer</h1>
  <p><strong>Visual & structural diff viewer for Mermaid flowcharts with direct Azure DevOps branch comparison.</strong></p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1f8a4c.svg" alt="License: MIT" /></a>
    <img src="https://img.shields.io/badge/React-18-61dafb.svg" alt="React 18" />
    <img src="https://img.shields.io/badge/TypeScript-5-3178c6.svg" alt="TypeScript 5" />
    <img src="https://img.shields.io/badge/Mermaid-v11-ff3670.svg" alt="Mermaid v11" />
  </p>
</div>

---

## Overview

Reviewing pull requests that modify Mermaid diagrams in raw text diffs is hard—small layout or edge changes are easy to miss. **Mermaid Reviewer** parses Mermaid `flowchart` / `graph` definitions into an abstract syntax tree (AST) and highlights **Added**, **Removed**, and **Modified** nodes, shapes, edges, edge labels, and subgraphs directly on the rendered diagrams.

### Key Highlights

- **Structural AST Diff Engine**
  - Detects added (`+`), removed (`−`), and modified (`~`) nodes (label or shape changes), edges (arrow type or label changes), and subgraphs.
  - Colour-codes diagram elements directly in SVG:
    - **Added**: Green (`#1f8a4c`)
    - **Removed**: Red dashed (`#c83a32`)
    - **Modified**: Amber (`#b87414`)
- **Three Interactive Views**
  - **Split View**: Side-by-side comparison (`Base · A` vs `Compare · B`) with optional synchronized pan & zoom (`Lock pan & zoom`).
  - **Merged View**: Single unified diagram overlaying added, modified, and ghosted removed nodes/edges in one canvas.
  - **Source View**: Dual Mermaid editors with file upload (`.mmd`, `.mermaid`, `.md`, `.txt`) and a collapsible unified LCS line-diff panel.
- **Changes Inspector Sidebar**
  - Filter structural changes by `All`, `Added`, `Removed`, or `Modified`.
  - Click any node or edge in the sidebar to automatically pan, zoom, and pulse-highlight the element on the canvas.
  - Toggle **Dim unchanged** to fade unchanged diagram elements to `22%` opacity.
- **Azure DevOps Git Integration**
  - Browse Azure DevOps **Projects**, **Repositories**, **Branches**, and Mermaid files (`.mmd`, `.mermaid`, and multi-block `.md` documentation files).
  - Supports **Personal Access Tokens (PAT)**, **Microsoft Entra ID (OAuth 2.0 PKCE Single Sign-On)**, and a built-in **Demo Workspace**.
- **100% Client-Side & Privacy-First**
  - Runs entirely in your browser. Diagrams, Personal Access Tokens, and OAuth tokens are never sent to any third-party server—requests go directly from your browser to `dev.azure.com` and `login.microsoftonline.com`.

---

## Getting Started Locally

### Prerequisites

- **Node.js** `>= 18.0.0`
- **npm** `>= 9.0.0`

### Installation & Development

```bash
# 1. Clone the repository
git clone https://github.com/<your-username>/mermaid-reviewer.git
cd mermaid-reviewer

# 2. Install dependencies
npm install

# 3. Start the local development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Building for Production

```bash
# Type-check with TypeScript and bundle into dist/
npm run build

# Preview the production bundle locally
npm run preview
```

---

## Connecting to Azure DevOps

Click the **Azure DevOps** button in the top toolbar to connect. Three modes are available:

### 1. Try with Demo Data (No Account Needed)
Click **Try with demo data** in the modal footer to explore a built-in multi-project Azure DevOps workspace (`contoso-eng`) with sample `.mmd` diagrams and multi-diagram `.md` architecture docs across multiple branches.

### 2. Personal Access Token (PAT) — Zero Setup
Connect to any Azure DevOps organization immediately without registering an Entra app:
1. In Azure DevOps, open **User Settings** (top-right icon next to your avatar) → **Personal access tokens** → **+ New Token**.
2. Select your organization and grant read-only scopes:
   - **Code**: `Read`
   - **Project and Team**: `Read`
3. In **Mermaid Reviewer**, open **Azure DevOps** → **Personal Access Token**, enter your organization name (e.g. `my-org` or `https://dev.azure.com/my-org`), and paste your PAT.

### 3. Microsoft Entra ID (Single Sign-On)
Uses `@azure/msal-browser` (OAuth 2.0 Authorization Code Flow with PKCE) directly in the browser.

<details>
<summary><strong>How to register a Microsoft Entra ID SPA App (2 minutes)</strong></summary>

1. Open [Azure Portal — App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and click **+ New registration**.
2. **Name**: `Mermaid Reviewer`
3. **Supported account types**: Choose single-tenant or multitenant based on your organization.
4. **Redirect URI**: Select **Single-page application (SPA)** *(not "Web")* and enter your app URL (e.g. `http://localhost:5173` or your deployed URL).
5. Click **Register**.
6. Go to **API permissions** → **+ Add a permission** → **Azure DevOps** → **Delegated permissions** → check **`user_impersonation`** → **Add permissions**.
7. Go to **Overview** and copy:
   - **Application (client) ID** *(first GUID under Essentials—do not use Object ID)*
   - **Directory (tenant) ID**

#### Providing the Client ID & Tenant ID
- **In the Browser UI (Saved in `localStorage`)**: Open **Azure DevOps → Microsoft Entra ID → Configure Client ID**, paste your IDs, and click **Save**.
- **Via `.env` file (For local or team builds)**:
  ```bash
  cp .env.example .env
  ```
  ```env
  VITE_ADO_SSO_CLIENT_ID=your-application-client-id
  VITE_ADO_SSO_TENANT_ID=your-directory-tenant-id
  ```
- **Via URL Query Parameters**:
  ```text
  https://your-app-url/?ssoClientId=YOUR_CLIENT_ID&ssoTenantId=YOUR_TENANT_ID
  ```
</details>

---

## Deploying Your Own Instance to Azure Static Web Apps

This repository is pre-configured for one-click deployment to **Azure Static Web Apps** (Free or Standard tier) using:
- [`public/staticwebapp.config.json`](public/staticwebapp.config.json) — SPA fallback routing (`/index.html`), MIME types, and security headers.
- [`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml) — Manual (`workflow_dispatch`) GitHub Actions workflow that lets you pass your own deployment token via the Run Workflow UI or GitHub Secrets.
- [`swa-cli.config.json`](swa-cli.config.json) — Azure Static Web Apps CLI configuration.

### Step 1: Create a Free Azure Static Web App
1. Go to [Azure Portal — Create Static Web App](https://portal.azure.com/#create/Microsoft.StaticApp).
2. Choose your **Subscription**, **Resource Group**, **Name**, and select the **Free** plan.
3. Under **Deployment details → Source**, select **Other**.
4. Click **Review + create** → **Create**, then open the resource and click **Manage deployment token** in the top bar to copy your token.

### Step 2: Deploy via GitHub Actions (Fork or Clone)
1. Fork this repository to your GitHub account.
2. Go to the **Actions** tab → select **Deploy to Azure Static Web Apps** → click **Run workflow**:
   - **Option 1 (Input Prompt)**: Paste your deployment token directly into the `deployment_token` field (and optionally `sso_client_id` / `sso_tenant_id`) and click **Run workflow**.
   - **Option 2 (Repository Secrets — Recommended for Public Forks)**: Save `AZURE_STATIC_WEB_APPS_API_TOKEN` in **Settings → Secrets and variables → Actions → Secrets**, leave the `deployment_token` prompt blank, and click **Run workflow**.

### Or Deploy from Your Terminal via SWA CLI
```bash
npm run swa:deploy -- --deployment-token "<YOUR_STATIC_WEB_APP_DEPLOYMENT_TOKEN>"
```

---

## URL Query Parameters

| Parameter | Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaultView` | `split` \| `overlay` \| `source` | `split` | Initial comparison view mode |
| `syncPanZoom` | `true` \| `false` | `true` | Synchronize pan and zoom between panes in Split view |
| `dimUnchanged` | `true` \| `false` | `false` | Fade unchanged nodes and edges to `22%` opacity |
| `adoDemoOnLoad` | `true` \| `false` | `false` | Automatically load the Azure DevOps demo workspace on startup |
| `ssoClientId` | `<GUID>` | `""` | Pre-fill Microsoft Entra ID Application (client) ID |
| `ssoTenantId` | `<GUID>` \| `organizations` \| `common` | `organizations` | Pre-fill Microsoft Entra ID Directory (tenant) ID |

---

## Project Structure

```text
├── .github/
│   └── workflows/
│       └── azure-static-web-apps.yml # Manual GitHub Actions workflow for Azure Static Web Apps
├── public/
│   ├── logo.png                      # Mermaid Reviewer brand icon & favicon
│   └── staticwebapp.config.json      # Azure Static Web Apps SPA routing & headers
├── src/
│   ├── main.tsx                      # Application entry point & URL/env bootstrap
│   ├── styles.css                    # Global styles & utility classes
│   ├── types.ts                      # TypeScript interfaces for AST, diffs, and ADO API
│   ├── vite-env.d.ts                 # Vite client type declarations
│   ├── ado/
│   │   ├── adoClient.ts              # Live Azure DevOps REST API 7.1 client & MSAL SSO manager
│   │   └── demoData.ts               # Built-in sample diagrams & demo ADO repository dataset
│   ├── components/
│   │   └── MermaidDiffApp.tsx        # Main application UI, canvas, sidebar & ADO modal
│   └── parser/
│       └── flowchartDiff.ts          # Mermaid flowchart parser, AST diff engine & SVG decorator
├── .env.example                      # Sample environment variables for Entra ID SSO
├── index.html                        # HTML entry point
├── LICENSE                           # MIT License
├── package.json                      # Dependencies & scripts
├── swa-cli.config.json               # Azure Static Web Apps CLI configuration
├── tsconfig.json                     # TypeScript configuration
└── vite.config.ts                    # Vite bundler configuration
```

---

## License

Released under the [MIT License](LICENSE).
