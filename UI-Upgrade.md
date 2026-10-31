# Dexter Write — UI Upgrade Plan

**Status:** Core implementation complete; P2 cleanup deferred  
**Last updated:** 2026-10-28  
**Scope:** Visual system, layout, component styling, button/state quality, responsive polish  
**Out of scope:** Product logic, compiler architecture, Supabase/MCP behavior, data model changes

> The component checklists below preserve the original audit. The **§16 progress tracker and §16.1 implementation log are authoritative** for current state.

---

## 0. Goal

Dexter Write ka feature set already functional hai, but UI feels “vibe-coded” because there is no single visual system behind it. The goal is to make the app feel like a deliberate, professional desktop writing tool:

- Calm, monochrome “ink and paper” interface
- One consistent type, spacing, radius, border, and control-size system
- Buttons that look and behave like real buttons
- Every screen uses the same header, footer, empty, loading, error, and disabled-state language
- No decorative purple/pink gradients, glows, glass blur, or random colors
- Every existing feature remains intact

This document is the single source of truth. When work resumes, start from the first unchecked item.

---

## 1. Why the current UI feels “vibe-coded”

### 1.1 Audit snapshot

| Item | Current state |
|---|---|
| Component files | 26 |
| Global CSS | 1,672 lines / ~68 KB in `src/index.css` |
| Inline style objects | 232 across components |
| Type families | Inter, Plus Jakarta Sans, JetBrains Mono, Georgia (preview) |
| Radii | 13 distinct values: 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 16, 20, 999 |
| Font sizes | 10, 10.5, 11, 11.5, 12, 12.5, 13, 14, 14.5, 15, 21 |
| Control heights | Mixed 20, 22, 24, 26, 28, 30, 34px |
| Shadows/glows/gradients/filters | 60+ declarations |
| Modal widths | 460, 760, 780 + inline 800, 840 |
| Most inline styles | `PreviewPane` 68, `ReviewAgentModal` 57, `CitationsModal` 30, `HistoryModal` 18 |

### 1.2 Visual causes

- Purple `#6366f1` mixed with violet and pink gradients
- Green `#34d3a6` used as a second accent
- Indigo user chat bubbles
- Frosted glass toolbar with `blur(18px) saturate(180%)`
- Glows on brand mark, focus states, primary buttons, tabs, modal icons, status icons
- Hardcoded colors in components (`#60a5fa`, `#10b981`, `#fbbf24`, `#eef0f3`)
- Undefined tokens in CSS: `--surface`, `--surface-sunken`, `--text-secondary`
- Too many arbitrary sizes and one-off layout styles
- Functional controls rendered as native/unstyled elements in custom surfaces

### 1.3 P0 defect visible in Project Hub screenshot

`ProjectHubModal` template cards overlap and clip their text.

Root cause:

- `ProjectHubModal.tsx` renders template cards as `<button className="btn template-card">`.
- `.btn` sets `height: 30px` and `white-space: nowrap`.
- `.template-card` changes to `flex-direction: column` and adds `padding: 14px`, but does not reset height or white-space.
- Card content therefore overflows a 30px box and overlaps the next row.

References:

- `src/components/ProjectHubModal.tsx:37`
- `src/index.css:154` (`← .btn` fixed height)
- `src/index.css:1481` (`← .template-card`)

Other Project Hub issues from the screenshot:

- Huge unexplained vertical gap between the action row and “Create a document”
- Four large grid buttons look like form rows, not actions
- Native “Choose Files / No file chosen” control clashes with the custom UI
- Purple “Create” button
- No visible labels above name/format fields
- Template descriptions use undefined `--text-secondary`
- Card background uses undefined `--surface`
- “Save current document as a personal template” section has excessive empty space
- Modal is very tall and likely needs internal scrolling with a fixed footer

This is P0 because Project Hub is the first screen many users see.

---

## 2. Target direction: “Ink & Paper”

A monochrome editorial workstation. Flat surfaces, 1px borders, strong typography, restrained motion. Reference feel: Linear, VS Code, iA Writer — not a Dribbble gradient dashboard.

### 2.1 Principles

1. Chrome is monochrome. Document content is paper.
2. One accent: contrast. White-on-black in dark mode, black-on-white in light mode.
3. Borders do the structural work; shadows are rare.
4. Color is functional only: error, warning, diff, editor syntax.
5. One primary action per region.
6. Every control has hover, active, focus, disabled, and loading states.
7. Dense but calm: compact rows, clear hierarchy, no dead space.
8. Every screen shares the same primitives. No screen-specific button styles.

### 2.2 Color exceptions

Allowed color:

- Error/destructive states
- Warning states
- Diff inserted/deleted lines
- Editor syntax highlighting
- Mermaid diagram content if user content requires it

Not allowed in chrome:

- Purple, violet, pink, teal, indigo as decoration
- Gradient brand mark
- Glowing borders
- Colored success buttons
- Colored focus rings

### 2.3 Dark / light palettes

```css
/* Dark */
--bg: #0b0b0c;
--panel: #111112;
--panel-2: #171718;
--panel-3: #1d1d1f;
--text: #f0f0f0;
--muted: #a1a1a6;
--muted-dim: #6e6e73;
--border: #2a2a2d;
--border-soft: #202023;
--inverse-bg: #f0f0f0;
--inverse-text: #0b0b0c;

/* Light */
--bg: #f7f7f5;
--panel: #ffffff;
--panel-2: #f0f0ec;
--panel-3: #e6e6e1;
--text: #141414;
--muted: #5f5f63;
--muted-dim: #8a8a8e;
--border: #d8d8d2;
--border-soft: #e7e7e2;
--inverse-bg: #141414;
--inverse-text: #ffffff;
```

