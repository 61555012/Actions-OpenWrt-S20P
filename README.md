**English** | [中文](https://p3terx.com/archives/build-openwrt-with-github-actions.html)

# Actions-OpenWrt

[![LICENSE](https://img.shields.io/github/license/mashape/apistatus.svg?style=flat-square&label=LICENSE)](https://github.com/P3TERX/Actions-OpenWrt/blob/master/LICENSE)
![GitHub Stars](https://img.shields.io/github/stars/P3TERX/Actions-OpenWrt.svg?style=flat-square&label=Stars&logo=github)
![GitHub Forks](https://img.shields.io/github/forks/P3TERX/Actions-OpenWrt.svg?style=flat-square&label=Forks&logo=github)

A template for building OpenWrt with GitHub Actions

## S20P 固件编译 (本项目)

针对 **Super Gateway S20P** (mediatek / filogic, MT7986A) 的云编译：

| 版本 | 工作流 | 源码 | 分支 | 设备 | 关键特性 |
|------|--------|------|------|------|----------|
| **25.12** | `s20p-25.12-chasey.yml` | chasey-dev/immortalwrt-mt798x-rebase | `25.12` | `clx_s20p` | 闭源 MTK WiFi + HNAT/WARP、OAF 识别内核（用户列表插件）、首页 CPU 实时采样 |

目录约定：

```
configs/25.12/s20p-chasey-25.12.config   # 25.12 配置 (clx_s20p)
diy/25.12/diy-part{1,2}.sh               # 25.12 DIY
files/                                   # 公共文件, 构建时合并进固件 /files
```

说明：
- 根目录 `files/` 合并进固件。
- **自研「状态 → 用户列表 / 设备详情」插件**（`files/` 内，替代原 OpenAppFilter 的 LuCI 界面）：
  - Go 采样器 `/usr/sbin/oaf-flowd`：netlink 订阅 conntrack 销毁事件 + 自适应周期采样（有人看页面 1s / 有流量 3s / 空闲 10s），单次采样约 3.5 ms（50 流级表），常驻 RSS 约 7 MB；日/月/小时/APP 分账落 `/etc/oaf/data/`（重启不丢），tmpfs 快照供页面轮询；APP 识别来自 oaf.ko 写入的 conntrack 标记，APP 时长按「活跃口径」统计（心跳/挂机连接不计时长）。
  - Lua 后端 `oaf_status_users.lua`（菜单 + API）+ `oaf_traffic.lua`（V4/V6 合并）+ `oaf_app_names.lua`（内置 appid → 中文名）；前端两个页面（列表 / 详情）自带 echarts、jquery、562 个应用图标（`oaf_status/app_icons/`）。
  - **OUI 品牌识别**：`www/luci-static/resources/oui/` 内置 IEEE 前缀表（`vendors-*.json`）+ 品牌 logo，设备头像按 MAC 前缀/品牌词认品牌，随机 MAC 退化按手机处理。
  - 原 OpenAppFilter 的 `luci-app-oaf` 界面已删除（diy 脚本里 `rm -rf package/OpenAppFilter/luci-app-oaf`），仅保留 `oaf` 内核模块与 `open-app-filter`（oafd + 特征库）作为识别数据源。
  - `etc/uci-defaults/99-oaf-status-defaults`：oaf-flowd 默认开机自启；**「网络 → 网络加速」默认启用 MediaTek HNAT 引擎并打开「HNAT 连接计数更新」**（`fastpath_mh_update_nfct=1`，HNAT 卸载后 conntrack 计数默认冻结，不开启流量统计会少算 95% 以上）。
- **argon 主题统一拉取 jerrykuku/luci-theme-argon `v3.1.1`**（v3 起设置页已并入主题包），构建前会清掉源码/feeds 里自带的旧版，避免同名包冲突。
  - 默认值：登录页样式 `居中卡片(centered)`、壁纸来源 `Bing`（同时改 `/etc/config/argon` 与 `uci-defaults`）。
  - 主题 `cascade.css` 只在构建时追加**防火墙「区域」表格**的排版修正（徽标被拉成整列宽色条、顶到单元格边缘），带 `==== s20p:` 标记幂等。
- **首页为 LuCI 原版**：不改端口状态卡片尺寸、不删「无线」区块、不动 DHCP 租约区块，也不注入自定义概览卡片。
- **首页 CPU 占用改为实时采样**（`files/` 覆盖上游两个文件，与 Actions-OpenWrt-ponwrt 同一实现）：
  - 上游 `luci.getCPUUsage` 是 `top -n1 | awk '/^CPU/ {printf("%d%", 100 - $8)}'`，单次运行窗口只有约 0.1 秒，而 **fork `top` + ubus 往返本身**就要吃掉其中一部分，所以空闲时也恒定显示 3~5%，既不归零也不随负载变化。
  - 改为 `/proc/stat` 增量差分：跨两次调用（前端 3 秒轮询）取差值，再从 busy 里**扣掉 rpcd 处理该 RPC 自身消耗的** `utime+stime+cutime+cstime`（`/proc/self/stat`，ucode 方法在 rpcd 进程内执行），不扣就会被测量动作顶成 1~2% 的固定读数。
  - 超过 10 秒无调用（关掉页面再打开）丢弃缓存，退化为 200ms 短采样，保证首屏是当前值而不是长期平均。
  - 前端 `10_system.js` 用 `poll.add(fn, 3)` 只更新 `CPU usage (%)` 那一格；回调先查 `el.isConnected` / `el.offsetParent` / `document.hidden`，页面不可见就不发 RPC。
  - 页面只显示纯百分比（`0%`），不带 `CPU:` 前缀。实测 4 核：空闲 `0%`，1/2/3/4 核满载 `25% / 50% / 75% / 100%`。
  - 编译前工作流会校验这两个文件存在、是实时采样版本、无额外前缀、且带轮询与可见性判断。
- **mosdns 已移除**（2026-11）：连带去掉 sbwml 26.x golang feed 替换、`luci-app-mosdns`(v5) 与 `v2ray-geodata` 的源码克隆；`configs/25.12` 里三个包显式 `is not set`，工作流编译前有 `absent` 断言防止被基线/feeds 带回来。
- 已移除 24.10 编译项目与「设备流量 / 在线主机」自定义页面（`client-rates` 采样服务一并删除）。

## Usage

- Click the [Use this template](https://github.com/P3TERX/Actions-OpenWrt/generate) button to create a new repository.
- Generate `.config` files using [Lean's OpenWrt](https://github.com/coolsnowwolf/lede) source code. ( You can change it through environment variables in the workflow file. )
- Push `.config` file to the GitHub repository.
- Select `Build OpenWrt` on the Actions page.
- Click the `Run workflow` button.
- When the build is complete, click the `Artifacts` button in the upper right corner of the Actions page to download the binaries.

## Tips

- It may take a long time to create a `.config` file and build the OpenWrt firmware. Thus, before create repository to build your own firmware, you may check out if others have already built it which meet your needs by simply [search `Actions-Openwrt` in GitHub](https://github.com/search?q=Actions-openwrt).
- Add some meta info of your built firmware (such as firmware architecture and installed packages) to your repository introduction, this will save others' time.

## Credits

- [Microsoft Azure](https://azure.microsoft.com)
- [GitHub Actions](https://github.com/features/actions)
- [OpenWrt](https://github.com/openwrt/openwrt)
- [coolsnowwolf/lede](https://github.com/coolsnowwolf/lede)
- [Mikubill/transfer](https://github.com/Mikubill/transfer)
- [softprops/action-gh-release](https://github.com/softprops/action-gh-release)
- [Mattraks/delete-workflow-runs](https://github.com/Mattraks/delete-workflow-runs)
- [dev-drprasad/delete-older-releases](https://github.com/dev-drprasad/delete-older-releases)
- [peter-evans/repository-dispatch](https://github.com/peter-evans/repository-dispatch)

## License

[MIT](https://github.com/P3TERX/Actions-OpenWrt/blob/main/LICENSE) © [**P3TERX**](https://p3terx.com)
