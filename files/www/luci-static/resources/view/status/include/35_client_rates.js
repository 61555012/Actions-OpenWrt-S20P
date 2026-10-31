'use strict';
'require baseclass';
'require rpc';
'require client-rates.brand as brand';

var callStatus = rpc.declare({
	object: 'luci.client_rates',
	method: 'status'
});

var STYLE_ID = 'cr-hosts-style';
var CSS = ''
	+ '.cr-hosts-head{display:flex;flex-wrap:wrap;gap:26px;align-items:baseline;padding:10px 14px;'
	+ 'border-radius:8px;background:rgba(127,127,127,.09);font-size:13px;margin:0 0 10px}'
	+ '.cr-hosts-head .k{opacity:.6;margin-right:6px}'
	+ '.cr-hosts-head .v{font-weight:600;font-variant-numeric:tabular-nums}'
	+ '.cr-hosts-table{display:table;width:100%;min-width:60rem;font-size:13px;border-collapse:collapse;table-layout:fixed}'
	+ '.cr-hosts-table th{font-weight:600;white-space:nowrap;padding:8px 8px !important;text-align:left;'
	+ 'border-bottom:1px solid rgba(127,127,127,.25);overflow:hidden;text-overflow:ellipsis}'
	+ '.cr-hosts-table td{padding:7px 8px !important;vertical-align:middle;overflow:hidden;white-space:nowrap;'
	+ 'border-bottom:1px solid rgba(127,127,127,.12)}'
	+ '.cr-hosts-table td.num{text-align:right !important;font-variant-numeric:tabular-nums}'
	+ '.cr-hosts-table th.num{text-align:right !important}'
	+ '.cr-hosts-table th.ctr,.cr-hosts-table td.ctr{text-align:center !important}'
	+ '.cr-hosts-table tr{display:table-row}'
	+ '.cr-hosts-table th,.cr-hosts-table td{display:table-cell}'
	+ '.cr-hosts-table tr.off td{opacity:.68}'
	+ '.cr-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2ecc71;'
	+ 'box-shadow:0 0 0 2px rgba(46,204,113,.2)}'
	+ '.cr-dot.off{background:#9aa0a6;box-shadow:none}'
	+ '.cr-hostname{display:flex;align-items:center;justify-content:flex-start;min-width:0}'
	+ '.cr-hostname .ic{flex:0 0 auto;margin-right:0;display:flex;align-items:center}'
	+ '.cr-hostname .n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0;max-width:100%}'
	+ '.cr-hostname .vd{opacity:.55;font-size:88%;margin-left:5px;white-space:nowrap;flex:0 0 auto;'
	+ 'overflow:hidden;text-overflow:ellipsis;max-width:40%}'
	/* MAC 与 IPv6 用同一套等宽小字(字号/透明度/字体一致), 区别只在内容长度 */
	+ '.cr-v6,.cr-mac{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;opacity:.85}'
	+ '.cr-link{font-size:12px;opacity:.85}'
	+ '.cr-rssi{font-variant-numeric:tabular-nums;font-size:12.5px}'
	+ '.cr-hosts-table td.num{font-size:12.5px}'
	+ '.cr-empty{padding:14px 4px;opacity:.6}'
	/* ===== 移动端: 卡片视图 (参考 OAF 用户列表的 user-card) ===== */
	+ '.cr-hosts-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}'
	+ '.cr-cards{display:none;flex-direction:column;gap:10px}'
	+ '.cr-card{border:1px solid rgba(127,127,127,.22);border-radius:12px;padding:11px 13px;'
	+ 'display:flex;flex-direction:column;gap:8px;box-sizing:border-box}'
	+ '.cr-card.off{opacity:.86}'
	+ '.cr-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}'
	+ '.cr-card-dev{display:flex;align-items:center;gap:8px;min-width:0}'
	+ '.cr-card-titwrap{min-width:0}'
	+ '.cr-card-title{font-weight:700;font-size:14px;line-height:1.3;overflow:hidden;'
	+ 'text-overflow:ellipsis;white-space:nowrap}'
	+ '.cr-card-sub{margin-top:2px;font-size:11.5px;opacity:.6;overflow:hidden;text-overflow:ellipsis;'
	+ 'white-space:nowrap}'
	+ '.cr-card-pill{flex:0 0 auto;white-space:nowrap;font-size:11.5px;font-weight:600;padding:2px 8px;'
	+ 'border-radius:999px;border:1px solid transparent;box-sizing:border-box}'
	+ '.cr-card-pill.on{color:#15803d;background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.38)}'
	+ '.cr-card-pill.off{color:#6b7280;background:rgba(148,163,184,.14);border-color:rgba(148,163,184,.32)}'
	+ '@media (prefers-color-scheme:dark){'
	+ '.cr-card-pill.on{color:#4ade80;background:rgba(34,197,94,.2);border-color:rgba(34,197,94,.42)}'
	+ '.cr-card-pill.off{color:#9aa0a6;background:rgba(148,163,184,.16);border-color:rgba(148,163,184,.34)}'
	+ '}'
	+ '.cr-card-body{display:flex;flex-direction:column;gap:6px}'
	+ '.cr-card-line{display:flex;align-items:baseline;justify-content:space-between;gap:12px;'
	+ 'font-size:12.5px;line-height:1.35}'
	+ '.cr-card-k{flex:0 0 auto;opacity:.6}'
	+ '.cr-card-v{min-width:0;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
	+ 'font-variant-numeric:tabular-nums}'
	+ '.cr-card-v.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px}'
	+ '@media (max-width:768px){'
	+ '.cr-hosts-wrap{display:none!important}'
	+ '.cr-cards{display:flex}'
	+ '.cr-hosts-head{gap:10px 16px;padding:9px 11px;font-size:12.5px}'
	/* 宽 IPv6 在 360px 以下会顶到省略号, 等宽值再收 1px */
	+ '.cr-card-v.mono{font-size:10.5px}'
	+ '}';

