/**
 * precise-billing · Host half
 *
 * 按 DeepSeek 官方人民币价目逐条请求计价：
 *   - 每条 assistant/message 的 usage 按它自己的时间戳判定峰谷（北京时间 09:00–12:00、14:00–18:00，周一至周五）
 *   - 中国法定节假日（2025–2026）全天闲时
 *   - 输入（未命中）/ 缓存命中 / 缓存写入 / 输出 四通道分别计价
 *   - 未登记价格的模型单独计数，不按 0 元混入
 *
 * 数据：$DSH_HOME/sessions/**\/session.v4.jsonl.zstd（多 zstd frame，增量消费新帧）
 * 索引：$DSH_HOME/storages/precise-billing.json（每个会话的摘要 + 按日聚合 + 用户设置）
 *
 * 路由：
 *   GET  /api/precise-billing?scope=summary&session=<id>   本会话 + 今日 + 累计
 *   GET  /api/precise-billing/settings                     读取设置
 *   POST /api/precise-billing/settings                     保存设置（部分字段合并）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

export const name = 'precise-billing';
export const inject = ['webServer', 'credentials'];

const ACCOUNT_RECORD_KEY = 'deepseek-account-platform/default';
const PLATFORM_BASE = 'https://platform.deepseek.com';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const ACCOUNT_TTL_MS = 120000;
let accountCache = null;

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const STORE_VERSION = 3;
const SUM_TTL_MS = 4000;

const DEFAULT_SETTINGS = {
  position: 'composer', // composer | header | hidden
  fontFamily: 'inherit',
  fontSize: 11,
  color: '',
  showToday: true,
  showTotal: true,
  chipPhase: true,
  chipSession: true,
  chipToday: true,
  chipTotal: true,
  chipBalance: true,
  sidebar: true,
  sidebarStyle: 'standard', // standard | simple | compact | merged
  sidebarSession: true,
  sidebarToday: true,
  sidebarTotal: true,
  sidebarPeak: true,
  sidebarProgress: true,
  pollMs: 60000,
  chipPollMs: 10000,
  sidebarPollMs: 30000,
  amountSource: 'local', // local | official
  custom: { a1: true, a2: true, a3: true, a4: true, b1: true, b2: true, b3: true, b4: true, c1: true, c2: true, d1: true, d2: true, d3: true, d4: true, d5: true, d6: true },
};

/** 每 token 的人民币价格：off = 闲时，peak = 峰时 */
const PRICES = {
  'deepseek-flash': {
    off: { input: 1e-6, cacheRead: 2e-8, cacheWrite: 1e-6, output: 4e-6 },
    peak: { input: 2e-6, cacheRead: 4e-8, cacheWrite: 2e-6, output: 8e-6 },
  },
  'deepseek-v4-flash': {
    off: { input: 1e-6, cacheRead: 2e-8, cacheWrite: 1e-6, output: 4e-6 },
    peak: { input: 2e-6, cacheRead: 4e-8, cacheWrite: 2e-6, output: 8e-6 },
  },
  'deepseek-v4-flash-vision-exp': {
    off: { input: 1e-6, cacheRead: 2e-8, cacheWrite: 1e-6, output: 4e-6 },
    peak: { input: 2e-6, cacheRead: 4e-8, cacheWrite: 2e-6, output: 8e-6 },
  },
  'deepseek-v4-pro': {
    off: { input: 4.5e-6, cacheRead: 1.5e-7, cacheWrite: 4.5e-6, output: 1.35e-5 },
    peak: { input: 9e-6, cacheRead: 3e-7, cacheWrite: 9e-6, output: 2.7e-5 },
  },
  'deepseek-chat': {
    off: { input: 2e-6, cacheRead: 2e-7, cacheWrite: 2e-6, output: 3e-6 },
    peak: { input: 4e-6, cacheRead: 4e-7, cacheWrite: 4e-6, output: 6e-6 },
  },
  'deepseek-reasoner': {
    off: { input: 2e-6, cacheRead: 2e-7, cacheWrite: 2e-6, output: 3e-6 },
    peak: { input: 4e-6, cacheRead: 4e-7, cacheWrite: 4e-6, output: 6e-6 },
  },
};

