import { createServer } from 'http';
import { parse } from 'url';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import next from 'next';

// 自托管部署时从项目根目录 .env 读取环境变量（如 COZE_API_TOKEN）。
// 已存在的进程环境变量优先，避免覆盖 PM2/systemd 注入的值。
function loadLocalEnv(): void {
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadLocalEnv();

// 生产判定：沙箱注入 COZE_PROJECT_ENV=PROD；自托管服务器使用标准 NODE_ENV=production
const prod =
  process.env.COZE_PROJECT_ENV === 'PROD' ||
  process.env.NODE_ENV === 'production';
const dev = !prod;
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  const onReady = () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : 'production'
      }`,
    );
    console.log(`> PORT=${port}`);
    console.log(`> 服务已启动，访问地址：http://localhost:${port}`);
  };
  if (dev) {
    server.listen(port, onReady);
  } else {
    // 生产环境显式绑定 IPv4 全网卡，保证 127.0.0.1 与公网 IP 均可访问
    server.listen(port, '0.0.0.0', onReady);
  }
});
