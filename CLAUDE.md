# Org Chart

A static web app with no build step: `index.html`, `style.css`, `app.js`. See README.md to run it.

## Cache busting

After changing `style.css` or `app.js`, run `./version.sh`. It stamps their includes in `index.html` with a
content hash (`?v=<hash>`), so browsers—Safari especially—don't keep serving stale cached copies.