const HOLIDAYS = new Set([
  '2025-01-01', '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01',
  '2025-02-02', '2025-02-03', '2025-02-04', '2025-04-04', '2025-04-05', '2025-04-06',
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', '2025-05-31',
  '2025-06-01', '2025-06-02', '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04',
  '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
  '2026-01-01', '2026-01-02', '2026-01-03', '2026-02-15', '2026-02-16', '2026-02-17',
  '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-02', '2026-05-03',
  '2026-05-04', '2026-05-05', '2026-06-19', '2026-06-20', '2026-06-21', '2026-09-25',
  '2026-09-26', '2026-09-27', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
  '2026-10-05', '2026-10-06', '2026-10-07',
]);

const FONT_FAMILIES = {
  inherit: 'inherit',
  yahei: '"Microsoft YaHei", "PingFang SC", sans-serif',
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'Consolas, "Cascadia Mono", monospace',
  serif: 'Georgia, "Noto Serif SC", serif',
};

function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

function storePath() {
  return path.join(dshHome(), 'storages', 'precise-billing.json');
}

function beijingDate(ms) {
  const d = new Date(ms + SHANGHAI_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function isPeak(ms) {
  const d = new Date(ms + SHANGHAI_OFFSET_MS);
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (HOLIDAYS.has(beijingDate(ms))) return false;
  const hour = d.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

/** 当前处于哪一档、这一档从何时开始、以及下一次切换的时刻（按分钟扫描，最多 96 小时） */
export function phaseAt(now) {
  const peak = isPeak(now);
  const step = 60 * 1000;
  const base = now - (now % step);
  let forward = base;
  for (let i = 0; i < 60 * 96; i++) {
    forward += step;
    if (isPeak(forward) !== peak) break;
  }
  let since = base;
  for (let i = 0; i < 60 * 96; i++) {
    if (since - step < 0) break;
    if (isPeak(since - step) !== peak) {
      since = since - step + step;
      break;
    }
    since -= step;
  }
  return { state: peak ? 'peak' : 'off', since, until: forward, next: peak ? 'off' : 'peak' };
}

function priceFor(model) {
  if (typeof model !== 'string') return undefined;
  const key = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return PRICES[key];
}

function emptySummary() {
  return {
    messages: 0,
    peakMessages: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    cost: 0,
    peakCost: 0,
    offPeakCost: 0,
    unpricedMessages: 0,
    unpricedModels: [],
    byDate: {},
    nextOffset: 0,
    lastModel: undefined,
    lastSeq: -1,
    header: undefined,
    turns: [],
    pending: '',
  };
}

/** 从帧起点向前找真正的帧尾：逐候选边界试解压，直到成功 */
function decodeFrames(buf, starts) {
  let text = '';
  let consumedTo = 0;
  let k = 0;
  while (k < starts.length) {
    const frameStart = starts[k];
    let decoded = null;
    let endUsed = -1;
    for (let j = k + 1; j <= starts.length; j++) {
      const end = j < starts.length ? starts[j] : buf.length;
      try {
        decoded = zstdDecompressSync(buf.subarray(frameStart, end));
        endUsed = end;
        k = j;
        break;
      } catch {
        /* 试下一个边界 */
      }
    }
    if (!decoded) break;
    text += decoded.toString('utf8');
    consumedTo = endUsed;
  }
  return { text, consumedTo };
}

function magicOffsets(buf) {
  const starts = [];
  let i = 0;
  while ((i = buf.indexOf(ZSTD_MAGIC, i)) !== -1) {
    starts.push(i);
    i += 4;
  }
  return starts;
}

function addRecord(summary, record) {
  const usage = record.data?.usage;
  if (!usage) return;
  const model = record.data?.message?.source?.model ?? summary.lastModel;
  const input = usage.inputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const time = record.time ?? 0;
  const peak = isPeak(time);
  const date = beijingDate(time);

  summary.messages += 1;
  if (peak) summary.peakMessages += 1;
  summary.tokens.input += input;
  summary.tokens.cacheRead += cacheRead;
  summary.tokens.cacheWrite += cacheWrite;
  summary.tokens.output += output;

  const day =
    summary.byDate[date] ??
    (summary.byDate[date] = {
      messages: 0,
      cost: 0,
      tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    });
  day.messages += 1;
  day.tokens.input += input;
  day.tokens.cacheRead += cacheRead;
  day.tokens.cacheWrite += cacheWrite;
  day.tokens.output += output;

  const table = priceFor(model);
  let cost = 0;
  if (!table) {
    summary.unpricedMessages += 1;
    if (model && !summary.unpricedModels.includes(String(model))) {
      summary.unpricedModels.push(String(model));
    }
  } else {
    const p = peak ? table.peak : table.off;
    cost = input * p.input + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + output * p.output;
    summary.cost += cost;
    if (peak) summary.peakCost += cost;
    else summary.offPeakCost += cost;
    day.cost += cost;
  }

  const turns = Array.isArray(summary.turns) ? summary.turns : (summary.turns = []);
  turns.push({ t: time, c: Math.round(cost * 10000) / 10000, p: peak ? 1 : 0, i: input, r: cacheRead, o: output });
  if (turns.length > 500) turns.splice(0, turns.length - 500);
}

function parseHeader(summary, record) {
  if (record.type !== 'session') return;
  summary.header = {
    id: record.id,
    parent: record.parentSession,
    origin: record.origin,
    depth: record.delegationDepth,
    createdAt: record.createdAt,
    cwd: record.cwd,
  };
}

function feedRecords(summary, text) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const seq = Number(record.seq);
    if (Number.isFinite(seq)) {
      if (seq <= (summary.lastSeq ?? -1)) continue;
      summary.lastSeq = seq;
    }
    parseHeader(summary, record);
    if (record.type === 'request/header') {
      const model = record.data?.header?.config?.model;
      if (typeof model === 'string') summary.lastModel = model;
      continue;
    }
    if (record.type === 'assistant/message') addRecord(summary, record);
  }
}

/** 整文件重读 */
function fullParse(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return undefined;
  }
  const summary = emptySummary();
  const { text } = decodeFrames(buf, magicOffsets(buf));
  feedRecords(summary, text);
  summary.nextOffset = buf.length;
  summary.pending = '';
  return summary;
}

