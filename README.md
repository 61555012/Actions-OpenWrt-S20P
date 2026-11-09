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
| **25.12** | `s20p-25.12-chasey.yml` | chasey-dev/immortalwrt-mt798x-rebase | `25.12` | `clx_s20p` | 闭源 MTK WiFi + HNAT/WARP、mosdns、OAF 识别内核（用户列表插件） |

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