Semantic:

```css
--danger: #c94b4b;
--danger-soft: rgba(201, 75, 75, 0.10);
--warning: #a86b16;
--warning-soft: rgba(168, 107, 22, 0.10);
--diff-add: #2f6b4f;
--diff-del: #8a3a3a;
```

Success should be neutral (text, check icon, or neutral toast), not a green button.

### 2.4 Typography

- UI: **Inter**
- Code, labels, numbers: **JetBrains Mono**
- Document preview: **Georgia**
- Remove Plus Jakarta Sans from UI. Keep only for the wordmark if necessary; otherwise remove entirely.

Scale:

| Token | Size | Use |
|---|---|---|
| `--text-meta` | 11px | status, timestamps, helper text |
| `--text-label` | 12px | labels, buttons, tabs |
| `--text-body` | 13px | body, chat, forms |
| `--text-title` | 15px | modal titles, section titles |
| `--text-page` | 20px | page/empty-state title |
| `--text-hero` | 28px | rare hero/onboarding heading |

Weights: 400, 500, 600 only. Brand wordmark may use 700.  
Line heights: 1.4 for UI, 1.5 for long copy.  
Remove 10, 10.5, 11.5, 12.5, 14.5.

### 2.5 Spacing, radius, controls

Spacing scale: `4 / 8 / 12 / 16 / 24 / 32 / 48`

Radius:

- `4px` inputs, small chips
- `6px` buttons, tabs, segmented controls
- `8px` cards, panels, modals
- `999px` pills only

Control heights:

```css
--control-xs: 24px;
--control-sm: 28px;
--control-md: 32px;
--control-lg: 36px;
```

Rules:

- Toolbar: 48px
- Modal footer: 32px controls
- Inputs/selects: 32px
- Icon buttons: 28 × 28px
- Pane header: 34px
- Status bar: 28px
- Tabs: 30px
- Touch targets: minimum 32px

### 2.6 Borders, elevation, motion

- Use 1px neutral borders. Remove inset highlights.
- No `box-shadow` on normal buttons, tabs, panes, or icons.
- Shadow only for modal and toast:
  `0 16px 48px rgba(0, 0, 0, 0.35)`
- No `backdrop-filter` on toolbar.
- Modal backdrop: solid dim, no heavy blur.
- Motion: 120–160ms ease. No bounce, no scale-in.
- Live/compile pulse allowed only when it communicates state.
- Respect `prefers-reduced-motion`.

### 2.7 Focus and disabled

- Focus: `outline: 2px solid var(--text); outline-offset: 2px;`
- No glow ring.
- Disabled: 45% opacity + `cursor: not-allowed`.
- Disabled controls with non-obvious reasons get a title/tooltip.
- Loading buttons keep their width and show a spinner + present-participle label.

---

## 3. Universal button contract

This is the standard every button must meet.

### 3.1 Structure and semantics

- [ ] Use `<button type="button">` for actions. Never clickable `<div>`/`<span>`.
- [ ] Use `<a>` only for navigation.
- [ ] No nested interactive elements inside a button.
- [ ] Icon-only buttons need `aria-label` and `title`.
- [ ] Toggles need `aria-pressed`.
- [ ] Destructive actions show a confirmation dialog with the object name.
- [ ] Native `window.confirm` must be replaced with the app’s own confirm dialog.

Known violation:

- Editor tab close is a `<span onClick>` inside a `<button>` (`src/App.tsx:1653`). This is invalid and not keyboard-accessible.

### 3.2 Visual hierarchy

| Type | Look | Use |
|---|---|---|
| Primary | Inverse fill (white on dark / black on light), 600 weight | One main action per region |
| Secondary | Panel-2 fill + 1px border | Normal actions |
| Ghost | Transparent, muted text | Toolbar/inline actions |
| Icon | 28×28, no label | Dense toolbars |
| Danger | 1px danger border, danger text, danger-soft hover | Delete/reset |
| Link | Underlined text, no color | Inline navigation |
| Toggle | Neutral selected fill + check | Persisted states |

Rules:

- [ ] No gradients on buttons.
- [ ] No glow on hover.
- [ ] No more than one primary button per visual region.
- [ ] Modal footer order: secondary left, primary right.
- [ ] Destructive action never uses primary styling.

### 3.3 States

Every button must define:

- [ ] Default
- [ ] Hover: one step lighter/darker surface
- [ ] Active/pressed: 1px downward shift or darker surface
- [ ] Focus-visible: 2px outline
- [ ] Disabled: 45% opacity, no pointer
- [ ] Loading: spinner, disabled, label changes (`Saving…`, `Compiling…`)
- [ ] Success/error feedback: toast or inline message, not a color change on the button

### 3.4 Sizes and labels

- [ ] Only `24 / 28 / 32 / 36` heights.
- [ ] Font 12px/600 for normal buttons, 11px/500 for xs.
- [ ] Icon 14px default, 16px for primary, 18px for activity bar.
- [ ] Gap between icon and label: 6px.
- [ ] Sentence case. No ALL CAPS button labels.
- [ ] Labels must be verbs: `Create`, `Import`, `Compile`, `Save`, not `OK`.
- [ ] Loading label must be specific: `Importing…`, not `Loading…`.

### 3.5 Common “fake button” causes to remove

