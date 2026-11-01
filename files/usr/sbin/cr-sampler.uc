#!/usr/bin/ucode
// client-rates sampler — 硬件加速(HNAT)下的逐设备流量统计
//
// 数据源:
//   /proc/net/nf_conntrack           软件路径计数(流被硬件卸载后冻结)
//   /sys/kernel/debug/hnat/all_entry PPE 快通道计数, 每条目单向:
//        SIP=客户端 -> dir=up ;  NDIP=客户端 -> dir=down
//
// 思路: 两个源互补不相交(卸载前归 conntrack, 卸载后归 HNAT), 故逐"源条目"求增量再求和。
// 每条基线以源内唯一 id 绑定(h:<槽位>:<5元组> / c:<5元组>), 首次见到只建基线不计数,
// 避免 HNAT 槽位回收导致同一累计值被反复计入。
'use strict';

const fs = require('fs');
const uci = require('uci');

const HNAT_PATH   = '/sys/kernel/debug/hnat/all_entry';
const CT_PATH     = '/proc/net/nf_conntrack';
const ARP_PATH    = '/proc/net/arp';
const LEASE_PATH  = '/tmp/dhcp.leases';
const OUT_PATH    = '/tmp/client-rates.json';
const STATE_DIR   = '/etc/client-rates';
const STATE_PATH  = STATE_DIR + '/state.json';
const INTERVAL    = 1;
const SAVE_EVERY  = 30;
const ONLINE_WIN  = 120;
const OFFLINE_WIN = 86400;  // 离线设备只在列表里保留最近 24h, 避免设备多时列表过长
const RATE_ALPHA  = 0.55;
const NEIGH_EVERY = 5;      // 每 5 个 tick 取一次 IPv6 邻居表
const RSSI_EVERY  = 10;     // 每 10 个 tick 取一次无线信号强度
const V6_TTL      = 86400;  // v6 地址池条目保留时长(秒)
const KEEP_BASE   = 180;    // 源条目基线保留时长(秒)
const KEEP_DAYS   = 7;

function now() { return time(); }

function daykey(t) {
	let tm = localtime(t);
	return sprintf('%04d-%02d-%02d', tm.year, tm.mon, tm.mday);
}

function hour_of(t) { return localtime(t).hour; }

function lan_cfg() {
	let ip = '192.168.6.1', mask = '255.255.255.0';
	try {
		let ctx = uci.cursor();
		ip = ctx.get('network', 'lan', 'ipaddr') || ip;
		mask = ctx.get('network', 'lan', 'netmask') || mask;
	} catch (e) { }
	let sl = index(ip, '/');        // ipaddr 可能带 CIDR 后缀
	if (sl != null) ip = substr(ip, 0, sl);
	let n = 0;
	for (let i = 0; i < length(ip); i++) if (ip[i] == '.') n++;
	if (n != 3 || !match(ip, /^[0-9.]+$/)) ip = '192.168.6.1';
	return { ip: ip, mask: mask };
}

function lan_prefix_of(ip, mask) {
	let o = split(ip, '.'), m = split(mask, '.');
	if (length(o) != 4 || length(m) != 4) return '192.168.6.';
	if (m[1] != '255') return o[0] + '.';
	if (m[2] != '255') return o[0] + '.' + o[1] + '.';
	return o[0] + '.' + o[1] + '.' + o[2] + '.';
}

const LC = lan_cfg();
const LAN = lan_prefix_of(LC.ip, LC.mask);
const ROUTER_IP = LC.ip;

function iface_mac(name) {
	let m = null;
	try { m = fs.readfile('/sys/class/net/' + name + '/address'); } catch (e) { return null; }
	return (m != null) ? lc(trim(m)) : null;
}
const LAN_MAC1 = iface_mac('br-lan');
const LAN_MAC2 = iface_mac('eth0');
function is_lan(ip) { return (ip != null) && (index(ip, LAN) == 0); }

function field(parts, name) {
	let pfx = name + '=';
	for (let i = 0; i < length(parts); i++)
		if (index(parts[i], pfx) == 0) return substr(parts[i], length(pfx));
	return null;
}

function read_arp() {
	let map = {};
	let txt = null;
	try { txt = fs.readfile(ARP_PATH); } catch (e) { return map; }
	if (txt == null) return map;
	let lines = split(txt, '\n');
	for (let i = 1; i < length(lines); i++) {
		let f = split(trim(lines[i]), ' ');
		let out = [];
		for (let j = 0; j < length(f); j++) if (length(f[j])) push(out, f[j]);
		if (length(out) < 4) continue;
		if (out[2] != '0x2') continue;
		if (out[3] == '00:00:00:00:00:00') continue;
		if (length(out) >= 6 && index(out[5], 'br-lan') != 0) continue;  // 排除 WAN 侧邻居
		map[out[0]] = lc(out[3]);
	}
	return map;
}

/* ---------- 无线信号强度 + 关联接口 ----------
 * iwinfo <dev> assoclist 输出:  AA:BB:CC:DD:EE:FF  -55 dBm / -95 dBm (SNR 40)  ...
 * 一次 shell 汇总所有 AP 接口, 同一 MAC 多接口关联取较强者; 同时记下接口名,
 * 后面据此判断是 2.4G 还是 5G(见 band_of())。
 */
const RSSI_CMD = 'for d in /sys/class/net/ra* /sys/class/net/wlan*; do [ -e "$d" ] || continue;'
	+ ' n="${d##*/}"; echo "==$n"; iwinfo "$n" assoclist 2>/dev/null; done';
