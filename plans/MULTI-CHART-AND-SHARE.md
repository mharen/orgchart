# Multiple charts and share links

## Multiple charts

- localStorage key `orgchart.v2`: `{ cur, charts: [{ name, people }] }`. `cur` is an index.
- `state` is the current chart object. `save()` writes it back into `store.charts[cur]` because
  undo replaces the `state` object.
- On first load, an old `orgchart.v1` chart (`{ people }`) becomes `org-1`. The v1 key is left in place.
- Names are generated: `org-N`, using the lowest unused N. No renaming.
- Tabs sit at the upper left of the nav: name links, `×` to delete, `+` to add.
  `×` only shows when there are 2+ charts, so there is always at least one.
- Deleting a chart that has people asks for confirmation; empty charts delete immediately. It can't be undone.
- Undo history is per session and is cleared whenever you switch charts.
- Two windows open at once will overwrite each other's saves (last write wins), as before.

## Share links

- Share copies `<page>#share=<data>` to the clipboard, or falls back to `prompt()`.
- `<data>` = JSON `[[name, role, roleStart, orgStart, manager], ...]` → `deflate-raw`
  (`CompressionStream`) → base64url without padding.
- It goes in the fragment instead of the query string, so it never reaches the server
  (no access logs, no server URL length limit).
- Opening a link (on load or `hashchange`) decodes it, adds it as a new `org-N` chart, switches to it,
  and removes the fragment with `history.replaceState` so a reload doesn't import it again.
- A shared copy is independent. Nothing syncs, and the chart name isn't included.
- Decoding is defensive: every value becomes a string, duplicate names are dropped, and `fixCycles()`
  clears unknown or circular managers.
- Rough size: about 25–40 URL characters per person after compression. A few hundred people fits
  comfortably in a URL in modern browsers. Chat apps may cut off very long links.
