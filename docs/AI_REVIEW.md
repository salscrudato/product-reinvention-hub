# Product Reinvention Hub — External AI Review

> **Audience:** AI agent, external reviewer, or new architect who has never seen this codebase.
> **Purpose:** Complete architectural context, data-flow maps, model fleet configuration,
> import pipeline deep-dive, and UI surface — enough to reason about any change without reading
> every file.
> **Date:** 2026-07-13 | **Branch:** `main`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Repository Layout](#2-repository-layout)
3. [Solution Architecture](#3-solution-architecture)
4. [Security & Auth Model](#4-security--auth-model)
5. [Data Layer — Cosmos Tenant Isolation](#5-data-layer--cosmos-tenant-isolation)
6. [AI Fleet — Multi-Model Routing](#6-ai-fleet--multi-model-routing)
7. [The Import Brain — 6-Stage Pipeline](#7-the-import-brain--6-stage-pipeline)
8. [Rating Engine — Three Canaries](#8-rating-engine--three-canaries)
9. [DuckCreek Serializer](#9-duckcreek-serializer) *(removed 2026-07-13)*
10. [Filing Importer](#10-filing-importer)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Key Screens](#12-key-screens)
13. [API Surface Map](#13-api-surface-map)
14. [Binding Invariants](#14-binding-invariants)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Hardening Campaign](#16-hardening-campaign)

---

## 1. Executive Summary

**Product Reinvention Hub** is a multi-tenant SaaS platform for P&C insurance product management.
It lets product teams build, rate, file, and export insurance products (Personal Home, Personal Auto,
General Liability, Inland Marine, Professional) through a governed lifecycle — from a raw ISO
workbook or regulatory filing PDF all the way to a SERFF regulatory filing bundle.

**Key capabilities:**

| Capability | What it does |
|---|---|
| **Import Brain** | 6-stage AI pipeline that turns ISO XLSX workbooks into structured coverage/rule trees — multi-model ensemble with adversarial validation |
| **Filing Importer** | Deterministic table parser + AI prose extraction from regulatory filing PDFs |
| **Rating Engine** | Pure, line-agnostic evaluator with locked canaries ($1,528 / $1,002 / $2,635) |
| **Portfolio Copilot** | RAG-grounded chat over the full product catalogue (hybrid dense+lexical) |
| **HomeCheck** | Consumer-facing home risk API (no portfolio access; FEMA/USGS/NOAA integrations) |
| **SERFF Bundler** | Regulatory filing bundle generator with AI-written rate-justification prose |
| **GTM Process Explorer** | Deterministic workbook→task converter (65 tasks, 90-day critical path) |

**Tech stack:** pnpm monorepo · React 18 / Vite / Tailwind v4 (app) · Express / Cosmos / Foundry AI / Blob (server) · Pure TypeScript shared library · Azure App Service (host) · Azure DevOps (CI/CD).

---

## 2. Repository Layout

```
314358_InsurancePlatformsAI/
├── app/                    React+Vite SPA — adapter seam, no platform SDK
│   ├── src/
│   │   ├── components/     UI + feature components
│   │   ├── lib/backend/    BackendAdapter seam (azure.adapter.ts)
│   │   ├── routes/         Page-level route components
│   │   ├── context/        React contexts (User, Product, Feedback, Capture)
│   │   ├── features/       Coverages, forms, search
│   │   └── index.css       ALL design tokens — var(--color-*)
│   └── CLAUDE.md
├── server/                 Azure App Service Express host
│   ├── server.js           Entry — mounts all routers, SPA fallback
│   └── lib/
│       ├── auth.js         Email OTP + JWT + role enforcement
│       ├── authz.js        Capability matrix
│       ├── data.js         Cosmos CRUD — tenant-isolated, atomic mutate
│       ├── cosmos.js       Cosmos client (single instance, pooled tenants)
│       ├── fleet.js        Model routing + cost guard
│       ├── ai/             Named AI handlers (chat, import, …)
│       ├── import-brain/   6-stage adaptive import pipeline
│       ├── filing.js       5-step regulatory filing generation
│       ├── serff.js        SERFF bundle generator
│       ├── homecheck.js    Consumer risk API (zero portfolio access)
│       └── storage.js      Azure Blob (path-sanitized)
├── shared/                 @pf/shared — pure TS, no platform imports
│   └── src/
│       ├── types.ts        Canonical domain types (Product, Coverage, Rule, …)
│       ├── ai/fleet.ts     Fleet registry + pricing (source of truth)
│       ├── rating/         Line-agnostic evaluator + canary tests
│       ├── insurance/      LOB registry (5 lines) + import domain
│       ├── retrieval/      Chunk builder + int8 dense retrieval
│       ├── rules/          Condition/outcome rules engine
│       ├── seed/           Canonical PH/PA/GL seed data
│       └── lines/          LineArchetype + bureau rules
├── functions/              REFERENCE ONLY — not deployed
├── scripts/                Operational tools (migrate, import harness, judge)
├── docs/
│   ├── adr/                ADRs 0001–0006
│   ├── audit/              Hardening ledger + execution tracker
│   └── DEPLOY_AZURE.md
├── tests/                  Integration + import tests
├── samples/                ISO XLSX workbooks, NJ Lemonade filing PDFs
├── azure-pipelines.yml     CI/CD — gate → build → deploy
└── CLAUDE.md               Binding invariants + session instructions
```

---

## 3. Solution Architecture

```svg
<svg viewBox="0 0 900 620" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,monospace" font-size="11">
  <defs>
    <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#64748b"/>
    </marker>
    <marker id="arr-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#3b82f6"/>
    </marker>
    <marker id="arr-orange" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#f97316"/>
    </marker>
    <marker id="arr-green" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/>
    </marker>
  </defs>

  <!-- Background zones -->
  <rect x="10" y="10" width="260" height="580" rx="10" fill="#f0f9ff" stroke="#bae6fd" stroke-width="1.5"/>
  <text x="140" y="30" text-anchor="middle" font-size="10" fill="#0369a1" font-weight="bold">BROWSER</text>

  <rect x="290" y="10" width="280" height="580" rx="10" fill="#fafaf9" stroke="#d6d3d1" stroke-width="1.5"/>
  <text x="430" y="30" text-anchor="middle" font-size="10" fill="#44403c" font-weight="bold">AZURE APP SERVICE (Express)</text>

  <rect x="590" y="10" width="300" height="580" rx="10" fill="#fdf4ff" stroke="#e9d5ff" stroke-width="1.5"/>
  <text x="740" y="30" text-anchor="middle" font-size="10" fill="#7e22ce" font-weight="bold">AZURE CLOUD SERVICES</text>

  <!-- BROWSER: React SPA -->
  <rect x="25" y="45" width="230" height="200" rx="6" fill="#e0f2fe" stroke="#7dd3fc"/>
  <text x="140" y="62" text-anchor="middle" font-weight="bold" fill="#0c4a6e">React 18 / Vite SPA</text>
  <text x="140" y="78" text-anchor="middle" fill="#0369a1">Tailwind v4 · Design tokens</text>

  <rect x="35" y="88" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="85" y="103" text-anchor="middle" fill="#0c4a6e">ProductWorkspace</text>
  <rect x="145" y="88" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="195" y="103" text-anchor="middle" fill="#0c4a6e">Portfolio Copilot</text>
  <rect x="35" y="118" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="85" y="133" text-anchor="middle" fill="#0c4a6e">ImportWorkbook</text>
  <rect x="145" y="118" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="195" y="133" text-anchor="middle" fill="#0c4a6e">FilingImport</text>
  <rect x="35" y="148" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="85" y="163" text-anchor="middle" fill="#0c4a6e">SERFF Bundler</text>
  <rect x="145" y="148" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="195" y="163" text-anchor="middle" fill="#0c4a6e">HomeCheck</text>
  <rect x="35" y="178" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="85" y="193" text-anchor="middle" fill="#0c4a6e">Claims Copilot</text>
  <rect x="145" y="178" width="100" height="22" rx="3" fill="#bae6fd" stroke="#7dd3fc"/>
  <text x="195" y="193" text-anchor="middle" fill="#0c4a6e">GTM Explorer</text>
  <rect x="35" y="208" width="210" height="28" rx="3" fill="#93c5fd" stroke="#60a5fa"/>
  <text x="140" y="226" text-anchor="middle" fill="#1e3a5f" font-weight="bold">BackendAdapter seam</text>
  <text x="140" y="237" text-anchor="middle" fill="#1e3a5f" font-size="9">(azure.adapter.ts — all reads/writes)</text>

  <!-- Guest / Consumer -->
  <rect x="25" y="265" width="110" height="50" rx="6" fill="#fef9c3" stroke="#fde047"/>
  <text x="80" y="283" text-anchor="middle" font-weight="bold" fill="#713f12">Anonymous</text>
  <text x="80" y="296" text-anchor="middle" fill="#713f12">Guest user</text>
  <text x="80" y="308" text-anchor="middle" fill="#713f12" font-size="9">VITE_ALLOW_GUEST</text>

  <!-- Tenant Admin etc -->
  <rect x="145" y="265" width="110" height="50" rx="6" fill="#d1fae5" stroke="#6ee7b7"/>
  <text x="200" y="283" text-anchor="middle" font-weight="bold" fill="#064e3b">Authed Users</text>
  <text x="200" y="296" text-anchor="middle" fill="#064e3b">VIEWER / EDITOR</text>
  <text x="200" y="308" text-anchor="middle" fill="#064e3b" font-size="9">TENANT_ADMIN / SA</text>

  <!-- Smart polling note -->
  <rect x="25" y="330" width="230" height="34" rx="6" fill="#fce7f3" stroke="#f9a8d4"/>
  <text x="140" y="348" text-anchor="middle" fill="#831843">Smart polling (no onSnapshot)</text>
  <text x="140" y="360" text-anchor="middle" fill="#831843" font-size="9">SW cache · VersionWatcher · PWA</text>

  <!-- Arrows browser → server -->
  <line x1="255" y1="230" x2="290" y2="230" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="272" y="226" text-anchor="middle" fill="#64748b" font-size="9">JWT</text>
  <line x1="255" y1="290" x2="290" y2="290" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="272" y="286" text-anchor="middle" fill="#64748b" font-size="9">/api/*</text>

  <!-- SERVER: Express -->
  <!-- Auth -->
  <rect x="300" y="45" width="255" height="50" rx="5" fill="#fef3c7" stroke="#fcd34d"/>
  <text x="427" y="63" text-anchor="middle" font-weight="bold" fill="#78350f">auth.js — Email OTP + JWT</text>
  <text x="427" y="76" text-anchor="middle" fill="#78350f" font-size="9">requireCapability() · authz.js · rank guards · jti revoke</text>

  <!-- Data -->
  <rect x="300" y="105" width="120" height="42" rx="5" fill="#ede9fe" stroke="#c4b5fd"/>
  <text x="360" y="122" text-anchor="middle" font-weight="bold" fill="#4c1d95">data.js</text>
  <text x="360" y="134" text-anchor="middle" fill="#4c1d95" font-size="9">Atomic mutate</text>
  <text x="360" y="144" text-anchor="middle" fill="#4c1d95" font-size="9">Tenant isolation</text>

  <!-- Storage -->
  <rect x="430" y="105" width="120" height="42" rx="5" fill="#ede9fe" stroke="#c4b5fd"/>
  <text x="490" y="122" text-anchor="middle" font-weight="bold" fill="#4c1d95">storage.js</text>
  <text x="490" y="134" text-anchor="middle" fill="#4c1d95" font-size="9">Azure Blob</text>
  <text x="490" y="144" text-anchor="middle" fill="#4c1d95" font-size="9">Path-sanitized</text>

  <!-- fleet.js -->
  <rect x="300" y="158" width="255" height="42" rx="5" fill="#fdf2f8" stroke="#f0abfc"/>
  <text x="427" y="176" text-anchor="middle" font-weight="bold" fill="#701a75">fleet.js — Cost Guard + Model Router</text>
  <text x="427" y="190" text-anchor="middle" fill="#701a75" font-size="9">$25/hr rolling window · 80% soft degrade · resolveModel()</text>

  <!-- AI handlers -->
  <rect x="300" y="210" width="120" height="90" rx="5" fill="#ecfdf5" stroke="#86efac"/>
  <text x="360" y="226" text-anchor="middle" font-weight="bold" fill="#14532d">ai/ handlers</text>
  <text x="360" y="240" text-anchor="middle" fill="#14532d" font-size="9">chat.js (copilot)</text>
  <text x="360" y="252" text-anchor="middle" fill="#14532d" font-size="9">unified-import.js</text>
  <text x="360" y="264" text-anchor="middle" fill="#14532d" font-size="9">summarize-product</text>
  <text x="360" y="276" text-anchor="middle" fill="#14532d" font-size="9">draft-rule / scaffold</text>
  <text x="360" y="289" text-anchor="middle" fill="#14532d" font-size="9">+8 more handlers</text>

  <!-- import-brain -->
  <rect x="430" y="210" width="120" height="90" rx="5" fill="#fff7ed" stroke="#fdba74"/>
  <text x="490" y="226" text-anchor="middle" font-weight="bold" fill="#7c2d12">import-brain/</text>
  <text x="490" y="240" text-anchor="middle" fill="#7c2d12" font-size="9">6-stage pipeline</text>
  <text x="490" y="252" text-anchor="middle" fill="#7c2d12" font-size="9">Classify→Lock</text>
  <text x="490" y="264" text-anchor="middle" fill="#7c2d12" font-size="9">ColMap→Extract</text>
  <text x="490" y="276" text-anchor="middle" fill="#7c2d12" font-size="9">Validate→Reconcile</text>
  <text x="490" y="289" text-anchor="middle" fill="#7c2d12" font-size="9">SSE progress stream</text>

  <!-- Other APIs -->
  <rect x="300" y="312" width="255" height="70" rx="5" fill="#f0fdf4" stroke="#86efac"/>
  <text x="360" y="328" text-anchor="middle" font-weight="bold" fill="#14532d">serff.js</text>
  <text x="360" y="340" text-anchor="middle" fill="#14532d" font-size="9">Rate exhibit + prose</text>
  <text x="490" y="328" text-anchor="middle" font-weight="bold" fill="#14532d">filing.js</text>
  <text x="490" y="340" text-anchor="middle" fill="#14532d" font-size="9">5-step · hash-pinned</text>
  <text x="490" y="358" text-anchor="middle" font-weight="bold" fill="#14532d">homecheck.js</text>
  <text x="490" y="370" text-anchor="middle" fill="#14532d" font-size="9">Zero portfolio access</text>

  <!-- SPA static -->
  <rect x="300" y="395" width="255" height="35" rx="5" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="427" y="415" text-anchor="middle" fill="#475569">GET * → server/public/ (Vite build + SPA fallback)</text>

  <!-- AZURE CLOUD -->
  <!-- Cosmos -->
  <rect x="605" y="45" width="270" height="90" rx="6" fill="#ede9fe" stroke="#a78bfa"/>
  <text x="740" y="62" text-anchor="middle" font-weight="bold" fill="#4c1d95">Azure Cosmos DB</text>
  <text x="740" y="78" text-anchor="middle" fill="#4c1d95" font-size="9">Database: prodhub</text>
  <text x="740" y="91" text-anchor="middle" fill="#4c1d95" font-size="9">Containers: docs (products, coverages, rules, …)</text>
  <text x="740" y="104" text-anchor="middle" fill="#4c1d95" font-size="9">          presence (live cursors)</text>
  <text x="740" y="117" text-anchor="middle" fill="#4c1d95" font-size="9">Partition key: ${tenantId}|${base} · c.tenantId filter</text>
  <text x="740" y="127" text-anchor="middle" fill="#4c1d95" font-size="9">Transactional batch: entity+audit+version+searchIndex</text>

  <!-- Foundry AI -->
  <rect x="605" y="148" width="270" height="110" rx="6" fill="#fdf4ff" stroke="#e879f9"/>
  <text x="740" y="165" text-anchor="middle" font-weight="bold" fill="#701a75">Azure AI Foundry</text>
  <text x="740" y="181" text-anchor="middle" fill="#701a75" font-size="9">Anthropic surface: /anthropic/v1/messages</text>
  <text x="740" y="194" text-anchor="middle" fill="#701a75" font-size="9">  claude-opus-4-8 (GROUNDED_CITED)</text>
  <text x="740" y="207" text-anchor="middle" fill="#701a75" font-size="9">  claude-haiku-4-5 (BULK_VERIFY)</text>
  <text x="740" y="220" text-anchor="middle" fill="#701a75" font-size="9">OpenAI surface: /openai/v1/chat/completions</text>
  <text x="740" y="233" text-anchor="middle" fill="#701a75" font-size="9">  gpt-5.1 (VISION · adversarial VALIDATOR)</text>
  <text x="740" y="246" text-anchor="middle" fill="#701a75" font-size="9">  text-embedding-3-small (EMBED · RAG)</text>

  <!-- Azure Blob -->
  <rect x="605" y="270" width="130" height="55" rx="6" fill="#fef9c3" stroke="#fde047"/>
  <text x="670" y="288" text-anchor="middle" font-weight="bold" fill="#713f12">Azure Blob</text>
  <text x="670" y="303" text-anchor="middle" fill="#713f12" font-size="9">Uploaded workbooks</text>
  <text x="670" y="315" text-anchor="middle" fill="#713f12" font-size="9">Filing PDFs · bundles</text>

  <!-- Azure DevOps -->
  <rect x="745" y="270" width="130" height="55" rx="6" fill="#e0f2fe" stroke="#7dd3fc"/>
  <text x="810" y="288" text-anchor="middle" font-weight="bold" fill="#0c4a6e">Azure DevOps</text>
  <text x="810" y="303" text-anchor="middle" fill="#0c4a6e" font-size="9">CI gate → build</text>
  <text x="810" y="315" text-anchor="middle" fill="#0c4a6e" font-size="9">Auto-deploy main</text>

  <!-- External APIs -->
  <rect x="605" y="338" width="270" height="90" rx="6" fill="#f0fdf4" stroke="#86efac"/>
  <text x="740" y="355" text-anchor="middle" font-weight="bold" fill="#14532d">External APIs (HomeCheck only)</text>
  <text x="740" y="370" text-anchor="middle" fill="#14532d" font-size="9">US Census Geocoder · FEMA NRI · FEMA NFHL (flood)</text>
  <text x="740" y="383" text-anchor="middle" fill="#14532d" font-size="9">OpenFEMA · USGS FDSN (earthquake)</text>
  <text x="740" y="396" text-anchor="middle" fill="#14532d" font-size="9">NOAA/NWS (weather) · USDA WHP (wildfire)</text>
  <text x="740" y="409" text-anchor="middle" fill="#14532d" font-size="9">GPT-5.1 Vision (home inventory)</text>
  <text x="740" y="420" text-anchor="middle" fill="#14532d" font-size="9">24-hr session TTL · guest rate-limited</text>

  <!-- Server → Cloud arrows -->
  <line x1="555" y1="130" x2="603" y2="90" stroke="#7c3aed" stroke-width="1.5" marker-end="url(#arr-blue)"/>
  <text x="575" y="115" text-anchor="middle" fill="#7c3aed" font-size="9">CRUD</text>
  <line x1="555" y1="200" x2="603" y2="200" stroke="#a21caf" stroke-width="1.5" marker-end="url(#arr-blue)"/>
  <text x="575" y="195" text-anchor="middle" fill="#a21caf" font-size="9">AI calls</text>
  <line x1="490" y1="105" x2="640" y2="285" stroke="#d97706" stroke-width="1.5" marker-end="url(#arr-orange)"/>
  <text x="565" y="195" text-anchor="middle" fill="#d97706" font-size="9">Blob ops</text>
  <line x1="427" y1="435" x2="810" y2="270" stroke="#0284c7" stroke-width="1.2" stroke-dasharray="4" marker-end="url(#arr-blue)"/>
  <text x="660" y="380" text-anchor="middle" fill="#0284c7" font-size="9">Deploy</text>

  <!-- Legend -->
  <rect x="10" y="450" width="260" height="135" rx="6" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="140" y="468" text-anchor="middle" font-weight="bold" fill="#334155">Legend</text>
  <rect x="20" y="476" width="12" height="12" fill="#e0f2fe" stroke="#7dd3fc"/>
  <text x="38" y="487" fill="#334155">Browser / SPA</text>
  <rect x="20" y="496" width="12" height="12" fill="#fafaf9" stroke="#d6d3d1"/>
  <text x="38" y="507" fill="#334155">Express host (server/)</text>
  <rect x="20" y="516" width="12" height="12" fill="#fdf4ff" stroke="#e9d5ff"/>
  <text x="38" y="527" fill="#334155">Azure Cloud Services</text>
  <line x1="20" y1="540" x2="36" y2="540" stroke="#64748b" stroke-width="1.5" marker-end="url(#arr)"/>
  <text x="38" y="544" fill="#334155">HTTP / JWT</text>
  <line x1="20" y1="558" x2="36" y2="558" stroke="#3b82f6" stroke-width="1.5" stroke-dasharray="4" marker-end="url(#arr-blue)"/>
  <text x="38" y="562" fill="#334155">Azure SDK (server-side only)</text>
  <text x="140" y="578" text-anchor="middle" fill="#94a3b8" font-size="9">Browser NEVER holds data-store or AI credentials</text>
</svg>
```

---

## 4. Security & Auth Model

### Authentication Flow

```
User → POST /api/auth/otp/request (email)
      ← 6-digit OTP via email (TTL 10m)
User → POST /api/auth/otp/verify  {email, otp}
      ← JWT {sub, email, name, role, tenantId, jti, exp:+12h}
       stored in localStorage (pf.azure.token)
       sent as Authorization: Bearer <token> on every /api call

SUPER_ADMIN bootstrap → POST /api/auth/bootstrap {adminSecret}
Logout → POST /api/auth/logout → jti added to revocation set (RISK-006)
```

### Role Hierarchy

```svg
<svg viewBox="0 0 700 220" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,monospace" font-size="11">
  <!-- Tenant Plane -->
  <rect x="10" y="10" width="390" height="195" rx="8" fill="#f0fdf4" stroke="#86efac" stroke-width="1.5"/>
  <text x="205" y="28" text-anchor="middle" font-weight="bold" fill="#14532d">TENANT PLANE</text>

  <rect x="20" y="38" width="90" height="50" rx="5" fill="#dcfce7" stroke="#4ade80"/>
  <text x="65" y="58" text-anchor="middle" font-weight="bold" fill="#14532d">VIEWER</text>
  <text x="65" y="72" text-anchor="middle" fill="#15803d" font-size="9">product:read</text>
  <text x="65" y="82" text-anchor="middle" fill="#15803d" font-size="9">only</text>

  <rect x="120" y="38" width="90" height="50" rx="5" fill="#bbf7d0" stroke="#4ade80"/>
  <text x="165" y="58" text-anchor="middle" font-weight="bold" fill="#14532d">EDITOR</text>
  <text x="165" y="72" text-anchor="middle" fill="#15803d" font-size="9">+write+ai:invoke</text>
  <text x="165" y="82" text-anchor="middle" fill="#15803d" font-size="9">+filing+changeset</text>

  <rect x="220" y="38" width="90" height="50" rx="5" fill="#86efac" stroke="#22c55e"/>
  <text x="265" y="58" text-anchor="middle" font-weight="bold" fill="#14532d">TENANT</text>
  <text x="265" y="70" text-anchor="middle" font-weight="bold" fill="#14532d">ADMIN</text>
  <text x="265" y="82" text-anchor="middle" fill="#15803d" font-size="9">+member+role+audit</text>

  <!-- rank arrows -->
  <line x1="110" y1="63" x2="120" y2="63" stroke="#16a34a" stroke-width="1.5" marker-end="url(#arr-green)"/>
  <line x1="210" y1="63" x2="220" y2="63" stroke="#16a34a" stroke-width="1.5" marker-end="url(#arr-green)"/>

  <!-- Capabilities breakdown -->
  <rect x="20" y="100" width="365" height="95" rx="5" fill="#f0fdf4" stroke="#bbf7d0"/>
  <text x="202" y="116" text-anchor="middle" font-weight="bold" fill="#14532d">Capability Matrix (authz.js)</text>
  <text x="100" y="133" text-anchor="middle" fill="#15803d" font-size="9">product:read</text>
  <text x="100" y="145" text-anchor="middle" fill="#15803d" font-size="9">product:write</text>
  <text x="100" y="157" text-anchor="middle" fill="#15803d" font-size="9">ai:invoke</text>
  <text x="100" y="169" text-anchor="middle" fill="#15803d" font-size="9">filing:generate</text>
  <text x="100" y="181" text-anchor="middle" fill="#15803d" font-size="9">changeset:approve</text>

  <text x="230" y="133" text-anchor="middle" fill="#15803d" font-size="9">member:manage</text>
  <text x="230" y="145" text-anchor="middle" fill="#15803d" font-size="9">role:assign</text>
  <text x="230" y="157" text-anchor="middle" fill="#15803d" font-size="9">audit:read</text>
  <text x="230" y="169" text-anchor="middle" fill="#15803d" font-size="9">(tenant admin only)</text>

  <!-- VIEWER tick marks -->
  <text x="30" y="133" fill="#22c55e">✓</text>
  <text x="30" y="145" fill="#d1d5db">✗</text>
  <text x="30" y="157" fill="#d1d5db">✗</text>
  <text x="30" y="169" fill="#d1d5db">✗</text>
  <text x="30" y="181" fill="#d1d5db">✗</text>

  <!-- EDITOR tick marks -->
  <text x="160" y="133" fill="#22c55e">✓</text>
  <text x="160" y="145" fill="#22c55e">✓</text>
  <text x="160" y="157" fill="#22c55e">✓</text>
  <text x="160" y="169" fill="#22c55e">✓</text>
  <text x="160" y="181" fill="#22c55e">✓</text>

  <!-- Platform Plane -->
  <rect x="415" y="10" width="275" height="195" rx="8" fill="#eff6ff" stroke="#93c5fd" stroke-width="1.5"/>
  <text x="552" y="28" text-anchor="middle" font-weight="bold" fill="#1e3a8a">PLATFORM PLANE</text>

  <rect x="425" y="38" width="115" height="50" rx="5" fill="#dbeafe" stroke="#60a5fa"/>
  <text x="482" y="58" text-anchor="middle" font-weight="bold" fill="#1e3a8a">SUPPORT</text>
  <text x="482" y="72" text-anchor="middle" fill="#1e40af" font-size="9">read+audit</text>
  <text x="482" y="82" text-anchor="middle" fill="#1e40af" font-size="9">+impersonate</text>

  <rect x="555" y="38" width="115" height="50" rx="5" fill="#93c5fd" stroke="#3b82f6"/>
  <text x="612" y="58" text-anchor="middle" font-weight="bold" fill="#1e3a8a">SUPER_ADMIN</text>
  <text x="612" y="72" text-anchor="middle" fill="#1e40af" font-size="9">platform:tenants</text>
  <text x="612" y="82" text-anchor="middle" fill="#1e40af" font-size="9">+users+audit+SA</text>

  <line x1="540" y1="63" x2="555" y2="63" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#arr-blue)"/>

  <rect x="425" y="100" width="245" height="55" rx="5" fill="#eff6ff" stroke="#bfdbfe"/>
  <text x="547" y="116" text-anchor="middle" font-weight="bold" fill="#1e3a8a">X-Tenant-Id override</text>
  <text x="547" y="131" text-anchor="middle" fill="#1e40af" font-size="9">SUPER_ADMIN can impersonate any tenant</text>
  <text x="547" y="143" text-anchor="middle" fill="#1e40af" font-size="9">clears all caches · resets pollers</text>

  <rect x="425" y="165" width="245" height="30" rx="5" fill="#fef2f2" stroke="#fca5a5"/>
  <text x="547" y="184" text-anchor="middle" fill="#b91c1c" font-size="9">jti revocation (RISK-006): logout → revoked set → 401 on next call</text>
</svg>
```

---

## 5. Data Layer — Cosmos Tenant Isolation

### Partition Strategy

Every document in the `docs` container uses:
- **Partition key:** `${tenantId}|${base}` where `base` is `products`, `coverages`, `rules`, etc.
- **Defense-in-depth:** Every query appends `AND c.tenantId = @tid`; reads re-check `r.tenantId === tid`

### Atomic Mutation Envelope

`server/lib/data.js` — `POST /api/db/mutate`:

```
Input: { entity, type, expectedRev?, tenantId }

Cosmos Transactional Batch (all-or-nothing):
  ┌─────────────────────────────────┐
  │ 1. entity (upsert)              │  ← the actual domain object
  │ 2. auditEvent (create)          │  ← who/what/when immutable log
  │ 3. version snapshot (create)    │  ← full entity copy at this rev
  │ 4. searchIndex (upsert)         │  ← full-text search fields
  └─────────────────────────────────┘
  409 if expectedRev mismatch → MutationConflictError → client shows ConflictDiffDialog
```

**No bare data-store writes exist anywhere** — all writes go through this envelope.

### Key Collections

| Collection base | Contents |
|---|---|
| `products` | Product master records + lifecycle state |
| `coverages` | Coverage trees per product |
| `rules` | Eligibility + rating rules |
| `ratingPrograms` | Rating step sequences + LD/RT tables |
| `forms` | Form attachments per product+state |
| `filings` | Immutable filing records (create-only) |
| `auditEvents` | Append-only audit log |
| `versions` | Full entity snapshots at each rev |
| `searchIndex` | Denormalized search fields |
| `grounding` | AI grounding chunks (text + int8 vectors) |
| `presence` | Live cursor positions (separate container) |

---

## 6. AI Fleet — Multi-Model Routing

### Fleet Registry (`shared/src/ai/fleet.ts` → `server/lib/fleet.js`)

```svg
<svg viewBox="0 0 820 340" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,monospace" font-size="11">
  <defs>
    <marker id="a2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#64748b"/>
    </marker>
  </defs>

  <!-- Title -->
  <text x="410" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">AI Fleet — Role-Based Model Dispatch (fleet.js)</text>

  <!-- Input box -->
  <rect x="20" y="40" width="140" height="270" rx="8" fill="#f1f5f9" stroke="#cbd5e1"/>
  <text x="90" y="58" text-anchor="middle" font-weight="bold" fill="#334155">AI Roles</text>
  <rect x="30" y="66" width="120" height="35" rx="5" fill="#fdf4ff" stroke="#e879f9"/>
  <text x="90" y="82" text-anchor="middle" font-weight="bold" fill="#701a75">GROUNDED_CITED</text>
  <text x="90" y="94" text-anchor="middle" fill="#701a75" font-size="9">citation-enforced prose</text>

  <rect x="30" y="110" width="120" height="35" rx="5" fill="#fff7ed" stroke="#fdba74"/>
  <text x="90" y="126" text-anchor="middle" font-weight="bold" fill="#7c2d12">BULK_VERIFY</text>
  <text x="90" y="138" text-anchor="middle" fill="#7c2d12" font-size="9">high-throughput extract</text>

  <rect x="30" y="154" width="120" height="35" rx="5" fill="#eff6ff" stroke="#93c5fd"/>
  <text x="90" y="170" text-anchor="middle" font-weight="bold" fill="#1e3a8a">VISION</text>
  <text x="90" y="182" text-anchor="middle" fill="#1e3a8a" font-size="9">image+adversarial val</text>

  <rect x="30" y="198" width="120" height="35" rx="5" fill="#f0fdf4" stroke="#86efac"/>
  <text x="90" y="214" text-anchor="middle" font-weight="bold" fill="#14532d">CHEAP_GENERAL</text>
  <text x="90" y="226" text-anchor="middle" fill="#14532d" font-size="9">degrade fallback / prose</text>

  <rect x="30" y="242" width="120" height="35" rx="5" fill="#fef9c3" stroke="#fde047"/>
  <text x="90" y="258" text-anchor="middle" font-weight="bold" fill="#713f12">EMBED</text>
  <text x="90" y="270" text-anchor="middle" fill="#713f12" font-size="9">dense vector RAG</text>

  <!-- fleet.js router -->
  <rect x="210" y="40" width="150" height="270" rx="8" fill="#fdf4ff" stroke="#e879f9" stroke-width="2"/>
  <text x="285" y="58" text-anchor="middle" font-weight="bold" fill="#701a75">fleet.js</text>
  <text x="285" y="72" text-anchor="middle" fill="#701a75" font-size="9">resolveModel(role)</text>
  <text x="285" y="86" text-anchor="middle" fill="#9d174d" font-size="9">↓</text>
  <text x="285" y="100" text-anchor="middle" fill="#701a75" font-size="9">guard(role, estCost)</text>
  <text x="285" y="114" text-anchor="middle" fill="#701a75" font-size="9">record(role, tokens)</text>
  <text x="285" y="128" text-anchor="middle" fill="#701a75" font-size="9">snapshot()</text>

  <rect x="220" y="140" width="130" height="85" rx="5" fill="#fce7f3" stroke="#f9a8d4"/>
  <text x="285" y="156" text-anchor="middle" font-weight="bold" fill="#831843">Cost Guard</text>
  <text x="285" y="172" text-anchor="middle" fill="#831843" font-size="9">Rolling 1-hr window</text>
  <text x="285" y="184" text-anchor="middle" fill="#831843" font-size="9">Hard ceiling: $25</text>
  <text x="285" y="196" text-anchor="middle" fill="#831843" font-size="9">Soft degrade: $20 (80%)</text>
  <text x="285" y="208" text-anchor="middle" fill="#831843" font-size="9">degradedRole() mapping</text>
  <text x="285" y="220" text-anchor="middle" fill="#831843" font-size="9">Unknown deploy → Opus$$</text>

  <rect x="220" y="233" width="130" height="65" rx="5" fill="#fdf4ff" stroke="#e879f9"/>
  <text x="285" y="250" text-anchor="middle" font-weight="bold" fill="#701a75">URL builders</text>
  <text x="285" y="263" text-anchor="middle" fill="#701a75" font-size="9">Foundry Anthropic endpoint</text>
  <text x="285" y="275" text-anchor="middle" fill="#701a75" font-size="9">Foundry OpenAI endpoint</text>
  <text x="285" y="287" text-anchor="middle" fill="#701a75" font-size="9">Embed endpoint</text>

  <!-- Arrows role → fleet -->
  <line x1="160" y1="84" x2="210" y2="84" stroke="#64748b" stroke-width="1.2" marker-end="url(#a2)"/>
  <line x1="160" y1="128" x2="210" y2="150" stroke="#64748b" stroke-width="1.2" marker-end="url(#a2)"/>
  <line x1="160" y1="172" x2="210" y2="175" stroke="#64748b" stroke-width="1.2" marker-end="url(#a2)"/>
  <line x1="160" y1="216" x2="210" y2="200" stroke="#64748b" stroke-width="1.2" marker-end="url(#a2)"/>
  <line x1="160" y1="260" x2="210" y2="260" stroke="#64748b" stroke-width="1.2" marker-end="url(#a2)"/>

  <!-- Model targets -->
  <rect x="415" y="40" width="190" height="130" rx="8" fill="#fdf2f8" stroke="#f0abfc"/>
  <text x="510" y="58" text-anchor="middle" font-weight="bold" fill="#701a75">Anthropic (via Foundry)</text>
  <rect x="425" y="66" width="170" height="42" rx="5" fill="#f5d0fe" stroke="#e879f9"/>
  <text x="510" y="82" text-anchor="middle" font-weight="bold" fill="#4a044e">claude-opus-4-8</text>
  <text x="510" y="95" text-anchor="middle" fill="#701a75" font-size="9">GROUNDED_CITED</text>
  <text x="510" y="107" text-anchor="middle" fill="#701a75" font-size="9">$15/$75 per MTok in/out</text>
  <rect x="425" y="117" width="170" height="42" rx="5" fill="#e9d5ff" stroke="#c084fc"/>
  <text x="510" y="133" text-anchor="middle" font-weight="bold" fill="#4a044e">claude-haiku-4-5</text>
  <text x="510" y="146" text-anchor="middle" fill="#701a75" font-size="9">BULK_VERIFY</text>
  <text x="510" y="158" text-anchor="middle" fill="#701a75" font-size="9">$0.80/$4.00 per MTok</text>

  <rect x="415" y="182" width="190" height="128" rx="8" fill="#eff6ff" stroke="#93c5fd"/>
  <text x="510" y="200" text-anchor="middle" font-weight="bold" fill="#1e3a8a">OpenAI (via Foundry)</text>
  <rect x="425" y="208" width="170" height="38" rx="5" fill="#dbeafe" stroke="#60a5fa"/>
  <text x="510" y="224" text-anchor="middle" font-weight="bold" fill="#1e3a8a">gpt-5.1</text>
  <text x="510" y="237" text-anchor="middle" fill="#1e40af" font-size="9">VISION · VALIDATOR · $3/$12</text>
  <rect x="425" y="255" width="170" height="25" rx="5" fill="#dbeafe" stroke="#60a5fa"/>
  <text x="510" y="271" text-anchor="middle" fill="#1e40af" font-size="9">gpt-5-mini — CHEAP_GENERAL · $0.30/$1.60</text>
  <rect x="425" y="288" width="170" height="18" rx="5" fill="#e0f2fe" stroke="#7dd3fc"/>
  <text x="510" y="301" text-anchor="middle" fill="#0369a1" font-size="9">text-embedding-3-small — EMBED · $0.02</text>

  <!-- fleet arrows to models -->
  <line x1="360" y1="84" x2="415" y2="88" stroke="#a21caf" stroke-width="1.5" marker-end="url(#a2)"/>
  <line x1="360" y1="150" x2="415" y2="137" stroke="#9333ea" stroke-width="1.5" marker-end="url(#a2)"/>
  <line x1="360" y1="175" x2="415" y2="224" stroke="#3b82f6" stroke-width="1.5" marker-end="url(#a2)"/>
  <line x1="360" y1="210" x2="415" y2="268" stroke="#22c55e" stroke-width="1.5" marker-end="url(#a2)"/>
  <line x1="360" y1="260" x2="415" y2="298" stroke="#d97706" stroke-width="1.5" marker-end="url(#a2)"/>

  <!-- Degrade arrow -->
  <path d="M510 159 Q540 173 510 208" fill="none" stroke="#b91c1c" stroke-width="1.2" stroke-dasharray="4" marker-end="url(#a2)"/>
  <text x="548" y="184" fill="#b91c1c" font-size="9">degrade</text>
  <text x="548" y="196" fill="#b91c1c" font-size="9">at $20</text>

  <!-- Pricing legend -->
  <rect x="620" y="40" width="185" height="270" rx="8" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="712" y="58" text-anchor="middle" font-weight="bold" fill="#334155">Foundry Endpoints</text>
  <text x="630" y="76" fill="#475569" font-size="9">AZURE_FOUNDRY_ENDPOINT</text>
  <text x="630" y="90" fill="#475569" font-size="9">AZURE_FOUNDRY_KEY</text>
  <text x="630" y="104" fill="#475569" font-size="9">AZURE_FOUNDRY_ANTHROPIC_VERSION</text>
  <line x1="630" y1="112" x2="795" y2="112" stroke="#e2e8f0"/>
  <text x="712" y="128" text-anchor="middle" font-weight="bold" fill="#334155">Degrade Map</text>
  <text x="630" y="144" fill="#475569" font-size="9">GROUNDED_CITED</text>
  <text x="720" y="144" fill="#ef4444" font-size="9">→ BULK_VERIFY</text>
  <text x="630" y="158" fill="#475569" font-size="9">VISION</text>
  <text x="720" y="158" fill="#ef4444" font-size="9">→ CHEAP_GENERAL</text>
  <text x="630" y="172" fill="#475569" font-size="9">others</text>
  <text x="720" y="172" fill="#475569" font-size="9">→ unchanged</text>
  <line x1="630" y1="180" x2="795" y2="180" stroke="#e2e8f0"/>
  <text x="712" y="196" text-anchor="middle" font-weight="bold" fill="#334155">Never</text>
  <rect x="630" y="204" width="150" height="24" rx="4" fill="#fef2f2" stroke="#fca5a5"/>
  <text x="705" y="220" text-anchor="middle" fill="#b91c1c" font-weight="bold">claude-fable-5</text>
  <line x1="630" y1="234" x2="795" y2="234" stroke="#e2e8f0"/>
  <text x="712" y="250" text-anchor="middle" font-weight="bold" fill="#334155">All AI = server-side</text>
  <text x="712" y="265" text-anchor="middle" fill="#94a3b8" font-size="9">Browser never calls model API</text>
  <text x="712" y="278" text-anchor="middle" fill="#94a3b8" font-size="9">Credentials in App Service config</text>
  <text x="712" y="292" text-anchor="middle" fill="#94a3b8" font-size="9">Never in code or client bundle</text>
</svg>
```

### RAG Grounding (Portfolio Copilot)

- Chunks written to Cosmos `grounding` collection at product-save time
- int8-quantized dense vectors (text-embedding-3-small)
- Lexical keyword layer (always-baseline PORTFOLIO chunks)
- Deduplication by text (chunk-scheme drift guard)
- System prompt enforces `[ref:xxx]` citation tags; free invention = bug

---

## 7. The Import Brain — 6-Stage Pipeline

The **adaptive import brain** (`server/lib/import-brain/`) converts a raw ISO XLSX workbook
(hundreds of rows, irregular structure, multi-sheet) into a typed `ImportPlan` (coverages, sub-coverages,
rules, forms, refIds, enumerations) using a staged multi-model ensemble.

```svg
<svg viewBox="0 0 880 500" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,monospace" font-size="11">
  <defs>
    <marker id="b1" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#64748b"/>
    </marker>
    <marker id="b2" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#ef4444"/>
    </marker>
    <marker id="b3" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#22c55e"/>
    </marker>
  </defs>

  <!-- Title -->
  <text x="440" y="20" text-anchor="middle" font-size="13" font-weight="bold" fill="#1e293b">Import Brain — 6-Stage Multi-Model Pipeline (server/lib/import-brain/)</text>

  <!-- Input -->
  <rect x="10" y="40" width="110" height="70" rx="6" fill="#f1f5f9" stroke="#94a3b8"/>
  <text x="65" y="58" text-anchor="middle" font-weight="bold" fill="#334155">XLSX Upload</text>
  <text x="65" y="73" text-anchor="middle" fill="#475569" font-size="9">ISO workbook</text>
  <text x="65" y="86" text-anchor="middle" fill="#475569" font-size="9">multi-sheet</text>
  <text x="65" y="99" text-anchor="middle" fill="#475569" font-size="9">raw row data</text>
  <line x1="120" y1="75" x2="148" y2="75" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- Stage 1: Classify -->
  <rect x="150" y="35" width="120" height="180" rx="6" fill="#fef3c7" stroke="#fcd34d" stroke-width="2"/>
  <text x="210" y="55" text-anchor="middle" font-weight="bold" fill="#78350f">STAGE 1</text>
  <text x="210" y="69" text-anchor="middle" font-weight="bold" fill="#78350f">Classify</text>
  <text x="210" y="83" text-anchor="middle" fill="#92400e" font-size="9">stage1-classify.js</text>
  <line x1="160" y1="92" x2="258" y2="92" stroke="#d97706" stroke-width="0.5"/>
  <text x="210" y="107" text-anchor="middle" fill="#78350f" font-size="9">BULK pre-filter</text>
  <text x="210" y="119" text-anchor="middle" fill="#78350f" font-size="9">(haiku-4-5)</text>
  <text x="210" y="133" text-anchor="middle" fill="#78350f" font-size="9">Sheet type labels:</text>
  <text x="210" y="145" text-anchor="middle" fill="#78350f" font-size="9">COVERAGE / RULE</text>
  <text x="210" y="157" text-anchor="middle" fill="#78350f" font-size="9">FORM / PRICING</text>
  <text x="210" y="169" text-anchor="middle" fill="#78350f" font-size="9">METADATA / SKIP</text>
  <text x="210" y="183" text-anchor="middle" fill="#78350f" font-size="9">REASONER_A+B ensemble</text>
  <text x="210" y="196" text-anchor="middle" fill="#78350f" font-size="9">consensus required</text>
  <text x="210" y="208" text-anchor="middle" fill="#78350f" font-size="9">unknown → SKIP</text>

  <line x1="270" y1="125" x2="298" y2="125" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- Stage 2: Header Lock -->
  <rect x="300" y="35" width="120" height="140" rx="6" fill="#fdf2f8" stroke="#f0abfc" stroke-width="2"/>
  <text x="360" y="55" text-anchor="middle" font-weight="bold" fill="#701a75">STAGE 2</text>
  <text x="360" y="69" text-anchor="middle" font-weight="bold" fill="#701a75">Header Lock</text>
  <text x="360" y="83" text-anchor="middle" fill="#9d174d" font-size="9">stage2-header-lock.js</text>
  <line x1="310" y1="92" x2="408" y2="92" stroke="#a21caf" stroke-width="0.5"/>
  <text x="360" y="107" text-anchor="middle" fill="#701a75" font-size="9">Deterministic fast path</text>
  <text x="360" y="119" text-anchor="middle" fill="#701a75" font-size="9">(regex heuristics first)</text>
  <text x="360" y="133" text-anchor="middle" fill="#701a75" font-size="9">AI fallback if unclear</text>
  <text x="360" y="145" text-anchor="middle" fill="#701a75" font-size="9">Pins: header row,</text>
  <text x="360" y="157" text-anchor="middle" fill="#701a75" font-size="9">data region bounds,</text>
  <text x="360" y="166" text-anchor="middle" fill="#701a75" font-size="9">skip-row markers</text>

  <line x1="420" y1="105" x2="448" y2="105" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- Stage 3: Column Map -->
  <rect x="450" y="35" width="120" height="160" rx="6" fill="#ede9fe" stroke="#c4b5fd" stroke-width="2"/>
  <text x="510" y="55" text-anchor="middle" font-weight="bold" fill="#4c1d95">STAGE 3</text>
  <text x="510" y="69" text-anchor="middle" font-weight="bold" fill="#4c1d95">Column Map</text>
  <text x="510" y="83" text-anchor="middle" fill="#5b21b6" font-size="9">stage3-column-map.js</text>
  <line x1="460" y1="92" x2="558" y2="92" stroke="#7c3aed" stroke-width="0.5"/>
  <text x="510" y="107" text-anchor="middle" fill="#4c1d95" font-size="9">REASONER_A parallel</text>
  <text x="510" y="119" text-anchor="middle" fill="#4c1d95" font-size="9">REASONER_B parallel</text>
  <text x="510" y="133" text-anchor="middle" fill="#4c1d95" font-size="9">(both opus-4-8)</text>
  <text x="510" y="147" text-anchor="middle" fill="#4c1d95" font-size="9">Consensus merge:</text>
  <text x="510" y="159" text-anchor="middle" fill="#4c1d95" font-size="9">col → field name,</text>
  <text x="510" y="171" text-anchor="middle" fill="#4c1d95" font-size="9">confidence weights,</text>
  <text x="510" y="181" text-anchor="middle" fill="#4c1d95" font-size="9">enum crosswalk</text>

  <line x1="570" y1="115" x2="598" y2="115" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- Stage 4: Extract -->
  <rect x="600" y="35" width="120" height="190" rx="6" fill="#ecfdf5" stroke="#86efac" stroke-width="2"/>
  <text x="660" y="55" text-anchor="middle" font-weight="bold" fill="#14532d">STAGE 4</text>
  <text x="660" y="69" text-anchor="middle" font-weight="bold" fill="#14532d">Extract</text>
  <text x="660" y="83" text-anchor="middle" fill="#166534" font-size="9">stage4-extract.js</text>
  <line x1="610" y1="92" x2="708" y2="92" stroke="#16a34a" stroke-width="0.5"/>
  <text x="660" y="107" text-anchor="middle" fill="#14532d" font-size="9">BULK batches (haiku)</text>
  <text x="660" y="119" text-anchor="middle" fill="#14532d" font-size="9">BULK_ALT crosscheck</text>
  <text x="660" y="133" text-anchor="middle" fill="#14532d" font-size="9">Multi-refId splitting</text>
  <text x="660" y="145" text-anchor="middle" fill="#14532d" font-size="9">(one row → N coverages)</text>
  <text x="660" y="159" text-anchor="middle" fill="#14532d" font-size="9">refId synthesis rules:</text>
  <text x="660" y="171" text-anchor="middle" fill="#14532d" font-size="9">never invented — derived</text>
  <text x="660" y="183" text-anchor="middle" fill="#14532d" font-size="9">from LOB registry</text>
  <text x="660" y="197" text-anchor="middle" fill="#14532d" font-size="9">Every field carries</text>
  <text x="660" y="209" text-anchor="middle" fill="#14532d" font-size="9">source-cell citation</text>
  <text x="660" y="221" text-anchor="middle" fill="#14532d" font-size="9">(sheet!R{n}C{m})</text>

  <line x1="720" y1="115" x2="748" y2="115" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- Stage 5: Validate -->
  <rect x="750" y="35" width="120" height="155" rx="6" fill="#fff7ed" stroke="#fdba74" stroke-width="2"/>
  <text x="810" y="55" text-anchor="middle" font-weight="bold" fill="#7c2d12">STAGE 5</text>
  <text x="810" y="69" text-anchor="middle" font-weight="bold" fill="#7c2d12">Validate</text>
  <text x="810" y="83" text-anchor="middle" fill="#9a3412" font-size="9">stage5-validate.js</text>
  <line x1="760" y1="92" x2="858" y2="92" stroke="#ea580c" stroke-width="0.5"/>
  <text x="810" y="107" text-anchor="middle" fill="#7c2d12" font-size="9">gpt-5.1 VALIDATOR</text>
  <text x="810" y="119" text-anchor="middle" fill="#7c2d12" font-size="9">(adversarial — different</text>
  <text x="810" y="131" text-anchor="middle" fill="#7c2d12" font-size="9"> provider &amp; family)</text>
  <text x="810" y="145" text-anchor="middle" fill="#7c2d12" font-size="9">Checks: invented refIds,</text>
  <text x="810" y="157" text-anchor="middle" fill="#7c2d12" font-size="9">missing citations,</text>
  <text x="810" y="169" text-anchor="middle" fill="#7c2d12" font-size="9">coverage name drift,</text>
  <text x="810" y="181" text-anchor="middle" fill="#7c2d12" font-size="9">enum hallucinations</text>

  <!-- Stage 6: Reconcile -->
  <rect x="300" y="245" width="400" height="90" rx="6" fill="#f0fdf4" stroke="#4ade80" stroke-width="2"/>
  <text x="500" y="265" text-anchor="middle" font-weight="bold" fill="#14532d">STAGE 6 — Reconcile (stage6-reconcile.js)</text>
  <text x="500" y="283" text-anchor="middle" fill="#15803d" font-size="9">Pure aggregation — writes nothing. Assembles ImportPlan: coverages[], rules[], forms[], ratingProgram, metadata.</text>
  <text x="500" y="297" text-anchor="middle" fill="#15803d" font-size="9">Every entity has: { refId, name, citation, confidence, sourceSheet, sourceRow }.</text>
  <text x="500" y="311" text-anchor="middle" fill="#15803d" font-size="9">Validation failures become importWarnings[] — never silently dropped.</text>
  <text x="500" y="323" text-anchor="middle" fill="#15803d" font-size="9">Plan passed to persist path (same as filing importer) via /api/db/mutate transactional batch.</text>

  <!-- Arrows into stage 6 -->
  <path d="M810 190 Q810 320 700 320" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>
  <path d="M660 225 L660 245" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>
  <path d="M510 195 L510 245" fill="none" stroke="#64748b" stroke-width="1.5" marker-end="url(#b1)"/>

  <!-- SSE progress bar -->
  <rect x="10" y="245" width="270" height="90" rx="6" fill="#eff6ff" stroke="#93c5fd"/>
  <text x="135" y="263" text-anchor="middle" font-weight="bold" fill="#1e3a8a">SSE Progress Stream</text>
  <text x="135" y="279" text-anchor="middle" fill="#1e40af" font-size="9">POST /api/ai/unifiedImport → SSE</text>
  <text x="135" y="293" text-anchor="middle" fill="#1e40af" font-size="9">{t:'progress', stage:1, pct:15, msg}</text>
  <text x="135" y="307" text-anchor="middle" fill="#1e40af" font-size="9">{t:'progress', stage:2, pct:30, …}</text>
  <text x="135" y="321" text-anchor="middle" fill="#1e40af" font-size="9">…{t:'done', plan:ImportPlan}</text>
  <text x="135" y="333" text-anchor="middle" fill="#1e40af" font-size="9">ImportWorkbookModal renders live</text>

  <!-- Output -->
  <rect x="300" y="355" width="570" height="60" rx="6" fill="#dcfce7" stroke="#4ade80"/>
  <text x="585" y="375" text-anchor="middle" font-weight="bold" fill="#14532d">Output: ImportPlan</text>
  <text x="585" y="393" text-anchor="middle" fill="#15803d" font-size="9">{ coverages[], subCoverages[], rules[], forms[], ratingProgram, warnings[], metadata } — passed to mutate() or shown in review UI</text>
  <text x="585" y="406" text-anchor="middle" fill="#15803d" font-size="9">Canary: GL 4-workbook → $2,635 · PH ISO → $1,528 · PA ISO → $1,002</text>

  <!-- Adversarial corpus note -->
  <rect x="10" y="355" width="270" height="115" rx="6" fill="#fef2f2" stroke="#fca5a5"/>
  <text x="135" y="373" text-anchor="middle" font-weight="bold" fill="#b91c1c">Adversarial Test Corpus</text>
  <text x="135" y="389" text-anchor="middle" fill="#991b1b" font-size="9">(import-live.mts — 8 cases)</text>
  <text x="135" y="403" text-anchor="middle" fill="#991b1b" font-size="9">empty workbook</text>
  <text x="135" y="415" text-anchor="middle" fill="#991b1b" font-size="9">decoy sheets (bait labels)</text>
  <text x="135" y="427" text-anchor="middle" fill="#991b1b" font-size="9">duplicate refIds</text>
  <text x="135" y="439" text-anchor="middle" fill="#991b1b" font-size="9">all-placeholder rows</text>
  <text x="135" y="451" text-anchor="middle" fill="#991b1b" font-size="9">wrong-LOB prefix / garbage PDF</text>
  <text x="135" y="463" text-anchor="middle" fill="#991b1b" font-size="9">Pass: 0 invented refIds, 0 silent drops</text>
</svg>
```

### Key Design Principles

| Principle | Implementation |
|---|---|
| **No invented refIds** | refIds derived from LOB registry rules; VALIDATOR checks independently |
| **Every field cited** | Source cell `sheet!R{n}C{m}` attached to every extracted field |
| **Decorrelated validation** | gpt-5.1 (OpenAI) validates Haiku (Anthropic) output — different provider |
| **Warnings not drops** | Unresolved items become `importWarnings[]`, never silently discarded |
| **Same persist path** | ImportPlan → `adapter.db.mutate()` → same Cosmos batch as any edit |
| **Adversarial test corpus** | 8 failure modes tested on every import-live run |

---

## 8. Rating Engine — Three Canaries

`shared/src/rating/evaluator.ts` — pure, no platform imports, no network.

```
evaluate(program, inputs, rtGetter, ldGetter) → EvaluatorResult

Steps → sorted by order → gated by condition expression
Each step produces: factor | addend | override
isCredit: true steps → cumulative product tracked
creditFloor on RatingProgram → corrective factor injected after last credit step (Rule 92)
```

### Locked Canaries (deploy blockers)

| Line | Test file | Premium | Seed fixture |
|---|---|---|---|
| Personal Home (HO-3) | `evaluator.test.ts` | **$1,528** | `seed/personalHome.ts` |
| Personal Auto | `personalAuto.evaluator.test.ts` | **$1,002** | `seed/personalAuto.ts` |
| General Liability | `generalLiability.evaluator.test.ts` | **$2,635** | `seed/generalLiability.ts` |
| Filing import (Lemonade NJ HO) | `evaluator.creditFloor.test.ts` | **$1,281** | `filing/njLemonadeFiling.ts` |

Any change to `evaluator.ts` that shifts a canary without a matching re-derived arithmetic note = blocked PR.

### LOB Registry (`shared/src/insurance/lobRegistry.ts`)

| LOB | Code | Lines |
|---|---|---|
| Personal Home | `PH` | HO-3, HO-4, HO-6 |
| Personal Auto | `PA` | PAP |
| General Liability | `GL` | CGL (occurrence + claims-made) |
| Inland Marine | `IM` | ISO forms |
| Professional | `PR` | E&O, D&O |

Each line carries: refId scheme, peril taxonomy, section hierarchy, bureau rules, rating kit.

---

## 9. DuckCreek Serializer

**Removed 2026-07-13.** The DuckCreek Author XML export (PDM intermediate representation,
`shared/src/duckcreek/` serializer, `server/lib/duckcreek.js` REST API, `exportDuckCreek` AI
handler, and the browser export UI) was deleted end-to-end. `/api/duckcreek/v1/*` now returns 404.
Static analysis (knip / ts-prune / grep) proved DuckCreek was the sole consumer of the PDM, so
`shared/src/pdm/` was removed with it.

---

## 10. Filing Importer

Second ingestion mechanism for regulatory filing PDFs.

### 5-Step Filing Generation (`server/lib/filing.js`)

```
SCOPE      → requireCapability('filing:generate')
RESOLVE    → fetch exact entity states from Cosmos version history (no guessing)
BUILD      → deterministic JSON; SHA-256 hash of every source field
VERIFY     → claude-opus-4-8 independent re-extraction check (GROUNDED_CITED)
FREEZE     → immutable create-only Cosmos record (no updates allowed)
```

Every field in a frozen filing traces to a `versionId`. The AI verify step independently
re-extracts each value and flags mismatches — filing is rejected if VERIFY disagrees with BUILD.

### Filing Import Domain (`shared/src/insurance/filing/`)

```
CLASSIFY  → identify filing type (rate/form/rule amendment, new product)
EXTRACT   → tableParser.ts deterministically extracts factor tables (no model transcription)
            prose sections extracted by BULK_VERIFY (Haiku) with citation
RECONCILE → reconcileFiling() → ImportPlan (same shape as workbook importer)
             every unresolved item emitted with reason + citation
             → same mutate() persist path
```

**Key property:** Tables are never transcribed by AI — `tableParser.ts` reads them directly
from the PDF structure. AI handles only prose interpretation.

---

## 11. Frontend Architecture

### Adapter Seam Pattern

```typescript
// app/src/lib/backend/index.ts
export { adapter } from './azure.adapter'

// All components:
import { adapter } from '@/lib/backend'
await adapter.db.mutate({ entity, type, expectedRev })
// ← NEVER import CosmosClient, firebase, etc. directly
```

### Mutation Conflict Handling

```typescript
try {
  await adapter.db.mutate({ entity: updated, expectedRev: current.rev })
} catch (e) {
  if (e instanceof MutationConflictError) {
    // show ConflictDiffDialog → user resolves → retry with winner
  }
}
```

### Design Token System

All colors live in `app/src/index.css` as CSS custom properties (`var(--color-*)`).
Tailwind v4 `@theme` block maps tokens to utility classes.
**No raw hex anywhere in browser code** (SVG exported to disk is the sole exception).

### Smart Polling (no onSnapshot)

Azure Cosmos does not support real-time listeners from browsers. The adapter uses:
- Interval-based polling with exponential backoff
- Presence (live cursors) via a separate polling loop on the `presence` container
- `VersionWatcher` component for SPA hot-reload on new deploy

### PWA / Service Worker

- SW cache name versioned by `__BUILD_ID__` (Vite stamps at build time)
- Fail-closed `/api` caching: only `/api/auth/tenants` cached (login dropdown)
- All `/api/*` calls bypass SW → always live server responses
- Cache purge on logout

---

## 12. Key Screens

### Screen Map

```svg
<svg viewBox="0 0 860 560" xmlns="http://www.w3.org/2000/svg" font-family="ui-monospace,monospace" font-size="10">
  <defs>
    <marker id="c1" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8"/>
    </marker>
  </defs>

  <!-- Background shell -->
  <rect x="5" y="5" width="850" height="550" rx="10" fill="#f8fafc" stroke="#e2e8f0" stroke-width="1.5"/>

  <!-- Topbar -->
  <rect x="5" y="5" width="850" height="30" rx="10" fill="#1e293b"/>
  <rect x="5" y="20" width="850" height="15" fill="#1e293b"/>
  <text x="30" y="25" fill="#f1f5f9" font-weight="bold" font-size="11">Product Reinvention Hub</text>
  <text x="400" y="25" text-anchor="middle" fill="#94a3b8" font-size="9">Topbar.tsx — theme toggle · user menu · tenant context</text>
  <text x="800" y="25" fill="#94a3b8" font-size="9">EDITOR</text>

  <!-- Left nav -->
  <rect x="5" y="35" width="130" height="520" fill="#0f172a"/>
  <text x="70" y="55" text-anchor="middle" fill="#94a3b8" font-size="9" font-weight="bold">Navigation</text>
  <text x="70" y="75" text-anchor="middle" fill="#e2e8f0" font-size="9">Home</text>
  <text x="70" y="93" text-anchor="middle" fill="#60a5fa" font-size="9">Products ←</text>
  <text x="70" y="111" text-anchor="middle" fill="#e2e8f0" font-size="9">Claims</text>
  <text x="70" y="129" text-anchor="middle" fill="#e2e8f0" font-size="9">Dictionary</text>
  <text x="70" y="147" text-anchor="middle" fill="#e2e8f0" font-size="9">Tasks (GTM)</text>
  <text x="70" y="165" text-anchor="middle" fill="#e2e8f0" font-size="9">Explorer</text>
  <text x="70" y="183" text-anchor="middle" fill="#e2e8f0" font-size="9">HomeCheck</text>
  <text x="70" y="201" text-anchor="middle" fill="#e2e8f0" font-size="9">News</text>
  <text x="70" y="219" text-anchor="middle" fill="#e2e8f0" font-size="9">Admin</text>

  <!-- Main area: Product Workspace tabs -->
  <rect x="140" y="35" width="715" height="30" fill="#1e293b" opacity="0.3"/>
  <text x="180" y="54" fill="#60a5fa" font-size="9" font-weight="bold">Overview</text>
  <text x="245" y="54" fill="#94a3b8" font-size="9">Coverages</text>
  <text x="305" y="54" fill="#94a3b8" font-size="9">Rules</text>
  <text x="350" y="54" fill="#94a3b8" font-size="9">Forms</text>
  <text x="395" y="54" fill="#94a3b8" font-size="9">Pricing</text>
  <text x="445" y="54" fill="#94a3b8" font-size="9">States</text>
  <text x="490" y="54" fill="#94a3b8" font-size="9">Builder</text>

  <!-- Overview tab content -->
  <rect x="140" y="65" width="715" height="490" fill="white"/>

  <!-- Product vitals card -->
  <rect x="150" y="75" width="200" height="115" rx="5" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="250" y="93" text-anchor="middle" font-weight="bold" fill="#1e293b">ProductVitals.tsx</text>
  <text x="160" y="110" fill="#64748b" font-size="9">Name: HO-3 Premier Plus</text>
  <text x="160" y="124" fill="#64748b" font-size="9">LOB: Personal Home (PH)</text>
  <text x="160" y="138" fill="#64748b" font-size="9">Status: ACTIVE · v14</text>
  <text x="160" y="152" fill="#64748b" font-size="9">refId: PH.PROD.001</text>
  <text x="160" y="166" fill="#64748b" font-size="9">States: 12 approved</text>
  <text x="160" y="180" fill="#64748b" font-size="9">LineageBadge: ISO-HO3</text>

  <!-- Presence avatars -->
  <rect x="360" y="75" width="180" height="50" rx="5" fill="#eff6ff" stroke="#bfdbfe"/>
  <text x="450" y="93" text-anchor="middle" font-weight="bold" fill="#1e3a8a">PresenceAvatars.tsx</text>
  <text x="450" y="107" text-anchor="middle" fill="#1e40af" font-size="9">Live users viewing this product</text>
  <text x="450" y="119" text-anchor="middle" fill="#1e40af" font-size="9">● Sarah ● Marcus (polling presence)</text>

  <!-- Export menu -->
  <rect x="555" y="75" width="170" height="70" rx="5" fill="#fdf4ff" stroke="#e9d5ff"/>
  <text x="640" y="93" text-anchor="middle" font-weight="bold" fill="#701a75">ExportMenu.tsx</text>
  <text x="640" y="107" text-anchor="middle" fill="#7e22ce" font-size="9">Export to Excel</text>
  <text x="640" y="119" text-anchor="middle" fill="#7e22ce" font-size="9">SERFF Bundle</text>
  <text x="640" y="131" text-anchor="middle" fill="#7e22ce" font-size="9">Generate Filing</text>
  <text x="640" y="143" text-anchor="middle" fill="#7e22ce" font-size="9">Clone Product</text>

  <!-- Summary dashboard -->
  <rect x="150" y="200" width="350" height="120" rx="5" fill="#f0fdf4" stroke="#86efac"/>
  <text x="325" y="218" text-anchor="middle" font-weight="bold" fill="#14532d">ProductSummaryDashboard.tsx</text>
  <text x="165" y="236" fill="#15803d" font-size="9">AI-generated narrative (claude-opus-4-8, GROUNDED_CITED)</text>
  <rect x="160" y="244" width="90" height="30" rx="3" fill="#dcfce7" stroke="#4ade80"/>
  <text x="205" y="263" text-anchor="middle" fill="#14532d" font-size="9">Coverage count: 24</text>
  <rect x="260" y="244" width="90" height="30" rx="3" fill="#dcfce7" stroke="#4ade80"/>
  <text x="305" y="263" text-anchor="middle" fill="#14532d" font-size="9">Rules: 18 active</text>
  <rect x="360" y="244" width="90" height="30" rx="3" fill="#dcfce7" stroke="#4ade80"/>
  <text x="405" y="263" text-anchor="middle" fill="#14532d" font-size="9">Forms: 7 attached</text>
  <text x="165" y="300" fill="#15803d" font-size="9">HistoryDrawer: versioned timeline → PromoteDraftDialog / RetireProductDialog</text>

  <!-- Coverage tree -->
  <rect x="150" y="330" width="240" height="170" rx="5" fill="#eff6ff" stroke="#93c5fd"/>
  <text x="270" y="348" text-anchor="middle" font-weight="bold" fill="#1e3a8a">CoverageTree.tsx</text>
  <text x="163" y="364" fill="#1e40af" font-size="9">▼ Dwelling (DW) PH.COV.001</text>
  <text x="175" y="378" fill="#1e40af" font-size="9">  ▷ Other Structures</text>
  <text x="175" y="392" fill="#1e40af" font-size="9">  ▷ Personal Property</text>
  <text x="163" y="406" fill="#1e40af" font-size="9">▼ Liability (LI) PH.COV.010</text>
  <text x="175" y="420" fill="#1e40af" font-size="9">  ▷ Medical Payments</text>
  <text x="163" y="434" fill="#1e40af" font-size="9">▼ Additional Living Exp</text>
  <text x="163" y="450" fill="#1e40af" font-size="9">RefChip: PH.COV.001</text>
  <text x="163" y="464" fill="#1e40af" font-size="9">CoverageEditDialog (inline edit)</text>
  <text x="163" y="478" fill="#1e40af" font-size="9">coverageAspects.ts: limit/ded/opt shapes</text>
  <text x="163" y="492" fill="#1e40af" font-size="9">← EDITOR+ only</text>

  <!-- Rating panel -->
  <rect x="400" y="330" width="240" height="170" rx="5" fill="#fff7ed" stroke="#fdba74"/>
  <text x="520" y="348" text-anchor="middle" font-weight="bold" fill="#7c2d12">HomeownersRatingPanel.tsx</text>
  <text x="413" y="364" fill="#9a3412" font-size="9">RatingAlgorithm: step list</text>
  <text x="413" y="378" fill="#9a3412" font-size="9">RatingTableEditor: LDTable / RTTable</text>
  <text x="413" y="392" fill="#9a3412" font-size="9">RatingStepDialog: add/edit steps</text>
  <text x="413" y="406" fill="#9a3412" font-size="9">ruleSim.ts: live sim inputs</text>
  <text x="413" y="420" fill="#9a3412" font-size="9">Canary badge: $1,528</text>
  <text x="413" y="434" fill="#9a3412" font-size="9">GenericRatingPanel (PA/GL/IM/PR)</text>

  <!-- StateTileMap -->
  <rect x="650" y="200" width="195" height="300" rx="5" fill="#fdf4ff" stroke="#e9d5ff"/>
  <text x="747" y="218" text-anchor="middle" font-weight="bold" fill="#701a75">StateTileMap.tsx</text>
  <text x="665" y="234" fill="#7e22ce" font-size="9">50-state grid, color-coded</text>
  <text x="665" y="248" fill="#7e22ce" font-size="9">by StateScope status:</text>
  <rect x="665" y="256" width="70" height="14" rx="2" fill="#dcfce7"/>
  <text x="700" y="267" text-anchor="middle" fill="#14532d" font-size="8">APPROVED</text>
  <rect x="665" y="274" width="70" height="14" rx="2" fill="#fef3c7"/>
  <text x="700" y="285" text-anchor="middle" fill="#78350f" font-size="8">PENDING</text>
  <rect x="665" y="292" width="70" height="14" rx="2" fill="#fce7f3"/>
  <text x="700" y="303" text-anchor="middle" fill="#831843" font-size="8">NOT FILED</text>
  <rect x="665" y="310" width="70" height="14" rx="2" fill="#f1f5f9"/>
  <text x="700" y="321" text-anchor="middle" fill="#475569" font-size="8">WITHDRAWN</text>
  <text x="665" y="342" fill="#7e22ce" font-size="9">All state colors from</text>
  <text x="665" y="355" fill="#7e22ce" font-size="9">var(--color-*) tokens</text>
  <text x="665" y="370" fill="#7e22ce" font-size="9">Click tile → state detail</text>
  <text x="665" y="384" fill="#7e22ce" font-size="9">EDITOR: set scope status</text>

  <!-- Import modal note -->
  <rect x="150" y="510" width="340" height="30" rx="5" fill="#fef9c3" stroke="#fde047"/>
  <text x="320" y="530" text-anchor="middle" fill="#713f12" font-size="9">ImportWorkbookModal → 6-stage SSE progress → review tree → mutate() | FilingImportModal (PDF)</text>

  <!-- Claims note -->
  <rect x="500" y="510" width="345" height="30" rx="5" fill="#fdf2f8" stroke="#f0abfc"/>
  <text x="672" y="530" text-anchor="middle" fill="#701a75" font-size="9">Claims.tsx: MillerColumn LOB→product→form → DeterminationCard (AI copilot, SSE)</text>
</svg>
```

### Route Inventory

| Route | Component | Role gate |
|---|---|---|
| `/` | `Home.tsx` — portfolio metrics, priority rail, base forms library | VIEWER+ |
| `/products` | `Products.tsx` — product catalogue grid with search/filter | VIEWER+ |
| `/products/:id` | `ProductWorkspace.tsx` — tab container | VIEWER+ |
| `/products/:id/overview` | `ProductOverview.tsx` | VIEWER+ |
| `/products/:id/coverages` | `ProductCoverages.tsx` — CoverageTree | VIEWER+ |
| `/products/:id/rules` | `ProductRules.tsx` — RuleBuilder | EDITOR+ |
| `/products/:id/forms` | `ProductForms.tsx` — form matrix | EDITOR+ |
| `/products/:id/pricing` | `ProductPricing.tsx` — rating panels | EDITOR+ |
| `/products/:id/states` | `ProductStates.tsx` — StateTileMap | EDITOR+ |
| `/claims` | `Claims.tsx` — MillerColumn + AI copilot | VIEWER+ |
| `/homecheck` | `HomeCheck.tsx` — consumer risk (no auth required) | guest |
| `/explorer` | `Explorer.tsx` — GTM process value explorer | VIEWER+ |
| `/tasks` | `Tasks.tsx` — generated task list | VIEWER+ |
| `/dictionary` | `Dictionary.tsx` | VIEWER+ |
| `/news` | `News.tsx` | VIEWER+ |
| `/admin` | `Admin.tsx` | SUPER_ADMIN / SUPPORT |
| `/tenant-admin` | `TenantAdmin.tsx` | TENANT_ADMIN |

---

## 13. API Surface Map

| Method | Path | Auth | Module | Notes |
|---|---|---|---|---|
| `GET` | `/api/health` | none | inline | no-cache |
| `POST` | `/api/auth/otp/request` | none | auth.js | rate 10/hr/IP |
| `POST` | `/api/auth/otp/verify` | none | auth.js | returns JWT |
| `POST` | `/api/auth/bootstrap` | admin secret | auth.js | SUPER_ADMIN init |
| `GET` | `/api/auth/tenants` | none | auth.js | login dropdown |
| `GET` | `/api/auth/me` | JWT | auth.js | decoded user |
| `POST` | `/api/auth/logout` | JWT | auth.js | jti revoke |
| `POST` | `/api/auth/change-password` | JWT | auth.js | |
| `*` | `/api/admin/*` | JWT+SUPER_ADMIN | admin.js | tenant mgmt |
| `*` | `/api/tenant-admin/*` | JWT+TENANT_ADMIN | tenant-admin.js | own org |
| `POST` | `/api/db/get` | JWT | data.js | entity fetch |
| `POST` | `/api/db/list` | JWT | data.js | filtered list |
| `POST` | `/api/db/mutate` | JWT+EDITOR | data.js | atomic batch |
| `POST` | `/api/ai/:name` | JWT+ai:invoke | ai/index.js | SSE stream |
| `GET` | `/api/storage/:path` | JWT | storage.js | Blob read |
| `PUT` | `/api/storage/:path` | JWT+EDITOR | storage.js | Blob write |
| `POST` | `/api/serff/v1/bundle` | JWT+EDITOR | serff.js | rate exhibit + AI prose |
| `GET` | `/api/serff/v1/states` | JWT | serff.js | state filing matrix |
| `POST` | `/api/filing/*` | JWT+filing:generate | filing.js | 5-step frozen filing |
| `*` | `/api/homecheck/v1/*` | none | homecheck.js | guest; zero portfolio |
| `GET` | `*` | none | static | SPA + fallback |

### Named AI Handlers (`/api/ai/:name`)

| Handler name | Model role | Description |
|---|---|---|
| `chat` | GROUNDED_CITED | Portfolio copilot — RAG-grounded SSE stream |
| `unifiedImport` | BULK_VERIFY + ensemble | 6-stage import brain |
| `summarizeProduct` | GROUNDED_CITED | Product narrative generation |
| `scaffoldProduct` | GROUNDED_CITED | New product scaffold from LOB template |
| `draftRule` | GROUNDED_CITED | AI-assisted rule authoring |
| `proposeMappingCorrection` | BULK_VERIFY | Coverage mapping correction |
| `identifyBaseForm` | BULK_VERIFY | Base form identification |
| `analyzeClaim` | GROUNDED_CITED | Claims copilot determination |
| `refreshNews` | BULK_VERIFY | Industry news summarization |
| `reindexProduct` | EMBED | Re-chunk product for RAG |
| `shapeFeedback` | BULK_VERIFY | Feedback shape analysis |

---

## 14. Binding Invariants

These are non-negotiable. Any PR that violates them is blocked regardless of test pass.

| Invariant | Where enforced | What breaks if violated |
|---|---|---|
| **Adapter seam** | oxlint `no-restricted-imports`; TS2307 | Platform SDK in browser = credential exposure |
| **Atomic mutations** | source-audit test; data.js | Broken audit trail; stale search index; orphaned versions |
| **Role enforcement** | `requireRole()`/`requireCapability()` middleware | VIEWER can write; tenant A reads tenant B |
| **AI server-side** | oxlint; no SDK in app/src/ | Browser holds model API key |
| **AI grounded+cited** | SYSTEM prompt; source-audit test | Free invention = compliance failure |
| **refId / form chips** | `RefChip.tsx`; never strip | Load-bearing display; regulators reference these |
| **HO-3 $1,528 canary** | `evaluator.test.ts`; CI gate | Wrong premium → rates not filed correctly |
| **Design tokens** | No hex in app/src/; SVG export only exception | Brand inconsistency; dark mode breaks |
| **Model IDs** | `fleet.ts` + `fleet.js`; never `claude-fable-5` | Wrong cost tier; capability mismatch |
| **Tenant isolation** | partition key + `c.tenantId` filter + re-check | Cross-tenant data leak |
| **Immutable filings** | create-only in filing.js | Regulatory audit integrity |

---

## 15. CI/CD Pipeline

`azure-pipelines.yml` — push to `main` triggers:

```
1. pnpm install (cached)
2. pnpm typecheck          ← TS errors = deploy blocked
3. pnpm lint               ← oxlint violations = deploy blocked
4. pnpm test               ← canary failures ($1,528/$1,002/$2,635) = deploy blocked
5. pnpm build              ← Vite SPA build → server/public/
6. check-bundle-budget.mjs ← bundle size gate (scripts/)
7. gitleaks secret scan    ← shallow clone tip-tree scan; .gitleaks.toml at root
8. az webapp deploy        ← Azure App Service (app-prodhub-dev / app-prodhub-prod)
```

**Never skip the canary or bundle budget checks.** Adding CI steps is allowed; removing them is blocked.

Local gate alias:
```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

---

## 16. Hardening Campaign

Active campaign: `feat/hardening-2026-07` branch.
Work queue: `docs/audit/EXECUTION.md`.

### Architecture Invariant Tests (`app/src/__invariants__/`)

These tests are loaded by vitest and fail the gate if violated:

| DEF | What it tests |
|---|---|
| DEF-0044 | Adapter seam — no bare Cosmos/Firebase imports in app/src/ |
| DEF-0045 | AI grounded+cited — SYSTEM prompt contains citation enforcement |
| DEF-0047 | Atomic mutations — no direct Cosmos writes outside data.js |
| RISK-006 | jti revocation — logout hits /api/auth/logout and revokes token |

### Do-Not-Change List

- `shared/src/rating/evaluator.ts` canary behavior
- `app/src/lib/backend/azure.adapter.ts` public interface (extend OK, rename = breaking)
- `server/lib/auth.js` RANK ordering or JWT format
- `azure-pipelines.yml` gate steps

### Blocked-Item Protocol

After 3 failed attempts on any item: mark **BLOCKED** in EXECUTION.md with failure notes.
Do not re-attempt a blocked item in the same session.

---

## Appendix A — Key File Index

| File | Purpose |
|---|---|
| `shared/src/types.ts` | Canonical domain types — `Product`, `Coverage`, `Rule`, `RatingProgram`, … |
| `shared/src/ai/fleet.ts` | Fleet registry + pricing (source of truth for all model IDs) |
| `shared/src/rating/evaluator.ts` | Line-agnostic pure rating engine |
| `shared/src/insurance/lobRegistry.ts` | 5-line LOB registry (PH/PA/GL/IM/PR) |
| `server/lib/fleet.js` | Production model router + cost guard |
| `server/lib/auth.js` | Email OTP + JWT + role enforcement |
| `server/lib/authz.js` | Capability matrix |
| `server/lib/data.js` | Cosmos tenant-isolated CRUD + atomic mutate |
| `server/lib/ai/chat.js` | Portfolio copilot (RAG-grounded SSE) |
| `server/lib/import-brain/index.js` | 6-stage import pipeline entry |
| `server/lib/filing.js` | 5-step regulatory filing generation |
| `server/lib/homecheck.js` | Consumer risk API (zero portfolio access) |
| `app/src/lib/backend/azure.adapter.ts` | BackendAdapter implementation |
| `app/src/components/product/CoverageTree.tsx` | Coverage hierarchy editor |
| `app/src/components/product/StateTileMap.tsx` | 50-state approval grid |
| `app/src/components/product/ImportWorkbookModal.tsx` | Import brain UI (SSE progress) |
| `app/src/index.css` | All design tokens — `var(--color-*)` |
| `scripts/import-live.mts` | Cross-format import harness (8 ISO + 3 filing + 8 adversarial) |
| `scripts/import-judge.ts` | Adversarial oracle (claude-opus-4-8 grades coverage tree) |
| `docs/adr/0001-model-ids.md` | Canonical model selection ADR |
| `docs/audit/EXECUTION.md` | Hardening campaign work queue |
| `azure-pipelines.yml` | CI/CD gate + deploy |

---

## Appendix B — Glossary

| Term | Definition |
|---|---|
| **refId** | Unique identifier for every coverage/rule/form (`PH.COV.001`, `GL.RULE.042`). Never invented; always derived from LOB registry rules. Load-bearing display element. |
| **ImportPlan** | Typed output of both the workbook importer and the filing importer — same shape, same persist path. |
| **GROUNDED_CITED** | AI role requiring every response to cite source documents. Used for customer-visible prose and any field that flows into a filing. |
| **BULK_VERIFY** | AI role for high-throughput extraction. Cheaper; used for row-by-row workbook processing. |
| **VALIDATOR** | Stage 5 of import brain — uses gpt-5.1 (OpenAI) to adversarially check Haiku (Anthropic) output. Decorrelated by design. |
| **Atomic mutate** | Single Cosmos transactional batch: entity + auditEvent + version snapshot + searchIndex. No bare writes exist. |
| **Canary** | A locked premium value ($1,528 / $1,002 / $2,635) that must remain exactly correct or the deploy is blocked. |
| **creditFloor** | Optional cap on cumulative discount applied by `isCredit` rating steps (Rule 92 pattern). |
| **StateScope** | Per-product, per-state approval status: APPROVED / PENDING / NOT_FILED / WITHDRAWN. Displayed on StateTileMap. |
| **Lineage** | Provenance tag on a product (e.g., `ISO-HO3`, `FILING-NJ-2024`) displayed as a badge. |
| **jti** | JWT ID — unique token identifier added at issue; stored in revocation set on logout (RISK-006). |
| **SILO_READY** | Seam in cosmos.js for future dedicated-container per-tenant isolation (currently pooled). |
| **Fleet** | The set of AI model deployments + their roles, pricing, and routing logic. Defined in `fleet.ts` / `fleet.js`. |