- [ ] Fixed `height` on cards that contain multi-line content
- [ ] Grid-stretched action buttons that look like form fields
- [ ] Native file inputs and unstyled selects inside custom surfaces
- [ ] Inconsistent disabled opacity across screens
- [ ] Buttons with no hover or pressed feedback
- [ ] Buttons that do nothing visible after click
- [ ] Repeated primary buttons in the same view
- [ ] Tiny 12px icons inside 28px hit areas without tooltips
- [ ] Card/template controls using `.btn` and inheriting single-line layout

---

## 4. Universal input/form contract

- [ ] Input, select, textarea: 32px height, 12px font, 6px radius.
- [ ] Visible label above control, 12px/600 muted.
- [ ] Optional helper text, 11px muted.
- [ ] Error text below field, danger color, `role="alert"`.
- [ ] Placeholder is an example, not a label.
- [ ] File upload uses a custom dropzone/button, never a raw file input.
- [ ] Checkbox/toggle rows align text to the first line, not center of multi-line copy.
- [ ] Native selects may remain native internally but must share the same outer styling.
- [ ] Long helper paragraphs collapse behind “Details” or move to documentation.

Known violations:

- Project Hub name and format fields have no visible labels.
- Project Hub uses a raw `<input type="file">` (`ProjectHubModal.tsx:34`).
- AssetLibrary uses a `<label className="btn">` wrapping a hidden file input; this is acceptable only after the label is styled as a real upload button.

---

## 5. Universal modal contract

- [ ] Widths only: 440 (`sm`), 640 (`md`), 840 (`lg`).
- [ ] Remove inline widths 800/840.
- [ ] `max-height: calc(100dvh - 48px)`.
- [ ] Fixed header and footer; only body scrolls.
- [ ] Header: neutral icon tile, title, optional subtitle, optional category, close button.
- [ ] No gradient modal icon; no glowing close button.
- [ ] Footer: secondary actions left, primary right; close/cancel is always secondary.
- [ ] Destructive confirmations use the same modal shell, not `window.confirm`.
- [ ] Body sections use 24px vertical rhythm.
- [ ] Long content never pushes the footer off-screen.
- [ ] On mobile: full-height sheet, sticky footer.

---

## 6. Component-by-component backlog

Priority legend:

- **P0:** broken/blocking visual defect
- **P1:** high-impact consistency or usability
- **P2:** polish after the system is stable

### 6.1 Global CSS and primitives

- [ ] **P0** Fix `.btn` fixed height leaking into card/template use.
- [ ] **P0** Define or replace undefined tokens: `--surface`, `--surface-sunken`, `--text-secondary`.
- [ ] **P1** Replace `--brand-grad` with a solid token or one neutral surface.
- [ ] **P1** Set `--glow-accent` to `none`; remove all glow consumers.
- [ ] **P1** Remove `--border-hi` inset highlight.
- [ ] **P1** Standardize radii to 4/6/8/999.
- [ ] **P1** Standardize spacing to the 4px grid.
- [ ] **P1** Standardize type scale and remove fractional sizes.
- [ ] **P1** Move focus styling to one global `:focus-visible` rule.
- [ ] **P1** Remove toolbar `backdrop-filter` and saturation.
- [ ] **P1** Remove color from scrollbars except neutral thumb.
- [ ] **P1** Remove hardcoded hex values from components; use tokens.
- [ ] **P2** Split CSS into `tokens.css`, `base.css`, `primitives.css`, `workspace.css`, `screens.css`; keep `index.css` as imports only.
- [ ] **P2** Add `@layer` ordering to prevent accidental overrides.

### 6.2 Shared primitives

- [ ] **P1** Button: primary, secondary, ghost, danger, icon, xs/sm/md/lg.
- [ ] **P1** Input, select, textarea, checkbox, switch.
- [ ] **P1** Segmented control without gradient active state.
- [ ] **P1** Tabs: neutral active surface + 1px bottom rule; no gradient underline.
- [ ] **P1** Badge/pill: neutral border + muted text.
- [ ] **P1** Modal shell: header/body/footer, scroll, fixed footer.
- [ ] **P1** Confirm dialog replacing `window.confirm`.
- [ ] **P1** Toast: neutral surface; only error uses a red accent line.
- [ ] **P1** Empty state: 15px title, 12px copy, one action.
- [ ] **P1** Loading state: skeleton or spinner, no shimmer gradient.
- [ ] **P1** Error state: inline panel, line number when available.
- [ ] **P2** Tooltip primitive for icon-only controls.
- [ ] **P2** Menu primitive for overflow actions.

### 6.3 App shell — `src/App.tsx`

**Toolbar**

- [ ] Group into three zones: left (brand/project/file), center (compile/preview), right (mode/export/overflow).
- [ ] Compile is the only primary action.
- [ ] Move theme, command palette, live, undo, and secondary exports into icon/overflow groups.
- [ ] Reduce visible labels at <1280px; never horizontal-scroll the toolbar.
- [ ] One 48px height; controls 28–32px.
- [ ] Remove gradient brand mark and radial glow.
- [ ] Make the file/project name a real button with a dropdown, not a plain label.
- [ ] Add clear pressed/active states for Preview, AI, and Live toggles.

**Activity bar**

- [ ] 44px wide, 18px icons, 36px hit areas.
- [ ] Group: project/assets/files/AI/outline; then review/history/citations/GitHub/cloud/MCP; then settings.
- [ ] Active item: neutral filled square + 2px left bar; no glow.
- [ ] All icon-only buttons have tooltips and `aria-label`.
- [ ] Remove duplicate “sparkles” meaning between AI and Review; give Review a distinct icon.

**Status bar**

