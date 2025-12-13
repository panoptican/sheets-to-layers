/**
 * Build script for the plugin UI.
 *
 * This script bundles the UI TypeScript and CSS into a single HTML file
 * that can be loaded by Figma.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isMinify = process.argv.includes('--minify');

const srcDir = path.join(__dirname, '..', 'src', 'ui');
const distDir = path.join(__dirname, '..', 'dist');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

/**
 * Read CSS file content.
 */
function readCSS() {
  const cssPath = path.join(srcDir, 'styles.css');
  return fs.readFileSync(cssPath, 'utf-8');
}

/**
 * Generate the final HTML file with inlined CSS and JS.
 */
function generateHTML(jsContent) {
  const css = readCSS();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sheets Sync</title>
  <style>
${css}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
${jsContent}
  </script>
</body>
</html>`;
}

/**
 * Write the HTML file.
 */
function writeHTML(jsContent) {
  const html = generateHTML(jsContent);
  const htmlPath = path.join(distDir, 'ui.html');
  fs.writeFileSync(htmlPath, html);
  console.log('Built: dist/ui.html');
}

/**
 * Build plugin for esbuild.
 */
const buildPlugin = {
  name: 'build-html',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error('Build failed');
        return;
      }

      // Read the bundled JS
      const jsPath = path.join(distDir, 'ui.js');
      const jsContent = fs.readFileSync(jsPath, 'utf-8');

      // Generate and write HTML
      writeHTML(jsContent);

      // Clean up temporary JS file
      fs.unlinkSync(jsPath);
    });
  },
};

/**
 * Run the build.
 */
async function build() {
  const ctx = await esbuild.context({
    entryPoints: [path.join(srcDir, 'ui.ts')],
    bundle: true,
    outfile: path.join(distDir, 'ui.js'),
    minify: isMinify,
    sourcemap: false,
    target: ['es2020'],
    format: 'iife',
    plugins: [buildPlugin],
  });

  if (isWatch) {
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