function fmtRate(v) {
	return String.format('%1024.2mB/s', v || 0);
}

function fmtB(v) {
	return String.format('%1024.2mB', v || 0);
}

function rssiColor(v) {
	if (v >= -60) return '#2ecc71';
	if (v >= -75) return '#e0a72c';
	return '#e05c5c';
}

function ensureStyle() {
	if (document.getElementById(STYLE_ID))
		return;
	var s = document.createElement('style');
	s.id = STYLE_ID;
	s.appendChild(document.createTextNode(CSS));
	document.head.appendChild(s);
}

function keyOf(c) {
	return c.mac || ('ip:' + c.ip);
}

/* 离线设备只在列表里保留最近 24h 出现过的(与后端 cr-sampler 的 OFFLINE_WIN 一致);
 * 后端已过滤, 这里兜底, 兼容只更新了前端的旧固件 */
var OFFLINE_WIN = 86400;

function keepRecent(list, ts) {
	var nowSec = ts || Math.floor(Date.now() / 1000);
	return list.filter(function (c) {
		if (c.online) return true;
		var ref = c.last_seen || c.first_seen || 0;
		return (!ref || (nowSec - ref) <= OFFLINE_WIN);
	});
}

function cardLine(label, mono) {
	var v = E('span', { 'class': 'cr-card-v' + (mono ? ' mono' : '') }, ['-']);
	var line = E('div', { 'class': 'cr-card-line' }, [
		E('span', { 'class': 'cr-card-k' }, [label]),
		v
	]);
	return { line: line, v: v };
}

function renderCell(c) {
	var title = c.host || brand.name(c.mac) || c.ip || '-';
	var vd = (c.host && brand.name(c.mac)) ? brand.name(c.mac) : '';
	var nameEl = E('span', { 'class': 'n', 'title': title }, [title]);
	var cName = E('div', { 'class': 'cr-card-title', 'title': title }, [title]);
	var cSub = E('div', { 'class': 'cr-card-sub' }, [vd]);
	var cPill = E('span', { 'class': 'cr-card-pill' + (c.online ? '' : ' off') },
		[c.online ? _('在线') : _('离线')]);
	var cIp = cardLine(_('IPv4 地址'));
	var cIp6 = cardLine(_('IPv6 地址'), true);
	var cMac = cardLine(_('MAC 地址'), true);
	var cUp = cardLine(_('上传'));
	var cDown = cardLine(_('下载'));
	var cTotal = cardLine(_('总流量'));
	var cConn = cardLine(_('连接数'));
	var cLink = cardLine(_('连接方式'));
	var cRssi = cardLine(_('信号强度'));

	var card = E('div', { 'class': 'cr-card' + (c.online ? '' : ' off') }, [
		E('div', { 'class': 'cr-card-head' }, [
			E('div', { 'class': 'cr-card-dev' }, [
				E('span', { 'class': 'ic' }, [brand.icon(c.mac, 24)]),
				E('div', { 'class': 'cr-card-titwrap' }, [cName, vd ? cSub : ''])
			]),
			cPill
		]),
		E('div', { 'class': 'cr-card-body' }, [
			cIp.line, cIp6.line, cMac.line, cUp.line, cDown.line, cTotal.line, cConn.line,
			cLink.line, cRssi.line
		])
	]);

	return {
		dot: E('span', { 'class': 'cr-dot' + (c.online ? '' : ' off') }),
		host: E('div', { 'class': 'cr-hostname' }, [
			E('span', { 'class': 'ic' }, [brand.icon(c.mac, 18)]),
			nameEl,
			vd ? E('span', { 'class': 'vd' }, [vd]) : ''
		]),
		nameEl: nameEl,
		ip: E('span', {}, [c.ip || '-']),
		ip6: E('span', { 'class': 'cr-v6', 'title': c.ip6 || '' }, [c.ip6 || '-']),
		mac: E('span', { 'class': 'cr-mac' }, [c.mac || '-']),
		up: E('span', {}, ['-']),
		down: E('span', {}, ['-']),
		rssi: E('span', { 'class': 'cr-rssi' }, ['-']),
		total: E('span', {}, ['-']),
		conn: E('span', {}, ['-']),
		link: E('span', { 'class': 'cr-link' }, [c.link || '-']),
		card: card, cPill: cPill, cIp: cIp.v, cIp6: cIp6.v, cMac: cMac.v,
		cUp: cUp.v, cDown: cDown.v, cTotal: cTotal.v, cConn: cConn.v, cLink: cLink.v, cRssi: cRssi.v
	};
}