- [ ] 28px height.
- [ ] Keep: file name, save state, words, compile state, AI complete.
- [ ] Move low-priority stats (chars, lines, reading time) into a tooltip or “Info” popover.
- [ ] Turn clickable stats into visually consistent buttons.
- [ ] Remove glow from active status icons.

**Panes and dividers**

- [ ] Pane header 34px; title 12px/600; meta 11px mono.
- [ ] Dividers: 1px neutral; hover only slightly brighter; no colored glow.
- [ ] Consistent pane padding: 12px horizontal.
- [ ] Panes must not jump when sidebar/preview toggles.

**Tabs and file tree**

- [ ] Tab height 30px; active tab neutral, not gradient.
- [ ] Tab close must be a real sibling `<button>`, not a `<span>` inside the tab button.
- [ ] File rows 28px; active row neutral fill + 2px left bar.
- [ ] Rename/delete icon buttons always visible on touch; on hover on desktop.
- [ ] Folder expand/collapse has a clear chevron rotation.
- [ ] Delete confirmation uses the app confirm dialog, not `window.confirm`.

**Toasts**

- [ ] 320px max width.
- [ ] Neutral surface, 8px radius, 1px border.
- [ ] Success icon neutral; error icon danger.
- [ ] Dismiss button 24px hit area.
- [ ] Stack bottom-right; no overlap with status bar.

### 6.4 Project Hub — `src/components/ProjectHubModal.tsx` (P0)

**Problems**

- Template cards inherit `.btn` fixed height and overlap.
- Undefined `--surface` and `--text-secondary`.
- Raw native file input.
- Four action buttons in a stretched grid.
- Large empty vertical gap.
- Purple primary button.
- No visible field labels.
- Modal content taller than viewport with no internal scroll strategy.

**Fix**

- [ ] Use a dedicated `.template-card` that does **not** include `.btn`.
- [ ] `height: auto; min-height: 96px; white-space: normal; justify-content: flex-start;`
- [ ] Fix template grid: 3 columns at 840px, 2 at 640px, 1 at mobile.
- [ ] Replace raw file input with a dropzone:
  - dashed 1px border
  - upload icon
  - “Choose files or drop them here”
  - supported formats in 11px muted text
  - selected file count
- [ ] Make “Edit with AI”, “Images”, “Backup ZIP”, “Validate” a compact action row with icons; use secondary styling.
- [ ] Move “LaTeX compiler location” to Settings/Advanced; keep an “Advanced” disclosure only if it must stay.
- [ ] Create document section:
  - visible labels: Name, Format
  - name input flexible, format select 160px
  - Create as primary, aligned right
- [ ] Import section:
  - shorten helper copy
  - show review list only after files are chosen
  - import action appears after review
- [ ] Save template section:
  - one row: input + secondary Save
  - disabled only when name is empty; explain why when disabled
- [ ] Footer: Close secondary.
- [ ] Use `modal lg` (840px) and internal body scroll.
- [ ] Verify no overlap at 840, 640, 390px widths.

**Buttons to verify**

`Edit with AI`, `Images and attachments`, `Download backup ZIP`, `Validate project`, `Create`, `Choose files`, `Import reviewed files`, each template card, `Save compiler preference`, `Save template`, `Close`.

### 6.5 Asset Library — `AssetLibraryModal.tsx`

- [ ] Search input with 32px height.
- [ ] Upload as a real primary/secondary button; hidden input behind it.
- [ ] Image cards: fixed thumbnail area, 1px border, neutral selected state (border + check), no outline glow.
- [ ] Thumbnail background uses a token, not `#eef0f3`.
- [ ] Rename/move action grouped with metadata, not floating.
- [ ] Insert button is primary only when an asset is selected.
- [ ] Delete uses confirm dialog.
- [ ] Share toggle has helper text and `aria-describedby`.
- [ ] Empty state: icon, one sentence, Upload action.
- [ ] Grid responsive: 4/3/2/1 columns.
- [ ] Verify long file names wrap without breaking the card.

**Buttons:** Upload, Rename/move, Insert, Delete, Share, Close.

### 6.6 AI Playground / chat — `AiPlayground.tsx`, `ChatMarkdown.tsx`

- [ ] Composer 32px, send icon button 28px, stop appears only while streaming.
- [ ] Remove purple caret, typing indicator, tool dots; use neutral text/mono.
- [ ] Assistant messages: plain text on panel, no heavy bubble.
- [ ] User messages: neutral surface chip, right-aligned.
- [ ] Tool rows: 24px, mono label, 6px status dot; no colored background.
- [ ] Code blocks: neutral surface, 6px radius, horizontal scroll.
- [ ] Attachments: compact rows with remove buttons.
- [ ] Conversation list: 28–32px rows, active neutral fill.
- [ ] Retry/copy/expand actions are real buttons with labels or tooltips.
- [ ] Empty state: short prompt examples, no giant hero.
- [ ] Long messages clamp with a clear “Show more” button.
- [ ] Scroll-to-bottom button when user is not at the bottom.
- [ ] Model/provider select has a visible label or clear chip.
- [ ] No purple focus ring in the composer.

**Buttons:** Send, Stop, Retry, Copy, Expand/collapse, Clear conversation, New conversation, Delete conversation, Attach, Remove attachment, Review changes, Apply, Discard.

### 6.7 Editor and file tree — `EditorPane.tsx`, `ProjectFileTree.tsx`, `monacoTheme.ts`

