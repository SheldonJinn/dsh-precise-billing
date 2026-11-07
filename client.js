/**
 * precise-billing · Client half
 *  - 输入框下方 / 会话标题栏 费用条：本会话、今日、累计
 *  - 侧栏卡片：今日消费 / 累计消费 / 峰谷进度（红=峰时，绿=闲时）
 *  - 设置 → 精确计费：分组表单 + 实时预览
 */
window.__ModuleLoader__.load({
  id: '@local/precise-billing',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    let slotsService;
    function openBillingSettings() {
      try {
        const entries = typeof slotsService?.entries === 'function' ? slotsService.entries('sidebar.settings') : [];
        for (const entry of entries) {
          const seat = entry && entry.store;
          const api = seat && typeof seat.create === 'function' ? seat.create() : undefined;
          const openSection = api && api.actions && api.actions.openSection;
          if (typeof openSection === 'function') {
            openSection('precise-billing');
            return true;
          }
        }
      } catch {
        /* 设置导航不可用：静默失败，不影响卡片渲染 */
      }
      return false;
    }

    const ReactDOM = (() => {
      try {
        return require('react-dom');
      } catch {
        return undefined;
      }
    })();
    const POLL_MS = 5000;

    const DEFAULT_SETTINGS = {
      position: 'composer',
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
      sidebarStyle: 'standard',
      sidebarToday: true,
      sidebarTotal: true,
      sidebarPeak: true,
      sidebarProgress: true,
      pollMs: 60000,
      chipPollMs: 10000,
      sidebarPollMs: 30000,
      amountSource: 'local',
      custom: {
        a1: true, a2: true, a3: true, a4: true,
        b1: true, b2: true, b3: true, b4: true,
        c1: true, c2: true,
        d1: true, d2: true, d3: true, d4: true, d5: true, d6: true,
      },
    };

    const FONT_LABELS = {
      inherit: '跟随界面',
      yahei: '微软雅黑',
      system: '系统界面字体',
      mono: '等宽（Consolas）',
      serif: '衬线（Georgia）',
    };

    const PEAK_COLOR = '#e07f0a';
    const OFF_COLOR = '#2e9e63';
    const SPLIT_COLOR = '#000000';
    const MUTED = 'var(--dsw-alias-label-secondary, #666)';

    // 与宿主一致的峰谷规则（法定节假日全天闲时）
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

    function dateKey(ms) {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function isPeakAt(ms) {
      const d = new Date(ms);
      const wd = d.getDay();
      if (wd === 0 || wd === 6) return false;
      if (HOLIDAYS.has(dateKey(ms))) return false;
      const hour = d.getHours();
      return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
    }

    const MINUTE = 60 * 1000;

    /** 本地计算当前时段：[since, until)，以及下一段的结束时刻 */
    function phaseModel(now) {
      const peak = isPeakAt(now);
      const base = Math.floor(now / MINUTE) * MINUTE;
      let until = base;
      for (let i = 0; i < 60 * 96; i++) {
        until += MINUTE;
        if (isPeakAt(until) !== peak) break;
      }
      let since = base;
      for (let i = 0; i < 60 * 96; i++) {
        if (isPeakAt(since - MINUTE) !== peak) break;
        since -= MINUTE;
      }
      let nextUntil = until;
      const nextPeak = !peak;
      for (let i = 0; i < 60 * 96; i++) {
        nextUntil += MINUTE;
        if (isPeakAt(nextUntil) !== nextPeak) break;
      }
      const span = Math.max(1, until - since);
      const elapsed = Math.max(0, now - since);
      const progress = Math.min(100, (elapsed / span) * 100);
      const weekday = new Date(now).getDay();
      return {
        peak,
        since,
        until,
        nextUntil,
        left: Math.max(0, until - now),
        elapsed,
        progress,
        remaining: Math.max(0, 100 - progress),
        holiday: HOLIDAYS.has(dateKey(now)),
        weekend: !HOLIDAYS.has(dateKey(now)) && (weekday === 0 || weekday === 6),
      };
    }

    function moneyFull(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      const fixed = n.toFixed(4);
      const negative = fixed.startsWith('-');
      const [int, dec] = (negative ? fixed.slice(1) : fixed).split('.');
      const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      return '¥' + (negative ? '-' : '') + grouped + '.' + dec + '元';
    }

    function fmtTokensCN(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '—';
      if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
      if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
      return String(Math.round(n));
    }

    function money(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      const abs = Math.abs(n);
      if (abs >= 1e8) return '¥' + (n / 1e8).toFixed(4) + '亿';
      if (abs >= 1e4) return '¥' + (n / 1e4).toFixed(4) + '万';
      return '¥' + n.toFixed(2);
    }

    function fmtTokens(value) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return '—';
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return String(Math.round(n));
    }

    function cacheHitRate(tokens) {
      if (!tokens) return '—';
      const read = Number(tokens.cacheRead) || 0;
      const miss = Number(tokens.input) || 0;
      const write = Number(tokens.cacheWrite) || 0;
      const total = read + miss + write;
      if (total <= 0) return '—';
      return ((read / total) * 100).toFixed(1) + '%';
    }

    function useAccount() {
      const [state, setState] = React.useState({ status: 'loading' });
      React.useEffect(() => {
        let alive = true;
        let timer = null;
        const tick = async () => {
          try {
            const res = await fetch('/api/precise-billing/account', { cache: 'no-store' });
            const data = await res.json();
            if (alive && data?.ok) setState({ status: 'ok', account: data.account });
            else if (alive) setState((prev) => (prev.status === 'ok' ? prev : { status: 'error' }));
          } catch {
            if (alive) setState((prev) => (prev.status === 'ok' ? prev : { status: 'error' }));
          }
          if (alive) timer = setTimeout(tick, 120000);
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, []);
      return state;
    }

    function pad2(n) {
      return String(n).padStart(2, '0');
    }

    function fmtClock(ms) {
      const d = new Date(ms);
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    /** 跨天时带上「月/日」，当天只显示时刻 */
    function fmtClockSmart(ms, now) {
      const d = new Date(ms);
      return dateKey(ms) === dateKey(now)
        ? fmtClock(ms)
        : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + fmtClock(ms);
    }

    function fmtRange(a, b, now) {
      return fmtClockSmart(a, now) + ' ~ ' + fmtClockSmart(b, now);
    }

    /** HH:mm:ss（不省略位） */
    function fmtHMS(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      return pad2(Math.floor(total / 3600)) + ':' + pad2(Math.floor((total % 3600) / 60)) + ':' + pad2(total % 60);
    }

    function pct(value) {
      return value.toFixed(2) + '%';
    }

    function coin() {
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 24 24',
        style: { marginRight: 5, flex: '0 0 auto', opacity: 0.95 },
        'aria-hidden': true,
      },
        h('circle', { cx: 12, cy: 12, r: 11, fill: 'currentColor' }),
        h('text', {
          x: 12,
          y: 16.8,
          textAnchor: 'middle',
          fontSize: 14,
          fontWeight: 700,
          fill: '#ffffff',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }, '¥'),
      );
    }

    function gearIcon(size = 14) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          fill: 'currentColor',
          d: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
        }));
    }

    function closeIcon(size = 14) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M6 6L18 18M18 6L6 18', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }));
    }

    function square(color) {
      return h('i', {
        style: { width: 7, height: 7, borderRadius: 1.5, background: color, display: 'inline-block', flex: '0 0 auto' },
        'aria-hidden': true,
      });
    }

    function dot(color) {
      return h('i', {
        style: { width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' },
        'aria-hidden': true,
      });
    }

    const POLL_CHOICES = [1000, 5000, 10000, 30000, 60000, 300000, 600000];

    function useSummary(sessionId, pollKey = 'sidebarPollMs') {
      const [state, setState] = React.useState({ status: 'loading' });
      React.useEffect(() => {
        let alive = true;
        let timer = null;
        let delay = pollKey === 'chipPollMs' ? 10000 : 30000;
        const tick = async () => {
          try {
            const query = sessionId ? '?scope=summary&session=' + encodeURIComponent(sessionId) : '?scope=summary';
            const res = await fetch('/api/precise-billing' + query, { cache: 'no-store' });
            if (!res.ok) throw new Error('http ' + res.status);
            const data = await res.json();
            if (alive) {
              setState({ status: 'ok', data });
              const next = Number(data?.settings?.[pollKey]);
              if (POLL_CHOICES.includes(next)) delay = next;
            }
          } catch {
            if (alive) setState((prev) => (prev.status === 'ok' ? prev : { status: 'error' }));
          }
          if (alive) timer = setTimeout(tick, delay);
        };
        tick();
        return () => {
          alive = false;
          if (timer) clearTimeout(timer);
        };
      }, [sessionId, pollKey]);
      return state;
    }

    /** ---------------------------------------------------------- 费用条 -- */
    function fmtTok(n) {
      return Number(n || 0).toLocaleString('en-US');
    }

    /** 点击费用条弹出的「本会话明细」卡片 */
    function SessionPanel({ detail, onClose, position, panelRef }) {
      const chartRef = React.useRef(null);
      React.useEffect(() => {
        const el = chartRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      }, [detail]);
      const s = detail;
      const sub = s.subagents;
      const total = (s.cost || 0) + (sub?.cost || 0);
      const pct = ((s.cacheHitRate || 0) * 100).toFixed(1) + '%';
      const rows = [
        ['缓存命中', pct],
        ['输入（未命中）', fmtTok(s.tokens.input)],
        ['缓存读取', fmtTok(s.tokens.cacheRead)],
        ['输出', fmtTok(s.tokens.output)],
      ];
      const allTurns = s.turns ?? [];
      const turns = allTurns;
      const peakTurns = Number(s.peakMessages ?? 0);
      const offTurns = Math.max(0, Number(s.messages ?? 0) - peakTurns);
      const sortedCosts = turns.map((turn) => turn.c || 0).sort((a, b) => a - b);
      const p95 = sortedCosts.length > 0 ? sortedCosts[Math.min(sortedCosts.length - 1, Math.floor(sortedCosts.length * 0.95))] : 0;
      const maxCost = Math.max(p95, 0.000001);
      const chartRows = [];
      for (let i = 0; i < turns.length; i += 25) chartRows.push(turns.slice(i, i + 25));
      return h('div', {
        ref: panelRef,
        style: {
          position: 'fixed',
          left: (position?.left ?? 18) + 'px',
          ...(position && position.top != null ? { top: position.top + 'px' } : { bottom: (position?.bottom ?? 96) + 'px' }),
          zIndex: 9999,
          width: 420,
          padding: '12px 14px',
          borderRadius: 10,
          background: 'var(--dsw-alias-bg-layer-1, #fff)',
          border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.18))',
          boxShadow: '0 10px 30px rgba(0,0,0,.18)',
          color: 'var(--dsw-alias-label-secondary, #555)',
          fontSize: 12,
          lineHeight: 1.7,
          userSelect: 'none',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 } },
          h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' } }, '本会话计费'),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('button', {
              type: 'button',
              onClick: () => openBillingSettings(),
              title: '打开精确计费设置',
              style: { width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, lineHeight: 1, color: 'inherit', opacity: 0.65, padding: 0 },
            }, gearIcon(13)),
            h('button', {
              type: 'button',
              onClick: onClose,
              title: '关闭',
              style: { width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 17, lineHeight: 1, color: 'inherit', opacity: 0.65, padding: 0 },
            }, closeIcon(13)))),
        h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '2px 0 2px' } },
          h('span', { style: { fontSize: 22, fontWeight: 700, color: 'var(--dsw-alias-label-primary, #111)' } }, money(total))),
        h('div', { style: { fontSize: 11, opacity: 0.85, marginBottom: 8 } },
          '主会话 ' + money(s.cost) + (sub && sub.count > 0 ? ' + 子代理 ' + sub.count + ' 个 ' + money(sub.cost) : '') + ' = ' + money(total)),
        ...rows.map(([label, value]) => h('div', { key: label, style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
          h('span', null, label), h('span', { style: { fontVariantNumeric: 'tabular-nums' } }, value))),
        h('div', { style: { height: 1, background: 'var(--dsw-alias-border-l1, rgba(0,0,0,.08))', margin: '8px 0' } }),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
          h('span', null, '空闲时段'), h('span', null, money(s.offPeakCost))),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 10 } },
          h('span', null, '高峰时段'), h('span', null, money(s.peakCost))),
        turns.length > 0
          ? h('div', { style: { marginTop: 8 } },
              h('div', { style: { fontSize: 11, opacity: 0.8, marginBottom: 4 } }, '最近 ' + turns.length + ' 轮成本'),
              h('div', { ref: chartRef, style: { maxHeight: 132, overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 } },
                ...chartRows.map((row, rowIndex) => h('div', {
                key: 'row' + rowIndex,
                style: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 46, marginBottom: rowIndex === chartRows.length - 1 ? 0 : 8 },
              }, row.map((turn, index) => h('div', {
                key: index,
                title: (turn.t ? fmtDateTime(turn.t) + ' · ' : '') + money(turn.c) + (turn.p ? ' · 峰时' : ' · 空闲'),
                style: { flex: '0 0 13px', width: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 2 },
              },
                h('span', {
                  style: {
                    fontSize: 7,
                    lineHeight: 1,
                    color: turn.p ? PEAK_COLOR : OFF_COLOR,
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap',
                  },
                }, turn.c >= 1 ? turn.c.toFixed(1) : turn.c.toFixed(2)),
                h('div', {
                  style: {
                    width: '100%',
                    height: Math.min(34, Math.max(3, Math.round(Math.sqrt(turn.c / maxCost) * 32))) + 'px',
                    borderRadius: 2,
                    background: turn.p ? PEAK_COLOR : OFF_COLOR,
                    opacity: 0.85,
                  },
                }))))),
              h('div', { style: { display: 'flex', gap: 12, fontSize: 10, marginTop: 5, opacity: 0.85, flexWrap: 'wrap' } },
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                  h('i', { style: { width: 8, height: 8, borderRadius: 2, background: PEAK_COLOR } }),
                  '高峰 ' + peakTurns + ' 轮 · ' + money(s.peakCost)),
                h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
                  h('i', { style: { width: 8, height: 8, borderRadius: 2, background: OFF_COLOR } }),
                  '空闲 ' + offTurns + ' 轮 · ' + money(s.offPeakCost)))))
          : null);
    }

    function buildChip(settings, families, data, status, account, opts) {
      const options = opts || {};
      const official = settings.amountSource === 'official' && account?.logged === true;
      const todayValue = official ? Number(account.todayCost) : data?.today?.cost;
      const totalValue = official ? Number(account.consumedTotal) : data?.total?.cost;
      const primary = data?.session ? money(data.session.cost) : data?.today ? money(data.today.cost) : status === 'error' ? '不可用' : '…';
      const phaseNow = phaseModel(Date.now());
      const parts = [];
      if (settings.chipPhase !== false) {
        parts.push(h('span', { key: 'phase', style: { color: phaseNow.peak ? PEAK_COLOR : OFF_COLOR, fontWeight: 600 } }, phaseNow.peak ? '峰时' : '闲时'));
      }
      if (settings.chipSession !== false) parts.push(h('span', { key: 'self' }, '本次 ' + primary));
      if (settings.chipToday !== false && settings.showToday !== false) parts.push(h('span', { key: 'today' }, '今日 ' + money(todayValue)));
      if (settings.chipTotal !== false && settings.showTotal !== false) parts.push(h('span', { key: 'total' }, '累计 ' + money(totalValue)));
      if (settings.chipBalance !== false && account?.logged === true && Number.isFinite(Number(account.balance))) parts.push(h('span', { key: 'balance' }, '余额 ' + money(Number(account.balance))));
      if (data?.session?.unpricedMessages) parts.push(h('span', { key: 'warn', style: { color: 'var(--dsw-alias-state-warn-primary, #c98a00)' } }, '含未计价'));

      const sess = data?.session;
      const parts2 = [];
      parts2.push(phaseNow.peak ? '峰时' : '闲时');
      if (sess?.tokens) parts2.push('缓存命中 ' + cacheHitRate(sess.tokens));
      parts2.push((data?.sessions ?? 0) + ' 个会话');

      return h('div', {
        onClick: options.onClick,
        ref: options.innerRef,
        onMouseEnter: options.onMouseEnter,
        onMouseLeave: options.onMouseLeave,
        title: [
          '本次 ' + (data?.session ? money(data.session.cost) : '—') + ' · 今日 ' + money(todayValue) + ' · 累计 ' + money(totalValue) + ' · 余额 ' + (account?.logged === true ? money(Number(account.balance)) : '—'),
          parts2.join(' · '),
        ].join('\n'),
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: families[settings.fontFamily] || 'inherit',
          fontSize: (settings.fontSize || 11) + 'px',
          lineHeight: 1.6,
          padding: '1px 8px',
          borderRadius: 999,
          color: settings.color || MUTED,
          background: options.active || options.hovered
            ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.07))'
            : 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.03))',
          border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
          whiteSpace: 'nowrap',
          userSelect: 'none',
          cursor: options.onClick ? 'pointer' : 'default',
          transition: 'background .15s ease',
        },
      }, ...parts);
    }

    function Chip(props) {
      props = props || {};
      const state = useSummary(props.sessionId, 'chipPollMs');
      const accountState = useAccount();
      const [open, setOpen] = React.useState(false);
      const [detail, setDetail] = React.useState(undefined);
      const [hovered, setHovered] = React.useState(false);
      const [position, setPosition] = React.useState(undefined);
      const chipRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const data = state.data;
      const settings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
      const families = data?.fontFamilies || {};
      const slot = props.__slot === 'header' ? 'header' : 'composer';

      const place = React.useCallback(() => {
        const node = chipRef.current;
        if (!node || typeof window === 'undefined') return;
        const rect = node.getBoundingClientRect();
        const width = 420;
        const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceAbove < 340 && spaceBelow > spaceAbove) {
          setPosition({ left, top: rect.bottom + 8 });
        } else {
          setPosition({ left, bottom: Math.max(8, window.innerHeight - rect.top + 8) });
        }
      }, []);

      React.useEffect(() => {
        if (!open) return undefined;
        place();
        const onPointerDown = (event) => {
          const target = event.target;
          if (chipRef.current && chipRef.current.contains(target)) return;
          if (panelRef.current && panelRef.current.contains(target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, place]);

      React.useEffect(() => {
        if (!open || !props.sessionId) return undefined;
        let alive = true;
        fetch('/api/precise-billing/session?session=' + encodeURIComponent(props.sessionId), { cache: 'no-store' })
          .then((res) => res.json())
          .then((json) => {
            if (alive && json?.ok) setDetail(json.session);
          })
          .catch(() => {});
        return () => {
          alive = false;
        };
      }, [open, props.sessionId]);

      if (settings.position !== slot) return null;
      const chip = buildChip(settings, families, data, state.status, accountState.account, {
        onClick: () => setOpen((value) => !value),
        active: open,
        hovered,
        innerRef: chipRef,
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
      });
      if (!open || !detail) return chip;
      const panel = h(SessionPanel, { detail, onClose: () => setOpen(false), position, panelRef });
      if (ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined') {
        return h(React.Fragment, null, chip, ReactDOM.createPortal(panel, document.body));
      }
      return chip;
    }

    /* ---------------------------------------------------------- 用量面板 -- */

    let usageOpen = false;
    const usageListeners = new Set();

    function setUsageOpen(value) {
      usageOpen = value;
      for (const fn of usageListeners) fn();
    }

    function useUsageOpen() {
      const [, force] = React.useState(0);
      React.useEffect(() => {
        const fn = () => force((x) => x + 1);
        usageListeners.add(fn);
        return () => usageListeners.delete(fn);
      }, []);
      return usageOpen;
    }

    function isoDate(date) {
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function addDays(date, days) {
      const next = new Date(date.getTime());
      next.setDate(next.getDate() + days);
      return next;
    }

    function rangeOf(key) {
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (key === 'yesterday') {
        const day = addDays(startOfDay, -1);
        return { from: isoDate(day), to: isoDate(day) };
      }
      if (key === 'last7') return { from: isoDate(addDays(startOfDay, -6)), to: isoDate(startOfDay) };
      if (key === 'last30') return { from: isoDate(addDays(startOfDay, -29)), to: isoDate(startOfDay) };
      if (key === 'thisMonth') {
        return { from: isoDate(new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 1)), to: isoDate(new Date(startOfDay.getFullYear(), startOfDay.getMonth() + 1, 0)) };
      }
      if (key === 'lastMonth') {
        const first = new Date(startOfDay.getFullYear(), startOfDay.getMonth() - 1, 1);
        const last = new Date(startOfDay.getFullYear(), startOfDay.getMonth(), 0);
        return { from: isoDate(first), to: isoDate(last) };
      }
      if (key === 'thisYear') {
        return { from: isoDate(new Date(startOfDay.getFullYear(), 0, 1)), to: isoDate(new Date(startOfDay.getFullYear(), 11, 31)) };
      }
      return { from: isoDate(startOfDay), to: isoDate(startOfDay) };
    }

    const USAGE_RANGES = [
      { value: 'today', label: '今天' },
      { value: 'yesterday', label: '昨天' },
      { value: 'last7', label: '近 7 天' },
      { value: 'last30', label: '近 30 天' },
      { value: 'thisMonth', label: '本月' },
      { value: 'lastMonth', label: '上月' },
      { value: 'thisYear', label: '今年' },
    ];

    function usageTotalTokens(tokens) {
      return (tokens.input || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0) + (tokens.output || 0);
    }

    function usageHitRate(tokens) {
      const hit = (tokens.cacheRead || 0) + (tokens.cacheWrite || 0);
      const all = usageTotalTokens(tokens);
      return all > 0 ? hit / all : 0;
    }

    function fmtNumberCn(value) {
      const n = Number(value) || 0;
      if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
      if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
      return String(Math.round(n));
    }

    function fmtMoneyCn(value) {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      if (Math.abs(n) >= 1e4) return '¥' + (n / 1e4).toFixed(2) + '万';
      if (Math.abs(n) >= 1) return '¥' + n.toFixed(2);
      return '¥' + n.toFixed(4);
    }

    const MODEL_PALETTE = ['#2f6fed', '#e07f0a', '#2e9e63', '#9b59b6', '#c0392b', '#16a085', '#d35400', '#8e44ad'];

    function modelColor(name, list) {
      const index = Math.max(0, (list || []).indexOf(name));
      return MODEL_PALETTE[index % MODEL_PALETTE.length];
    }

    function zeroTokenBucket() {
      return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    }

    function filterUsageByModels(data, selected) {
      if (!data || !Array.isArray(selected) || selected.length === 0) return data;
      const all = ((data.totals && data.totals.models) || []).map((item) => item.model);
      if (selected.length >= all.length && all.every((name) => selected.includes(name))) return data;
      const set = new Set(selected);
      const pick = (models) => {
        const out = { tokens: zeroTokenBucket(), cost: 0, peakCost: 0, offPeakCost: 0, requests: 0, models: [] };
        for (const model of models || []) {
          if (!set.has(model.model)) continue;
          out.models.push(model);
          out.cost += model.cost || 0;
          out.peakCost += model.peakCost || 0;
          out.offPeakCost += model.offPeakCost || 0;
          out.requests += model.requests || 0;
          const t = model.tokens || {};
          out.tokens.input += t.input || 0;
          out.tokens.cacheRead += t.cacheRead || 0;
          out.tokens.cacheWrite += t.cacheWrite || 0;
          out.tokens.output += t.output || 0;
        }
        return out;
      };
      const mapDays = (days) =>
        (days || [])
          .map((day) => ({ ...day, ...pick(day.models) }))
          .filter((day) => day.models.length > 0);
      const days = mapDays(data.days);
      const localDays = data.localDays ? mapDays(data.localDays) : undefined;
      const mapHours = (hours) =>
        (hours || [])
          .map((entry) => {
            const list = Object.entries(entry.models || {}).map(([name, value]) => ({ model: name, ...value }));
            const picked = pick(list);
            const models = {};
            for (const model of picked.models) models[model.model] = model;
            return { ...entry, ...picked, models };
          })
          .filter((entry) => Object.keys(entry.models).length > 0);
      const hours = data.hours ? mapHours(data.hours) : undefined;
      const totals = pick((data.totals && data.totals.models) || []);
      const localTotals = data.localTotals ? pick(data.localTotals.models || []) : undefined;
      return { ...data, days, localDays, hours, totals, localTotals };
    }

    function dailyOrMonthly(days) {
      const list = (days || []).slice(-366);
      if (list.length === 0) return { monthly: false, items: [] };
      const first = new Date(list[0].date + 'T00:00:00');
      const last = new Date(list[list.length - 1].date + 'T00:00:00');
      const span = Math.round((last - first) / 86400000);
      const monthly = span > 120;
      const emptySlot = (key, label) => ({ key, label, total: 0, peak: 0, off: 0, requests: 0, tokens: 0, parts: {}, modelTokens: {} });
      const addDay = (slot, day) => {
        slot.total += day.cost || 0;
        slot.peak += day.peakCost || 0;
        slot.off += day.offPeakCost || 0;
        slot.requests += day.requests || 0;
        slot.tokens += usageTotalTokens(day.tokens || {});
        for (const model of day.models || []) {
          slot.parts[model.model] = (slot.parts[model.model] || 0) + (model.cost || 0);
          slot.modelTokens[model.model] = (slot.modelTokens[model.model] || 0) + usageTotalTokens(model.tokens || {});
        }
      };
      if (!monthly) {
        return {
          monthly,
          items: list.map((day) => {
            const slot = emptySlot(day.date, day.date.slice(5));
            addDay(slot, day);
            return slot;
          }),
        };
      }
      const map = {};
      for (const day of list) {
        const key = day.date.slice(0, 7);
        const slot = map[key] ?? (map[key] = emptySlot(key, Number(key.slice(5)) + '月'));
        addDay(slot, day);
      }
      return { monthly, items: Object.values(map).sort((a, b) => (a.key < b.key ? -1 : 1)) };
    }

    function UsageCostChart({ days, hours, dayKey, singleDay, models }) {
      const names = models || [];
      let series = [];
      let xLabels = [];
      if (singleDay) {
        const byHour = {};
        for (const entry of hours || []) {
          const time = String(entry.time || '');
          if (time.slice(0, 10) !== dayKey) continue;
          const hour = Number(time.slice(11, 13));
          if (!Number.isFinite(hour)) continue;
          const slot = byHour[hour] || (byHour[hour] = { total: 0, parts: {}, peak: 0, off: 0 });
          slot.peak += entry.peakCost || 0;
          slot.off += entry.offPeakCost || 0;
          const hourModels = entry.models || {};
          const keys = Object.keys(hourModels);
          if (keys.length === 0) {
            slot.total += entry.cost || 0;
            continue;
          }
          for (const name of keys) {
            const value = (hourModels[name] && hourModels[name].cost) || 0;
            slot.parts[name] = (slot.parts[name] || 0) + value;
            slot.total += value;
          }
        }
        for (let hour = 0; hour <= 23; hour += 1) {
          const slot = byHour[hour] || { total: 0, parts: {}, peak: 0, off: 0 };
          series.push({ label: String(hour).padStart(2, '0') + ':00', total: slot.total, parts: slot.parts, peak: slot.peak, off: slot.off });
        }
        xLabels = ['00:00', '06:00', '12:00', '18:00', '23:00'];
      } else {
        series = dailyOrMonthly(days).items;
        if (series.length > 0) {
          const middle = series[Math.floor(series.length / 2)].label.slice(5);
          xLabels = [series[0].label.slice(5), middle, series[series.length - 1].label.slice(5)];
        }
      }
      if (series.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');

      const axisSlots = series.map((item, index) => {
        if (singleDay) return item.label;
        return item.label;
      });

      const max = Math.max.apply(null, series.map((item) => item.total).concat([0.0001]));
      const height = 96;

      const axisMoney = (value) => '¥' + Number(value || 0).toFixed(2);
      const yLabels = [4, 3, 2, 1, 0].map((step) =>
        h('div', { key: step }, axisMoney((max * step) / 4)));

      const gridLines = [1, 2, 3, 4].map((step) =>
        h('div', { key: step, style: { position: 'absolute', left: 0, right: 0, bottom: step * 25 + '%', borderTop: '1px dashed rgba(0,0,0,.13)' } }));

      const singleModel = names.length <= 1;
      const bars = series.map((item, index) => {
        const phaseColor = (item.peak || 0) > (item.off || 0) ? PEAK_COLOR : OFF_COLOR;
        const stack = singleModel
          ? (singleDay || item.total <= 0
              ? [h('div', { key: 'phase', style: { height: '100%', background: phaseColor } })]
              : [
                  h('div', { key: 'peak', style: { height: ((item.peak || 0) / item.total) * 100 + '%', background: PEAK_COLOR } }),
                  h('div', { key: 'off', style: { height: ((item.off || 0) / item.total) * 100 + '%', background: OFF_COLOR } }),
                ])
          : names
              .filter((name) => item.parts[name])
              .map((name) => h('div', {
                key: name,
                style: { height: item.total > 0 ? ((item.parts[name] || 0) / item.total) * 100 + '%' : '0%', background: modelColor(name, names) },
              }));
        const bar = h('div', { style: { width: '55%', maxWidth: 22, minWidth: 3, height: (item.total > 0 ? Math.max(1, (item.total / max) * 100) : 0) + '%', display: 'flex', flexDirection: 'column-reverse', borderRadius: '2px 2px 0 0', overflow: 'hidden' } }, stack);
        return h('div', {
          key: index,
          title: item.label + ' · ' + fmtMoneyCn(item.total),
          style: { flex: '1 1 0', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', minWidth: 2 },
        }, bar);
      });

      const plot = h('div', { style: { position: 'relative', height: height, borderLeft: '1px solid rgba(0,0,0,.18)', borderBottom: '1px solid rgba(0,0,0,.18)' } },
        gridLines,
        h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 6 } }, bars));

      const xAxis = h('div', { style: { display: 'flex', fontSize: singleDay || series.length > 10 ? 8 : 9.5, color: MUTED, marginTop: 3 } },
        axisSlots.map((label, index) => h('span', { key: index, style: { flex: '1 1 0', textAlign: 'center', whiteSpace: 'nowrap' } }, label)));

      const axis = h('div', { style: { display: 'flex', gap: 6 } },
        h('div', { style: { width: 58, height: height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: MUTED, textAlign: 'right' } }, yLabels),
        h('div', { style: { flex: '1 1 0', minWidth: 0 } }, plot, xAxis));

      const legendItems = singleModel
        ? [
            h('span', { key: 'peak', style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('i', { style: { width: 8, height: 8, borderRadius: 2, background: PEAK_COLOR, display: 'inline-block' } }),
              '峰时'),
            h('span', { key: 'off', style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('i', { style: { width: 8, height: 8, borderRadius: 2, background: OFF_COLOR, display: 'inline-block' } }),
              '闲时'),
            h('span', { key: 'model', style: { color: MUTED } }, names[0] || ''),
          ]
        : names.map((name) =>
            h('span', { key: name, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
              h('i', { style: { width: 8, height: 8, borderRadius: 2, background: modelColor(name, names), display: 'inline-block' } }),
              name));
      const legend = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 10.5, color: MUTED } }, legendItems);

      return h('div', null, axis, legend);
    }

    function UsageRequestsChart({ days, hours, dayKey, singleDay }) {
      const values = [];
      const labels = [];
      if (singleDay) {
        const byHour = {};
        for (const entry of hours || []) {
          const time = String(entry.time || '');
          if (time.slice(0, 10) !== dayKey) continue;
          const hour = Number(time.slice(11, 13));
          if (!Number.isFinite(hour)) continue;
          byHour[hour] = (byHour[hour] || 0) + (entry.requests || 0);
        }
        for (let hour = 0; hour <= 23; hour += 1) {
          values.push(byHour[hour] || 0);
          labels.push(String(hour).padStart(2, '0') + ':00');
        }
      } else {
        for (const slot of dailyOrMonthly(days).items) {
          values.push(slot.requests || 0);
          labels.push(slot.label);
        }
      }
      if (values.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');

      const width = 1000;
      const height = 96;
      const max = Math.max.apply(null, values.concat([1]));
      const step = values.length > 1 ? width / (values.length - 1) : width;
      const px = (index) => Math.round(index * step);
      const py = (value) => Math.round(height - (value / max) * height);
      const points = values.map((value, index) => px(index) + ',' + py(value));
      const linePath = 'M' + points.join(' L');
      const areaPath = linePath + ' L' + px(values.length - 1) + ',' + height + ' L0,' + height + ' Z';

      const grid = [1, 2, 3, 4].map((k) =>
        h('div', { key: k, style: { position: 'absolute', left: 0, right: 0, bottom: k * 25 + '%', borderTop: '1px dashed rgba(0,0,0,.13)' } }));

      const hoverRects = values.map((value, index) => {
        const rect = h('rect', { x: px(index), y: 0, width: Math.max(1, step), height: height, fill: 'transparent' });
        return h('g', { key: index }, rect, h('title', null, labels[index] + ' · ' + fmtNumberCn(value) + ' 次'));
      });

      const svg = h('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        preserveAspectRatio: 'none',
        style: { position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' },
      },
        h('path', { d: areaPath, fill: 'rgba(47,111,237,.18)' }),
        h('path', { d: linePath, fill: 'none', stroke: '#2f6fed', strokeWidth: 2, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round' }),
        hoverRects);

      const plot = h('div', { style: { position: 'relative', height: height, borderLeft: '1px solid rgba(0,0,0,.18)', borderBottom: '1px solid rgba(0,0,0,.18)' } }, grid, svg);

      const axisSlots = labels.map((label, index) => {
        if (singleDay) return label;
        return label;
      });
      const xAxis = h('div', { style: { display: 'flex', fontSize: singleDay || labels.length > 10 ? 8 : 9.5, color: MUTED, marginTop: 3 } },
        axisSlots.map((label, index) => h('span', { key: index, style: { flex: '1 1 0', textAlign: 'center', whiteSpace: 'nowrap' } }, label)));

      const yAxis = h('div', { style: { width: 56, height: height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: MUTED, textAlign: 'right' } },
        [4, 3, 2, 1, 0].map((k) => h('div', { key: k }, fmtNumberCn((max * k) / 4))));

      return h('div', { style: { display: 'flex', gap: 6 } },
        yAxis,
        h('div', { style: { flex: '1 1 0', minWidth: 0 } }, plot, xAxis));
    }

    function UsageModelTable({ models, prevModels }) {
      const list = (models || []).slice().sort((a, b) => (b.cost || 0) - (a.cost || 0));
      if (list.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');
      const prevMap = {};
      for (const model of prevModels || []) prevMap[model.model] = model;
      const cell = { padding: '3px 0', fontSize: 11.5 };
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
        h('div', { style: { display: 'flex', gap: 8, fontSize: 10.5, color: MUTED, paddingBottom: 3, borderBottom: '1px solid rgba(0,0,0,.12)' } },
          h('span', { style: { flex: '1 1 0' } }, '模型'),
          h('span', { style: { width: 86, textAlign: 'right' } }, '变化'),
          h('span', { style: { width: 92, textAlign: 'right' } }, '金额'),
          h('span', { style: { width: 76, textAlign: 'right' } }, '调用'),
          h('span', { style: { width: 92, textAlign: 'right' } }, 'Tokens')),
        list.map((model) => {
          const prev = prevMap[model.model];
          let changeText = '—';
          let changeColor = MUTED;
          if (prev && (prev.cost || 0) > 0) {
            const ratio = ((model.cost || 0) - prev.cost) / prev.cost;
            const percent = (ratio * 100).toFixed(1) + '%';
            changeText = ratio > 0 ? '+' + percent : percent;
            changeColor = ratio > 0 ? '#c0392b' : '#2e9e63';
          } else if (!prev && (model.cost || 0) > 0) {
            changeText = '新增';
            changeColor = '#c0392b';
          }
          return h('div', { key: model.model, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid rgba(0,0,0,.10)' } },
            h('span', { style: { ...cell, flex: '1 1 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, model.model),
            h('span', { style: { ...cell, width: 86, textAlign: 'right', color: changeColor } }, changeText),
            h('span', { style: { ...cell, width: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtMoneyCn(model.cost)),
            h('span', { style: { ...cell, width: 76, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtNumberCn(model.requests) + ' 次'),
            h('span', { style: { ...cell, width: 92, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, fmtNumberCn(usageTotalTokens(model.tokens))));
        }));
    }

    function UsageTokenChart({ days, hours, dayKey, singleDay, models, metric }) {
      const names = models || [];
      const valueOf = (bucket) => (metric === 'requests' ? bucket.requests || 0 : usageTotalTokens(bucket.tokens || {}));
      let series = [];
      if (singleDay) {
        const byHour = {};
        for (const entry of hours || []) {
          const time = String(entry.time || '');
          if (time.slice(0, 10) !== dayKey) continue;
          const hour = Number(time.slice(11, 13));
          if (!Number.isFinite(hour)) continue;
          const slot = byHour[hour] || (byHour[hour] = { total: 0, parts: {} });
          const entryModels = entry.models || {};
          const keys = Object.keys(entryModels);
          if (keys.length === 0) {
            slot.total += valueOf(entry);
            continue;
          }
          for (const name of keys) {
            const value = valueOf(entryModels[name]);
            slot.parts[name] = (slot.parts[name] || 0) + value;
            slot.total += value;
          }
        }
        for (let hour = 0; hour <= 23; hour += 1) {
          const slot = byHour[hour] || { total: 0, parts: {} };
          series.push({ label: String(hour).padStart(2, '0') + ':00', total: slot.total, parts: slot.parts });
        }
      } else {
        series = dailyOrMonthly(days).items.map((slot) => {
          const parts = {};
          let total = 0;
          for (const [name, cost] of Object.entries(slot.parts)) {
            const value = metric === 'requests' ? 0 : (slot.modelTokens[name] || 0);
            parts[name] = value;
            total += value;
          }
          return { label: slot.label, total, parts };
        });
      }
      if (series.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');
      const axisSlots = series.map((item, index) => {
        if (singleDay) return item.label;
        return item.label;
      });
      const max = Math.max.apply(null, series.map((item) => item.total).concat([1]));
      const height = 96;
      const axisText = (value) => (metric === 'requests' ? fmtNumberCn(value) : fmtNumberCn(value));
      const gridLines = [1, 2, 3, 4].map((step) =>
        h('div', { key: step, style: { position: 'absolute', left: 0, right: 0, bottom: step * 25 + '%', borderTop: '1px dashed rgba(0,0,0,.13)' } }));
      const bars = series.map((item, index) => {
        const stack = names
          .filter((name) => item.parts[name])
          .map((name) => h('div', {
            key: name,
            style: { height: item.total > 0 ? ((item.parts[name] || 0) / item.total) * 100 + '%' : '0%', background: modelColor(name, names) },
          }));
        const bar = h('div', { style: { width: '55%', maxWidth: 22, minWidth: 3, height: (item.total > 0 ? Math.max(1, (item.total / max) * 100) : 0) + '%', display: 'flex', flexDirection: 'column-reverse', borderRadius: '2px 2px 0 0', overflow: 'hidden' } }, stack);
        const nextHour = singleDay ? Number(item.label.slice(0, 2)) + 1 : 0;
        const tip = singleDay
          ? item.label.slice(0, 2) + ':00–' + String(nextHour).padStart(2, '0') + ':00 · ' + fmtNumberCn(item.total)
          : item.label + ' · ' + fmtNumberCn(item.total);
        return h('div', {
          key: index,
          title: tip,
          style: { flex: '1 1 0', height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', minWidth: 2 },
        }, bar);
      });
      const plot = h('div', { style: { position: 'relative', height: height, borderLeft: '1px solid rgba(0,0,0,.18)', borderBottom: '1px solid rgba(0,0,0,.18)' } },
        gridLines,
        h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 6 } }, bars));
      const xAxis = h('div', { style: { display: 'flex', fontSize: singleDay || series.length > 10 ? 8 : 9.5, color: MUTED, marginTop: 3 } },
        axisSlots.map((label, index) => h('span', { key: index, style: { flex: '1 1 0', textAlign: 'center', whiteSpace: 'nowrap' } }, label)));
      const legendItems = names.map((name) =>
        h('span', { key: name, style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
          h('i', { style: { width: 8, height: 8, borderRadius: 2, background: modelColor(name, names), display: 'inline-block' } }),
          name));
      return h('div', null,
        h('div', { style: { display: 'flex', gap: 6 } },
          h('div', { style: { width: 64, height: height, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 10, color: MUTED, textAlign: 'right' } },
            [4, 3, 2, 1, 0].map((step) => h('div', { key: step }, axisText((max * step) / 4)))),
          h('div', { style: { flex: '1 1 0', minWidth: 0 } }, plot, xAxis)),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6, fontSize: 10.5, color: MUTED } }, legendItems));
    }

    function UsageModelPicker({ models, selected, onChange }) {
      const [open, setOpen] = React.useState(false);
      const allSelected = selected === 'all';
      const count = allSelected ? models.length : selected.length;
      const isChecked = (name) => allSelected || selected.includes(name);
      const toggle = (name) => {
        if (allSelected) {
          onChange(models.filter((item) => item !== name));
          return;
        }
        const next = selected.includes(name) ? selected.filter((item) => item !== name) : selected.concat(name);
        onChange(next.length === 0 ? 'all' : next);
      };
      return h('div', { style: { position: 'relative', flex: '1 1 180px', minWidth: 150 } },
        h('button', {
          type: 'button',
          onClick: () => setOpen(!open),
          style: { width: '100%', textAlign: 'left', fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,.26)', background: 'transparent', color: 'inherit', cursor: 'pointer' },
        }, (allSelected ? '全部模型（' + models.length + '）' : '已选 ' + count + ' 个模型') + ' ▾'),
        open
          ? h('div', {
              style: {
                position: 'absolute', zIndex: 10, top: '112%', left: 0, width: 270, maxHeight: 280, overflowY: 'auto',
                background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit',
                border: '1px solid rgba(0,0,0,.21)', borderRadius: 8, boxShadow: '0 10px 26px rgba(0,0,0,.24)', padding: 8,
              },
            },
              h('div', { style: { display: 'flex', gap: 8, marginBottom: 6, fontSize: 11 } },
                h('button', { type: 'button', onClick: () => onChange('all'), style: { border: 'none', background: 'transparent', color: '#2f6fed', cursor: 'pointer', padding: 0 } }, '全选'),
                h('button', { type: 'button', onClick: () => onChange(models.slice(0, 1)), style: { border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', padding: 0 } }, '只留第一个'),
                h('button', { type: 'button', onClick: () => setOpen(false), style: { marginLeft: 'auto', border: 'none', background: 'transparent', color: MUTED, cursor: 'pointer', padding: 0 } }, '关闭')),
              models.map((name) => h('label', { key: name, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '3px 0', cursor: 'pointer' } },
                h('input', { type: 'checkbox', checked: isChecked(name), onChange: () => toggle(name), style: { margin: 0 } }),
                h('span', { style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, name))))
          : null);
    }

    const usagePanelStyles = {
      overlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 4000,
        background: 'rgba(0,0,0,.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        boxSizing: 'border-box',
      },
      panel: {
        width: 'min(900px, 90vw)',
        height: 'min(90vh, 900px)',
        background: 'var(--dsw-alias-bg-layer-1, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #111)',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.18))',
        borderRadius: 12,
        boxShadow: '0 18px 48px rgba(0,0,0,.22)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        fontFamily: 'inherit',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
      },
      tabs: { display: 'flex', gap: 18, padding: '0 16px', borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))' },
      controls: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 16px', minHeight: 50, boxSizing: 'border-box' },
      body: { flex: '1 1 auto', overflowY: 'auto', padding: '4px 16px 26px' },
      cards: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10, margin: '10px 0 14px' },
      card: {
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03))',
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        minWidth: 0,
      },
      cardLabel: { fontSize: 11, color: MUTED, display: 'flex', alignItems: 'center', gap: 4 },
      cardValue: { fontSize: 20, fontWeight: 700, marginTop: 4, lineHeight: 1.2 },
      cardHint: { fontSize: 10.5, color: MUTED, marginTop: 3 },
      section: {
        border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.14))',
        borderRadius: 10,
        padding: '10px 12px',
        marginBottom: 12,
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
      },
      sectionTitle: { fontSize: 12.5, fontWeight: 600, marginBottom: 8 },
    };

    function applyLocalSplit(data) {
      if (!data || data.mode !== 'official' || data.peakSplit !== false || !Array.isArray(data.localDays)) return data;
      const map = {};
      for (const day of data.localDays) map[day.date] = day;
      const days = (data.days || []).map((day) => {
        const local = map[day.date];
        if (!local) return day;
        return {
          ...day,
          peakCost: local.peakCost || 0,
          offPeakCost: local.offPeakCost || 0,
          models: (day.models || []).map((model) => {
            const hit = (local.models || []).find((item) => item.model === model.model);
            return hit ? { ...model, peakCost: hit.peakCost || 0, offPeakCost: hit.offPeakCost || 0 } : model;
          }),
        };
      });
      const localModels = (data.localTotals && data.localTotals.models) || [];
      const totals = {
        ...data.totals,
        peakCost: (data.localTotals && data.localTotals.peakCost) || 0,
        offPeakCost: (data.localTotals && data.localTotals.offPeakCost) || 0,
        models: (data.totals.models || []).map((model) => {
          const hit = localModels.find((item) => item.model === model.model);
          return hit ? { ...model, peakCost: hit.peakCost || 0, offPeakCost: hit.offPeakCost || 0 } : model;
        }),
      };
      return { ...data, days, totals };
    }

    function UsageStatCard({ label, value, hint }) {
      return h('div', { style: { ...usagePanelStyles.card, textAlign: 'center' } },
        h('div', { style: { ...usagePanelStyles.cardLabel, justifyContent: 'center' } }, label),
        h('div', { style: { ...usagePanelStyles.cardValue, textAlign: 'center' } }, value),
        hint ? h('div', { style: { ...usagePanelStyles.cardHint, textAlign: 'center' } }, hint) : null);
    }

    function UsageModelBars({ models }) {
      const list = (models || []).slice().sort((a, b) => (b.cost || 0) - (a.cost || 0));
      if (list.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');
      const max = Math.max(...list.map((m) => m.cost || 0), 0.0001);
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        list.map((m) => h('div', { key: m.model, style: { display: 'flex', alignItems: 'center', gap: 10 } },
          h('span', { style: { width: 150, fontSize: 11.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, m.model),
          h('div', { style: { flex: '1 1 auto', height: 10, borderRadius: 3, background: 'rgba(0,0,0,.05)', overflow: 'hidden', display: 'flex' } },
            h('div', { style: { width: ((m.peakCost || 0) / max) * 100 + '%', background: PEAK_COLOR } }),
            h('div', { style: { width: ((m.offPeakCost || 0) / max) * 100 + '%', background: OFF_COLOR } })),
          h('span', { style: { width: 92, textAlign: 'right', fontSize: 11.5, fontVariantNumeric: 'tabular-nums' } }, fmtMoneyCn(m.cost)))));
    }

    function UsageDailyChart({ days }) {
      const list = (days || []).slice(-31);
      if (list.length === 0) return h('div', { style: { fontSize: 11.5, color: MUTED } }, '暂无数据');
      const max = Math.max(...list.map((d) => d.cost || 0), 0.0001);
      return h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, paddingTop: 6 } },
        list.map((d) => {
          const total = d.cost || 0;
          const peak = d.peakCost || 0;
          const off = d.offPeakCost || 0;
          const barHeight = Math.max(2, (total / max) * 100);
          const peakShare = total > 0 ? peak / total : 0;
          return h('div', {
            key: d.date,
            title: d.date + ' · ' + fmtMoneyCn(total) + '（峰 ' + fmtMoneyCn(peak) + ' / 闲 ' + fmtMoneyCn(off) + '）',
            style: { flex: '1 1 0', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 4 },
          },
            h('div', { style: { height: barHeight + '%', display: 'flex', flexDirection: 'column-reverse', borderRadius: 2, overflow: 'hidden' } },
              h('div', { style: { height: peakShare * 100 + '%', background: PEAK_COLOR } }),
              h('div', { style: { height: (1 - peakShare) * 100 + '%', background: OFF_COLOR } })));
        }));
    }

    function shiftDateKey(key, days) {
      const parts = String(key).split('-').map(Number);
      const date = new Date(parts[0], parts[1] - 1, parts[2]);
      date.setDate(date.getDate() + days);
      return isoDate(date);
    }

    function previousWindow(win) {
      const a = win.from.split('-').map(Number);
      const b = win.to.split('-').map(Number);
      const days = Math.max(1, Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000) + 1);
      return { from: shiftDateKey(win.from, -days), to: shiftDateKey(win.from, -1) };
    }

    function fetchUsageWindow(win, mode) {
      const query = '/api/precise-billing/usage?from=' + win.from + '&to=' + win.to + '&mode=' + mode;
      return fetch(query, { cache: 'no-store' }).then((res) => res.json());
    }

    function useUsage(rangeKey, custom, mode) {
      const [state, setState] = React.useState({ status: 'loading' });
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        let alive = true;
        const win = rangeKey === 'custom' && custom ? custom : rangeOf(rangeKey);
        const prevWin = previousWindow(win);
        Promise.all([fetchUsageWindow(win, mode), fetchUsageWindow(prevWin, mode).catch(() => undefined)])
          .then(([data, prev]) => {
            if (alive) setState({ status: 'ok', data, prev, win });
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', error: String((error && error.message) || error) });
          });
        return () => {
          alive = false;
        };
      }, [rangeKey, custom && custom.from, custom && custom.to, mode, tick]);
      return [state, () => setTick((x) => x + 1)];
    }

    function fillDaysWithWindow(days, win) {
      if (!win || win.from > win.to) return days || [];
      const map = {};
      for (const day of days || []) map[day.date] = day;
      const out = [];
      const cursor = new Date(win.from + 'T00:00:00');
      const end = new Date(win.to + 'T00:00:00');
      while (cursor <= end && out.length < 366) {
        const key = isoDate(cursor);
        out.push(map[key] || {
          date: key,
          tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
          cost: 0,
          peakCost: 0,
          offPeakCost: 0,
          requests: 0,
          models: [],
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      return out;
    }

    const AUTO_REFRESH_OPTIONS = [[0, '不自动刷新'], [15, '15 秒'], [30, '30 秒'], [60, '1 分钟'], [300, '5 分钟']];

    function UsagePanel(props) {
      const open = useUsageOpen();
      const [tab, setTab] = React.useState('trend');
      const [rangeKey, setRangeKey] = React.useState('today');
      const [customFrom, setCustomFrom] = React.useState(isoDate(new Date()));
      const [customTo, setCustomTo] = React.useState(isoDate(new Date()));
      const [appliedCustom, setAppliedCustom] = React.useState(null);
      const [mode, setMode] = React.useState('official');
      const [selectedModels, setSelectedModels] = React.useState('all');
      const [chartMode, setChartMode] = React.useState('trend');
      const [metric, setMetric] = React.useState('tokens');
      const [autoSec, setAutoSec] = React.useState(0);
      const [state, reload] = useUsage(open ? rangeKey : 'today', appliedCustom, mode);

      React.useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape') setUsageOpen(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [open]);

      React.useEffect(() => {
        if (!open || !autoSec) return undefined;
        const timer = setInterval(() => reload(), autoSec * 1000);
        return () => clearInterval(timer);
      }, [open, autoSec]);

      if (!open || !ReactDOM || typeof document === 'undefined') return null;

      const raw = state.status === 'ok' ? state.data : undefined;
      const rawModels = ((raw && raw.totals && raw.totals.models) || []).map((item) => item.model);
      const filtered = filterUsageByModels(raw, selectedModels === 'all' ? null : selectedModels);
      const data = applyLocalSplit(filtered);
      const totals = (data && data.totals) || { tokens: {}, cost: 0, peakCost: 0, offPeakCost: 0, requests: 0, models: [] };
      const tokens = totals.tokens || {};
      const hit = usageHitRate(tokens);
      const modelNames = (totals.models || []).map((item) => item.model);
      const prevFiltered = state.prev ? filterUsageByModels(state.prev, selectedModels === 'all' ? null : selectedModels) : undefined;
      const prevData = applyLocalSplit(prevFiltered);
      const prevTotals = (prevData && prevData.totals) || { models: [] };
      const win = state.win || (rangeKey === 'custom' && appliedCustom ? appliedCustom : rangeOf(rangeKey));
      const chartDays = data ? fillDaysWithWindow(data.days, win) : undefined;
      const balance = (props && props.account && props.account.logged && props.account.balance) || (data && data.balance && data.balance.balance);
      const loading = state.status === 'loading';
      const errorText = state.status === 'error' ? state.error : data && data.error === 'not-logged' ? '未检测到 DeepSeek 账号，官方数据不可用' : undefined;
      const calendarModel = selectedModels === 'all' ? 'all' : selectedModels.length === 1 ? selectedModels[0] : 'all';

      const toggleStyle = (active) => ({
        padding: '4px 10px', fontSize: 11.5, border: 'none', cursor: 'pointer',
        background: active ? 'rgba(47,111,237,.12)' : 'transparent',
        color: active ? '#2f6fed' : 'inherit', fontWeight: active ? 600 : 400,
      });
      const groupStyle = { display: 'inline-flex', border: '1px solid rgba(0,0,0,.26)', borderRadius: 6, overflow: 'hidden' };

      return ReactDOM.createPortal(
        h('div', { style: usagePanelStyles.overlay, onMouseDown: (event) => { if (event.target === event.currentTarget) setUsageOpen(false); } },
          h('div', { style: usagePanelStyles.panel },
            h('div', { style: usagePanelStyles.header },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
                h('div', { style: { fontSize: 14, fontWeight: 700 } }, '用量看板'),
                h('div', { style: { fontSize: 11, color: MUTED } }, 'Tokens ' + fmtNumberCn(usageTotalTokens(tokens)) + ' · 消费 ' + fmtMoneyCn(totals.cost))),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                h('select', {
                  value: autoSec,
                  onChange: (event) => setAutoSec(Number(event.target.value)),
                  title: '自动刷新',
                  style: { fontSize: 11.5, padding: '5px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,.26)', background: 'transparent', color: 'inherit' },
                }, AUTO_REFRESH_OPTIONS.map(([value, label]) => h('option', { key: value, value }, label))),
                h('button', { type: 'button', onClick: () => reload(), style: { padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.22)', background: 'transparent', cursor: 'pointer', color: 'inherit' } }, '刷新'),
                h('button', { type: 'button', onClick: () => setUsageOpen(false), style: { padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(0,0,0,.22)', background: 'transparent', cursor: 'pointer', color: 'inherit' } }, '关闭'))),
            h('div', { style: usagePanelStyles.tabs },
              ['trend', 'calendar'].map((key) => h('button', {
                key,
                type: 'button',
                onClick: () => setTab(key),
                style: {
                  padding: '10px 2px', fontSize: 12.5, border: 'none', background: 'transparent', cursor: 'pointer',
                  color: tab === key ? 'var(--dsw-alias-label-primary, #111)' : MUTED,
                  borderBottom: tab === key ? '2px solid #2f6fed' : '2px solid transparent',
                  fontWeight: tab === key ? 700 : 400,
                },
              }, key === 'trend' ? '用量趋势' : '用量日历'))),
            h('div', { style: usagePanelStyles.controls },
              h('select', {
                value: rangeKey,
                onChange: (event) => setRangeKey(event.target.value),
                title: tab === 'calendar' ? '趋势页的时间范围（日历页用下方年月导航）' : '时间范围',
                style: { flex: '1 1 170px', fontSize: 12, padding: '5px 8px', borderRadius: 6, border: '1px solid rgba(0,0,0,.26)', background: 'transparent', color: 'inherit', minWidth: 132, opacity: tab === 'calendar' ? 0.55 : 1 },
              }, USAGE_RANGES.concat([{ value: 'custom', label: '自定义' }]).map((item) => h('option', { key: item.value, value: item.value }, item.label))),
              tab === 'trend' && rangeKey === 'custom'
                ? h('div', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5 } },
                    h('input', { type: 'date', value: customFrom, onChange: (event) => setCustomFrom(event.target.value), style: { fontSize: 11.5, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,.26)', background: 'transparent', color: 'inherit' } }),
                    h('span', null, '~'),
                    h('input', { type: 'date', value: customTo, onChange: (event) => setCustomTo(event.target.value), style: { fontSize: 11.5, padding: '4px 6px', borderRadius: 6, border: '1px solid rgba(0,0,0,.26)', background: 'transparent', color: 'inherit' } }),
                    h('button', {
                      type: 'button',
                      onClick: () => setAppliedCustom({ from: customFrom, to: customTo < customFrom ? customFrom : customTo }),
                      style: { fontSize: 11.5, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(47,111,237,.45)', color: '#2f6fed', background: 'transparent', cursor: 'pointer' },
                    }, '应用'))
                : null,
              h('div', { style: groupStyle },
                ['official', 'local'].map((key) => h('button', {
                  key,
                  type: 'button',
                  onClick: () => setMode(key),
                  style: toggleStyle(mode === key),
                }, key === 'official' ? '官方' : '本地'))),
              h(UsageModelPicker, { models: rawModels, selected: selectedModels, onChange: setSelectedModels }),
              loading ? h('span', { style: { fontSize: 11, color: MUTED } }, '加载中…') : null,
              errorText ? h('span', { style: { fontSize: 11, color: '#c0392b' } }, errorText) : null),
            h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, color: MUTED, padding: '0 16px 4px' } },
              h('span', null, mode === 'official' ? '官方账单合计 ' : '本地用量合计 ', h('b', { style: { color: 'var(--dsw-alias-label-primary, #111)' } }, fmtMoneyCn(totals.cost))),
              mode === 'official' && data && data.peakSplit === false ? h('span', null, '峰/闲取自本地日志') : null,
              mode === 'official' ? h('span', null, '含该账号所有客户端') : h('span', null, '仅本机 DSH 会话')),
            h('div', { style: tab === 'calendar' ? { ...usagePanelStyles.body, overflow: 'hidden', display: 'flex', flexDirection: 'column' } : usagePanelStyles.body },
              h('div', { style: usagePanelStyles.cards },
                h(UsageStatCard, { label: 'Tokens', value: fmtNumberCn(usageTotalTokens(tokens)), hint: '命中率 ' + (hit * 100).toFixed(2) + '%' }),
                h(UsageStatCard, { label: 'API 请求次数', value: fmtNumberCn(totals.requests) + ' 次', hint: mode === 'official' ? '官方请求统计' : '本地会话统计' }),
                h(UsageStatCard, { label: '消费金额', value: fmtMoneyCn(totals.cost), hint: h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%' } }, h('span', { style: { color: PEAK_COLOR } }, '峰时 ' + '¥' + Number(totals.peakCost || 0).toFixed(2)), h('span', { style: { color: OFF_COLOR } }, '闲时 ' + '¥' + Number(totals.offPeakCost || 0).toFixed(2))) }),
                h(UsageStatCard, { label: '余额', value: balance === undefined ? '—' : fmtMoneyCn(balance), hint: '官方账户余额' })),
              tab === 'trend'
                ? h('div', null,
                    h('div', { style: usagePanelStyles.section },
                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 } },
                        h('div', { style: usagePanelStyles.sectionTitle }, '各模型消费金额'),
                        h('div', { style: groupStyle },
                          h('button', { type: 'button', onClick: () => setChartMode('trend'), style: toggleStyle(chartMode === 'trend') }, '趋势'),
                          h('button', { type: 'button', onClick: () => setChartMode('total'), style: toggleStyle(chartMode === 'total') }, '综合'))),
                      chartMode === 'trend'
                        ? h(UsageCostChart, {
                            days: chartDays,
                            hours: data && data.hours,
                            dayKey: win.from,
                            singleDay: win.from === win.to,
                            models: modelNames,
                          })
                        : h(UsageModelBars, { models: totals.models })),
                    h('div', { style: usagePanelStyles.section },
                      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 } },
                        h('div', { style: usagePanelStyles.sectionTitle }, '各模型 Token 用量', h('span', { style: { marginLeft: 10, fontSize: 10.5, fontWeight: 400, color: MUTED } }, fmtNumberCn(usageTotalTokens(tokens)) + ' Tokens')),
                        h('div', { style: groupStyle },
                          h('button', { type: 'button', onClick: () => setMetric('tokens'), style: toggleStyle(metric === 'tokens') }, 'Token 数'),
                          h('button', { type: 'button', onClick: () => setMetric('requests'), style: toggleStyle(metric === 'requests') }, '请求数'))),
                      h(UsageTokenChart, { days: chartDays, hours: data && data.hours, dayKey: win.from, singleDay: win.from === win.to, models: modelNames, metric })),
                    h('div', { style: usagePanelStyles.section },
                      h('div', { style: usagePanelStyles.sectionTitle }, 'API 请求次数', h('span', { style: { marginLeft: 10, fontSize: 10.5, fontWeight: 400, color: MUTED } }, fmtNumberCn(totals.requests) + ' 次')),
                      h(UsageRequestsChart, { days: chartDays, hours: data && data.hours, dayKey: win.from, singleDay: win.from === win.to })),
                    h('div', { style: usagePanelStyles.section },
                      h('div', { style: usagePanelStyles.sectionTitle }, '各模型明细（对比上一周期）'),
                      h(UsageModelTable, { models: totals.models, prevModels: prevTotals.models })))
                : h('div', { style: { ...usagePanelStyles.section, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 } },
                    h('div', { style: usagePanelStyles.sectionTitle }, '用量日历'),
                    h(UsageCalendar, { mode, model: calendarModel }))))), document.body);
    }

    function useUsageWindow(from, to, mode, model, enabled) {
      const [state, setState] = React.useState({ status: 'loading' });
      const [tick, setTick] = React.useState(0);
      React.useEffect(() => {
        if (!enabled) return undefined;
        let alive = true;
        let query = '/api/precise-billing/usage?from=' + from + '&to=' + to + '&mode=' + mode;
        if (model && model !== 'all') query += '&model=' + encodeURIComponent(model);
        fetch(query, { cache: 'no-store' })
          .then((res) => res.json())
          .then((payload) => {
            if (alive) setState({ status: 'ok', data: payload });
          })
          .catch((error) => {
            if (alive) setState({ status: 'error', error: String((error && error.message) || error) });
          });
        return () => {
          alive = false;
        };
      }, [from, to, mode, model, tick, enabled]);
      return [state, () => setTick((x) => x + 1)];
    }

    function startOfWeek(date) {
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const offset = (day.getDay() + 6) % 7;
      day.setDate(day.getDate() - offset);
      return day;
    }

    function weekNumber(date) {
      const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
      const firstThursday = new Date(target.getFullYear(), 0, 4);
      firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
      return 1 + Math.round((target - firstThursday) / (7 * 86400000));
    }

    function mdShort(dateKey) {
      const parts = String(dateKey).split('-');
      return parts.length === 3 ? parts[1] + '/' + parts[2] : String(dateKey);
    }

    function emptyCell(key, label, sub) {
      return { key, label, sub, tokens: 0, tokens4: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, cost: 0, peakCost: 0, offPeakCost: 0, requests: 0, models: [], dates: [] };
    }

    function addCellUsage(cell, day, useLocalSplit) {
      const peak = useLocalSplit ? day.localPeakCost ?? 0 : day.peakCost ?? 0;
      const off = useLocalSplit ? day.localOffPeakCost ?? 0 : day.offPeakCost ?? 0;
      const total = Number.isFinite(day.cost) && day.cost > 0 ? day.cost : peak + off;
      cell.tokens += usageTotalTokens(day.tokens || {});
      const t4 = day.tokens || {};
      cell.tokens4.input += t4.input || 0;
      cell.tokens4.cacheRead += t4.cacheRead || 0;
      cell.tokens4.cacheWrite += t4.cacheWrite || 0;
      cell.tokens4.output += t4.output || 0;
      cell.cost += total;
      cell.peakCost += peak;
      cell.offPeakCost += off;
      cell.requests += day.requests || 0;
      for (const model of day.models || []) {
        const hit = cell.models.find((item) => item.model === model.model);
        if (hit) {
          hit.cost += model.cost || 0;
          hit.tokens += usageTotalTokens(model.tokens || {});
        } else {
          cell.models.push({ model: model.model, cost: model.cost || 0, requests: 0, tokens: usageTotalTokens(model.tokens || {}) });
        }
        const entry = hit || cell.models[cell.models.length - 1];
        if (entry) entry.requests += model.requests || 0;
      }
      cell.dates.push(day.date);
    }

    function buildCalendar(days, localMap, dim, anchor, todayKey, officialNeedsLocal) {
      const byDate = {};
      for (const day of days || []) byDate[day.date] = day;
      const cells = [];
      if (dim === 'day') {
        const first = new Date(anchor.year, anchor.month - 1, 1);
        const lead = (first.getDay() + 6) % 7;
        const count = new Date(anchor.year, anchor.month, 0).getDate();
        for (let i = lead - 1; i >= 0; i -= 1) {
          const date = new Date(anchor.year, anchor.month - 1, -i);
          const outside = emptyCell(isoDate(date), String(date.getDate()), '');
          outside.outside = true;
          cells.push(outside);
        }
        for (let d = 1; d <= count; d += 1) {
          const key = anchor.year + '-' + String(anchor.month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const cell = emptyCell(key, String(d), key === todayKey ? '今天' : '');
          const day = byDate[key];
          if (day) {
            const local = localMap[key];
            const merged = { ...day };
            if (officialNeedsLocal && local) {
              merged.localPeakCost = local.peakCost;
              merged.localOffPeakCost = local.offPeakCost;
            }
            addCellUsage(cell, merged, officialNeedsLocal);
          }
          cells.push(cell);
        }
        let trailing = 1;
        while (cells.length % 7 !== 0) {
          const date = new Date(anchor.year, anchor.month - 1, count + trailing);
          const outside = emptyCell(isoDate(date), String(date.getDate()), '');
          outside.outside = true;
          cells.push(outside);
          trailing += 1;
        }
        return { cells, title: anchor.year + ' 年 ' + anchor.month + ' 月' };
      }
      if (dim === 'week') {
        const year = anchor.year;
        const byDate = {};
        for (const day of days || []) byDate[day.date] = day;
        const rows = [];
        for (let month = 1; month <= 12; month += 1) {
          const monthKey = String(month).padStart(2, '0');
          const count = new Date(year, month, 0).getDate();
          const chunks = [];
          let chunkStart = 1;
          for (let d = 2; d <= count; d += 1) {
            if (new Date(year, month - 1, d).getDay() === 1) {
              chunks.push([chunkStart, d - 1]);
              chunkStart = d;
            }
          }
          chunks.push([chunkStart, count]);
          const cells = chunks.map(([fromDay, toDay], index) => {
            const cell = emptyCell(year + '-' + monthKey + '-w' + (index + 1), '第' + (index + 1) + '周', month + '/' + fromDay + ' ~ ' + month + '/' + toDay);
            let touched = false;
            for (let d = fromDay; d <= toDay; d += 1) {
              const dateKey = year + '-' + monthKey + '-' + String(d).padStart(2, '0');
              if (dateKey === todayKey) cell.isToday = true;
              const day = byDate[dateKey];
              if (!day) continue;
              touched = true;
              const local = localMap[dateKey];
              addCellUsage(cell, { ...day, localPeakCost: local?.peakCost, localOffPeakCost: local?.offPeakCost }, true);
            }
            cell.empty = !touched;
            return cell;
          });
          rows.push({ label: month + ' 月', cells });
        }
        return {
          matrix: true,
          rows,
          columns: Math.max(...rows.map((row) => row.cells.length)),
          title: year + ' 年',
        };
      }
      if (dim === 'year') {
        const byDate = {};
        for (const day of days || []) byDate[day.date] = day;
        const years = new Set();
        for (const day of days || []) years.add(Number(day.date.slice(0, 4)));
        years.add(anchor.year);
        const rows = [...years].filter((year) => Number.isFinite(year)).sort((a, b) => a - b).map((year) => {
          const cells = [];
          for (let month = 1; month <= 12; month += 1) {
            const cell = emptyCell(year + '-' + String(month).padStart(2, '0'), month + ' 月', '');
            for (let d = 1; d <= new Date(year, month, 0).getDate(); d += 1) {
              const dateKey = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
              const day = byDate[dateKey];
              if (!day) continue;
              const local = localMap[dateKey];
              addCellUsage(cell, { ...day, localPeakCost: local?.peakCost, localOffPeakCost: local?.offPeakCost }, true);
            }
            cells.push(cell);
          }
          return { label: year + ' 年', cells };
        });
        return {
          matrix: true,
          rows,
          columns: 12,
          headers: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
          title: anchor.year + ' 年',
        };
      }
      const map = {};
      for (let m = 1; m <= 12; m += 1) {
        const key = anchor.year + '-' + String(m).padStart(2, '0');
        map[key] = emptyCell(key, m + ' 月', '');
      }
      for (const day of days || []) {
        const key = day.date.slice(0, 7);
        if (!map[key]) continue;
        const local = localMap[day.date];
        addCellUsage(map[key], { ...day, localPeakCost: local?.peakCost, localOffPeakCost: local?.offPeakCost }, true);
      }
      return { cells: Object.values(map), title: anchor.year + ' 年' };
    }

    function UsageCalendar({ mode, model }) {
      const today = new Date();
      const todayKey = isoDate(today);
      const [dim, setDim] = React.useState('day');
      const [anchor, setAnchor] = React.useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
      const [detail, setDetail] = React.useState(null);
      const [hoverKey, setHoverKey] = React.useState(null);
      const [expandedYears, setExpandedYears] = React.useState({});
      const weekRef = React.useRef(null);

      let from;
      let to;
      if (dim === 'day') {
        from = isoDate(new Date(anchor.year, anchor.month - 1, 1));
        to = isoDate(new Date(anchor.year, anchor.month, 0));
      } else if (dim === 'year') {
        from = anchor.year - 1 + '-01-01';
        to = anchor.year + '-12-31';
      } else {
        from = anchor.year + '-01-01';
        to = anchor.year + '-12-31';
      }

      const [state] = useUsageWindow(from, to, mode, model, true);
      const data = state.status === 'ok' ? state.data : undefined;
      const days = (data && data.days) || [];
      const localMap = {};
      for (const day of (data && data.localDays) || []) localMap[day.date] = day;
      if (mode === 'local') for (const day of days) localMap[day.date] = day;
      const officialNeedsLocal = mode === 'official' && data && data.peakSplit === false;
      const calendar = buildCalendar(days, localMap, dim, anchor, todayKey, officialNeedsLocal);

      React.useEffect(() => {
        if (dim !== 'week') return;
        const node = weekRef.current;
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, [dim, anchor.year, anchor.month, state.status]);

      const allCells = (calendar.matrix ? calendar.rows.flatMap((row) => row.cells) : calendar.cells).filter((cell) => cell && !cell.outside);
      const maxTokens = Math.max.apply(null, allCells.map((cell) => cell.tokens).concat([1]));
      const calTotals = allCells.reduce((acc, cell) => ({
        tokens: acc.tokens + cell.tokens,
        cost: acc.cost + cell.cost,
        peakCost: acc.peakCost + cell.peakCost,
        offPeakCost: acc.offPeakCost + cell.offPeakCost,
      }), { tokens: 0, cost: 0, peakCost: 0, offPeakCost: 0 });

      const shift = (delta) => {
        if (dim === 'day') {
          const month = anchor.month + delta;
          const year = anchor.year + Math.floor((month - 1) / 12);
          setAnchor({ year, month: ((month - 1 + 12) % 12) + 1 });
        } else {
          setAnchor({ year: anchor.year + delta, month: anchor.month });
        }
        setDetail(null);
      };

      const levelOf = (value) => {
        if (!value) return 0;
        const q = value / maxTokens;
        return q > 0.72 ? 4 : q > 0.45 ? 3 : q > 0.18 ? 2 : 1;
      };
      const money2 = (value) => '¥' + Number(value || 0).toFixed(2);
      const mutedText = { color: MUTED };
      const splitChip = (label, value, color, size) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: size, color: MUTED, whiteSpace: 'nowrap' } },
        h('i', { style: { width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' } }),
        label + ' ' + money2(value));

      const splitRow = (label, value, color, size) => h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0 },
      },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: size, color: color, whiteSpace: 'nowrap', fontWeight: 400 } },
          h('i', { style: { width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flex: '0 0 auto' } }),
          label),
        h('span', { style: { fontSize: size, color: color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 400 } }, money2(value)));

      const cellCard = (cell, variant) => {
        const isToday = cell.isToday === true || cell.key === todayKey;
        const empty = !cell.tokens && !cell.cost && !cell.requests;
        const big = variant === 'month';
        const mini = variant === 'year';
        const level = levelOf(cell.tokens);
        const heat = isToday ? 'rgba(47,111,237,.10)' : 'transparent';
        const title = (cell.label || cell.sub ? (cell.label + ' ' + (cell.sub || '')).trim() + '\n' : '') +
          'Tokens ' + fmtNumberCn(cell.tokens) + ' · 请求 ' + fmtNumberCn(cell.requests) + ' 次\n' +
          '总额 ' + money2(cell.cost) + '（峰时 ' + money2(cell.peakCost) + ' / 闲时 ' + money2(cell.offPeakCost) + '）';
        return h('div', {
          key: cell.key,
          ref: isToday ? weekRef : undefined,
          title,
          onMouseEnter: () => setHoverKey(cell.key),
          onMouseLeave: () => setHoverKey(null),
          onClick: (event) => setDetail({ cell, x: event.clientX, y: event.clientY }),
          style: {
            minWidth: 0,
            height: big ? 132 : mini ? 108 : 120,
            boxSizing: 'border-box',
            padding: big ? '11px 13px' : mini ? '8px 9px' : '8px 10px',
            borderRadius: 10,
            border: '1px solid rgba(0,0,0,.14)',
            background: heat,
            boxShadow: hoverKey === cell.key ? '0 6px 16px rgba(0,0,0,.10)' : 'none',
            transform: hoverKey === cell.key ? 'translateY(-1px)' : 'none',
            transition: 'box-shadow .14s ease, transform .14s ease, border-color .14s ease',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            gap: big ? 5 : 3,
          },
        },
          (cell.label || cell.sub)
            ? h('div', {
                style: {
                  position: 'relative', display: 'flex', flexDirection: dim === 'week' ? 'column' : 'row',
                  alignItems: 'baseline', justifyContent: 'center', gap: dim === 'week' ? 1 : 4, minWidth: 0, textAlign: 'center',
                },
              },
                h('span', { style: { fontSize: big ? 17 : mini ? 13 : 16, fontWeight: big ? 700 : 600, color: 'var(--dsw-alias-label-primary, #111)', whiteSpace: 'nowrap', textAlign: 'center' } }, cell.label),
                isToday
                  ? h('span', {
                      style: {
                        position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', gap: 4,
                        fontSize: 10.5, color: '#c0392b', whiteSpace: 'nowrap', fontWeight: 700,
                      },
                    },
                      h('i', { className: 'pb-today-badge', style: { width: 6, height: 6, borderRadius: '50%', background: '#e74c3c', display: 'inline-block' } }),
                      dim === 'day' ? '今天' : dim === 'week' ? '本周' : dim === 'month' ? '本月' : '今年')
                  : (cell.sub
                      ? h('span', { style: { fontSize: mini ? 8.5 : 9.5, color: MUTED, whiteSpace: 'nowrap', textAlign: 'center' } }, cell.sub)
                      : null))
            : null,
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 } },
            h('span', { style: { fontSize: big ? 11 : mini ? 9.5 : 11, color: MUTED, whiteSpace: 'nowrap', flex: '0 0 auto', fontWeight: 700 } }, 'Token'),
            h('span', { style: { fontSize: big ? 12 : mini ? 9.5 : 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: empty ? MUTED : 'var(--dsw-alias-label-primary, #111)', lineHeight: 1.2, marginLeft: 'auto', whiteSpace: 'nowrap' } },
              empty ? '—' : fmtNumberCn(cell.tokens))),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, minWidth: 0 } },
            h('span', { style: { fontSize: big ? 11 : mini ? 9.5 : 11, color: MUTED, whiteSpace: 'nowrap', flex: '0 0 auto', fontWeight: 700 } }, '消费'),
            h('span', { style: { fontSize: big ? 12 : mini ? 9.5 : 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: empty ? MUTED : 'var(--dsw-alias-label-primary, #111)', marginLeft: 'auto', whiteSpace: 'nowrap' } },
              empty ? '—' : money2(cell.cost))),
          empty ? null : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 'auto' } },
            splitRow('峰时', cell.peakCost, PEAK_COLOR, big ? 10.5 : mini ? 9.5 : 10),
            splitRow('闲时', cell.offPeakCost, OFF_COLOR, big ? 10.5 : mini ? 9.5 : 10)));
      };

      const emptyTile = (key, height) => h('div', { key, style: { height, boxSizing: 'border-box', borderRadius: 10, background: 'transparent', border: '1px dashed rgba(0,0,0,.16)' } });

      const dimPills = h('div', { style: { display: 'inline-flex', padding: 2, borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.04))' } },
        [['day', '按日'], ['week', '按周'], ['month', '按月'], ['year', '按年']].map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          onClick: () => { setDim(value); setDetail(null); },
          style: {
            padding: '4px 11px', fontSize: 11.5, border: 'none', borderRadius: 6, cursor: 'pointer',
            background: dim === value ? 'var(--dsw-alias-bg-layer-1, #fff)' : 'transparent',
            color: dim === value ? '#2f6fed' : 'inherit',
            fontWeight: dim === value ? 600 : 400,
            boxShadow: dim === value ? '0 1px 3px rgba(0,0,0,.10)' : 'none',
          },
        }, label)));

      const navButton = (label, onClick, title) => h('button', {
        type: 'button', onClick, title,
        style: { width: 28, height: 28, borderRadius: 8, border: '1px solid rgba(0,0,0,.14)', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 13, lineHeight: 1 },
      }, label);

      const totalStrip = h('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
          padding: '8px 12px', borderRadius: 10, marginBottom: 10,
          background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.03))', fontSize: 11.5, color: MUTED,
        },
      },
        h('span', { style: { fontWeight: 600, color: 'var(--dsw-alias-label-primary, #111)' } }, '本期合计'),
        h('span', null, h('b', { style: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary, #111)' } }, fmtNumberCn(calTotals.tokens)), ' Tokens'),
        h('span', null, h('b', { style: { fontSize: 13.5, color: 'var(--dsw-alias-label-primary, #111)' } }, money2(calTotals.cost))),
        splitChip('峰时', calTotals.peakCost, PEAK_COLOR, 11),
        splitChip('闲时', calTotals.offPeakCost, OFF_COLOR, 11));

      const weekday = ['一', '二', '三', '四', '五', '六', '日'];
      let gridBody = null;
      if (calendar.matrix && dim === 'year') {
        gridBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          calendar.rows.map((row, rowIndex) => {
            const months = row.cells;
            const sum = months.reduce((acc, cell) => ({
              tokens: acc.tokens + cell.tokens,
              cost: acc.cost + cell.cost,
              peak: acc.peak + cell.peakCost,
              off: acc.off + cell.offPeakCost,
            }), { tokens: 0, cost: 0, peak: 0, off: 0 });
            const maxCost = Math.max.apply(null, months.map((cell) => cell.cost).concat([0.0001]));
            const expanded = expandedYears[row.label] === true;
            const metricRow = (label, value, color) => h('div', {
              style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, fontSize: 11.5 },
            },
              h('span', { style: { color: color || MUTED } }, label),
              h('span', { style: { fontWeight: 700, color: color || 'var(--dsw-alias-label-primary, #111)', fontVariantNumeric: 'tabular-nums' } }, value));
            const bars = h('div', {
              style: { display: 'flex', alignItems: 'flex-end', gap: 4, height: 96, flex: '1 1 auto', minWidth: 0 },
            },
              months.map((cell) => {
                const percent = cell.cost > 0 ? Math.max(3, (cell.cost / maxCost) * 100) : 2;
                return h('div', {
                  key: cell.key,
                  title: cell.label + ' ' + money2(cell.cost),
                  style: { flex: '1 1 0', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 3, minWidth: 0 },
                },
                  h('div', {
                    style: {
                      width: '62%', maxWidth: 16, height: percent + '%',
                      background: cell.cost > 0 ? 'rgba(47,111,237,.62)' : 'rgba(0,0,0,.06)',
                      borderRadius: '3px 3px 0 0',
                    },
                  }),
                  h('span', { style: { fontSize: 9, color: MUTED, whiteSpace: 'nowrap' } }, Number(cell.key.slice(5)) + '月'));
              }));
            return h('div', {
              key: 'year-' + row.label,
              style: {
                border: '1px solid rgba(0,0,0,.13)',
                borderRadius: 12,
                padding: '12px 14px',
                background: 'transparent',
              },
            },
              h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' } },
                h('div', { style: { width: 190, flex: '0 0 190px', display: 'flex', flexDirection: 'column', gap: 4 } },
                  h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 } },
                    h('span', { style: { fontSize: 15, fontWeight: 700 } }, row.label),
                    h('button', {
                      type: 'button',
                      title: expanded ? '收起月份' : '展开月份',
                      onClick: () => setExpandedYears({ ...expandedYears, [row.label]: !expanded }),
                      style: {
                        width: 24, height: 24, borderRadius: 8, border: '1px solid rgba(0,0,0,.18)',
                        background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 14, lineHeight: 1,
                      },
                    }, expanded ? '−' : '+')),
                  metricRow('Token', fmtNumberCn(sum.tokens)),
                  metricRow('消费', money2(sum.cost)),
                  metricRow('峰时', money2(sum.peak), PEAK_COLOR),
                  metricRow('闲时', money2(sum.off), OFF_COLOR)),
                bars),
              expanded
                ? h('div', {
                    style: {
                      display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 8,
                      marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,.11)',
                    },
                  },
                    months.map((cell) => cellCard(cell, 'year')))
                : null);
          }));
      } else if (calendar.matrix) {
        gridBody = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { display: 'flex', gap: 6, padding: '0 8px 2px' } },
            h('div', { style: { width: 52, flex: '0 0 52px' } }),
            Array.from({ length: calendar.columns }, (_, index) => h('div', {
              key: 'head-' + index,
              style: { flex: '1 1 0', fontSize: 13, color: 'var(--dsw-alias-label-primary, #111)', textAlign: 'center', fontWeight: 700 },
            }, (calendar.headers && calendar.headers[index]) || ('第' + (index + 1) + '周')))),
          calendar.rows.map((row, rowIndex) => h('div', {
            key: 'row-' + row.label,
            style: {
              display: 'flex', gap: 6, padding: '5px 8px', alignItems: 'stretch',
              borderRadius: 8,
              background: 'transparent',
            },
          },
            h('div', { style: { width: 52, flex: '0 0 52px', fontSize: 13, color: 'var(--dsw-alias-label-primary, #111)', display: 'flex', alignItems: 'center', fontWeight: 700 } }, row.label),
            Array.from({ length: calendar.columns }, (_, index) => {
              const cell = row.cells[index];
              return h('div', { key: 'cell-' + row.label + '-' + index, style: { flex: '1 1 0', minWidth: 0 } },
                cell ? cellCard(cell, dim === 'year' ? 'year' : 'week') : emptyTile('e-' + row.label + '-' + index, dim === 'year' ? 108 : 120));
            }))));
      } else if (dim === 'day') {
        const outsideTile = (cell) => h('div', {
          key: cell.key,
          style: {
            height: 120, boxSizing: 'border-box', borderRadius: 10,
            border: '1px solid rgba(0,0,0,.11)', background: 'transparent',
            padding: '8px 10px', color: 'rgba(0,0,0,.38)', fontSize: 12, fontWeight: 600,
            userSelect: 'none', display: 'flex', flexDirection: 'column', gap: 3,
          },
        }, cell.label);
        gridBody = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 } },
          weekday.map((name) => h('div', { key: 'w-' + name, style: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary, #111)', textAlign: 'center', paddingBottom: 3, fontWeight: 700 } }, name)),
          calendar.cells.map((cell, index) => {
            if (!cell) return h('div', { key: 'blank-' + index, style: { height: 120, boxSizing: 'border-box' } });
            if (cell.outside) return outsideTile(cell);
            return cellCard(cell, 'day');
          }));
      } else {
        gridBody = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 } },
          calendar.cells.map((cell, index) => (cell ? cellCard(cell, 'month') : emptyTile('blank-' + index, 132))));
      }

      const headerRow = h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 } },
        dimPills,
        h('div', { style: { flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minWidth: 220 } },
          navButton('‹', () => shift(-1), '上一期'),
          h('span', { style: { fontSize: 20, fontWeight: 800, letterSpacing: 0.2, textAlign: 'center', minWidth: 150 } }, calendar.title),
          navButton('›', () => shift(1), '下一期')),
        h('button', {
          type: 'button',
          onClick: () => { setAnchor({ year: today.getFullYear(), month: today.getMonth() + 1 }); setDetail(null); },
          style: { padding: '5px 12px', fontSize: 11.5, borderRadius: 8, border: '1px solid rgba(0,0,0,.16)', background: 'transparent', cursor: 'pointer', color: 'inherit' },
        }, dim === 'day' ? '今天' : dim === 'week' ? '本周' : dim === 'month' ? '本月' : '今年'),
        officialNeedsLocal ? h('span', { style: { fontSize: 10, color: MUTED } }, '峰/闲取自本地日志') : null,
        state.status === 'loading' ? h('span', { style: { fontSize: 10.5, color: MUTED } }, '加载中…') : null);

      const head = h('div', { style: { padding: '2px 2px 8px', borderBottom: '1px solid rgba(0,0,0,.11)', flex: '0 0 auto' } }, headerRow, totalStrip);

      React.useEffect(() => {
        if (!detail) return undefined;
        const onDown = (event) => {
          const node = event.target;
          if (node && typeof node.closest === 'function' && node.closest('.pb-cal-pop')) return;
          setDetail(null);
        };
        document.addEventListener('mousedown', onDown, true);
        return () => document.removeEventListener('mousedown', onDown, true);
      }, [detail]);

      const pop = detail ? (() => {
        const cell = detail.cell;
        const popWidth = 320;
        const left = Math.min(Math.max(8, detail.x + 14), Math.max(8, (window.innerWidth || 1200) - popWidth - 12));
        const top = Math.min(Math.max(8, detail.y + 14), Math.max(8, (window.innerHeight || 800) - 480));
        const metric = (label, value, color) => h('div', null,
          h('div', { style: { fontSize: 10, color: MUTED } }, label),
          h('div', { style: { fontSize: 15, fontWeight: 700, color: color || 'var(--dsw-alias-label-primary, #111)', fontVariantNumeric: 'tabular-nums' } }, value));
        const models = (cell.models || []).slice().sort((a, b) => b.cost - a.cost).map((item) => {
          const share = cell.cost > 0 ? (item.cost || 0) / cell.cost : 0;
          return h('div', { key: item.model, style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 } },
            h('span', { style: { width: 120, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, item.model),
            h('div', { style: { flex: '1 1 0', height: 5, borderRadius: 3, background: 'rgba(0,0,0,.06)', overflow: 'hidden' } },
              h('div', { style: { width: share * 100 + '%', height: '100%', background: '#2f6fed' } })),
            h('span', { style: { width: 110, textAlign: 'right', fontSize: 10.5, color: MUTED, fontVariantNumeric: 'tabular-nums' } },
              fmtNumberCn(item.tokens) + ' · ' + money2(item.cost)));
        });
        const t4 = cell.tokens4 || { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
        const full = (value) => Number(value || 0).toLocaleString('en-US');
        const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(cell.key || ''));
        const title = dateMatch ? Number(dateMatch[2]) + '月' + Number(dateMatch[3]) + '日' : (cell.label || cell.key);
        const row = (label, value, color) => h('div', {
          style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid rgba(0,0,0,.11)' },
        },
          h('span', { style: { fontSize: 11.5, color: MUTED } }, label),
          h('span', { style: { fontSize: 12, fontWeight: 600, color: color || 'var(--dsw-alias-label-primary, #111)', fontVariantNumeric: 'tabular-nums' } }, value));
        const modelLine = (item) => h('div', {
          key: item.model,
          style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, color: MUTED, paddingTop: 5 },
        },
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.model),
          h('span', { style: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } }, money2(item.cost) + ' · ' + fmtNumberCn(item.requests) + ' 次'));
        const node = h('div', {
          className: 'pb-cal-pop',
          onMouseLeave: () => setDetail(null),
          style: {
            position: 'fixed', left, top, width: popWidth, zIndex: 5000,
            background: 'var(--dsw-alias-bg-layer-1, #fff)',
            color: 'var(--dsw-alias-label-primary, #111)',
            border: '1px solid rgba(0,0,0,.18)', borderRadius: 12,
            boxShadow: '0 18px 44px rgba(0,0,0,.24)', padding: '12px 16px 10px',
            fontSize: 12,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, paddingBottom: 8 } },
            h('div', null,
              h('div', { style: { fontSize: 10, letterSpacing: 0.6, color: MUTED } }, '日期详情'),
              h('div', { style: { fontSize: 18, fontWeight: 700, marginTop: 2 } }, title)),
            h('button', { type: 'button', onClick: () => setDetail(null), style: { border: 'none', background: 'transparent', cursor: 'pointer', color: MUTED, fontSize: 15, lineHeight: 1, padding: 2 } }, '×')),
          row('消费金额', money2(cell.cost)),
          row('峰时费用', money2(cell.peakCost), PEAK_COLOR),
          row('闲时费用', money2(cell.offPeakCost), OFF_COLOR),
          row('API 请求次数', fmtNumberCn(cell.requests) + ' 次'),
          row('输入（命中缓存）', full(t4.cacheRead)),
          row('输入（未命中缓存）', full(t4.input)),
          row('缓存写入', full(t4.cacheWrite)),
          row('输出', full(t4.output)),
          row('Token 合计', full(cell.tokens)),
          cell.models.length > 0
            ? h('div', { style: { marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,.11)' } },
                cell.models.slice().sort((a, b) => b.cost - a.cost).map(modelLine))
            : null);
        return ReactDOM && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined'
          ? ReactDOM.createPortal(node, document.body)
          : node;
      })() : null;

      return h('div', { style: { display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' } },
        head,
        h('div', { style: { flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden', marginTop: 8 } },
          h('div', { style: { background: 'transparent', borderRadius: 12, padding: 10 } }, gridBody)),
        pop);
    }

    function UsageHost(props) {
      return h(PageBoundary, null, h(UsagePanel, { account: props && props.account }));
    }

    function withSlot(name) {
      return function Wrapped(props) {
        return h(Chip, { ...(props || {}), __slot: name });
      };
    }

    /** -------------------------------------------------------- 峰谷区块 -- */
    const STYLE_ID = 'precise-billing-style';

    function ensureStyles() {
      if (typeof document === 'undefined') return;
      let style = document.getElementById(STYLE_ID);
      if (!style) {
        style = document.createElement('style');
        style.id = STYLE_ID;
        document.head.appendChild(style);
      }
      style.textContent = [
        '.pb-bill-seg{container-type:inline-size}',
        '.pb-bill-bar-label{color:#fff !important;-webkit-text-fill-color:#fff !important;',
        'text-shadow:none !important;font-weight:600;line-height:1;display:inline-flex;align-items:center;height:100%;',
        'font-size:clamp(9px,10cqw,12px);font-variant-numeric:tabular-nums;white-space:nowrap;-webkit-font-smoothing:antialiased}',

        '.pb-gear{transition:opacity .15s ease}.pb-gear:hover{opacity:1 !important}',
        '.pb-field{transition:background .12s ease;border-radius:4px}.pb-field:hover{background:rgba(0,0,0,.04)}',
        '@keyframes pb-today-pulse{0%,100%{opacity:1}50%{opacity:.5}}',
        '.pb-today-badge{animation:pb-today-pulse 2.8s ease-in-out infinite}',
        '@keyframes pb-bill-cursor{0%,100%{opacity:1}50%{opacity:.45}}',
        '.pb-bill-cursor{animation:pb-bill-cursor 1s ease-in-out infinite}',
        '.pb-bill-col-end{align-items:flex-end !important;text-align:right}',
        '.pb-bill-col-end > div:first-child{justify-content:flex-end}',
      ].join('');
    }

    function peakBar(phase, flags = {}) {
      const color = phase.peak ? PEAK_COLOR : OFF_COLOR;
      const progress = Math.max(0, Math.min(100, phase.progress));
      const remaining = Math.max(0, 100 - progress);
      const spanMs = Math.max(1, phase.until - phase.since);
      const cellMinutes = spanMs / 20 / 60000;
      const showTicks = flags.b2 !== false;
      const showCursor = flags.b3 !== false;
      const showTooltip = flags.b4 !== false;
      const ticks = [];
      if (showTicks) for (let i = 1; i < 20; i++) ticks.push(((i / 20) * 100).toFixed(3));

      const onEnter = showTooltip ? (event) => {
        const node = event.currentTarget;
        node.title = [
          '每格相当于' + (cellMinutes >= 10 ? Math.round(cellMinutes) : cellMinutes.toFixed(1)) + '分钟，目前' + (phase.peak ? '峰时' : '闲时') + '进度' + progress.toFixed(2) + '%。',
          fmtDuration(phase.left) + '后，' + fmtDateTime(phase.until) + '转' + (phase.peak ? '闲时' : '峰时') + '。',
        ].join('\n');
      } : undefined;
      const onLeave = showTooltip ? (event) => { event.currentTarget.removeAttribute('title'); } : undefined;

      return h('div', {
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        style: {
          position: 'relative',
          height: 7,
          margin: '5px 0 2px',
          borderRadius: 0,
          overflow: 'hidden',
          boxSizing: 'border-box',
          background: 'transparent',
          border: '1px solid #5b6470',
        },
      },
        h('div', {
          style: {
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: 'calc(' + remaining.toFixed(2) + '% + 1px)',
            background: color,
          },
        }),
        showTicks
          ? ticks.map((pct, index) => h('div', {
              key: 'tick' + index,
              style: { position: 'absolute', left: pct + '%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,.5)' },
            }))
          : null,
        showCursor
          ? h('div', {
              className: 'pb-bill-cursor',
              style: { position: 'absolute', left: 'calc(' + progress.toFixed(2) + '% - 1.5px)', top: 0, bottom: 0, width: 3, background: '#ffffff', borderRadius: 0 },
            })
          : null);
    }

    function peakRow(color, label, right) {
      return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, dot(color), h('span', null, label)),
        h('span', null, right));
    }

    function buildPeakBlock(settings, phase, dense) {
      if (!phase) return [];
      const currentText = phase.peak ? '目前峰时' : '目前闲时';
      const nextText = phase.peak ? '闲时' : '峰时';
      const currentColor = phase.peak ? PEAK_COLOR : OFF_COLOR;
      const nextColor = phase.peak ? OFF_COLOR : PEAK_COLOR;
      const nodes = [];

      if (settings.sidebarProgress !== false) nodes.push(peakBar(phase));

      if (dense) {
        nodes.push(h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } },
            dot(currentColor),
            currentText),
          h('span', null, fmtClock(phase.until) + ' 转' + nextText + ' · 距离 ' + fmtHMS(phase.left))));
        return nodes;
      }

      nodes.push(peakRow(currentColor, currentText, ''));
      nodes.push(h('div', { style: { opacity: 0.9 } }, fmtClock(phase.since) + ' ~ ' + fmtClock(phase.until)));
      nodes.push(h('div', { style: { opacity: 0.9 } }, '已过 ' + fmtHMS(phase.elapsed)));
      nodes.push(peakRow(nextColor, fmtClock(phase.until) + ' 转' + nextText, ''));
      nodes.push(h('div', { style: { opacity: 0.9 } }, fmtClock(phase.until) + ' ~ ' + fmtClock(phase.nextUntil)));
      nodes.push(h('div', { style: { opacity: 0.9 } }, '距离 ' + fmtHMS(phase.left)));
      return nodes;
    }

    /** -------------------------------------------------------- 侧栏卡片 -- */
    function fmtDateTime(ms) {
      const d = new Date(ms);
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function fmtDuration(ms) {
      const total = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const p = (n) => String(n).padStart(2, '0');
      return p(days) + '天' + p(hours) + '小时' + p(minutes) + '分' + p(seconds) + '秒';
    }

    function resolveFlags(settings) {
      const all = {
        a1: true, a2: true, a3: true, a4: true,
        b1: true, b2: true, b3: true, b4: true,
        c1: true, c2: true,
        d1: true, d2: true, d3: true, d4: true, d5: true, d6: true,
      };
      const style = settings.sidebarStyle === 'merged' ? 'standard' : (settings.sidebarStyle || 'standard');
      if (style === 'custom') return { ...all, ...(settings.custom || {}) };
      if (style === 'compact') {
        return { ...all, a3: false, a4: false, b1: false, b2: false, b3: false, b4: false, c1: true, c2: true, d1: false, d2: false, d3: false, d4: false, d5: false, d6: false };
      }
      if (style === 'simple') {
        return { ...all, d1: false, d2: false, d3: false, d4: false, d5: false, d6: false };
      }
      return all;
    }

    function buildDetails(phase, now, flags) {
      const curColor = phase.peak ? PEAK_COLOR : OFF_COLOR;
      const nextColor = phase.peak ? OFF_COLOR : PEAK_COLOR;
      const curText = phase.peak ? '峰时' : '闲时';
      const nextText = phase.peak ? '闲时' : '峰时';
      const rows = [];
      const row = (left, right) => h('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
      }, left || h('span'), right || h('span'));

      const curLabel = flags.d1 ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, dot(curColor), '目前' + curText) : null;
      const curRange = flags.d2 ? fmtDateTime(phase.since) + ' ~ ' + fmtDateTime(phase.until) : null;
      const curElapsed = flags.d3 ? '已过 ' + fmtDuration(phase.elapsed) : null;

      if (curLabel || curRange || curElapsed) {
        const inlineRight = curRange || curElapsed;
        rows.push(row(curLabel, inlineRight ? h('span', { style: { opacity: 0.9, whiteSpace: 'nowrap' } }, inlineRight) : null));
        if (curRange && curElapsed) {
          rows.push(h('div', { style: { textAlign: 'right' } }, curElapsed));
        }
      }

      const nextLabel = flags.d4 ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, dot(nextColor), '距离' + nextText) : null;
      const nextRange = flags.d5 ? fmtDateTime(phase.until) + ' ~ ' + fmtDateTime(phase.nextUntil) : null;
      const remaining = flags.d6 ? '剩余 ' + fmtDuration(phase.left) : null;

      if (nextLabel || nextRange || remaining) {
        const inlineRight = nextRange || remaining;
        rows.push(row(nextLabel, inlineRight ? h('span', { style: { opacity: 0.9, whiteSpace: 'nowrap' } }, inlineRight) : null));
        if (nextRange && remaining) {
          rows.push(h('div', { style: { textAlign: 'right' } }, remaining));
        }
      }

      return rows;
    }

    function buildSidebar(settings, families, data, account, now, wide) {
      const phase = phaseModel(now);
      const flags = resolveFlags(settings);
      const official = settings.amountSource === 'official' && account?.logged === true;
      const todayValue = official ? Number(account.todayCost) : Number(data?.today?.cost);
      const totalValue = official ? Number(account.consumedTotal) : Number(data?.total?.cost);
      const todayText = money(todayValue);
      const totalText = money(totalValue);
      const layout = settings.sidebarStyle || 'standard';

      const base = {
        fontFamily: families[settings.fontFamily] || 'inherit',
        fontSize: Math.round((settings.fontSize || 11) * 1.1) + 'px',
        lineHeight: 1.5,
        color: settings.color || MUTED,
        userSelect: 'none',
        cursor: 'default',
        minWidth: 0,
        width: '100%',
        alignSelf: 'stretch',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      };

      const gridStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16, rowGap: 1, alignItems: 'center', paddingRight: 16 };

      const title = '累计消费 ' + totalText + ' · 账户余额 ' + money(Number(account?.balance)) + '\n' +
        (phase.peak ? '目前峰时' : '目前闲时') + ' 进度 ' + pct(phase.progress) + ' · ' + fmtClock(phase.until) + ' 转' + (phase.peak ? '闲时' : '峰时');

      if (!wide) {
        return h('div', { title, style: { ...base, alignItems: 'center', fontSize: 10, gap: 2, padding: '4px 0' } },
          h('span', { style: { color: phase.peak ? PEAK_COLOR : OFF_COLOR } }, phase.peak ? '峰' : '谷'),
          h('span', null, todayText),
        );
      }

      const logged = account?.logged === true;
      const monthCostText = logged ? money(Number(account.monthCost)) : '—';
      const balanceText = logged && Number.isFinite(Number(account.balance)) ? money(Number(account.balance)) : '—';

      const gearNode = h('button', {
        type: 'button',
        className: 'pb-gear',
        title: '打开精确计费设置',
        onClick: () => openBillingSettings(),
        style: { position: 'absolute', top: 0, right: 0, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 1px', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 12, lineHeight: 1, opacity: 0.45 },
      }, gearIcon(12));

      const chartNode = h('button', {
        type: 'button',
        className: 'pb-gear',
        title: '用量看板',
        onClick: () => setUsageOpen(true),
        style: { position: 'absolute', top: 0, right: 18, border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 1px', color: 'var(--dsw-alias-label-secondary, #666)', fontSize: 12, lineHeight: 1, opacity: 0.55 },
      }, '📊');

      const cell = (label, value, full) => h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, minWidth: 0 },
      },
        h('span', { style: { whiteSpace: 'nowrap' } }, label),
        h('span', { style: { whiteSpace: 'nowrap', textAlign: 'right', cursor: full ? 'help' : 'default' }, title: full || undefined }, value));

      const cells = [];
      if (flags.a1) cells.push(cell('累计消费', totalText, moneyFull(totalValue)));
      if (flags.a2) cells.push(cell('账户余额', balanceText, moneyFull(Number(account?.balance))));
      if (flags.a3) cells.push(cell('今日消费', todayText, moneyFull(todayValue)));
      if (flags.a4) cells.push(cell('本月消费', monthCostText, moneyFull(Number(account?.monthCost))));

      const top = cells.length > 0
        ? h('div', {
            style: { ...gridStyle, fontWeight: 600 },
          }, ...cells)
        : null;

      const barNode = flags.b1 ? peakBar(phase, flags) : null;

      const curColor = phase.peak ? PEAK_COLOR : OFF_COLOR;
      const curLabel = phase.peak ? '峰时' : '闲时';
      const infoPair = (label, value, align) => h('div', {
        style: { display: 'flex', justifyContent: 'space-between', gap: 8, minWidth: 0 },
      },
        h('span', { style: { color: curColor, fontWeight: 700, whiteSpace: 'nowrap' } }, label),
        h('span', { style: { color: curColor, fontWeight: 700, whiteSpace: 'nowrap' } }, value));

      const infoNode = (flags.c1 || flags.c2)
        ? h('div', {
            style: { ...gridStyle, margin: '1px 0' },
          },
            flags.c1 ? infoPair(curLabel + '已过', phase.progress.toFixed(2) + '%', 'left') : h('span'),
            flags.c2 ? infoPair(curLabel + '剩余', (100 - phase.progress).toFixed(2) + '%', 'right') : h('span'))
        : null;

      const detailRows = buildDetails(phase, now, flags);
      const detailsNode = detailRows.length > 0
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1, marginTop: 1 } }, ...detailRows)
        : null;

      return h('div', { title, style: { ...base, gap: 2, padding: '2px 2px 4px' } }, top, barNode, infoNode, detailsNode, chartNode, gearNode);
    }

    function SidebarCard(props) {
      props = props || {};
      const state = useSummary(undefined, 'sidebarPollMs');
      const accountState = useAccount();
      const [now, setNow] = React.useState(Date.now());
      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, []);
      const data = state.data;
      const settings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
      const host = h(UsageHost, { account: accountState.account });
      if (settings.sidebar === false) return host;
      return h(React.Fragment, null, host, buildSidebar(settings, data?.fontFamilies || {}, data, accountState.account, now, props.wide !== false));
    }

    /** ------------------------------------------------------------ 设置页 -- */
    const inputStyle = {
      fontSize: 12,
      padding: '5px 8px',
      borderRadius: 6,
      border: '1px solid rgba(0,0,0,.36)',
      background: 'var(--dsw-alias-bg-layer-1, #fff)',
      color: 'var(--dsw-alias-label-primary, #111)',
      width: 160,
      boxSizing: 'border-box',
    };

    function Section({ title, desc, children, extra }) {
      return h('section', {
        style: {
          border: '2px solid var(--dsw-alias-border-l2, rgba(0,0,0,.22))',
          borderRadius: 10,
          padding: '13px 16px 6px',
          marginBottom: 12,
          background: 'var(--dsw-alias-bg-layer-1, rgba(0,0,0,.015))',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
          h('h3', { style: { fontSize: 12.5, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary, #111)' } }, title),
          extra || null),
        desc ? h('p', { style: { fontSize: 11, color: MUTED, margin: '4px 0 8px', lineHeight: 1.6 } }, desc) : null,
        children);
    }

    function Field({ label, hint, children }) {
      const [hovered, setHovered] = React.useState(false);
      return h('div', {
        onMouseEnter: () => setHovered(true),
        onMouseLeave: () => setHovered(false),
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 6px',
          margin: '0 -6px',
          borderRadius: 4,
          transition: 'background .12s ease',
          background: hovered ? 'rgba(0,0,0,.04)' : 'transparent',
          borderBottom: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.12))',
        },
      },
        h('div', { style: { width: 92, flex: '0 0 92px' } },
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-primary, #111)' } }, label),
          hint ? h('div', { style: { fontSize: 10, color: MUTED, marginTop: 1, lineHeight: 1.4 } }, hint) : null),
        h('div', { style: { flex: '1 1 0', display: 'flex', justifyContent: 'flex-end', minWidth: 0 } }, children));
    }

    function Segmented({ value, options, onChange }) {
      return h('div', {
        style: {
          display: 'inline-flex',
          border: '1px solid rgba(0,0,0,.36)',
          borderRadius: 7,
          overflow: 'hidden',
          background: 'transparent',
        },
      }, options.map((option) => h('button', {
        key: option.value,
        type: 'button',
        onClick: () => onChange(option.value),
        style: {
          padding: '5px 11px',
          fontSize: 11,
          border: 'none',
          cursor: 'pointer',
          background: value === option.value ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.08))' : 'transparent',
          color: 'var(--dsw-alias-label-primary, #111)',
          fontWeight: value === option.value ? 600 : 400,
          whiteSpace: 'nowrap',
        },
      }, option.label)));
    }

    function Check({ label, checked, onChange, flush }) {
      return h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, marginLeft: flush ? 0 : 14, cursor: 'pointer' } },
        h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked), style: { margin: 0, flex: '0 0 auto' } }),
        label);
    }

    class PageBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error };
      }
      componentDidCatch(error) {
        try {
          console.error('[precise-billing] settings page error', error);
        } catch {}
      }
      render() {
        if (this.state.error) {
          return h('div', {
            style: { padding: 16, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #c00)', whiteSpace: 'pre-wrap', lineHeight: 1.7 },
          }, '精确计费设置页出错：\n' + String(this.state.error && this.state.error.message ? this.state.error.message : this.state.error));
        }
        return this.props.children;
      }
    }

    function SettingsPage() {
      const [state, setState] = React.useState({ status: 'loading' });
      const [draft, setDraft] = React.useState(null);
      const [saved, setSaved] = React.useState('');
      const [dirty, setDirty] = React.useState(false);
      const [now, setNow] = React.useState(Date.now());
      const summary = useSummary(undefined, 'sidebarPollMs');
      const accountState = useAccount();

      React.useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
      }, []);

      React.useEffect(() => {
        let alive = true;
        fetch('/api/precise-billing/settings', { cache: 'no-store' })
          .then((r) => r.json())
          .then((data) => {
            if (!alive) return;
            setState({ status: 'ok', fontFamilies: data.fontFamilies || {} });
            setDraft({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
          })
          .catch(() => alive && setState({ status: 'error' }));
        return () => { alive = false; };
      }, []);

      if (state.status === 'loading') return h('div', { style: { padding: 20, fontSize: 12 } }, '加载中…');
      if (state.status === 'error') return h('div', { style: { padding: 20, fontSize: 12, color: 'var(--dsw-alias-state-error-primary, #c00)' } }, '读取设置失败');

      const families = state.fontFamilies;
      const data = summary.data;
      const account = accountState.account;
      const set = (patch) => {
        setDraft((prev) => ({ ...prev, ...patch }));
        setDirty(true);
      };

      const setCustom = (key, value) => {
        setDraft((prev) => ({ ...prev, custom: { ...(prev.custom || {}), [key]: value } }));
        setDirty(true);
      };

      const save = async (next = draft) => {
        try {
          const res = await fetch('/api/precise-billing/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(next),
          });
          const out = await res.json();
          if (!out.ok) throw new Error(out.error || 'save failed');
          setDraft({ ...DEFAULT_SETTINGS, ...out.settings });
          setDirty(false);
          setSaved('已保存 ' + new Date().toLocaleTimeString());
        } catch (error) {
          setSaved('保存失败：' + String(error.message || error));
        }
      };

      const reset = () => {
        const next = { ...DEFAULT_SETTINGS };
        setDraft(next);
        setDirty(true);
        save(next);
      };

      const officialToday = Number(account?.todayCost ?? 0);
      const localToday = Number(data?.today?.cost ?? 0);
      const logged = account?.logged === true;

      return h('div', { style: { padding: '2px 2px 24px', maxWidth: 760 } },
        h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 } },
          h('div', null,
            h('h2', { style: { fontSize: 17, margin: '0 0 3px', color: 'var(--dsw-alias-label-primary, #111)' } }, '精确计费'),
            h('div', { style: { fontSize: 11, color: MUTED } }, '按 DeepSeek 官方人民币价目逐条请求计价 · 峰时为闲时的两倍 · 节假日全天闲时')),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 11, color: MUTED } }, dirty ? '有未保存修改' : saved),
            h('button', {
              type: 'button',
              onClick: reset,
              style: { fontSize: 11, padding: '6px 12px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.21))', background: 'transparent', color: 'var(--dsw-alias-label-primary, #111)' },
            }, '恢复默认'),
            h('button', {
              type: 'button',
              onClick: () => setUsageOpen(true),
              style: { padding: '6px 12px', fontSize: 12, borderRadius: 6, border: '1px solid rgba(47,111,237,.45)', color: '#2f6fed', background: 'transparent', cursor: 'pointer' },
            }, '📊 用量面板'),
            h('button', {
              type: 'button',
              onClick: () => save(),
              style: { fontSize: 11, padding: '6px 16px', borderRadius: 7, cursor: 'pointer', border: '1px solid var(--dsw-alias-brand-primary, #247bbf)', background: 'var(--dsw-alias-brand-primary, #247bbf)', color: '#fff', fontWeight: 600 },
            }, '保存设置'))),

        h(Section, { title: '账户', desc: '读取 DSH 已登录的 DeepSeek 账号，后台每 2 分钟刷新。' },
          h(Field, { label: '登录状态' },
            h('span', { style: { fontSize: 12 } },
              logged ? '已登录' : account?.error === 'unauthorized' ? '未登录' : accountState.status === 'loading' ? '读取中…' : '读取失败')),
          h(Field, { label: '账户余额' }, h('span', { style: { fontSize: 12 } }, logged && Number.isFinite(Number(account.balance)) ? money(Number(account.balance)) : '—')),
          h(Field, { label: '本月消费' }, h('span', { style: { fontSize: 12 } }, logged ? money(Number(account.monthCost)) : '—')),
          h(Field, { label: '本月用量' }, h('span', { style: { fontSize: 12 } }, logged ? fmtTokensCN(account.monthTokens) + ' tokens' : '—')),
          h(Field, { label: '金额口径', hint: '官方含其他客户端' },
            h(Segmented, {
              value: draft.amountSource || 'local',
              options: [{ value: 'local', label: '本地日志' }, { value: 'official', label: '官方账号' }],
              onChange: (value) => set({ amountSource: value }),
            })),
          h(Field, { label: '对账' },
            h('span', { style: { fontSize: 11.5, color: MUTED } },
              logged ? '官方 ' + money(officialToday) + ' · 本地 ' + money(localToday) + ' · 差 ' + money(Math.abs(officialToday - localToday)) : '—'))),

        h(Section, { title: '费用条', desc: '输入框下方或会话标题栏的常驻费用条，点击可展开本会话明细。' },
          h(Field, { label: '位置' },
            h(Segmented, {
              value: draft.position,
              options: [{ value: 'hidden', label: '隐藏' }, { value: 'composer', label: '输入框下方' }, { value: 'header', label: '标题栏' }],
              onChange: (value) => set({ position: value }),
            })),
          h(Field, { label: '字体' },
            h('select', { style: inputStyle, value: draft.fontFamily, onChange: (e) => set({ fontFamily: e.target.value }) },
              Object.keys(FONT_LABELS).map((key) => h('option', { key, value: key }, FONT_LABELS[key])))),
          h(Field, { label: '字号' },
            h('input', { type: 'number', min: 9, max: 18, style: { ...inputStyle, width: 80 }, value: draft.fontSize, onChange: (e) => set({ fontSize: Number(e.target.value) || 11 }) })),
          h(Field, { label: '颜色' },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(draft.color) ? draft.color : '#666666', onChange: (e) => set({ color: e.target.value }), style: { width: 34, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' } }),
              h('button', { type: 'button', style: { ...inputStyle, width: 'auto', padding: '4px 10px', cursor: 'pointer' }, onClick: () => set({ color: '' }) }, '跟随主题'))),
          h(Field, { label: '显示内容' },
            h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center' } },
              h(Check, { label: '峰时/闲时', checked: draft.chipPhase !== false, onChange: (value) => set({ chipPhase: value }) }),
              h(Check, { label: '本次', checked: draft.chipSession !== false, onChange: (value) => set({ chipSession: value }) }),
              h(Check, { label: '今日', checked: draft.chipToday !== false, onChange: (value) => set({ chipToday: value }) }),
              h(Check, { label: '累计', checked: draft.chipTotal !== false, onChange: (value) => set({ chipTotal: value }) }),
              h(Check, { label: '余额', checked: draft.chipBalance !== false, onChange: (value) => set({ chipBalance: value }) }))),
          h(Field, { label: '刷新间隔' },
            h('select', { style: { ...inputStyle, width: 130 }, value: draft.chipPollMs || 10000, onChange: (e) => set({ chipPollMs: Number(e.target.value) }) },
              h('option', { value: 1000 }, '1 秒'),
              h('option', { value: 5000 }, '5 秒'),
              h('option', { value: 10000 }, '10 秒'),
              h('option', { value: 30000 }, '30 秒'),
              h('option', { value: 60000 }, '1 分钟'),
              h('option', { value: 300000 }, '5 分钟'),
              h('option', { value: 600000 }, '10 分钟'))),
          h(Field, { label: '预览' },
            h('div', { style: { width: '100%', display: 'flex', justifyContent: 'flex-end', padding: '6px 0' } },
              buildChip(draft, families, data, summary.status, account, {})))),

        h(Section, { title: '侧栏卡片', desc: '侧栏底部的常驻卡片，显示内容由「风格」决定。' },
          h(Field, { label: '启用' },
            h(Segmented, {
              value: draft.sidebar !== false ? 'on' : 'off',
              options: [{ value: 'on', label: '显示' }, { value: 'off', label: '隐藏' }],
              onChange: (value) => set({ sidebar: value === 'on' }),
            })),
          h(Field, { label: '风格' },
            h('select', { style: { ...inputStyle, width: 150 }, value: draft.sidebarStyle, onChange: (e) => set({ sidebarStyle: e.target.value }) },
              h('option', { value: 'standard' }, '标准'),
              h('option', { value: 'simple' }, '简约'),
              h('option', { value: 'compact' }, '紧凑'),
              h('option', { value: 'custom' }, '自定义'))),
          h(Field, { label: '刷新间隔' },
            h('select', { style: { ...inputStyle, width: 130 }, value: draft.sidebarPollMs || 30000, onChange: (e) => set({ sidebarPollMs: Number(e.target.value) }) },
              h('option', { value: 1000 }, '1 秒'),
              h('option', { value: 5000 }, '5 秒'),
              h('option', { value: 10000 }, '10 秒'),
              h('option', { value: 30000 }, '30 秒'),
              h('option', { value: 60000 }, '1 分钟'),
              h('option', { value: 300000 }, '5 分钟'),
              h('option', { value: 600000 }, '10 分钟'))),
          draft.sidebarStyle === 'custom'
            ? h(Field, { label: '自定义内容' },
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' } },
                  h('div', { style: { fontSize: 11, color: MUTED } }, '顶部金额'),
                  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: '100%' } },
                    h(Check, { label: '累计消费', flush: true, checked: draft.custom.a1 !== false, onChange: (v) => setCustom('a1', v) }),
                    h(Check, { label: '账户余额', flush: true, checked: draft.custom.a2 !== false, onChange: (v) => setCustom('a2', v) }),
                    h(Check, { label: '今日消费', flush: true, checked: draft.custom.a3 !== false, onChange: (v) => setCustom('a3', v) }),
                    h(Check, { label: '本月消费', flush: true, checked: draft.custom.a4 !== false, onChange: (v) => setCustom('a4', v) })),
                  h('div', { style: { fontSize: 11, color: MUTED, marginTop: 4 } }, '进度条'),
                  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: '100%' } },
                    h(Check, { label: '进度条', flush: true, checked: draft.custom.b1 !== false, onChange: (v) => setCustom('b1', v) }),
                    h(Check, { label: '刻度线', flush: true, checked: draft.custom.b2 !== false, onChange: (v) => setCustom('b2', v) }),
                    h(Check, { label: '游标', flush: true, checked: draft.custom.b3 !== false, onChange: (v) => setCustom('b3', v) }),
                    h(Check, { label: '悬浮提示', flush: true, checked: draft.custom.b4 !== false, onChange: (v) => setCustom('b4', v) })),
                  h('div', { style: { fontSize: 11, color: MUTED, marginTop: 4 } }, '百分比'),
                  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: '100%' } },
                    h(Check, { label: '已过', flush: true, checked: draft.custom.c1 !== false, onChange: (v) => setCustom('c1', v) }),
                    h(Check, { label: '剩余', flush: true, checked: draft.custom.c2 !== false, onChange: (v) => setCustom('c2', v) })),
                  h('div', { style: { fontSize: 11, color: MUTED, marginTop: 4 } }, '时段明细'),
                  h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, width: '100%' } },
                    h(Check, { label: '目前时段', flush: true, checked: draft.custom.d1 !== false, onChange: (v) => setCustom('d1', v) }),
                    h(Check, { label: '目前时段范围', flush: true, checked: draft.custom.d2 !== false, onChange: (v) => setCustom('d2', v) }),
                    h(Check, { label: '已过时长', flush: true, checked: draft.custom.d3 !== false, onChange: (v) => setCustom('d3', v) }),
                    h(Check, { label: '下一时段', flush: true, checked: draft.custom.d4 !== false, onChange: (v) => setCustom('d4', v) }),
                    h(Check, { label: '下一时段范围', flush: true, checked: draft.custom.d5 !== false, onChange: (v) => setCustom('d5', v) }),
                    h(Check, { label: '剩余时长', flush: true, checked: draft.custom.d6 !== false, onChange: (v) => setCustom('d6', v) }))))
            : null,
          h(Field, { label: '预览' },
            h('div', { style: { width: '100%', display: 'flex', justifyContent: 'flex-end' } },
              h('div', { style: { width: 300, padding: 8, borderRadius: 8, border: '1px dashed var(--dsw-alias-border-l1, rgba(0,0,0,.18))' } },
                buildSidebar(draft, families, data, account, now, true))))),

      );
    }

    function SettingsPageSafe() {
      return h(PageBoundary, null, h(SettingsPage));
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        slotsService = ctx.slots;
        ensureStyles();
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({ name: 'conversation.composer.dock', id: 'precise-billing', order: 30 }, withSlot('composer')),
        );
        ctx.slots.inject('conversation.session.header.actions', () =>
          ctx.slots.register({ name: 'conversation.session.header.actions', id: 'precise-billing-header', order: 45 }, withSlot('header')),
        );
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register({ name: 'settings.section', id: 'precise-billing', order: 70, label: '精确计费' }, SettingsPageSafe),
        );
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'precise-billing-sidebar', order: 5 }, SidebarCard),
        );
      },
    };
  },
});
