# 风机传动结构透视演示

Three.js 风机机舱交互展示：自动传动、内部结构透视、零件选择、上下游与支撑关系着色、标注及模拟监测。

## 在线访问

[打开演示网页](https://guanyu-peng2005.github.io/wind-turbine-viewer/)

默认以 0.25 倍速度运转。勾选“传动结构透视”查看齿轮和发电机内部联动；点击零件树查看动力与支撑关系。报警点默认隐藏，可手动开启。

手机和 iPad 支持横竖屏切换，“零件面板”可展开或收起。单指拖动旋转，点击“平移”后单指移动模型，双指可缩放和平移。屏幕较窄时面板位于底部，较宽的横屏及大尺寸 iPad 使用侧边面板。

桌面布局按参考画面的比例自动适配可用窗口，保持零件树、字号和模型的相对尺寸。移动端保留触控尺寸；竖屏面板最多占 30% 屏幕高度，详细内容在面板内滚动。

标注支持源 CAD 和内部齿轮、发电机示意零件，包括实例零件。测点按功能部件绑定并贴合几何表面；位置为模型示意，不代表厂商实测安装位置。拾取使用后台构建的 BVH 加速，保持原始顶点和三角形索引不变。

新标注保存稳定零件身份、模型版本和完整视角信息。旧版标注经零件校验后兼容读取；模型版本不匹配的记录保留为“定位待确认”，不会自动绑定到其他零件。浏览器原有 v1 标注数据保留，后续保存使用 v2 格式。

首次访问需要下载约 96 MB 的主模型，随后加载约 21 MB 的交互模型；请等待加载完成。内部发电机和齿轮参数用于典型结构演示，电气连接标为示意。实时监测默认使用模拟数据。标注保存在当前浏览器中。

## 本地运行

使用 Node.js 24。

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

## GitHub Pages

仓库 Settings → Pages 中选择 GitHub Actions。推送到 `main` 后，工作流自动安装依赖、运行测试、构建并发布 `dist`。部署路径由 Pages 配置提供，模型和解码器均跟随该路径加载。

本地检查仓库子路径版本：

```sh
npm run build -- --base=/wind-turbine-viewer/
npm run preview -- --base=/wind-turbine-viewer/
```

访问 `http://127.0.0.1:4173/wind-turbine-viewer/`。

参考：[Vite 静态部署](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

源 CAD 压缩包、临时导出、测试截图和本机工具产物不进入发布仓库。网站使用的模型文件保留在 `public/models`。