- [ ] Monaco chrome: neutral background, neutral line numbers, neutral selection.
- [ ] Syntax colors: muted/desaturated; no purple/violet/neon.
- [ ] Cursor: neutral white/black, not blue.
- [ ] Find highlight: neutral or muted amber, not purple.
- [ ] Diff insert/delete: desaturated green/red only in diff.
- [ ] File tree rows 28px; folder and file icons consistent size.
- [ ] Active file: 2px left bar + panel-2 background.
- [ ] Rename/delete appear on hover and focus-within.
- [ ] Inline AI edit widget: neutral border, 8px radius, no glow.
- [ ] `Ctrl+I` hint uses one consistent `kbd` style.
- [ ] Tab strip handles overflow with a scroll fade, not clipped text.

### 6.8 Preview and compile — `PreviewPane.tsx`, `SyncTexPdfView.tsx`

- [ ] Remove 68 inline visual styles; keep only dynamic width/height/scale.
- [ ] Toolbar: 32px height, 28px icon buttons, 14px icons.
- [ ] Compile button: primary, shows `Compiling…`, disabled during compile.
- [ ] Compile status: neutral chip with clear state (`Idle`, `Compiling`, `PDF ready`, `Error`).
- [ ] Error panel: line number + message + expandable compiler output.
- [ ] Never silently trigger a large local WASM download. If local fallback is used, ask the user first and name the download size.
- [ ] Cloud/local source is visible in the UI, not hidden.
- [ ] Zoom controls: `−`, percentage, `+`, reset; consistent 28px.
- [ ] Download, open external, maximize, hide, and fix-with-AI actions have tooltips.
- [ ] Preview document stays paper-white in dark mode.
- [ ] PDF container background neutral gray, not colored.
- [ ] Empty state: “Compile to see a preview” + primary Compile.
- [ ] `SyncTexPdfView` uses the same toolbar primitives.

### 6.9 History — `HistoryModal.tsx`

- [ ] 840px modal; fixed header/footer.
- [ ] Snapshot list 32px rows; selected row neutral border/fill.
- [ ] Diff pane and list pane have consistent split; stack on narrow.
- [ ] Replace inline widths with modal classes.
- [ ] Restore action is primary; delete is danger with confirm.
- [ ] Empty state explains when snapshots are created.
- [ ] Timestamps use mono 11px.
- [ ] No purple selected borders.

**Buttons:** snapshot row, Restore, Delete, Compare, Close.

### 6.10 Citations — `CitationsModal.tsx`

- [ ] 840px modal; tabs use segmented control primitive.
- [ ] Search input 32px; result rows 36px.
- [ ] Citation cards: neutral surface, 1px border, no colored key text.
- [ ] Insert is primary; Copy/Export are secondary.
- [ ] Delete citation uses confirm.
- [ ] Paste/import area: 32px controls, clear error.
- [ ] Empty state per tab.
- [ ] Remove 30 inline styles.

**Buttons:** My citations / Search / Paste tabs, Search, Insert, Copy, Export BibTeX, Delete, Close.

### 6.11 Review Agent — `ReviewAgentModal.tsx`

- [ ] Rebuild layout with 8px grid; remove 57 inline styles.
- [ ] Three zones: scope/controls, findings list, preview.
- [ ] 840px wide at desktop; stacked at <1100.
- [ ] All findings use neutral severity markers; only error is red.
- [ ] Apply all is primary; apply selected is secondary; dismiss is ghost.
- [ ] Review progress uses a neutral bar, no purple glow.
- [ ] Long finding text scrolls within its pane.
- [ ] Empty state before scan; loading state while scanning; error state with retry.
- [ ] Buttons disabled while scanning, with specific labels.

**Buttons:** Start review, Stop, Scan selected file, Scan project, Apply all, Apply selected, Dismiss, Retry, Close.

### 6.12 Workspace Review — `WorkspaceReviewModal.tsx`

- [ ] Same 3-pane review shell as Review Agent.
- [ ] File list rows 30px, active neutral.
- [ ] Preview pane has independent scroll.
- [ ] Apply/discard actions in fixed footer.
- [ ] Remove inline preview styles; reuse shared diff/preview components.
- [ ] No nested scroll traps.

### 6.13 Diff Review — `DiffReviewModal.tsx`

- [ ] Neutral segmented tabs (`Code diff`, `Rendered preview`).
- [ ] Hunk rows: 1px border, 6px radius.
- [ ] Insert/delete colors desaturated; no colored glow.
- [ ] Checkboxes 14px with clear labels.
- [ ] Accept all / Reject all secondary; Apply primary.
- [ ] Sticky footer.
- [ ] Diff code uses mono 12px with consistent line height.
- [ ] Empty diff state.

### 6.14 Cloud — `CloudPanel.tsx`

- [ ] Remove `cloud-hero` gradient and oversized icon.
- [x] Replace with: account row, remote endpoint, recent MCP edits, project list.
- [x] Neutral badges; no green success badges.
- [x] URL/config rows use mono 11px + copy button.
- [x] Applied-edit rows show path, project, base version, time, and summary.
- [x] Undo is the only edit action; edits apply immediately through MCP.
- [ ] Warning text uses warning token, not amber glow.
- [ ] Empty state when signed out: one sign-in button.
- [ ] Loading state for project list.
- [ ] Delete project uses confirm dialog.
- [ ] Move 12 inline styles into classes.

**Buttons:** Sign in, Sign out, Import, Push, Load, Delete, Refresh, Undo edit, Copy URL, Close.

### 6.15 MCP Manager — `McpManager.tsx`