/** 增量消费新增帧；帧边界按试解压确定，跨帧的残行留在 pending */
function updateSummary(file, previous) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return undefined;
  }

  if (!previous) {
    const fresh = fullParse(file);
    if (!fresh) return undefined;
    return { summary: fresh, size: stat.size, mtimeMs: stat.mtimeMs };
  }

  const summary = {
    ...previous,
    tokens: { ...previous.tokens },
    byDate: cloneDates(previous.byDate),
    turns: [...(previous.turns ?? [])],
  };
  let offset = summary.nextOffset ?? 0;
  if (stat.size < offset) {
    const fresh = fullParse(file);
    return fresh ? { summary: fresh, size: stat.size, mtimeMs: stat.mtimeMs } : undefined;
  }
  if (stat.size === offset) return { summary, size: stat.size, mtimeMs: stat.mtimeMs };

  const fd = fs.openSync(file, 'r');
  let buf;
  try {
    const length = stat.size - offset;
    buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }

  const { text, consumedTo } = decodeFrames(buf, magicOffsets(buf));
  if (consumedTo > 0) {
    const combined = (summary.pending ?? '') + text;
    const parts = combined.split('\n');
    summary.pending = parts.pop() ?? '';
    feedRecords(summary, parts.join('\n'));
    summary.nextOffset = offset + consumedTo;
  }
  return { summary, size: stat.size, mtimeMs: stat.mtimeMs };
}

function cloneDates(byDate) {
  const out = {};
  if (!byDate) return out;
  for (const [key, value] of Object.entries(byDate)) {
    out[key] = { messages: value.messages, cost: value.cost, tokens: { ...value.tokens } };
  }
  return out;
}

