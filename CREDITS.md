# 参考项目与致谢（CREDITS）

本插件（`dsh-precise-billing`，显示名「精确计费」）在设计与实现过程中学习、对比过以下开源项目。
记录于此，便于以后对照更新与继续学习。

## 一、直接借鉴（设计/机制参考，代码为独立实现）

| 项目 | 许可证 | 源码地址 | 借鉴内容 | 说明 |
| --- | --- | --- | --- | --- |
| DeepSeek-Usage（npm `deepseek-usage` 0.1.6） | MIT | https://github.com/sdiwenchen-lang/DeepSeek-Usage | 用量看板的信息架构：趋势/日历双视图、统计卡、模型消费/Token/请求图、按模型明细、点击日期弹层、峰/闲分色 | 面板与图表为重新实现（自写 SVG 与布局），未复制其源码；官方插件仍可独立安装 |
| dsh-meter（0.3.32） | MIT | https://github.com/J-Chien/dsh-meter | 会话级计费：Token 分桶、缓存命中率、峰谷感知费用的会话标题栏与价格表设置页的计费思路 | 本插件计价引擎为独立实现，未复制其源码 |
| dsh-hot-restart（0.3.17） | MIT | https://github.com/xiaolu511/dsh-hot-restart | 热重启的实现思路：把「等待→结束主进程→重新拉起」的助手交给 Explorer 派发，避免助手被 DSH 的 job object 连带结束；全程无黑窗 | 本插件在宿主侧独立实现了一个约 50 行的精简版接口 `POST /api/precise-billing/restart`，未复制其源码，也没有调用该插件的接口；它额外的自检/诊断/覆盖层 UI 未纳入 |

## 二、调研过但未使用代码

| 项目 | 许可证 | 源码地址 | 用途 |
| --- | --- | --- | --- |
| dsh-unified-market（0.4.1） | MIT | https://github.com/jing-hy/dsh-unified-market | 调研插件市场在 DSH 桌面壳中的 profile/slot 适配方式，本插件未使用其代码 |
| dsh-duet（0.2.0） | Apache-2.0 | https://github.com/YuMS/dsh-duet | 调研全双工语音交互，本插件未使用其代码 |

## 三、许可合规说明

- 上述项目均为 MIT / Apache-2.0 等宽松开源许可证，允许学习、修改与再分发；
- 本插件对借鉴内容采取**独立重写**：只参考设计思路与实现机制，没有逐行复制源文件；
- 若后续确实需要直接复用某段代码，应保留其原始版权声明与许可证文本，并在本文件补充对应条目；
- 本插件自身目前未声明开源许可证（`private: true`，仅本机使用）。

## 四、本插件自身

- 宿主：`index.js`（计价引擎、会话扫描、HTTP 路由、热重启助手）
- 客户端：`client.js`（费用条、侧边栏卡片、设置页、用量看板）
- 数据：`$DSH_HOME/storages/precise-billing.json`
- 仓库备份：`E:\DSH项目备份\插件编写\插件编写.git`

## 五、如何安装原版

本插件的用量看板与热重启已由本插件自行实现，原版插件已从本机卸载。如仍想单独使用原版：

```bash
dsh plugin --profile desktop add deepseek-usage
dsh plugin --profile desktop add dsh-hot-restart
dsh plugin --profile desktop add dsh-meter
```

- DeepSeek-Usage：https://github.com/sdiwenchen-lang/DeepSeek-Usage
- dsh-hot-restart：https://github.com/xiaolu511/dsh-hot-restart
- dsh-meter：https://github.com/J-Chien/dsh-meter