- [ ] Server rows: name, transport, status dot, tools count.
- [ ] Add-server form uses 32px inputs; advanced JSON in a disclosure.
- [ ] Connect/disconnect is secondary; remove is danger + confirm.
- [ ] Tool list uses mono names and 11px descriptions.
- [ ] Copy config is a real button with copied feedback.
- [ ] Disconnected, connecting, connected, error states are visually distinct without glow.
- [ ] No purple border around active server.
- [ ] Empty state with “Add server” primary.

**Buttons:** Add server, Connect, Disconnect, Test, Refresh, Copy config, Remove, Close.

### 6.16 BYOK / AI settings — `ByokModal.tsx`

- [ ] Provider selection as a 2/3-column list, not a wall of buttons.
- [ ] API key field with show/hide button; no key ever shown by default.
- [ ] Test connection with loading + result line.
- [ ] Save endpoint primary; Delete endpoint danger.
- [ ] Model suggestions as neutral chips.
- [ ] Vision/tools probe results use check/x icons + text, not color-only.
- [ ] Remove 8 inline margins.
- [ ] Footer: Clear key (danger, left), Close (secondary), Save (primary).

**Buttons:** Provider, Show/Hide key, Test connection, Test model + tools, Save endpoint, Delete endpoint, Clear key, Close.

### 6.17 GitHub — `GithubPanel.tsx`

- [ ] Tabs: Token / OAuth.
- [ ] Token input 32px; masked by default.
- [ ] Repo/branch inputs with labels.
- [ ] Connect is primary; Push/Pull secondary.
- [ ] Connection log uses mono 11px, scrollable, neutral.
- [ ] Success/error states inline.
- [ ] Disconnect danger + confirm.
- [ ] Remove 5 inline flex/width styles.

### 6.18 Live collaboration — `LiveModal.tsx`

- [ ] Room name + password fields with labels.
- [ ] Create/Join primary; Cancel secondary.
- [ ] Invite link row with copy button.
- [ ] Peer avatars neutral; keep per-user colors only as tiny dots, not chrome.
- [ ] Leave session danger + confirm.
- [ ] Connection state text.
- [ ] Remove inline flex style.

### 6.19 Shortcuts — `ShortcutsModal.tsx`

- [ ] Two-column table at desktop, one at mobile.
- [ ] `kbd` style consistent: 11px mono, 4px radius, neutral border.
- [ ] Group by General / Editor / AI / Files.
- [ ] Search optional; not needed if list is short.
- [ ] Close secondary.

### 6.20 Command Palette — `CommandPalette.tsx`

- [ ] Width 560px; 8px radius; neutral backdrop.
- [ ] Input 36px; list rows 40px.
- [ ] Active row panel-3, no gradient/accent.
- [ ] Group labels 10px uppercase mono muted.
- [ ] Shortcut hints right-aligned mono.
- [ ] Empty state clear.
- [ ] Keyboard navigation fully visible.

**Buttons:** command rows, Close/Escape hint.

### 6.21 OAuth consent — `OAuthConsent.tsx`

- [ ] Centered 440px card on neutral background.
- [ ] Monochrome brand mark.
- [ ] Client name/icon row.
- [ ] Scopes as neutral rows with check icons.
- [ ] Allow is primary; Deny/Cancel secondary.
- [ ] Signed-out state shows Sign in primary.
- [ ] No purple “PROJECT” pill or gradient icon.
- [ ] Clear one-line explanation of what access is granted.

### 6.22 External Agent banner — `ExternalAgentBanner.tsx`

- [ ] Neutral strip below toolbar, 1px border, 8px radius if floating.
- [ ] Icon 15px neutral.
- [ ] Text 12px, strong 600.
- [ ] Review changes primary; Discard ghost with confirm.
- [ ] No accent2 border/background.
- [ ] Position does not shift the editor layout.

### 6.23 Mermaid and chat markdown — `MermaidBlock.tsx`, `ChatMarkdown.tsx`

- [ ] Mermaid container neutral surface, 6px radius, 1px border.
- [ ] Use grayscale Mermaid theme in chrome; content colors only if diagram requires.
- [ ] Error state: red label + mono error, not a giant red block.
- [ ] Markdown headings/body use the type scale.
- [ ] Tables: 1px borders, panel-3 header, no zebra except code/diff.
- [ ] Links underlined; no purple.
- [ ] Blockquotes: 1px neutral rule.

### 6.24 Modal header — `ModalHeader.tsx`

- [ ] Neutral icon tile 32px, panel-3 background, 1px border.
- [ ] Title 15px/600; subtitle 12px muted.
- [ ] Category pill neutral outline.
- [ ] Close button 28px icon; hover panel-2; focus ring.
- [ ] Header border-bottom optional; use 1px soft border.
- [ ] No `autoFocus={false}` workaround needed.

---

## 7. Button inventory — screens to verify

Use this as the manual QA checklist. Every item must have all states.