function listSessionFiles() {
  const root = path.join(dshHome(), 'sessions');
  const files = [];
  if (!fs.existsSync(root)) return files;
  for (const bucket of fs.readdirSync(root, { withFileTypes: true })) {
    if (!bucket.isDirectory()) continue;
    const bucketPath = path.join(root, bucket.name);
    let entries;
    try {
      entries = fs.readdirSync(bucketPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(bucketPath, entry.name, 'session.v4.jsonl.zstd');
      if (fs.existsSync(file)) {
        files.push({ key: path.join(bucket.name, entry.name), dir: entry.name, file });
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------- store

let store;
let storeDirty = false;
let saveTimer;

function loadStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    const upgrade = (raw.version ?? 1) < STORE_VERSION;
    return {
      version: STORE_VERSION,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
      files: upgrade ? {} : raw.files ?? {},
    };
  } catch {
    return { version: STORE_VERSION, settings: { ...DEFAULT_SETTINGS }, files: {} };
  }
}

function getStore() {
  if (!store) store = loadStore();
  return store;
}

function scheduleSave() {
  storeDirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    flushStore();
  }, 1500);
  saveTimer.unref?.();
}

export function flushStore() {
  if (!store || !storeDirty) return;
  storeDirty = false;
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store), 'utf8');
  fs.renameSync(tmp, target);
}

// ---------------------------------------------------------------- aggregation

let aggregateCache;
let aggregateAt = 0;

export function refresh() {
  const s = getStore();
  const files = listSessionFiles();
  let changed = false;
  for (const item of files) {
    const previous = s.files[item.key];
    const updated = updateSummary(item.file, previous?.summary);
    if (!updated) continue;
    if (!previous || previous.mtimeMs !== updated.mtimeMs || previous.size !== updated.size) {
      s.files[item.key] = { mtimeMs: updated.mtimeMs, size: updated.size, summary: updated.summary };
      changed = true;
    }
  }
  if (changed) scheduleSave();
  return files.length;
}

export function aggregate() {
  const now = Date.now();
  if (aggregateCache && now - aggregateAt < SUM_TTL_MS) return aggregateCache;
  refresh();
  const today = beijingDate(now);
  const total = emptySummary();
  const perDay = {};
  for (const entry of Object.values(getStore().files)) {
    const summary = entry.summary;
    if (!summary) continue;
    total.messages += summary.messages;
    total.peakMessages += summary.peakMessages;
    total.tokens.input += summary.tokens.input;
    total.tokens.cacheRead += summary.tokens.cacheRead;
    total.tokens.cacheWrite += summary.tokens.cacheWrite;
    total.tokens.output += summary.tokens.output;
    total.cost += summary.cost;
    total.peakCost += summary.peakCost;
    total.offPeakCost += summary.offPeakCost;
    total.unpricedMessages += summary.unpricedMessages;
    for (const model of summary.unpricedModels ?? []) {
      if (!total.unpricedModels.includes(model)) total.unpricedModels.push(model);
    }
    for (const [date, value] of Object.entries(summary.byDate ?? {})) {
      const slot = perDay[date] ?? (perDay[date] = { messages: 0, cost: 0 });
      slot.messages += value.messages;
      slot.cost += value.cost;
    }
  }
  aggregateCache = {
    today: perDay[today] ?? { messages: 0, cost: 0 },
    total: {
      messages: total.messages,
      cost: total.cost,
      tokens: total.tokens,
      peakMessages: total.peakMessages,
      unpricedMessages: total.unpricedMessages,
    },
    sessions: Object.keys(getStore().files).length,
    computedAt: now,
  };
  aggregateAt = now;
  return aggregateCache;
}

function cacheHitRate(tokens) {
  const read = Number(tokens?.cacheRead) || 0;
  const miss = Number(tokens?.input) || 0;
  const write = Number(tokens?.cacheWrite) || 0;
  const total = read + miss + write;
  return total > 0 ? read / total : 0;
}

function normId(id) {
  return String(id || '').replace(/^session-/, '');
}

function childEntries(parentId) {
  const store = getStore();
  const target = normId(parentId);
  const out = [];
  for (const entry of Object.values(store.files)) {
    const header = entry.summary?.header;
    if (!header || !header.parent) continue;
    if (normId(header.parent) === target) out.push(entry);
  }
  return out;
}

export function subagentTotals(sessionId) {
  const seen = new Set([normId(sessionId)]);
  const stack = [sessionId];
  const totals = {
    count: 0,
    cost: 0,
    messages: 0,
    tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
    children: [],
  };
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of childEntries(current)) {
      const header = entry.summary?.header;
      const id = normId(header?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      stack.push(id);
      totals.count += 1;
      totals.cost += entry.summary?.cost ?? 0;
      totals.messages += entry.summary?.messages ?? 0;
      for (const key of Object.keys(totals.tokens)) totals.tokens[key] += entry.summary?.tokens?.[key] ?? 0;
      totals.children.push({ id, cost: entry.summary?.cost ?? 0, messages: entry.summary?.messages ?? 0 });
    }
  }
  return totals;
}

