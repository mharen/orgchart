# Org chart—plan

A single-page web app: paste a table of people, get one box per person, then drag the boxes
onto each other to build the org chart. State persists in localStorage.

## Constraints

- Plain HTML, CSS, and a single small JS file. No frameworks, no build step.
- Plain lines and readable typography. No ASCII art.
- Light and dark modes, following the OS.
- Readable over a Zoom share: clear type, high contrast, fits the screen.

## Files

- `index.html`—markup: toolbar, chart area, data dialog
- `style.css`—theme tokens (light/dark), layout, box styling
- `app.js`—parsing, state, layout, rendering, drag and drop

## Data in

- Paste CSV or TSV (straight from a spreadsheet) into the data dialog.
- Columns by position: `name, role, role start, org start[, manager]`.
- The first column is the identity and must be unique. A header row is detected and skipped.
- Dates accept `2021-03-15`, `3/15/2021`, `2021-03`, `Mar 2021`, `2021`.
- Applying a paste syncs the roster: people are matched by name, new people are added, missing
  people are removed (their reports move up to the next remaining manager), and existing links
  are kept.
- If the 5th column is present, it is authoritative for reporting lines. The dialog opens
  pre-filled with the current data, manager column included, so it doubles as export/backup and
  bulk edit.

## The box

A plain bordered card, left-aligned, two lines:

1. The name (large, bold), followed on the same line by the role as a small pill-shaped "bug".
2. Tenure, small and dim: "1y2m in role · 5y4m at org".

- Tenure is computed from today as `NyNm`.
- All boxes share one width, measured from the widest text and clamped to a range. Overflow
  gets an ellipsis.

## Model

- `people`: an ordered array of `{name, role, roleStart, orgStart, manager}`.
- `manager` is a name or `null`.
- Stored in localStorage as JSON. Undo is a stack of snapshots (`⌘Z`/`Ctrl+Z`).

## Layout

- Classic top-down tree: each parent is centered over its children, with SVG elbow connectors.
- Peers (and roots, and the tray) are sorted by time at the org, longest first. Unknown dates
  go last.
- A compact variant stacks a manager's leaf-only reports vertically on a side rail.
- People with no manager and no reports sit in an "unassigned" tray below the chart.
- Fit to screen: try both variants and every tray column count, then pick the arrangement that
  allows the largest font size. Layout runs on an abstract grid. Boxes are positioned in `em`, and
  connectors are an SVG scaled to the same grid, so the whole chart scales through `font-size`.
- Size is capped at a comfortable maximum. Small orgs don't blow up to fill the screen.
- Re-fits on resize.

## Linking (drag and drop)

- Drag a box with pointer events (works with mouse, trackpad, and touch). A ghost follows the
  cursor.
- Dragging a manager moves their whole team. Hold Shift to move only the person (their reports
  move up to their old manager).
- Hovering another box opens a drop pad over it: "↑ manages Jane" across the top,
  "← peer | ⇄ replace Jane | peer →" in the middle, and "↓ reports to Jane" across the bottom.

  - **reports to**: becomes the target's report
  - **manages**: takes the target's place in the tree, and the target reports to them
  - **peer** (either side): same manager as the target. Order comes from the tenure sort.
  - **replace** (center): takes the target's place—same manager, and the target's reports now
    report to them. The target is unlinked and goes to the tray.
- Dropping on empty space unassigns the person, so they become a root, or go to the tray if they
  have no team.
- A conflicting drop just moves the person: one manager per person, so a new link replaces the
  old one.
- Drops that would create a cycle (onto your own team) are refused.

## Editing one person

- Click a box (without dragging) to open a small modal with name, role, and both dates (native
  date pickers), plus Save, Cancel, and Delete.
- Renaming updates everyone who reports to them. Names must stay unique.
- Delete moves the person's reports up to their manager. Undo restores them.
- Add (toolbar) opens the same modal empty. New people start in the unassigned tray.

## Toolbar

Add, Data (bulk paste/edit/export), Undo, Clear.

## Serving

Static files: `python3 -m http.server 8000` and open `http://localhost:8000` in Safari.

## Out of scope (for now)

Free-form manual positioning, dotted-line relationships, printing/PNG export, multiple saved
charts.