| Screen | Buttons/controls |
|---|---|
| Global primitives | Primary, secondary, ghost, icon, danger, disabled, loading, toggle |
| Toolbar | Project/file menu, Compile, Preview, Format select, Export select, Live, Invite, Leave, Undo AI, Theme, Command palette |
| Activity bar | Project, Images, Files, AI, Outline, Review, History, Citations, GitHub, Cloud, MCP, Settings |
| Status bar | Project/Import, AI complete, save state, compile state, peer list |
| Project Hub | Edit with AI, Images, Backup ZIP, Validate, Create, Choose files, Import reviewed, template cards, Save compiler, Save template, Close |
| Asset Library | Upload, Rename/move, Insert, Delete, Share, Close |
| AI Playground | Send, Stop, Retry, Copy, Expand, Clear, New conversation, Delete conversation, Attach, Remove, Review changes, Apply, Discard |
| Editor tabs | Tab, close tab, new file, maximize, hide |
| File tree | Folder expand, file open, rename, delete, new file |
| Preview | Compile, zoom out/in, reset, download, external, maximize, hide, fix with AI |
| History | Snapshot, restore, delete, compare, close |
| Citations | Tabs, search, insert, copy, export, delete, close |
| Review Agent | Start, stop, scan file/project, apply all/selected, dismiss, retry, close |
| Workspace Review | File select, apply, discard, close |
| Diff Review | Code/preview tabs, accept/reject all, hunk toggle, apply, discard |
| Cloud | Sign in/out, import, push, load, delete, refresh, undo edit, copy URL, close |
| MCP | Add, connect, disconnect, test, refresh, copy config, remove, close |
| BYOK | Provider, show/hide, test, save, delete, clear key, close |
| GitHub | Token/OAuth tabs, connect, push, pull, disconnect, close |
| Live | Create, join, copy invite, leave, close |
| Shortcuts | Close |
| Command Palette | Command rows, close |
| OAuth Consent | Sign in, allow, deny/cancel |
| Toasts | Dismiss |

---

## 8. Specific CSS cleanup targets

- [ ] `src/index.css:15` `--accent: #6366f1` → monochrome.
- [ ] `src/index.css:19-20` `--accent2` → semantic success/warning tokens, not chrome.
- [ ] `src/index.css:21` `--brand-grad` → solid token.
- [ ] `src/index.css:29` `--glow-accent` → none.
- [ ] `src/index.css:22` `--bubble-u` → neutral panel.
- [ ] `src/index.css:117-126` toolbar glass → solid.
- [ ] `src/index.css` `.brand-mark::after` radial glow → none.
- [ ] `src/index.css:168-169` primary gradient/glow → inverse fill.
- [ ] `src/index.css:220` segmented active gradient → neutral.
- [ ] `src/index.css:259` divider glow → neutral.
- [ ] `src/index.css:852-853` status icon glow → none.
- [ ] `src/index.css:911` modal bounce animation → simple fade/translate.
- [ ] `src/index.css:923-924` modal icon gradient/glow → neutral tile.
- [ ] `src/index.css:960-965` tab gradient underline/glow → 2px neutral.
- [ ] `src/index.css:1482` undefined `--text-secondary` → token.
- [ ] `src/index.css:1484` undefined `--surface` → token.
- [ ] `src/index.css:1486` hardcoded `#eef0f3` → token.
- [ ] `src/index.css:1506` undefined `--text-secondary` → token.
- [ ] `PreviewPane.tsx` hardcoded `#60a5fa`, `#10b981`, `#fbbf24` → tokens.
- [ ] `PreviewPane.tsx` `--surface-sunken`, `--text-secondary` → defined tokens or replacements.
- [ ] Remove/repurpose `--border-hi`.
- [ ] Remove `filter: drop-shadow` from icons.
- [ ] Remove `backdrop-filter` from `.doc-skeleton-status`.

---

## 9. Responsive checklist

- [ ] 1280px: no horizontal toolbar scroll; labels collapse cleanly.
- [ ] 1440px: default comfortable layout.
- [ ] 1920px: max content widths prevent overly long lines.
- [ ] <1100px: preview/review split stacks before becoming cramped.
- [ ] <900px: sidebars become drawers; activity bar remains usable.
- [ ] 390px: modals full-height; footer sticky; buttons wrap without overlap.
- [ ] Project Hub: 3/2/1 template columns.
- [ ] Asset Library: 4/3/2/1 image columns.
- [ ] Command palette: full-width on mobile.
- [ ] Toast: full-width minus 16px gutters on mobile.

---

## 10. Accessibility checklist

- [ ] Every interactive element is keyboard-reachable.
- [ ] No nested interactive elements.
- [ ] Icon-only buttons have accessible names.
- [ ] Focus-visible is clearly visible on all surfaces.
- [ ] Text contrast meets WCAG AA.
- [ ] Disabled states are not the only way to communicate why an action is unavailable.
- [ ] Status changes use `aria-live` where appropriate.
- [ ] Dialogs have `aria-modal`, labelled title, and focus management.
- [ ] Escape closes modals/palette.
- [ ] `prefers-reduced-motion` disables decorative transitions.
- [ ] Color is never the only diff/error signal.

---

## 11. Verification matrix

Screenshots required at:

- 1920 × 1080
- 1440 × 900
- 1280 × 800
- 390 × 844

Themes:

- Dark
- Light

States:

- Default
- Sidebar open/closed
- Both side panes
- Maximized preview/editor
- Modal open
- Loading
- Empty
- Error
- Disabled
- Long text
- Focus visible

Commands:

```bash
npm run lint
npm test
npm run build
npm run test:e2e
```

Manual checks:

- [ ] Click every button in the inventory.
- [ ] Tab through every screen.
- [ ] Confirm no button does nothing without feedback.
- [ ] Confirm no modal footer leaves the viewport.
- [ ] Confirm no text overlaps or clips.
- [ ] Confirm no horizontal overflow at 1280px.

---

## 12. Definition of done