function summaryView(summary) {
  return {
    messages: summary.messages,
    peakMessages: summary.peakMessages,
    tokens: summary.tokens,
    cacheHitRate: cacheHitRate(summary.tokens),
    cost: summary.cost,
    peakCost: summary.peakCost,
    offPeakCost: summary.offPeakCost,
    unpricedMessages: summary.unpricedMessages,
    unpricedModels: summary.unpricedModels,
    header: summary.header,
    turns: (summary.turns ?? []).slice(-500),
  };
}

function findEntry(sessionId) {
  refresh();
  const store = getStore();
  const target = normId(sessionId);
  for (const [key, entry] of Object.entries(store.files)) {
    if (normId(entry.summary?.header?.id) === target || key.endsWith(target)) return entry;
  }
  const hit = listSessionFiles().find((item) => normId(item.dir) === target || item.dir.endsWith(target));
  if (!hit) return undefined;
  const updated = updateSummary(hit.file, undefined);
  if (!updated) return undefined;
  store.files[hit.key] = { mtimeMs: updated.mtimeMs, size: updated.size, summary: updated.summary };
  scheduleSave();
  aggregateCache = undefined;
  return store.files[hit.key];
}

export function sessionSummary(sessionId) {
  const entry = findEntry(sessionId);
  if (!entry) return undefined;
  const view = summaryView(entry.summary);
  view.subagents = subagentTotals(sessionId);
  return view;
}

// ---------------------------------------------------------------- HTTP

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sanitizeSettings(input) {
  const out = {};
  const s = getStore().settings;
  const next = { ...s };
  if (input && typeof input === 'object') {
    if (['composer', 'header', 'hidden'].includes(input.position)) next.position = input.position;
    if (typeof input.fontFamily === 'string' && FONT_FAMILIES[input.fontFamily]) next.fontFamily = input.fontFamily;
    if (typeof input.fontSize === 'number' && Number.isFinite(input.fontSize)) {
      next.fontSize = Math.min(18, Math.max(9, Math.round(input.fontSize)));
    }
    if (typeof input.color === 'string') {
      next.color = /^#[0-9a-fA-F]{3,8}$/.test(input.color) ? input.color : '';
    }
    if (typeof input.showToday === 'boolean') next.showToday = input.showToday;
    for (const key of ['chipPhase', 'chipSession', 'chipToday', 'chipTotal', 'chipBalance']) {
      if (typeof input[key] === 'boolean') next[key] = input[key];
    }
    if (typeof input.showTotal === 'boolean') next.showTotal = input.showTotal;
    for (const key of ['sidebar', 'sidebarSession', 'sidebarToday', 'sidebarTotal', 'sidebarPeak', 'sidebarProgress']) {
      if (typeof input[key] === 'boolean') next[key] = input[key];
    }
    if (['standard', 'simple', 'compact', 'merged'].includes(input.sidebarStyle)) next.sidebarStyle = input.sidebarStyle;
    if ([1000, 5000, 10000, 30000, 60000, 300000, 600000].includes(input.pollMs)) next.pollMs = input.pollMs;
    if ([1000, 5000, 10000, 30000, 60000, 300000, 600000].includes(input.chipPollMs)) next.chipPollMs = input.chipPollMs;
    if ([1000, 5000, 10000, 30000, 60000, 300000, 600000].includes(input.sidebarPollMs)) next.sidebarPollMs = input.sidebarPollMs;
    if (['local', 'official'].includes(input.amountSource)) next.amountSource = input.amountSource;
    if (input.custom && typeof input.custom === 'object') {
      for (const key of ['a1','a2','a3','a4','b1','b2','b3','b4','c1','c2','d1','d2','d3','d4','d5','d6']) {
        if (typeof input.custom[key] === 'boolean') next.custom[key] = input.custom[key];
      }
    }
  }
  out.settings = next;
  out.fontFamilies = FONT_FAMILIES;
  return out;
}

