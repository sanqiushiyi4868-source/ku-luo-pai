# 梦幻库洛牌 / Dreamy Clow Cards

在线体验：https://sanqiushiyi4868-source.github.io/ku-luo-pai/

## 本地预览

1. Double-click `start-local.bat`.
2. Open `http://127.0.0.1:4173/` if the browser does not open automatically.

Do not test by double-clicking `index.html`. Browsers restrict `file://` resource loading and camera access. Camera gesture mode is supported on `http://127.0.0.1` and HTTPS deployments.

也可安装 Node.js 20 或以上版本后运行 `npm start`，打开终端显示的地址。页面是静态站点，不需要打包；Three.js、MediaPipe 模型、WASM 和运行用 WebP 均由本站提供。

## 操作

- 鼠标移动或触摸拖动旋转牌阵，按住卡牌查看，松开释放。
- 手势模式：先允许摄像头权限，在小窗确认实际画面，移动食指旋转，拇指和食指捏合抽牌，张开释放。也支持握拳/张掌。
- 多摄像头设备可在预览下方选择来源。黑屏时检查遮挡和光线，或更换摄像头。权限拒绝、设备占用、断流和识别失败会显示不同提示。
- 摄像头画面和识别在浏览器内处理，不上传、不录制。关闭手势或切到后台会停止摄像头；返回页面后手动重新开启。

## 2026-09-12 修复

后续交互更新：恢复抽牌后随鼠标/手势轻微倾斜，以及随方向变化的金色描边与光照；牌阵仍保持原来的布局，抽出的牌仍在前景防止遮挡。实时预览改为原生视频独立播放。识别循环使用最新视频帧、最多一个在途请求，桌面目标 30 FPS、移动目标 24 FPS，按实际推理耗时自动调节。去掉全尺寸画面读回和重复缩放，降低输入滤波与手势防抖延迟。预览下方分别显示实际画面/识别帧率；这些目标不是所有硬件上的帧率保证。

1. 鼠标和手势共用同一牌阵布局。性能降级仅调整粒子与分辨率，不改变卡牌数量、间距或大小；横竖屏分别适配。
2. 抽牌移至独立前景场景，居中正面显示，按可用视口缩放，避免其他卡牌遮挡。
3. 摄像头权限、视频帧、识别模型分开管理；预览直接播放摄像头视频，识别按需读取同一摄像头的最新帧，增加黑屏/断流检测、超时、取消及迟到资源清理。
4. 按深度选择最前面的卡牌，避免按数组顺序选错；修正张开手指后不释放、鼠标干扰手势、释放牌面立即消失的问题。
5. 按帧间隔计算旋转和缓动，减少刷新率差异；仅在用户请求手势后加载模型。支持系统的减少动画设置（停止牌阵自动旋转）。

## 验证与维护

```sh
npm ci
npx playwright install chromium
npm run check
npm test
```

已安装 Chrome 时可设置 `BROWSER_CHANNEL=chrome` 使用系统浏览器。设置 `SCREENSHOT_DIR` 可保存回归截图。测试使用 Chromium 测试摄像头和模拟故障，不会开启实际设备摄像头。

18 项浏览器回归覆盖实际 MediaPipe Worker 的初始化及推理、模式布局一致性、前景抽牌与释放、手势动作、鼠标/手势倾斜与金色描边、实时预览在识别等待时持续刷新、权限/设备错误、取消、黑屏恢复、摄像头切换、断流、Worker 异常/超时、后台释放和三种移动视口。动作与故障测试使用合成输入，不能替代各设备真实摄像头和真人手势验收。

GitHub Pages 沿用 `main` 分支根目录发布。每次推送也会运行 `.github/workflows/check.yml`；无需改动 Pages 来源。原始 JPG 和现有 WebP 保留。
