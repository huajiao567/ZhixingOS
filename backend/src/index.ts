import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { authRequired } from './auth.js';
import { authRouter } from './routes/auth.js';
import dataRouter from './routes/data.js';
import { secretaryRouter } from './routes/secretary.js';
import { briefRouter } from './routes/brief.js';
import { runtimeRouter } from './routes/runtime.js';
import { pingDeepSeek } from './llm/deepseek.js';
import { ensureDemoSeed } from './services/seedDemo.js';
import { getDb } from './db.js';
import { startScheduler, stopScheduler } from './scheduler/index.js';

// 触发数据库初始化
getDb();

const app = express();
app.use(express.json({ limit: '1mb' }));
const origins = config.corsOrigin === '*' ? '*' : config.corsOrigin.split(',').map((s) => s.trim());
app.use(cors({ origin: origins, credentials: false }));

// 请求日志（轻量）
app.use((req, _res, next) => {
  if (!req.path.startsWith('/health')) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'zhixingos-backend', time: new Date().toISOString() }));

// DeepSeek 连通性探测（管理员用，省 token）
app.get('/health/llm', async (_req, res) => {
  const r = await pingDeepSeek();
  res.json(r);
});

app.use('/api/auth', authRouter);

// 受保护路由
app.use('/api/data', authRequired, dataRouter);
app.use('/api/secretary', authRequired, secretaryRouter);
app.use('/api/brief', authRequired, briefRouter);
app.use('/api/runtime', authRequired, runtimeRouter);

// 演示种子：首次启动自动创建 demo 账号，便于直接体验
ensureDemoSeed();

// 全局错误处理
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('未捕获错误:', err);
  res.status(err.status ?? 500).json({ error: err.message ?? '服务器内部错误' });
});

app.listen(config.port, config.host, () => {
  console.log(`\n  知行镜后端已启动 → http://${config.host}:${config.port}`);
  console.log(`  健康检查 → http://localhost:${config.port}/health`);
  console.log(`  DeepSeek 探测 → http://localhost:${config.port}/health/llm`);
  console.log(`  演示账号 → demo@zhixingos.com / demo1234`);
  startScheduler();
});

process.on('SIGINT', () => {
  console.log('\n  收到 SIGINT，正在优雅关闭...');
  stopScheduler();
  process.exit(0);
});