function newRow(c) {
	var cl = renderCell(c);
	var tr = E('tr', { 'class': 'cr-row', 'data-key': keyOf(c) }, [
		E('td', { 'class': 'ctr' }, [cl.dot]),
		E('td', {}, [cl.host]),
		E('td', {}, [cl.mac]),
		E('td', {}, [cl.ip]),
		E('td', {}, [cl.ip6]),
		E('td', { 'class': 'num' }, [cl.up]),
		E('td', { 'class': 'num' }, [cl.down]),
		E('td', { 'class': 'num' }, [cl.total]),
		E('td', { 'class': 'num' }, [cl.conn]),
		E('td', {}, [cl.link]),
		E('td', { 'class': 'num' }, [cl.rssi])
	]);
	tr._cr = cl;
	return tr;
}

function fill(tr, c) {
	var cl = tr._cr;
	cl.dot.className = 'cr-dot' + (c.online ? '' : ' off');
	var title = c.host || brand.name(c.mac) || c.ip || '-';
	if (cl.nameEl.textContent !== title) {
		cl.nameEl.textContent = title;
		cl.nameEl.title = title;
	}
	cl.ip.textContent = c.ip || '-';
	cl.ip6.textContent = c.ip6 || '-';
	cl.ip6.title = c.ip6 || '';
	cl.mac.textContent = c.mac || '-';
	cl.up.textContent = fmtRate(c.up);
	cl.down.textContent = fmtRate(c.down);
	if (c.rssi != null) {
		cl.rssi.textContent = c.rssi + ' dBm';
		cl.rssi.style.color = rssiColor(c.rssi);
		cl.cRssi.textContent = c.rssi + ' dBm';
		cl.cRssi.style.color = rssiColor(c.rssi);
	}
	else {
		cl.rssi.textContent = '-';
		cl.rssi.style.color = '';
		cl.cRssi.textContent = '-';
		cl.cRssi.style.color = '';
	}
	cl.total.textContent = fmtB((c.up_today || 0) + (c.down_today || 0));
	cl.conn.textContent = (c.conn != null) ? String(c.conn) : '-';
	cl.link.textContent = c.link || '-';
	tr.className = 'cr-row' + (c.online ? '' : ' off');

	/* 卡片视图 */
	cl.cPill.textContent = c.online ? _('在线') : _('离线');
	cl.cPill.className = 'cr-card-pill' + (c.online ? '' : ' off');
	cl.card.className = 'cr-card' + (c.online ? '' : ' off');
	cl.cIp.textContent = c.ip || '-';
	cl.cIp6.textContent = c.ip6 || '-';
	cl.cIp6.title = c.ip6 || '';
	cl.cMac.textContent = c.mac || '-';
	cl.cUp.textContent = fmtRate(c.up);
	cl.cDown.textContent = fmtRate(c.down);
	cl.cTotal.textContent = fmtB((c.up_today || 0) + (c.down_today || 0));
	cl.cConn.textContent = (c.conn != null) ? String(c.conn) : '-';
	cl.cLink.textContent = c.link || '-';
}

var timer = null;

function stopTimer() {
	if (timer) {
		clearInterval(timer);
		timer = null;
	}
}

