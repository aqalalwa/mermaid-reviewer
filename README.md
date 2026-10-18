# Mermaid Diff Comparison Tool

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
├── index.html                  # App HTML entry point & Geist font imports
├── package.json                # Dependencies and npm scripts
├── tsconfig.json               # TypeScript compiler configuration
├── vite.config.ts              # Vite bundler configuration
├── .env.example                # Sample environment variables for Entra ID SSO
└── src/
    ├── main.tsx                # React root mount & URL/env parameter bootstrap
    ├── styles.css              # Global layout styles & utility classes
    ├── types.ts                # TypeScript interfaces for AST, diffs, and ADO API
    ├── vite-env.d.ts           # Vite client type declarations
    ├── ado/
    │   ├── adoClient.ts        # Live Azure DevOps REST API 7.1 client & MSAL SSO manager
    │   └── demoData.ts         # Built-in sample diagrams & demo ADO repository dataset
    ├── components/
    │   └── MermaidDiffApp.tsx  # Main application component, canvas, sidebar & ADO modal
    └── parser/
        └── flowchartDiff.ts    # Mermaid flowchart parser, AST diff engine & SVG decorator
```
