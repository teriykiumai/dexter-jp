import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDEX_HTML_PATH = fileURLToPath(new URL('./web/index.html', import.meta.url));

interface DashboardAsset {
  body: Blob;
  contentType: string;
  isHtml: boolean;
}

let assetBuild: Promise<Map<string, DashboardAsset>> | null = null;

async function buildDashboardAssets(): Promise<Map<string, DashboardAsset>> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'dexter-dashboard-assets-'));
  try {
    const result = await Bun.build({
      entrypoints: [INDEX_HTML_PATH],
      outdir: outputDirectory,
      target: 'browser',
      minify: true,
      sourcemap: 'none',
      publicPath: '/',
      naming: {
        entry: '[name]-[hash].[ext]',
        asset: '[name]-[hash].[ext]',
        chunk: '[name]-[hash].[ext]',
      },
      env: 'disable',
    });
    if (!result.success) throw new Error('Dashboard asset build failed.');

    const assets = new Map<string, DashboardAsset>();
    for (const output of result.outputs) {
      const isHtml = output.type.startsWith('text/html');
      const contentType = isHtml
        ? 'text/html; charset=utf-8'
        : (output.type || 'application/octet-stream');
      const asset = {
        body: new Blob([await output.arrayBuffer()], { type: contentType }),
        contentType,
        isHtml,
      };
      if (isHtml) {
        assets.set('/', asset);
        assets.set('/index.html', asset);
      } else {
        assets.set(`/${basename(output.path)}`, asset);
      }
    }
    return assets;
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

export async function loadDashboardAsset(pathname: string): Promise<DashboardAsset | null> {
  assetBuild ??= buildDashboardAssets();
  const assets = await assetBuild;
  return assets.get(pathname) ?? null;
}