const RE_ASSOC = /^([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+)[ \t]+(-?[0-9]+)[ \t]*dBm/;
const RE_DEVHDR = /^==(.+)$/;
/* 协商速率行(在 MAC 行之后, 以 tab 缩进):
 *   RX: 1201.0 MBit/s, HE-MCS 11, 80MHz, HE-NSS 2, HE-GI 0, HE-DCM 0   0 Pkts.
 *   TX: 1.0 MBit/s                                 0 Pkts.
 * 频宽不一定出现(2.4G 老模式只有 "RX: 1.0 MBit/s"), 单独抓 MHz。
 * 从 AP 视角: RX = 客户端发过来的(上行), TX = 发给客户端的(下行)。
 */
const RE_RX  = /^[ \t]*RX:[ \t]*([0-9.]+)[ \t]*MBit\/s/;
const RE_TX  = /^[ \t]*TX:[ \t]*([0-9.]+)[ \t]*MBit\/s/;
const RE_MHZ = /([0-9]+)[ \t]*MHz/;
let rssi = {};          // mac -> dBm
let wifi_dev = {};      // mac -> 关联的 AP 接口名
let links = {};         // mac -> '2.4G' | '5G' | 'lanX'
let rates = {};         // mac -> { rx, rxm, tx, txm }  单位 Mbit/s / MHz

function read_rssi() {
	let map = {}, devs = {}, rmap = {};
	let txt = null;
	try {
		let p = fs.popen(RSSI_CMD);
		if (p == null) return map;
		txt = p.read('all');
		p.close();
	} catch (e) { return map; }
	if (txt == null || !length(txt)) return map;
	let lines = split(txt, '\n'), cur = null, cur_mac = null;
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		let mh = match(line, RE_DEVHDR);
		if (mh != null) { cur = mh[1]; cur_mac = null; continue; }
		let m = match(line, RE_ASSOC);
		if (m != null) {
			let mac = lc(m[1]), dbm = +m[2];
			cur_mac = null;
			if (!match(mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
			cur_mac = mac;
			let old = map[mac];
			if (old == null || dbm > old) { map[mac] = dbm; devs[mac] = cur; }
			continue;
		}
		if (cur_mac == null) continue;
		let mr = match(line, RE_RX);
		if (mr != null) {
			if (rmap[cur_mac] == null) rmap[cur_mac] = {};
			rmap[cur_mac].rx = +mr[1];
			let z = match(line, RE_MHZ);
			if (z != null) rmap[cur_mac].rxm = +z[1];
			continue;
		}
		let mt = match(line, RE_TX);
		if (mt != null) {
			if (rmap[cur_mac] == null) rmap[cur_mac] = {};
			rmap[cur_mac].tx = +mt[1];
			let z = match(line, RE_MHZ);
			if (z != null) rmap[cur_mac].txm = +z[1];
		}
	}
	wifi_dev = devs;
	rates = rmap;
	return map;
}

/* ---------- 连接方式: 2.4G / 5G / 6G / 具体网口 ----------
 * 无线: assoclist 给出关联接口, 再用 iwinfo <dev> info 的频道频率判频段(结果缓存,
 *       接口频段运行期不会变, 不必每轮都问)。
 * 有线: 桥里没有 iw 信息, 用 brctl 的端口号 -> 接口名映射 + MAC 表反查走哪个口。
 *       桥端口顺序由内核决定, 必须按 brctl show 输出的顺序编号, 不能写死。
 */
let wifi_band = {};     // iface -> '2.4G' | '5G' | '6G'

function band_of(dev) {
	let b = wifi_band[dev];
	if (b != null) return b;
	let freq = 0, txt = null;
	try {
		let p = fs.popen('iwinfo ' + dev + ' info 2>/dev/null');
		if (p != null) { txt = p.read('all'); p.close(); }
	} catch (e) { }
	if (txt != null) {
		let m = match(txt, /Channel:\s*[0-9]+\s*\(([0-9.]+)\s*GHz\)/);
		if (m != null) freq = int(+m[1] * 1000);
	}
	b = (freq >= 5925) ? '6G' : (freq >= 3000) ? '5G' : (freq > 0) ? '2.4G' : '';
	wifi_band[dev] = b;
	return b;
}

function read_links() {
	let out = {};
	/* 无线: 本轮 assoclist 关联到的接口 */
	for (let mac in wifi_dev) {
		let b = band_of(wifi_dev[mac]);
		if (length(b)) out[mac] = b;
	}
	/* 有线: 端口号 -> 接口名。brctl show 的接口列表顺序不等于端口号(按 hash 排),
	 * 必须用 showstp 里行尾括号中的编号, 否则 lanX 会被映射成隔壁的 raX */
	let ports = {};
	try {
		let p = fs.popen('brctl showstp br-lan 2>/dev/null');
		let txt = (p != null) ? p.read('all') : null;
		if (p != null) p.close();
		if (txt != null) {
			let lines = split(txt, '\n');
			for (let i = 0; i < length(lines); i++) {
				let m = match(trim(lines[i]), /^(\S+)\s+\(([0-9]+)\)$/);
				if (m == null) continue;
				ports[+m[2]] = m[1];
			}
		}
	} catch (e) { }
	/* MAC 表: 只看非本地条目(no), 本地的是桥/接口自身 MAC */
	try {
		let p = fs.popen('brctl showmacs br-lan 2>/dev/null');
		let txt = (p != null) ? p.read('all') : null;
		if (p != null) p.close();
		if (txt != null) {
			let lines = split(txt, '\n');
			for (let i = 1; i < length(lines); i++) {
				let f = split(trim(lines[i]), /[ \t]+/);
				if (length(f) < 3) continue;
				if (f[2] != 'no') continue;
				let mac = lc(f[1]);
				if (!match(mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
				if (out[mac] != null) continue;   // 关联表已给出频段, 以它为准
				let dev = ports[+f[0]];
				if (dev == null) continue;
				/* 桥里的无线口(ra0 / rax0 之类)换成频段名, 其余直接显示网口名 */
				let name = match(dev, /^(ra|wlan)/) ? band_of(dev) : dev;
				if (length(name)) out[mac] = name;
			}
		}
	} catch (e) { }
	return out;
}

function read_leases() {
	let map = {};
	let txt = null;
	try { txt = fs.readfile(LEASE_PATH); } catch (e) { return map; }
	if (txt == null) return map;
	let lines = split(txt, '\n');
	for (let i = 0; i < length(lines); i++) {
		if (!length(lines[i])) continue;
		let f = split(trim(lines[i]), ' ');
		if (length(f) >= 4) map[lc(f[1])] = { ip: f[2], host: (f[3] != '*') ? f[3] : null };
	}
	return map;
}

/* ---------- IPv6 地址池 ----------
 * 一台设备常有 3~5 个 v6(隐私地址轮换 + ULA + 公网 + 链路本地),
 * 这里把三个来源合并成"地址池", 每个地址记最近活跃时间, 对外只暴露最新的一条。
 *   邻居表            -> 无状态(SLAAC)地址, 带 REACHABLE/STALE 状态
 *   DHCPv6 租约       -> 有状态地址, 打 stateful 标记
 *   conntrack ipv6 行 -> 真正在收发流量的地址, 用来刷新活跃时间
 */
let v6pool = {};        // 归一化地址 -> { disp, mac, t, rank, stateful }
let v6pfx = {};         // LAN 侧 /64 前缀 -> true, 用来判断 HNAT 表项里哪一侧是客户端
let v6learn = {};       // 归一化地址 -> { mac, t }, HNAT 学到的归属(邻居表里没有的临时地址)

const RE_V6CH = /[0-9a-fA-F:]/;

function v6_rank(a) {
	let g = lc(split(a, ':')[0]);
	if (length(g) == 0) return 0;
	if (index(g, 'fe8') == 0 || index(g, 'fe9') == 0 || index(g, 'fea') == 0 || index(g, 'feb') == 0) return 1;
	if (index(g, 'fd') == 0 || index(g, 'fc') == 0) return 2;
	return 3;
}

/* 任意写法(::压缩 / 前导零 / 大写)统一成 8 段小写无前导零, 便于跨源比对 */
function expand6(s) {
	if (s == null || type(s) != 'string') return null;
	let a = lc(trim(s));
	if (!length(a)) return null;
	let pct = index(a, '%');
	if (pct >= 0) a = substr(a, 0, pct);
	if (!match(a, /^[0-9a-f:]+$/)) return null;
	let g = [];
	let dbl = index(a, '::');
	if (dbl >= 0) {
		let h = substr(a, 0, dbl), tl = substr(a, dbl + 2);
		let hp = length(h) ? split(h, ':') : [];
		let tp = length(tl) ? split(tl, ':') : [];
		let fill = 8 - length(hp) - length(tp);
		if (fill < 0) return null;
		for (let i = 0; i < length(hp); i++) push(g, hp[i]);
		for (let i = 0; i < fill; i++) push(g, '0');
		for (let i = 0; i < length(tp); i++) push(g, tp[i]);
	} else {
		g = split(a, ':');
	}
	if (length(g) != 8) return null;
	let out = [];
	for (let i = 0; i < 8; i++) {
		let seg = g[i];
		if (!length(seg)) seg = '0';
		let j = 0;
		while (j < length(seg) - 1 && substr(seg, j, 1) == '0') j++;
		push(out, substr(seg, j));
	}
	return join(':', out);
}

/* 取 /64 前缀(前 4 段), 用于判断一个地址是不是本 LAN 段的 */
function pfx64(a) {
	if (a == null) return null;
	let g = split(a, ':');
	if (length(g) < 4) return null;
	return join(':', [g[0], g[1], g[2], g[3]]);
}

/* 递归收集 JSON 里所有 v6 形态的字符串/键 */
function scan_v6(node, set, depth) {
	if (depth > 8) return;
	let ty = type(node);
	if (ty == 'object') {
		for (let k in node) {
			let nk = expand6(k);
			if (nk != null) set[nk] = true;
			scan_v6(node[k], set, depth + 1);
		}
	} else if (ty == 'array') {
		for (let i = 0; i < length(node); i++) scan_v6(node[i], set, depth + 1);
	} else if (ty == 'string') {
		let nv = expand6(node);
		if (nv != null) set[nv] = true;
	}
}

/* 有状态(DHCPv6)地址集合; 未开 DHCPv6 时返回空表 */
function read_dhcpv6() {
	let set = {};
	let txt = null;
	try {
		let p = fs.popen('ubus -S call dhcp ipv6leases 2>/dev/null');
		if (p != null) { txt = p.read('all'); p.close(); }
	} catch (e) { }
	if (txt != null && length(txt) > 8) {
		try { scan_v6(json(txt), set, 0); } catch (e) { }
	}
	return set;
}

/* 邻居表刷新: 无状态地址入库; 非 STALE(刚确认可达)才推进活跃时间 */
function read_neigh6(t, dhcp6) {
	let txt = null;
	try {
		let p = fs.popen('/sbin/ip -6 neigh show dev br-lan 2>/dev/null');
		if (p == null) return;
		txt = p.read('all');
		p.close();
	} catch (e) { return; }
	if (txt == null || !length(txt)) return;
	let lines = split(txt, '\n');
	for (let i = 0; i < length(lines); i++) {
		let f = split(trim(lines[i]), ' ');
		let out = [];
		for (let j = 0; j < length(f); j++) if (length(f[j])) push(out, f[j]);
		if (length(out) < 3) continue;
		let addr = out[0], mac = null, st = null;
		for (let j = 1; j < length(out); j++) {
			if (out[j] == 'lladdr' && j + 1 < length(out)) { mac = lc(out[j + 1]); j++; continue; }
			if (out[j] == 'REACHABLE' || out[j] == 'STALE' || out[j] == 'DELAY' ||
			    out[j] == 'PROBE' || out[j] == 'FAILED' || out[j] == 'NOARP')
				st = out[j];
		}
		if (st == 'FAILED' || st == 'NOARP') continue;
		if (mac == null || !match(mac, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/)) continue;
		let a = expand6(addr);
		if (a == null) continue;
		let rk = v6_rank(a);
		if (rk < 2) continue;                       // 丢弃 fe80 链路本地
		let e = v6pool[a];
		if (e == null) {
			v6pool[a] = { disp: addr, mac: mac, t: t, rank: rk, stateful: (dhcp6[a] == true) ? 1 : 0 };
		} else {
			e.mac = mac; e.disp = addr; e.rank = rk;
			if (dhcp6[a] == true) e.stateful = 1;
			if (st != 'STALE') e.t = t;
		}
	}
}

/* LAN 段前缀表: br-lan 自己的地址 + 地址池里的客户端地址, 两者的 /64 都是内网段。
 * HNAT 的 v6 表项是纯路由(没有 NAT 段), 只能靠"哪一侧落在内网前缀里"判断客户端是哪一侧,
 * 上行的 smac 是路由器自己、dmac 是上游下一跳, 都不能当客户端 MAC 用。 */
function read_lan6pfx() {
	let txt = null;
	try {
		let p = fs.popen('/sbin/ip -6 addr show dev br-lan 2>/dev/null');
		if (p == null) return;
		txt = p.read('all');
		p.close();
	} catch (e) { return; }
	if (txt != null) {
		let lines = split(txt, '\n');
		for (let i = 0; i < length(lines); i++) {
			let m = match(trim(lines[i]), /^inet6 ([0-9a-fA-F:]+)/);
			if (m == null) continue;
			let a = expand6(m[1]);
			if (a == null || v6_rank(a) < 2) continue;      // 跳过 fe80
			v6pfx[pfx64(a)] = true;
		}
	}
	for (let a in v6pool) {
		let e = v6pool[a];
		if (e.mac != null) v6pfx[pfx64(a)] = true;
	}
}

/* conntrack 里出现 = 真正在用, 刷新活跃时间 */
function touch_v6(line, t) {
	let pos = 0;
	for (let n = 0; n < 4; n++) {
		let i = index(substr(line, pos), 'src=');
		if (i < 0) break;
		let s = pos + i + 4, e = s;
		while (e < length(line) && match(substr(line, e, 1), RE_V6CH)) e++;
		let a = expand6(substr(line, s, e - s));
		if (a != null) { let en = v6pool[a]; if (en != null) en.t = t; }
		pos = e;
	}
}

/* 取该设备"最新"的一条 v6: 活跃时间 > 公网/ULA 优先 > 有状态优先 */
function pick6(mac) {
	if (mac == null) return null;
	let best = null;
	for (let a in v6pool) {
		let e = v6pool[a];
		if (e.mac != mac) continue;
		if (best == null) { best = e; continue; }
		if (e.t != best.t) { if (e.t > best.t) best = e; continue; }
		if (e.rank != best.rank) { if (e.rank > best.rank) best = e; continue; }
		if (e.stateful > best.stateful) best = e;
	}
	return (best != null) ? best.disp : null;
}

let base = {};           // 源条目基线: id -> {u,d,b,at}
let clients = {};        // mac 或 ip:addr -> record
let wan_hours = {};      // 全 WAN 每小时流量: hour -> [up, down]
let wan_day_up = 0;      // 全 WAN 当天累计(跨天时归档到 archive)
let wan_day_down = 0;
let archive = {};        // "YYYY-MM-DD" -> [up, down], 保留 30 天
let day = daykey(now());
let tick = 0;
let prev_ts = now();
let hnat_ok = true;

function flow_id(proto, cip, cport, rip, rport) {
	return proto + '|' + cip + '|' + cport + '|' + rip + '|' + rport;
}

const RE_CT = /^\s*ipv4\s+\d+\s+(\w+)\s+\d+\s+\d+\s+\w+\s+src=([0-9.]+) dst=([0-9.]+) sport=(\d+) dport=(\d+) packets=\d+ bytes=(\d+).*src=([0-9.]+) dst=([0-9.]+) sport=(\d+) dport=(\d+) packets=\d+ bytes=(\d+)/;
const PROTO_MAP = { tcp: '6', udp: '17', icmp: '1', sctp: '132' };

/* ---------- IPv6 流量 ----------
 * 两个源: conntrack(软件路径) + HNAT 的 IPV6_5T_ROUTE 条目(硬件快通道)。
 * **两者必须都读**: 实测一条 3MB 的 v6 下载, conntrack 只记到 44KB(握手+未卸载的那几包),
 * 卸载后的字节全在 HNAT 表项的 bytes= 计数里; 只读 conntrack 会少算 95% 以上。
 * 一条 ipv6 conntrack 记录有两段(去/回), 格式比 ipv4 多 tos=/[UNREPLIED], 且没有固定分隔符,
 * 按 token 出现顺序解析: 每遇到 src= 开一段, 其后的 dst/sport/dport/bytes 归该段。
 * 归属: conntrack 行里没有 MAC, 用邻居表维护的 v6pool(地址 -> mac) 反查; HNAT 行同理。
 */
function parse_ct6(line) {
	let toks = split(trim(line), /[ \t]+/);
	let out = [], cur = null;
	for (let i = 0; i < length(toks); i++) {
		let t = toks[i];
		if (index(t, 'src=') == 0) {
			cur = { src: substr(t, 4), bytes: 0 };
			push(out, cur);
			continue;
		}
		if (cur == null) continue;
		if (index(t, 'dst=') == 0) cur.dst = substr(t, 4);
		else if (index(t, 'sport=') == 0) cur.sport = substr(t, 6);
		else if (index(t, 'dport=') == 0) cur.dport = substr(t, 6);
		else if (index(t, 'bytes=') == 0) cur.bytes = +substr(t, 6);
	}
	return out;
}

/* 增量累加到 cur6[mac] = { up, down }; 基线 id 用 (mac, 对端, 两端端口) 而非地址,
 * 设备隐私地址轮换时同一条流的累计值不会被重复计入。
 * seen6[id] = mac: 顺带记下本次 tick 出现过的 v6 连接(一个 conntrack 条目含去/回
 * 两段, 只算一条), 供「连接数」列的 v6 行使用 —— 与流量增量无关, 0 字节的新连接也算。 */
function sample_ct6(line, cur6, t, seen6) {
	let d = parse_ct6(line);
	if (length(d) < 2) return;
	let a1 = expand6(d[0].src), a2 = expand6(d[1].src);
	let e1 = (a1 != null) ? v6pool[a1] : null;
	let e2 = (a2 != null) ? v6pool[a2] : null;
	let mac = null, first = false;
	if (e1 != null && e1.mac != null) { mac = e1.mac; first = true; }
	else if (e2 != null && e2.mac != null) { mac = e2.mac; }
	if (mac == null) return;
	/* 客户端在发起侧 -> 第一段字节是上行; 客户端在响应侧 -> 反过来 */
	let up = first ? d[0].bytes : d[1].bytes;
	let dn = first ? d[1].bytes : d[0].bytes;
	let peer = first ? a2 : a1;
	let id = 'c6|' + mac + '|' + peer + '|'
		+ (first ? d[0].sport : d[1].sport) + '|' + (first ? d[0].dport : d[1].dport);
	if (seen6 != null) seen6[id] = mac;
	let p = base[id];
	let du = 0, dd = 0;
	if (p != null) {
		du = (up > p.u) ? up - p.u : 0;
		dd = (dn > p.d) ? dn - p.d : 0;
	}
	else if (tick > 1) {
		/* v6 没有快通道兜底, 短连接(一个 tick 内就结束)只出现一次:
		 * 若首见只建基线, 这类 flow 会被整条漏掉。启动后头两个 tick 例外
		 * (conntrack 里已有的老流会一次性全量计入, 造成今日流量尖峰)。 */
		du = up;
		dd = dn;
	}
	base[id] = { u: up, d: dn, at: t };
	if (du == 0 && dd == 0) return;
	let f = cur6[mac];
	if (f == null) { f = { up: 0, down: 0 }; cur6[mac] = f; }
	f.up += du; f.down += dd;
}

/* cur: flowkey -> {up,down,ip,mac}   本次 tick 的增量汇总 */
function sample_ct(cur, seen, t, cur6, seen6) {
	let txt = null;
	try { txt = fs.readfile(CT_PATH); } catch (e) { return; }
	if (txt == null) return;
	let lines = split(txt, '\n');
	for (let i = 0; i < length(lines); i++) {
		if (index(lines[i], 'ipv6') == 0) {
			touch_v6(lines[i], t);
			if (cur6 != null) sample_ct6(lines[i], cur6, t, seen6);
			continue;
		}
		let m = match(lines[i], RE_CT);
		if (m == null) continue;
		let proto = PROTO_MAP[m[1]];
		if (proto == null) continue;
		let s1 = m[2], d1 = m[3], sp1 = m[4], dp1 = m[5], b1 = +m[6];
		let b2 = +m[11];
		let k = null, cip = null, up = b1, dn = b2;
		if (is_lan(s1)) { k = flow_id(proto, s1, sp1, d1, dp1); cip = s1; }
		else if (is_lan(d1)) { k = flow_id(proto, d1, dp1, s1, sp1); cip = d1; up = b2; dn = b1; }
		if (k == null) continue;
		seen[k] = { ip: cip, mac: null };
		let id = 'c' + k;
		let p = base[id];
		let du = 0, dd = 0;
		if (p != null) {
			du = (up > p.u) ? up - p.u : 0;
			dd = (dn > p.d) ? dn - p.d : 0;
		}
		base[id] = { u: up, d: dn, at: t };
		if (du == 0 && dd == 0) continue;
		let f = cur[k];
		if (f == null) { f = { up: 0, down: 0, ip: cip, mac: null }; cur[k] = f; }
		f.up += du; f.down += dd;
	}
}

const RE_TUPLE = /SIP=([0-9.]+)\(sp=([0-9]+)\)->DIP=([0-9.]+)\(dp=([0-9]+)\)=>NSIP=([0-9.]+)\(sp=([0-9]+)\)->NDIP=([0-9.]+)\(dp=([0-9]+)\)/;
/* IPv6 是纯路由(IPV6_5T_ROUTE), 没有 =>NSIP 这段 NAT 信息 */
const RE_TUPLE6 = /SIP=([0-9a-fA-F:]+)\(sp=([0-9]+)\)->DIP=([0-9a-fA-F:]+)\(dp=([0-9]+)\)/;
const RE_MAC = /^([0-9a-fA-F:]+)->([0-9a-fA-F:]+)$/;

/* HNAT 里的 v6 地址是「4 组 8 位十六进制」: 24098a20:5263cab4:dc6b16e2:14204c91
 * 先拼回 32 位再切成 8 组, 最后交给 expand6 归一化(去前导零/小写),
 * 才能和 v6pool(邻居表建的地址 -> mac)的 key 对上 */
function hex32(s) {
	let parts = split(s, ':');
	let h = '';
	for (let i = 0; i < length(parts); i++) h += parts[i];
	if (length(h) != 32) return null;
	let g = [];
	for (let i = 0; i < 32; i += 4) push(g, substr(h, i, 4));
	return expand6(join(':', g));
}

/* 与 IPv4 同思路: 逐「源条目 + 槽位号」求增量, 避免槽位回收导致同一累计值被反复计入。
 * 归属: 先按 /64 前缀定位客户端是哪一侧, 再取 MAC
 *   v6pool(邻居表/租约) -> v6learn(HNAT 学到的) -> 下行表项的 dmac
 * 后两者才能把「邻居表里没有的临时地址」统计进来: Windows/macOS 会轮换隐私地址,
 * 邻居表经常只留其中一两个, 只靠地址反查会漏掉一半流量
 * (实测 48MB 只统计到 21MB, 差的就是用完就丢的临时地址)。 */
function sample_hnat6(line, cur6, t) {
	if (cur6 == null) return;
	let b = match(line, /^bytes=([0-9]+)/);
	if (b == null) return;
	let bytes = +b[1];
	let p = split(line, '|');
	let proto = field(p, 'prot');
	let idx = field(p, 'index');
	let tpl = match(line, RE_TUPLE6);
	if (tpl == null || proto == null) return;
	let a1 = hex32(tpl[1]), a2 = hex32(tpl[3]);
	if (a1 == null || a2 == null) return;

	/* 哪一侧是内网客户端: 先用 /64 前缀判断, 网络侧地址不会落在 LAN 前缀里。
	 * 判不出来(客户端刚换地址、前缀表还没建立)再退回地址池反查。 */
	let c6 = null, up = false;
	let l1 = (v6pfx[pfx64(a1)] == true), l2 = (v6pfx[pfx64(a2)] == true);
	if (l1 && !l2) { c6 = a1; up = true; }
	else if (l2 && !l1) { c6 = a2; up = false; }
	if (c6 == null) {
		let e1 = v6pool[a1], e2 = v6pool[a2];
		if (e1 != null && e1.mac != null) { c6 = a1; up = true; }
		else if (e2 != null && e2.mac != null) { c6 = a2; up = false; }
		else if (v6learn[a1] != null) { c6 = a1; up = true; }
		else if (v6learn[a2] != null) { c6 = a2; up = false; }
		else return;
	}

	let smac = null, dmac = null;
	let macf = field(p, 'smac');
	if (macf != null) {
		let mm = match(macf, RE_MAC);
		if (mm != null) { smac = lc(mm[1]); dmac = lc(mm[2]); }
	}
	if (smac == '00:00:00:00:00:00') smac = null;
	if (dmac == '00:00:00:00:00:00') dmac = null;

	let mac = null;
	let pe = v6pool[c6];
	if (pe != null && pe.mac != null) mac = pe.mac;
	if (mac == null && v6learn[c6] != null) mac = v6learn[c6].mac;
	if (mac == null) {
		/* 只有下行表项的 dmac 才是客户端网卡; 上行表项的 dmac 是上游下一跳, 学了会造出假设备 */
		if (!up && dmac != null && dmac != LAN_MAC1 && dmac != LAN_MAC2) mac = dmac;
		else return;
	}
	if (mac == LAN_MAC1 || mac == LAN_MAC2) return;

	/* 「地址 -> MAC」学习缓存: 邻居表里没有的临时隐私地址靠它归位,
	 * 也让同一个流的上行条目(地址相同、表项里没有客户端 MAC)能算进来 */
	let le = v6learn[c6];
	if (le == null || le.mac != mac) v6learn[c6] = { mac: mac, t: t };
	else le.t = t;

	/* 客户端在 SIP -> 这条计上行; 在 DIP -> 计下行。key 用「槽位号 + 客户端 + 对端」 */
	let ra = up ? a2 : a1, rp = up ? tpl[4] : tpl[2];
	let key = 'h6|' + (idx != null ? idx : '?') + '|' + mac + '|' + ra + '|' + rp;
	let pr = base[key];
	let d = 0;
	if (pr != null) d = (bytes > pr.b) ? bytes - pr.b : 0;
	/* 首见只建基线, 不把 bytes 全量计入: HNAT 槽位会被复用, 新表项一出现就可能带着
	 * 上一条流的旧累计值(实测新条目 45KB 而实际只下了 3.9KB), 全量计入会造成数倍虚高。
	 * 代价是流建立后第一个 tick 的字节不算, 与 IPv4 路径行为一致。
	 * 卸载前的那几包 conntrack 已经记过, 短流不会整条丢失。 */
	base[key] = { b: bytes, at: t };
	if (d == 0) return;
	let f = cur6[mac];
	if (f == null) { f = { up: 0, down: 0 }; cur6[mac] = f; }
	if (up) f.up += d; else f.down += d;
}

function sample_hnat(cur, seen, t, cur6) {
	let txt = null;
	try { txt = fs.readfile(HNAT_PATH); hnat_ok = true; }
	catch (e) { hnat_ok = false; return; }
	if (txt == null) { hnat_ok = false; return; }

	let lines = split(txt, '\n');
	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (!length(line)) continue;
		if (index(line, 'IPV6_') >= 0) { sample_hnat6(line, cur6, t); continue; }
		if (index(line, 'IPV4_') < 0) continue;
		let b = match(line, /^bytes=([0-9]+)/);
		if (b == null) continue;
		let bytes = +b[1];
		let p = split(line, '|');
		let proto = field(p, 'prot');
		let idx = field(p, 'index');
		let tpl = match(line, RE_TUPLE);
		if (tpl == null || proto == null) continue;
		let sip = tpl[1], sp = tpl[2], dip = tpl[3], dp = tpl[4], ndip = tpl[7], ndp = tpl[8];
		let smac = null, dmac = null;
		let macf = field(p, 'smac');
		if (macf != null) {
			let mm = match(macf, RE_MAC);
			if (mm != null) { smac = lc(mm[1]); dmac = lc(mm[2]); }
		}
		let k = null, dir = null, cip = null, cmac = null;
		if (is_lan(sip)) { k = flow_id(proto, sip, sp, dip, dp); dir = 'up'; cip = sip; cmac = smac; }
		else if (is_lan(ndip)) { k = flow_id(proto, ndip, ndp, sip, sp); dir = 'down'; cip = ndip; cmac = dmac; }
		if (k == null) continue;

		if (seen[k] == null) seen[k] = { ip: cip, mac: cmac };
		else if (seen[k].mac == null) seen[k].mac = cmac;

		/* 槽位号参与 id: 同一流可能同时存在多个快通道条目, 各自独立计数 */
		let id = 'h' + (idx != null ? idx : '?') + '|' + k;
		let pr = base[id];
		let d = 0;
		if (pr != null) d = (bytes > pr.b) ? bytes - pr.b : 0;
		base[id] = { b: bytes, at: t };
		if (d == 0) continue;
		let f = cur[k];
		if (f == null) { f = { up: 0, down: 0, ip: cip, mac: cmac }; cur[k] = f; }
		if (dir == 'up') f.up += d; else f.down += d;
		if (cmac != null && f.mac == null) f.mac = cmac;
	}
}

function load_state() {
	let st = null;
	try { st = json(fs.readfile(STATE_PATH)); } catch (e) { return; }
	if (st == null || type(st) != 'object') return;
	if (type(st.archive) == 'object') archive = st.archive;
	if (st.day != day || type(st.clients) != 'object') {
		/* 跨天(或旧格式): 昨天还没归档的累计补进 archive */
		if (st.day != null && ((+st.wan_up || 0) > 0 || (+st.wan_down || 0) > 0))
			archive[st.day] = [+st.wan_up || 0, +st.wan_down || 0];
		return;
	}
	if (type(st.wan_hours) == 'object') wan_hours = st.wan_hours;
	wan_day_up = +st.wan_up || 0;
	wan_day_down = +st.wan_down || 0;
	if (wan_day_up == 0 && wan_day_down == 0) {
		/* 旧版 state 没有日累计字段: 用小时桶求和兜底, 保证 daily 与曲线一致 */
		for (let h in wan_hours) {
			let e = wan_hours[h];
			if (type(e) == 'array') { wan_day_up += e[0]; wan_day_down += e[1]; }
		}
	}
	for (let k in st.clients) {
		let c = st.clients[k];
		if (c.mac == null && c.ip == ROUTER_IP) continue;   // 路由器自身不入账
		clients[k] = {
			mac: c.mac, ip: c.ip, host: c.host, ip6: c.ip6,
			up_today: +c.up_today || 0, down_today: +c.down_today || 0,
			up6_today: +c.up6_today || 0, down6_today: +c.down6_today || 0,
			hours: (type(c.hours) == 'object') ? c.hours : {},
			first_seen: +c.first_seen || now(), last_seen: +c.last_seen || 0,
			up_rate: 0, down_rate: 0, up6_rate: 0, down6_rate: 0, conn: 0, rssi: null
		};
	}
}

function save_state() {
	let out = { day: day, saved: now(), wan_hours: wan_hours,
		wan_up: wan_day_up, wan_down: wan_day_down, archive: archive, clients: {} };
	let cut = now() - KEEP_DAYS * 86400;
	for (let k in clients) {
		let c = clients[k];
		let ref_t = (c.last_seen > 0) ? c.last_seen : c.first_seen;
		if (ref_t > 0 && ref_t < cut) continue;
		out.clients[k] = { mac: c.mac, ip: c.ip, host: c.host, ip6: c.ip6,
			up_today: c.up_today, down_today: c.down_today,
			up6_today: c.up6_today, down6_today: c.down6_today,
			hours: c.hours, first_seen: c.first_seen, last_seen: c.last_seen };
	}
	try { fs.mkdir(STATE_DIR, 0755); } catch (e) { }
	try {
		fs.writefile(STATE_PATH + '.tmp', sprintf('%J', out));
		fs.rename(STATE_PATH + '.tmp', STATE_PATH);
	} catch (e) { }
}

function client_key(mac, ip) {
	return (mac != null && mac != '') ? mac : ('ip:' + ip);
}

/* 每小时流量桶: bucket["7"] = [up, down] */
function add_hour(bucket, h, up, down) {
	let k = sprintf('%d', h);
	let e = bucket[k];
	if (e == null) { e = [0, 0]; bucket[k] = e; }
	e[0] += up;
	e[1] += down;
}

function client_for(mac, ip, leases) {
	let key = client_key(mac, ip);
	let c = clients[key];

	if (c == null && mac != null) {
		let old = clients['ip:' + ip];
		if (old != null) {
			clients[key] = old;
			old.mac = mac;
			delete clients['ip:' + ip];
			c = old;
		}
	}

	if (c == null) {
		c = { mac: mac, ip: ip, host: null, ip6: null, up_today: 0, down_today: 0,
		      up6_today: 0, down6_today: 0,
		      hours: {}, first_seen: now(), last_seen: 0,
		      up_rate: 0, down_rate: 0, up6_rate: 0, down6_rate: 0, conn: 0, rssi: null };
		clients[key] = c;
	}
	if (ip != null) c.ip = ip;
	if (mac != null) {
		c.mac = mac;
		let v6 = pick6(mac);
		if (v6 != null) c.ip6 = v6;
	}
	if (c.mac != null && leases[c.mac] != null && leases[c.mac].host != null)
		c.host = leases[c.mac].host;
	return { key: key, c: c };
}

function run() {
	let arp = read_arp();
	let leases = read_leases();
	let t = now(), dt = t - prev_ts;
	if (dt <= 0) dt = 1;

	if (tick % NEIGH_EVERY == 0) {
		read_neigh6(t, read_dhcpv6());
		for (let a in v6pool)
			if ((t - v6pool[a].t) > V6_TTL) delete v6pool[a];
		read_lan6pfx();
		for (let a in v6learn)
			if ((t - v6learn[a].t) > V6_TTL) delete v6learn[a];
	}
	if (tick % RSSI_EVERY == 0) { rssi = read_rssi(); links = read_links(); }

	let cur = {}, seen = {}, cur6 = {}, seen6 = {};
	sample_ct(cur, seen, t, cur6, seen6);
	sample_hnat(cur, seen, t, cur6);

	/* 连接数: 本 tick 出现过的流(两源并集)归到设备 */
	let fcount = {};
	for (let k in seen) {
		let s = seen[k];
		let mac = (arp[s.ip] != null) ? arp[s.ip] : s.mac;
		if (mac != null && (mac == LAN_MAC1 || mac == LAN_MAC2)) mac = null;
		if (mac == null && s.ip == ROUTER_IP) continue;
		let rec = client_for(mac, s.ip, leases);
		let n = fcount[rec.key];
		fcount[rec.key] = (n != null) ? n + 1 : 1;
	}

	/* v6 连接数: 一个 conntrack ipv6 条目算一条, 按 v6pool 反查出的 mac 归集。
	 * 设备记录的 key 在 mac 已知时就是 mac, 所以下面能直接用 clients 的 key 取 */
	let fcount6 = {};
	for (let id in seen6) {
		let mac = seen6[id];
		if (mac == null || mac == LAN_MAC1 || mac == LAN_MAC2) continue;
		let n = fcount6[mac];
		fcount6[mac] = (n != null) ? n + 1 : 1;
	}

	/* 流量增量归到设备 */
	let hh = hour_of(t);
	let seen_bw = {};
	for (let k in cur) {
		let f = cur[k];
		let mac = (arp[f.ip] != null) ? arp[f.ip] : f.mac;
		if (mac != null && (mac == LAN_MAC1 || mac == LAN_MAC2)) mac = null;
		if (mac == null && f.ip == ROUTER_IP) continue;
		let rec = client_for(mac, f.ip, leases);
		let c = rec.c;
		c.up_today += f.up;
		c.down_today += f.down;
		add_hour(c.hours, hh, f.up, f.down);
		add_hour(wan_hours, hh, f.up, f.down);
		wan_day_up += f.up;
		wan_day_down += f.down;
		c.last_seen = t;
		if (seen_bw[rec.key] == null) seen_bw[rec.key] = [0, 0];
		seen_bw[rec.key][0] += f.up;
		seen_bw[rec.key][1] += f.down;
	}

	/* v6 流量: 已按 mac 归好, 直接并入设备总量; 单独另记 up6/down6 供「IPv6 行」显示。
	 * 设备总量(今日/小时桶/WAN 总量)计入 v6, 「今日流量」才是这台机器真实跑的字节数 */
	let seen_bw6 = {};
	for (let mac in cur6) {
		if (mac == LAN_MAC1 || mac == LAN_MAC2) continue;
		let f = cur6[mac];
		let c = clients[mac];
		if (c == null) {
			c = { mac: mac, ip: null, host: null, ip6: pick6(mac),
			      up_today: 0, down_today: 0, up6_today: 0, down6_today: 0,
			      hours: {}, first_seen: t, last_seen: 0,
			      up_rate: 0, down_rate: 0, up6_rate: 0, down6_rate: 0, conn: 0, rssi: null };
			clients[mac] = c;
		}
		c.up_today += f.up;
		c.down_today += f.down;
		c.up6_today += f.up;
		c.down6_today += f.down;
		add_hour(c.hours, hh, f.up, f.down);
		add_hour(wan_hours, hh, f.up, f.down);
		wan_day_up += f.up;
		wan_day_down += f.down;
		c.last_seen = t;
		seen_bw6[mac] = [f.up, f.down];
	}

	/* ARP 在册说明近期有 L2 活动: 没流量的设备也建记录(0 速率), 已存在的续期 */
	for (let ip in arp) {
		if (ip == ROUTER_IP) continue;
		let mac = arp[ip];
		if (mac == LAN_MAC1 || mac == LAN_MAC2) continue;
		let key = client_key(mac, ip);
		let c = clients[key];
		if (c == null) {
			c = client_for(mac, ip, leases).c;
			c.last_seen = t;
			continue;
		}
		if ((t - c.last_seen) <= 600) c.last_seen = t;
	}

	let tick_up = 0, tick_dn = 0;
	for (let k in seen_bw) { tick_up += seen_bw[k][0]; tick_dn += seen_bw[k][1]; }

	/* v6 只留最新一条 + 无线信号强度, 与设备记录对齐 */
	for (let k in clients) {
		let c = clients[k];
		if (c.mac == null) { c.rssi = null; continue; }
		let v6 = pick6(c.mac);
		if (v6 != null) c.ip6 = v6;
		c.rssi = (rssi[c.mac] != null) ? rssi[c.mac] : null;
	}

	let tot_up = 0, tot_dn = 0, tot_up6 = 0, tot_dn6 = 0;
	let list = [], online = 0, hidden = 0;
	for (let k in clients) {
		let c = clients[k];
		let s = seen_bw[k] || [0, 0];
		let s6 = seen_bw6[k] || [0, 0];
		c.up_rate = c.up_rate * (1 - RATE_ALPHA) + (s[0] / dt) * RATE_ALPHA;
		c.down_rate = c.down_rate * (1 - RATE_ALPHA) + (s[1] / dt) * RATE_ALPHA;
		c.up6_rate = c.up6_rate * (1 - RATE_ALPHA) + (s6[0] / dt) * RATE_ALPHA;
		c.down6_rate = c.down6_rate * (1 - RATE_ALPHA) + (s6[1] / dt) * RATE_ALPHA;
		if (c.up_rate < 1) c.up_rate = 0;
		if (c.down_rate < 1) c.down_rate = 0;
		if (c.up6_rate < 1) c.up6_rate = 0;
		if (c.down6_rate < 1) c.down6_rate = 0;
		c.conn = fcount[k] || 0;
		c.conn6 = fcount6[k] || 0;
		tot_up += c.up_rate + c.up6_rate; tot_dn += c.down_rate + c.down6_rate;
		tot_up6 += c.up6_rate; tot_dn6 += c.down6_rate;
		let on = ((t - c.last_seen) <= ONLINE_WIN);
		if (on) online++;
		/* 离线且超过 24h 没出现的设备不再输出:
		 * last_seen 为 0 时(旧版 state 没存该字段 / 本轮还没观测到)退回 first_seen 判断,
		 * 避免升级后把今天才出现过的设备一次性全部隐藏 */
		let ref_t = (c.last_seen > 0) ? c.last_seen : c.first_seen;
		if (!on && (t - ref_t) > OFFLINE_WIN) {
			hidden++;
			continue;
		}
		push(list, {
			mac: c.mac, ip: c.ip, ip6: c.ip6, host: c.host,
			up: int(c.up_rate), down: int(c.down_rate),
			up6: int(c.up6_rate), down6: int(c.down6_rate),
			up_today: int(c.up_today), down_today: int(c.down_today),
			up6_today: int(c.up6_today), down6_today: int(c.down6_today),
			hours: ((t - c.last_seen) <= 43200) ? c.hours : {},
			conn: c.conn, conn6: c.conn6 || 0, rssi: c.rssi,
			link: (c.mac != null) ? (links[c.mac] ?? null) : null,
			rate: (c.mac != null && rates[c.mac] != null) ? rates[c.mac] : null,
			last_seen: int(c.last_seen), first_seen: int(c.first_seen),
			online: on
		});
	}
	sort(list, function(a, b) {
		if (a.online != b.online) return a.online ? -1 : 1;
		return (b.up + b.down + b.up6 + b.down6) - (a.up + a.down + a.up6 + a.down6);
	});

	/* 今日总量: v4+v6 合计(设备行也是这个口径); 另给 v6 分量,
	 * 前端用「总量 − v6」得到 v4, 三个数字才能互相自洽 */
	let up_today = 0, down_today = 0, up6_today = 0, down6_today = 0;
	for (let k in clients) {
		up_today += clients[k].up_today; down_today += clients[k].down_today;
		up6_today += clients[k].up6_today; down6_today += clients[k].down6_today;
	}

	/* 最近 30 天每日总量(archive) + 今天 */
	let daily = [];
	let dkeys = [];
	for (let k in archive) push(dkeys, k);
	sort(dkeys);
	for (let i = 0; i < length(dkeys); i++) {
		let e = archive[dkeys[i]];
		push(daily, { d: dkeys[i], up: int(e[0]), down: int(e[1]) });
	}
	if (wan_day_up > 0 || wan_day_down > 0)
		push(daily, { d: day, up: int(wan_day_up), down: int(wan_day_down) });

	let out = {
		ts: t, day: day, interval: dt, hnat: hnat_ok, lan: LAN,
		wan: { up: int(tot_up), down: int(tot_dn), up_today: int(up_today),
		       down_today: int(down_today), hours: wan_hours, daily: daily,
		       up6: int(tot_up6), down6: int(tot_dn6),
		       up6_today: int(up6_today), down6_today: int(down6_today) },
		sec: { up: int(tick_up), down: int(tick_dn) },
		online: online, total: length(list), hidden: hidden,
		clients: slice(list, 0, 128)
	};
	try {
		fs.writefile(OUT_PATH + '.tmp', sprintf('%J', out));
		fs.rename(OUT_PATH + '.tmp', OUT_PATH);
	} catch (e) { warn('write failed: ' + e); }

	/* 基线清理 */
	for (let k in base)
		if (base[k].at > 0 && (t - base[k].at) > KEEP_BASE) delete base[k];

	prev_ts = t;
	tick++;

	if (day != daykey(t)) {
		archive[day] = [int(wan_day_up), int(wan_day_down)];
		let ks = [];
		for (let k in archive) push(ks, k);
		sort(ks);
		while (length(ks) > 30) { delete archive[ks[0]]; shift(ks); }
		day = daykey(t);
		wan_day_up = 0;
		wan_day_down = 0;
		wan_hours = {};
		for (let k in clients) {
			clients[k].up_today = 0; clients[k].down_today = 0;
			clients[k].up6_today = 0; clients[k].down6_today = 0;
			clients[k].hours = {};
		}
	}
	if (tick % SAVE_EVERY == 0) save_state();
}

load_state();

/* 小时桶是后来才加的: 若与当天累计对不上(旧 state), 把差额记到当前小时,
   保证「今日流量 / 24 小时图 / 近 30 天」三个数字互相自洽。 */
function calibrate_hours() {
	let tu = 0, td = 0;
	for (let k in clients) { tu += clients[k].up_today; td += clients[k].down_today; }
	let hu = 0, hd = 0;
	for (let h in wan_hours) {
		let e = wan_hours[h];
		if (type(e) == 'array') { hu += e[0]; hd += e[1]; }
	}
	if (tu > hu + 1048576 || td > hd + 1048576) {
		add_hour(wan_hours, hour_of(now()), tu - hu, td - hd);
		wan_day_up = tu;
		wan_day_down = td;
		warn(sprintf('client-rates: hours 校准 +%d/+%d', tu - hu, td - hd));
	}
}
try { calibrate_hours(); } catch (e) { }

prev_ts = now();
warn('client-rates: started, lan=' + LAN + ' router=' + ROUTER_IP);

/* 注意: 本固件的 ucode sleep(n) 单位是「毫秒」而非秒,
   写成 sleep(INTERVAL) 会变成 sleep(1ms) -> 空转跑满一个核。 */
const TICK_MS = INTERVAL * 1000;

/* clock(true) 返回 [秒, 纳秒], 转成毫秒 */
function clock_ms() {
	let c = clock(true);
	return c[0] * 1000 + int(c[1] / 1000000);
}

while (true) {
	let t0 = clock_ms();
	try { run(); } catch (e) { warn('client-rates tick error: ' + e); }
	/* 扣掉本轮计算耗时, 让上报周期稳定为 INTERVAL 秒 */
	let wait = TICK_MS - (clock_ms() - t0);
	if (wait < TICK_MS / 4) wait = TICK_MS / 4;
	sleep(wait);
}