async function platformGet(token, pathname) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(PLATFORM_BASE + pathname, {
      headers: {
        'User-Agent': BROWSER_UA,
        'x-dsh-auth-token': token,
        accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (res.status === 401) return { unauthorized: true };
    if (!res.ok) throw new Error('http ' + res.status);
    return { data: await res.json() };
  } finally {
    clearTimeout(timer);
  }
}

function sumMonthTokens(payload) {
  const body = payload?.data?.biz_data ?? payload?.biz_data ?? payload;
  const rows = Array.isArray(body?.total) ? body.total : [];
  let tokens = 0;
  for (const row of rows) {
    for (const item of row?.usage ?? []) {
      const type = String(item?.type ?? '');
      const amount = Number(item?.amount);
      if (!Number.isFinite(amount)) continue;
      if (type.includes('TOKEN')) tokens += amount;
    }
  }
  return tokens;
}

function walletBalance(payload) {
  const body = payload?.data?.biz_data ?? payload?.biz_data ?? payload ?? {};
  const wallets = [...(body.normal_wallets ?? []), ...(body.bonus_wallets ?? [])];
  let balance = 0;
  let currency = 'CNY';
  for (const wallet of wallets) {
    const value = Number(wallet?.balance);
    if (Number.isFinite(value)) balance += value;
    if (wallet?.currency) currency = String(wallet.currency).toUpperCase();
  }
  return { balance, currency };
}

function costRows(payload) {
  const body = payload?.data?.biz_data ?? payload?.biz_data ?? payload;
  const blocks = Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : [];
  const byDate = new Map();
  for (const block of blocks) {
    const days = Array.isArray(block?.days) ? block.days : [];
    for (const day of days) {
      const date = String(day?.date ?? '');
      if (!date) continue;
      let sum = Number(byDate.get(date)) || 0;
      for (const item of Array.isArray(day?.data) ? day.data : []) {
        for (const usage of Array.isArray(item?.usage) ? item.usage : []) {
          const amount = Number(usage?.amount);
          if (Number.isFinite(amount)) sum += amount;
        }
      }
      byDate.set(date, sum);
    }
  }
  return [...byDate.entries()].map(([date, cost]) => ({ date, cost }));
}

function consumedTotalOf(payload) {
  const body = payload?.data?.biz_data ?? payload?.biz_data ?? {};
  const row = Array.isArray(body?.total_costs) ? body.total_costs[0] : undefined;
  const value = Number(row?.amount);
  return Number.isFinite(value) ? value : undefined;
}

function beijingDateKey(ms) {
  const d = new Date(ms + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function sumRangeCost(payload) {
  const json = payload?.data ?? payload;
  const biz = json?.data?.biz_data ?? json?.biz_data;
  const entries = Array.isArray(biz?.data) ? biz.data : [];
  let sum = 0;
  for (const entry of entries) {
    for (const series of entry?.series ?? []) {
      for (const bucket of series?.buckets ?? []) {
        const value = Number(bucket?.cost ?? bucket?.amount);
        if (Number.isFinite(value)) sum += value;
      }
    }
  }
  return sum;
}

function localMidnightSec(nowMs) {
  const offset = 8 * 3600 * 1000;
  return Math.floor((nowMs - ((nowMs + offset) % 86400000)) / 1000);
}

function monthStartSec(nowMs) {
  const offset = 8 * 3600 * 1000;
  const d = new Date(nowMs + offset);
  const startMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - offset;
  return Math.floor(startMs / 1000);
}

/** 读取 DSH 里已登录的 DeepSeek 账号：余额 + 本月 token + 官方今日/本月/累计费用 */
export async function readAccount(ctx) {
  const now = Date.now();
  if (accountCache && now - accountCache.at < ACCOUNT_TTL_MS) return accountCache.value;

  let token;
  try {
    const record = await ctx.credentials?.readRecord?.(ACCOUNT_RECORD_KEY);
    token = record?.payload?.token;
  } catch {
    token = undefined;
  }
  if (typeof token !== 'string' || token.length === 0) {
    accountCache = { at: now, value: { logged: false } };
    return accountCache.value;
  }

  const date = new Date();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const tz = 8 * 3600;
  const end = Math.ceil(now / 1000 / 3600) * 3600;
  const todayStart = localMidnightSec(now);
  const monthStart = monthStartSec(now);
  try {
    const [summary, amount, todayCostRes, monthCostRes, monthCostDoc] = await Promise.all([
      platformGet(token, '/api/v0/users/get_user_summary'),
      platformGet(token, '/api/v0/usage/amount?month=' + month + '&year=' + year),
      platformGet(token, '/api/v0/usage/by_api_key/cost?start=' + todayStart + '&end=' + end + '&tz=' + tz),
      platformGet(token, '/api/v0/usage/by_api_key/cost?start=' + monthStart + '&end=' + end + '&tz=' + tz).catch(() => undefined),
      platformGet(token, '/api/v0/usage/cost?month=' + month + '&year=' + year).catch(() => undefined),
    ]);
    if (summary?.unauthorized || amount?.unauthorized || todayCostRes?.unauthorized) {
      accountCache = { at: now, value: { logged: false, error: 'unauthorized' } };
      return accountCache.value;
    }
    const { balance, currency } = walletBalance(summary?.data);
    const value = {
      logged: true,
      balance,
      currency,
      monthTokens: sumMonthTokens(amount?.data),
      monthCost: sumRangeCost(monthCostRes?.data) || costRows(monthCostDoc?.data).reduce((sum, row) => sum + row.cost, 0),
      todayCost: sumRangeCost(todayCostRes?.data),
      today: beijingDateKey(now),
      consumedTotal: consumedTotalOf(summary?.data),
      month,
      year,
      fetchedAt: now,
      rawToday: JSON.stringify(todayCostRes?.data ?? null).slice(0, 4000),
    };
    accountCache = { at: now, value };
    return value;
  } catch (error) {
    const value = { logged: true, error: String(error?.message ?? error), fetchedAt: now };
    accountCache = { at: now, value };
    return value;
  }
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({
    path: '/api/precise-billing',
    handler: async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const pathname = url.pathname;

        if (pathname === '/api/precise-billing/settings') {
          if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, settings: getStore().settings, fontFamilies: FONT_FAMILIES });
            return;
          }
          if (req.method === 'POST') {
            const raw = await readBody(req);
            let body;
            try {
              body = JSON.parse(raw || '{}');
            } catch {
              sendJson(res, 400, { ok: false, error: 'invalid json' });
              return;
            }
            const { settings } = sanitizeSettings(body);
            getStore().settings = settings;
            scheduleSave();
            aggregateCache = undefined;
            sendJson(res, 200, { ok: true, settings, fontFamilies: FONT_FAMILIES });
            return;
          }
          sendJson(res, 405, { ok: false, error: 'method not allowed' });
          return;
        }

        if (pathname === '/api/precise-billing/session') {
          const id = url.searchParams.get('session');
          if (!id) { sendJson(res, 400, { ok: false, error: 'session required' }); return; }
          const detail = sessionSummary(id);
          sendJson(res, detail ? 200 : 404, detail ? { ok: true, session: detail } : { ok: false, error: 'not found' });
          return;
        }

        if (pathname === '/api/precise-billing/account') {
          const account = await readAccount(ctx);
          sendJson(res, 200, { ok: true, account });
          return;
        }

        if (pathname === '/api/precise-billing' || pathname === '/api/precise-billing/') {
          const scope = url.searchParams.get('scope') || 'summary';
          if (scope === 'summary') {
            const sessionId = url.searchParams.get('session') || undefined;
            const agg = aggregate();
            sendJson(res, 200, {
              ok: true,
              session: sessionId ? sessionSummary(sessionId) : undefined,
              today: agg.today,
              total: agg.total,
              sessions: agg.sessions,
              settings: getStore().settings,
              fontFamilies: FONT_FAMILIES,
              phase: phaseAt(Date.now()),
              computedAt: agg.computedAt,
            });
            return;
          }
          sendJson(res, 400, { ok: false, error: 'unknown scope' });
          return;
        }

        sendJson(res, 404, { ok: false, error: 'not found' });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
    },
  });

  ctx.effect(() => dispose);
  ctx.effect(
    () => () => {
      flushStore();
    },
  );
}
