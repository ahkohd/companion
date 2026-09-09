# Landing page and screenshots

The landing page lives in `landing/`. It is a static page with locally hosted fonts and screenshots. It does not run the Companion bridge.

## Refresh the screenshots

Install the capture browser once:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Then run:

```sh
pnpm screenshots
```

This builds the current dashboard and captures Overview, Designer, Modules and Animations in both light and dark themes into `docs/images/`. Each capture uses the same theme for the dashboard and sample device. This does not change the independent device theme setting in the app. Names include the theme, such as `overview-light.png`. The existing README image paths use copies of the dark captures. A manifest records their sizes, themes, sample time and file hashes.

The capture uses an isolated browser and a temporary, read-only server on a random loopback port. It uses sample agents and integrations from `scripts/screenshots/fixture.mjs`. It never connects to the running Companion bridge, reads personal settings or sends commands to hardware. External browser requests fail the capture.

Screenshots use a 1440 by 1000 viewport at 2x device scale, producing native 2880 by 2000 images. This keeps text sharp on Retina displays. The capture uses bundled fonts, reduced motion and a fixed clock. The command waits for the correct theme, page, fonts and images to load and fails on page errors or missing assets. PNGs are replaced only after all eight captures succeed. Small font-rendering differences can occur between macOS and Linux; use the GitHub workflow for a consistent runner.

To inspect the sample dashboard separately, run `pnpm screenshots:preview` and open the printed URL. This preview is read-only. Stop it with Control-C.

## Build the landing page

```sh
pnpm landing:build
pnpm landing:preview
```

Open the printed address. The build refreshes screenshots, makes lossless WebP copies and writes a standalone site to `landing-dist/`. The website follows the system theme by default and shows matching screenshots. Its light and dark toggle remembers your choice. Only this output folder needs hosting. The build does not deploy it.

To rebuild the page from the existing captures without running screenshot capture, use `node scripts/landing/build.mjs`. It prepares the complete output in a temporary directory under `.cache/`, then replaces each output file atomically and publishes `index.html` last. Existing preview assets stay available while images are generated. A generation failure leaves the served output unchanged. Older, unreferenced assets are retained so pages already open in the preview can still load them.

The download link uses the version in `package.json`. Set `COMPANION_VERSION` to an existing published version when preparing a page from an unreleased checkout. Check the installer URL before publishing.

Edit the page copy in `landing/index.html`, its layout in `landing/styles.css`, and screenshot tabs in `landing/app.js`. Add screenshot cases in `scripts/screenshots/capture.mjs` and corresponding sample data in `fixture.mjs`.

The **Dashboard screenshots** GitHub workflow runs on relevant pull requests and can also be run manually. It uploads the screenshots and built page as an artifact for review. It does not commit images or publish the site automatically.

## Search and link previews

The page includes a title, description, canonical URL, Open Graph metadata and a Twitter `summary_large_image` card. Both social previews use `social-preview.png`, a 1200 by 630 PNG generated during the build by `scripts/landing/social-preview.mjs`. The card combines the bundled Geist font, Companion eyes and the real light Overview capture. It needs no network access or separate browser capture.

`landing/robots.txt` allows crawling and points to `sitemap.xml`. The sitemap contains the canonical home page only. Its URL, the canonical link and the social URLs use `https://companion.victor.computer/`. The home page also has `WebSite` JSON-LD naming Companion. There are no invented ratings, reviews or search actions.

After publishing, check the home page, `/social-preview.png`, `/robots.txt` and `/sitemap.xml` on the live domain. Social services cache previews and may take time to refresh them. These files make the site readable by crawlers; they do not guarantee indexing or a particular search appearance.

The metadata follows the [Open Graph protocol](https://ogp.me/) and Google's guidance on [site names](https://developers.google.com/search/docs/appearance/site-names) and [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap).

## Publish

The site is hosted on Cloudflare Workers Static Assets at [companion.victor.computer](https://companion.victor.computer). Its configuration is in `infra/landing/wrangler.jsonc`, separate from the release CDN.

With Wrangler signed in to the configured Cloudflare account, run:

```sh
pnpm landing:deploy
```

This refreshes screenshots, builds the page and publishes it to the custom domain. It uploads only `landing-dist/`.