return baseclass.extend({
	title: _('在线主机'),

	load: function () {
		return Promise.all([
			L.resolveDefault(callStatus(), {}),
			brand.load()
		]);
	},

	render: function (res) {
		try {
			return this._render(res);
		}
		catch (e) {
			stopTimer();
			return E('div', { 'class': 'cr-empty' },
				['在线主机组件加载失败: ' + (e && e.message ? e.message : e)]);
		}
	},

	_render: function (res) {
		var data = (res && res[0]) || {};

		if (this.root) {
			try { this.update(data); } catch (e) { }
			return this.root;
		}

		ensureStyle();

		var onlineV = E('span', { 'class': 'v' }, ['0']);
		var upV = E('span', { 'class': 'v', 'style': 'color:#e08b2c' }, ['0 B/s']);
		var downV = E('span', { 'class': 'v', 'style': 'color:#2f7ed8' }, ['0 B/s']);
		var noteV = E('span', { 'class': 'v', 'style': 'font-weight:400;opacity:.6' }, ['']);

		var tbody = E('tbody', {});
		var cardsEl = E('div', { 'class': 'cr-cards' });
		var empty = E('div', { 'class': 'cr-empty' }, [_('暂无设备')]);

		var node = E('div', {}, [
			E('div', { 'class': 'cr-hosts-head' }, [
				E('span', {}, [E('span', { 'class': 'k' }, [_('在线用户')]), onlineV]),
				E('span', {}, [E('span', { 'class': 'k' }, [_('上传总带宽')]), upV]),
				E('span', {}, [E('span', { 'class': 'k' }, [_('下载总带宽')]), downV]),
				E('span', {}, [noteV])
			]),
			E('div', { 'class': 'cr-hosts-wrap' }, [
				E('table', { 'class': 'table cr-hosts-table' }, [
					E('colgroup', {}, [
						E('col', { 'style': 'width:4.5%' }),
						E('col', { 'style': 'width:12.5%' }),
						E('col', { 'style': 'width:12%' }),
						E('col', { 'style': 'width:10%' }),
						E('col', { 'style': 'width:16%' }),
						E('col', { 'style': 'width:7%' }),
						E('col', { 'style': 'width:7%' }),
						E('col', { 'style': 'width:7%' }),
						E('col', { 'style': 'width:6%' }),
						E('col', { 'style': 'width:8%' }),
						E('col', { 'style': 'width:10%' })
					]),
					E('thead', {}, [E('tr', { 'class': 'cr-row' }, [
						E('th', { 'class': 'ctr' }, [_('状态')]),
						E('th', {}, [_('主机名')]),
						E('th', {}, [_('MAC 地址')]),
						E('th', {}, [_('IPv4 地址')]),
						E('th', {}, [_('IPv6 地址')]),
						E('th', { 'class': 'num' }, [_('上传')]),
						E('th', { 'class': 'num' }, [_('下载')]),
						E('th', { 'class': 'num' }, [_('总流量')]),
						E('th', { 'class': 'num' }, [_('连接数')]),
						E('th', {}, [_('连接方式')]),
						E('th', { 'class': 'num' }, [_('信号强度')])
					])]),
					tbody
				])
			]),
			cardsEl,
			empty
		]);

		this.root = node;
		this.body = tbody;
		this.cardsEl = cardsEl;
		this.cardOrder = '';
		this.emptyEl = empty;
		this.rows = {};
		this.onlineEl = onlineV;
		this.upEl = upV;
		this.downEl = downV;
		this.noteEl = noteV;

		this.update = function (d) {
			var wan = d.wan || {};
			onlineV.textContent = String(d.online || 0);
			if (!d.online && d.total) onlineV.textContent = '0';
			upV.textContent = fmtRate(wan.up);
			downV.textContent = fmtRate(wan.down);
			noteV.textContent = d.hnat ? _('硬件加速已校正') : _('仅软件路径');

			var list = keepRecent(d.clients || [], d.ts);
			var seen = {}, i, c, tr;

			for (i = 0; i < list.length; i++) {
				c = list[i];
				var k = keyOf(c);
				seen[k] = 1;
				tr = this.rows[k];
				if (!tr) {
					tr = newRow(c);
					this.rows[k] = tr;
				}
				fill(tr, c);
				if (this.body.children[i] !== tr)
					this.body.insertBefore(tr, this.body.children[i] || null);
			}

			for (k in this.rows) {
				if (!seen[k]) {
					var cd = this.rows[k]._cr.card;
					if (cd.parentNode)
						cd.parentNode.removeChild(cd);
					if (this.rows[k].parentNode)
						this.rows[k].parentNode.removeChild(this.rows[k]);
					delete this.rows[k];
				}
			}

			/* 卡片视图: 与表格同序, 仅顺序变化时重排, 避免每秒抖动 */
			var ord = [];
			for (i = 0; i < list.length; i++)
				ord.push(keyOf(list[i]));
			if (ord.join('|') !== this.cardOrder) {
				this.cardOrder = ord.join('|');
				for (i = 0; i < list.length; i++)
					this.cardsEl.appendChild(this.rows[keyOf(list[i])]._cr.card);
			}

			this.emptyEl.style.display = list.length ? 'none' : '';
		};

		try { this.update(data); } catch (e) { }

		var self = this;
		timer = setInterval(function () {
			if (document.hidden || !self.root || !self.root.parentNode)
				return;
			callStatus().then(function (d) {
				if (!d || !d.wan) return;
				self.update(d);
			}).catch(function () { });
		}, 1000);

		return node;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
