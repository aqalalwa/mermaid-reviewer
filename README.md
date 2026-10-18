# Mermaid Reviewer

An interactive visual and structural diff viewer for **Mermaid flowcharts**, built with **React**, **TypeScript**, **Vite**, and **Mermaid v11**, featuring direct **Azure DevOps** repository integration.

---

## Features

- **Structural Flowchart Diffing**: Parses Mermaid `flowchart` / `graph` definitions into nodes, shapes, edges, edge labels, and subgraphs to detect **Added**, **Removed**, **Modified**, and **Unchanged** elements.
- **Three Comparison Modes**:
  - **Split View**: Side-by-side rendered SVG comparison (`Base · A` vs `Compare · B`) with optional synchronized pan & zoom.
  - **Merged View**: Single unified diagram overlaying added, removed (dashed ghost nodes/edges), and modified elements.
  - **Source View**: Live Mermaid code editors for both diagrams alongside a collapsible LCS unified line-diff panel.
- **Interactive Changes Sidebar**: Filter changes by `All`, `Nodes`, `Edges`, or `Subgraphs`, and click any change item to pan, zoom, and pulse-highlight the corresponding SVG element.
- **Azure DevOps Integration**:
  - Compare `.mmd`, `.mermaid`, and `.md` (with multi-block Mermaid fence picker) files directly across branches in Azure DevOps Git repositories.
  - Supports **Microsoft Entra ID (OAuth 2.0 PKCE SSO)**, **Personal Access Token (PAT)**, and a built-in **Demo Workspace**.

---

## Prerequisites

- **Node.js** `>= 18.0.0`
- **npm** `>= 9.0.0`

---

## Quick Start

### 1. Install Dependencies

From the project root (`c:\MySpace\mermaid`):

```bash
npm install
```

### 2. Start the Development Server

```bash
npm run dev
```

Vite will start the local dev server (typically at `http://localhost:5173`). Open the URL in your browser.

### 3. Build for Production

To run the TypeScript compiler check (`tsc -b`) and bundle the production assets into `dist/`:

```bash
npm run build
```

To preview the production build locally:

```bash
npm run preview
```

---

## Connecting to Azure DevOps

Click the **Azure DevOps** button in the top-left toolbar to open the connection modal. Three connection modes are available:

### 1. Try with Demo Data (No Account Needed)
Click **Try with demo data** in the modal footer to load a simulated multi-project Azure DevOps organization (`contoso-eng`) with multiple repositories, branches, `.mmd` files, and multi-diagram `.md` architecture docs.

### 2. Personal Access Token (PAT)
1. In Azure DevOps, go to **User Settings** (top right) → **Personal access tokens** → **+ New Token**.
2. Select your organization and grant at least:
   - **Code**: `Read`
   - **Project and Team**: `Read`
3. In the app's **Personal Access Token** tab, enter your **Organization** (e.g., `my-org`, `https://dev.azure.com/my-org`, or `https://my-org.visualstudio.com`) and paste your PAT.

### 3. Microsoft Entra ID (Single Sign-On)
Microsoft Entra ID SSO uses `@azure/msal-browser` (OAuth 2.0 Authorization Code Flow with PKCE) directly from the browser—no backend secret required.

