/**
 * 每日 SQLite 文件备份（V4.3 §10 路线图 A27.2，spec SubTask 27.3）
 *
 * 每日凌晨使用 node:sqlite 的 backup() API 将主库备份到独立文件，
 * 保留最近 7 份，超出删除最旧的。
 *
 * 注意：
 * - 后端使用 node:sqlite（DatabaseSync），不是 better-sqlite3。
 *   node:sqlite 提供独立的 backup(sourceDb, path) 异步函数（v22.16.0+），
 *   功能等价于 better-sqlite3 的 db.backup(filePath)。
 * - 不修改 db.ts，通过 getDb() 获取数据库实例。
 * - 所有 IO 操作使用 try/catch，失败不影响主流程。
 *
 * 严格规则：
 * - 不引入额外依赖（仅用 setInterval / clearInterval / node:sqlite.backup / node:fs）
 * - 失败时记录 console.error，不抛出
 * - 单实例运行（避免重复启动）
 */
import { backup } from 'node:sqlite';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDb } from '../db.js';
import { config } from '../config.js';

/** 备份目录：从 config.dbPath 的同级目录下派生（默认 backend/data/backups/） */
const BACKUP_DIR = join(dirname(config.dbPath), 'backups');

/** 备份保留份数（spec A27.2：保留最近 7 份） */
const BACKUP_RETENTION = 7;

/** 扫描间隔：24 小时（spec SubTask 27.3） */
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000;

let backupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 启动备份任务：首次启动后立即跑一次，然后每 24 小时一次。
 * 返回 stop 函数，调用后停止任务。
 */
export function startBackupJob(intervalMs: number = SCAN_INTERVAL_MS): () => void {
  if (backupTimer) {
    console.warn('  [backupJob] 已在运行，忽略重复启动');
    return stopBackupJob;
  }
  console.log(`  [backupJob] 已启动，扫描间隔 ${Math.round(intervalMs / 3600000)}h`);
  // 立即跑一次，再设置定时器
  setTimeout(() => {
    runBackup().catch((e) => console.error('  [backupJob] 初始备份失败:', e?.message ?? e));
  }, 0);
  backupTimer = setInterval(() => {
    runBackup().catch((e) => console.error('  [backupJob] 备份失败:', e?.message ?? e));
  }, intervalMs);
  return stopBackupJob;
}

/** 停止备份任务 */
export function stopBackupJob(): void {
  if (backupTimer) {
    clearInterval(backupTimer);
    backupTimer = null;
    console.log('  [backupJob] 已停止');
  }
}

/**
 * 执行一次备份：
 * 1. 确保备份目录存在
 * 2. 生成备份文件名：zx-backup-YYYYMMDD-HHmmss.db
 * 3. 调用 node:sqlite backup() API
 * 4. 清理超出保留数量的旧备份
 */
async function runBackup(): Promise<void> {
  try {
    // 1. 确保备份目录存在
    mkdirSync(BACKUP_DIR, { recursive: true });

    // 2. 生成备份文件名
    const now = new Date();
    const ts = formatTimestamp(now);
    const backupPath = join(BACKUP_DIR, `zx-backup-${ts}.db`);

    // 3. 执行备份（node:sqlite backup 函数，等价于 better-sqlite3 的 db.backup()）
    const db = getDb();
    const totalPages = await backup(db, backupPath);
    console.log(`  [backupJob] 备份完成: ${backupPath} (${totalPages} pages)`);

    // 4. 清理旧备份（保留最近 7 份）
    pruneOldBackups();
  } catch (e: any) {
    // 失败时记录 console.error，不抛出
    console.error('  [backupJob] 备份失败:', e?.message ?? e);
  }
}

/**
 * 格式化时间戳为 YYYYMMDD-HHmmss（用于备份文件名）。
 */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/**
 * 清理旧备份：按文件名时间戳倒序排列，保留最近 BACKUP_RETENTION 份，删除其余。
 * 文件名格式 zx-backup-YYYYMMDD-HHmmss.db 可直接字典序排序。
 */
function pruneOldBackups(): void {
  try {
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('zx-backup-') && f.endsWith('.db'))
      .sort((a, b) => b.localeCompare(a)); // 倒序（最新在前）

    for (let i = BACKUP_RETENTION; i < files.length; i++) {
      const fullPath = join(BACKUP_DIR, files[i]);
      try {
        unlinkSync(fullPath);
        console.log(`  [backupJob] 已删除旧备份: ${files[i]}`);
      } catch (e: any) {
        console.error(`  [backupJob] 删除旧备份失败 ${files[i]}:`, e?.message ?? e);
      }
    }
  } catch (e: any) {
    console.error('  [backupJob] 清理旧备份失败:', e?.message ?? e);
  }
}