- [ ] Project Hub template cards no longer overlap.
- [ ] No decorative purple/violet/pink/teal remains.
- [ ] No gradient primary buttons, glows, or glass toolbar.
- [ ] One button hierarchy across the entire app.
- [ ] One input height and one visible-label pattern.
- [ ] Three modal widths only.
- [ ] Three radius values only (plus pills).
- [ ] Type scale limited to documented sizes.
- [ ] No static inline visual styles outside dynamic layout values.
- [ ] No nested buttons or clickable spans.
- [ ] `window.confirm` removed from UI flows.
- [ ] Every button has hover, active, focus, disabled, and loading states.
- [ ] All screens pass the screenshot matrix.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass.

---

## 13. Suggested work order

1. **P0 hotfix:** Project Hub template cards + undefined tokens + modal scroll.
2. **Foundation:** tokens, type, spacing, radii, controls, focus, borders.
3. **Primitives:** buttons, inputs, tabs, segmented control, modal shell, toast, confirm dialog.
4. **Shell:** toolbar, activity bar, status bar, panes, tabs, file tree.
5. **Core workspace:** Project Hub, Assets, AI chat, editor, preview/compile.
6. **Integrations:** Cloud, MCP, BYOK, GitHub, Live, consent.
7. **Review/history/citations:** Review Agent, Workspace Review, Diff Review, History, Citations.
8. **Polish:** responsive, accessibility, motion, empty/loading/error states.
9. **QA:** screenshot matrix, full button inventory, build/test/lint.

---

## 14. Working rules

- Do not change product logic while doing visual work.
- Do not touch `supabase/`, `lambda/`, MCP tool behavior, storage, or compiler internals in this pass.
- Preserve all existing features and keyboard shortcuts.
- Prefer token changes over one-off overrides.
- Prefer shared primitives over per-screen CSS.
- Remove inline styles only when they are static; keep dynamic widths/positions.
- Do not introduce a new UI library.
- Keep the paper preview visually stable; chrome changes must not alter document typography.
- After each pass: lint, test, build, and take screenshots.

---

## 15. Open decisions

Defaults selected; confirm before implementation if needed.

| Decision | Default |
|---|---|
| Strict monochrome UI | Yes |
| Keep light theme as paper theme | Yes |
| Desaturated syntax colors in editor | Yes |
| One functional color exception: error/warning/diff | Yes |
| Project Hub width | 840px |
| Move compiler URL to Advanced/Settings | Yes |
| Replace `window.confirm` with app dialog | Yes |
| Remove Plus Jakarta from UI | Yes |
| Split `index.css` into modules | Yes, after primitives stabilize |

---

## 16. Progress tracker

| Wave | Status |
|---|---|
| P0 Project Hub hotfix | Complete |
| Tokens and global base | Complete |
| Primitives | Complete |
| App shell | Complete |
| Project Hub and Assets | Complete |
| AI / Editor / Preview | Complete |
| Cloud / MCP / BYOK / GitHub / Live | Complete (visual pass) |
| Review / History / Citations | Complete |
| Responsive and accessibility | Complete |
| Final QA and cleanup | Verification passed; P2 cleanup deferred |

### 16.1 Implementation log — 2026-10-28

Landed in this pass:

- Monochrome token system, neutral toolbar/panes/modals/status bar, self-hosted Inter + JetBrains Mono, plus Jakarta removed.
- Custom confirm/prompt dialog host; native `window.confirm`/`prompt` flows replaced, including destructive file, asset, history, citation, MCP, cloud, and workspace actions.
- App shell: tab close is a real sibling button, duplicate toolbar mode select removed, status bar consolidated, activity-bar icon meanings separated, file-tree chevrons and touch affordances fixed.
- Project Hub: template cards no longer use `.btn`, labels added, custom file dropzone, fixed footer, 3/2/1 template columns.
- Editor/preview: desaturated Monaco theme (neutral cursor/selection/diff, no neon syntax), neutral preview canvas, honest local TeX ~120 MB download confirmation, inline compile errors with Fix with AI.
- Modals: History, Citations, Shortcuts, Workspace Review, Diff Review, Review Agent, Live, BYOK, MCP, Cloud, and OAuth consent brought onto shared primitives.
- Responsive: 920px two-row header with Editor/Preview/Panel switch, mobile panel navigation, 390/360px full-height modals, compact status bar, wrapped preview toolbar, no horizontal page overflow.
- Export fix: nested document paths now export basenames (`docs/report.md` → `report.html`) instead of `docs_report.html`.

Verification:

- `npm run lint` — pass
- `npm test` — 25 files / 274 tests pass
- `npm run build` — pass
- `npm run test:e2e` — 3/3 pass
- Visual screenshots checked: 1920×1080, 1440×900, 1280×800, 900×900, 390×844, 360×800; dark and light where applicable.

Deferred P2 cleanup:

- Split `index.css` into tokens/base/primitives/workspace/screens modules.
- Add tooltip/menu primitives and finish removing static inline visual styles.
- Main bundle is ~4.4 MB; code-splitting is outside this visual pass.

### 16.2 Direct MCP edits and cloud undo — 2026-10-30

- Local inbound MCP edits now apply immediately. The old workspace review modal is gone; the applied notice offers Undo and stays dismissible.
- Toast + applied banner share one AI undo action, so the existing toolbar Undo still works.
- Cloud remote MCP writes apply through `apply_ai_edit`, which checks `base_version`, snapshots the previous content, and bumps the file version.
- Cloud panel replaces the pending-edit queue with recent MCP revisions and a per-revision Undo button.
- Linked cloud projects poll file versions and pull applied edits when the editor is clean; dirty local files are preserved and reported instead of overwritten.
- Remote MCP endpoint copy is available inside Cloud with connection copy.

Verification:

- `npm run lint` — pass
- `npm test` — 26 files / 278 tests pass
- `npm run build` — pass