#### Azure App Registration Setup
1. Open the [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **+ New registration**.
2. Enter a name (e.g., `Mermaid Diff Tool`).
3. Under **Redirect URI**, select **Single-page application (SPA)** and enter your app's origin (e.g., `http://localhost:5173`).
4. Once created, go to **API permissions** → **+ Add a permission** → **Azure DevOps** → **Delegated permissions** → check `user_impersonation` → **Add permissions**.
5. Copy the **Application (client) ID** and **Directory (tenant) ID** from the **Overview** blade.

#### Configuring the Client ID in the App
You can provide your Entra App Registration details in any of three ways:

- **Option A — In-App UI**: Open the **Azure DevOps** modal → **Microsoft Entra ID** tab → click **Configure Client ID** (or **Edit App Registration**), enter your Client ID and Tenant ID, and click **Save**. Settings are persisted in `localStorage`.
- **Option B — Environment Variables**: Copy `.env.example` to `.env` and set your values:
  ```bash
  cp .env.example .env
  ```
  ```env
  VITE_ADO_SSO_CLIENT_ID=00000000-0000-0000-0000-000000000000
  VITE_ADO_SSO_TENANT_ID=organizations
  ```
- **Option C — URL Query Parameters**:
  ```text
  http://localhost:5173/?ssoClientId=YOUR_CLIENT_ID&ssoTenantId=organizations
  ```

---

## Deploying to Azure Static Web Apps (from GitHub)

This project includes pre-configured Azure Static Web Apps files:
- [`public/staticwebapp.config.json`](public/staticwebapp.config.json) — SPA fallback routing (`/index.html`), MIME types, and security headers (copied into `dist/` on build).
- [`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml) — GitHub Actions CI/CD workflow (supports both `main` branch production deploys and automatic Pull Request preview environments).
- [`swa-cli.config.json`](swa-cli.config.json) — Configuration for the Azure Static Web Apps CLI.

### Option A: Connect Your GitHub Repo Directly in the Azure Portal
1. Push this repository to **GitHub**.
2. Go to the [Azure Portal — Create Static Web App](https://portal.azure.com/#create/Microsoft.StaticApp).
3. Choose your **Subscription**, **Resource Group**, **Name** (e.g., `mermaid-diff-tool`), and **Plan type** (`Free` or `Standard`).
4. Under **Deployment details**:
   - Select **GitHub** and sign in to your GitHub account.
   - Select your **Organization**, **Repository**, and **Branch** (`main`).
   - Under **Build Details**, choose **React** (or **Custom**) with:
     - **App location**: `/`
     - **Api location**: *(leave blank)*
     - **Output location**: `dist`
5. Click **Review + create** → **Create**.

### Option B: Use the Included GitHub Actions Workflow ([`.github/workflows/azure-static-web-apps.yml`](.github/workflows/azure-static-web-apps.yml))
If you created the Static Web App with Deployment Source set to **Other** (or want to use the existing workflow file in this repo):
1. In the Azure Portal, open your Static Web App → click **Manage deployment token** in the top bar → copy the token.
2. In your GitHub repository, go to **Settings** → **Secrets and variables** → **Actions**:
   - Under the **Secrets** tab, click **New repository secret**:
     - Name: `AZURE_STATIC_WEB_APPS_API_TOKEN`
     - Value: paste your deployment token.
   - Under the **Variables** tab *(optional, for Microsoft Entra ID SSO)*, click **New repository variable**:
     - `VITE_ADO_SSO_CLIENT_ID`: your Entra ID Application (client) ID.
     - `VITE_ADO_SSO_TENANT_ID`: your Entra ID Directory (tenant) ID (or `organizations`).
3. Push to `main`—GitHub Actions will automatically build and deploy the app.

### Option C: Deploy Directly from Your Terminal (SWA CLI)
You can also deploy straight from your machine without waiting for CI:
```bash
npm run swa:deploy -- --deployment-token "<YOUR_STATIC_WEB_APP_DEPLOYMENT_TOKEN>"
```

### Adding Your Production URL to Entra ID Redirect URIs (If Using SSO)
Once deployed, Azure will give your app a URL like `https://<name>.azurestaticapps.net`:
1. Open the [Azure Portal — App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → select your app.
2. Go to **Authentication** → under **Single-page application** Redirect URIs, click **Add URI** and add your `https://<name>.azurestaticapps.net` URL.
3. Click **Save**.

---

## Optional URL Parameters

You can customize the initial application state via URL query parameters:

| Parameter | Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaultView` | `split` \| `overlay` \| `source` | `split` | Initial comparison view mode |
| `syncPanZoom` | `true` \| `false` | `true` | Lock pan and zoom between panes in Split view |
| `dimUnchanged` | `true` \| `false` | `false` | Fade unchanged nodes and edges to `22%` opacity |
| `adoDemoOnLoad` | `true` \| `false` | `false` | Automatically connect to the Azure DevOps demo workspace on load |
| `ssoClientId` | `<GUID>` | `""` | Override Microsoft Entra ID Application (client) ID |
| `ssoTenantId` | `<GUID>` \| `organizations` \| `common` | `organizations` | Override Microsoft Entra ID authority tenant |

---

## Project Structure

```text
├── .github/
│   └── workflows/
│       └── azure-static-web-apps.yml # GitHub Actions CI/CD workflow for Azure Static Web Apps
├── index.html                        # App HTML entry point & Geist font imports
├── package.json                      # Dependencies and npm scripts
├── tsconfig.json                     # TypeScript compiler configuration
├── vite.config.ts                    # Vite bundler configuration
├── swa-cli.config.json               # Azure Static Web Apps CLI configuration
├── .env.example                      # Sample environment variables for Entra ID SSO
├── public/
│   └── staticwebapp.config.json      # Azure Static Web Apps runtime routing & headers
└── src/
    ├── main.tsx                      # React root mount & URL/env parameter bootstrap
    ├── styles.css                    # Global layout styles & utility classes
    ├── types.ts                      # TypeScript interfaces for AST, diffs, and ADO API
    ├── vite-env.d.ts                 # Vite client type declarations
    ├── ado/
    │   ├── adoClient.ts              # Live Azure DevOps REST API 7.1 client & MSAL SSO manager
    │   └── demoData.ts               # Built-in sample diagrams & demo ADO repository dataset
    ├── components/
    │   └── MermaidDiffApp.tsx        # Main application component, canvas, sidebar & ADO modal
    └── parser/
        └── flowchartDiff.ts          # Mermaid flowchart parser, AST diff engine & SVG decorator
```

