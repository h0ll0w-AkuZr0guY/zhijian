# 开发指南

[返回项目首页](../README.md)

## 环境与启动

使用 Node.js 22.13 或更新的受支持版本，依赖通过 `package-lock.json` 锁定。

```sh
npm ci
npm run dev
```

开发服务位于 `http://127.0.0.1:5173/`，端口由 Vite 配置固定。

```sh
npm run check
npm test
npm run build
npm run preview
```

`check` 执行 TypeScript、ESLint 与 Prettier 检查，`test` 执行 Vitest，`build` 生成 `dist/`，`preview` 预览构建产物。修改格式可运行 `npm run format`。

## 目录与职责

| 路径            | 职责                                             |
| --------------- | ------------------------------------------------ |
| `src/main.ts`   | 工程协调、跨页命令历史、导入校对、保存与界面模式 |
| `src/core`      | 工程、页面、元素模型与基线引用                   |
| `src/editor`    | 元素交互、选择、快捷键、连续页面展示             |
| `src/guided`    | 模块表单、结构化内容与画布双向映射               |
| `src/importers` | Markdown、PDF、OCR 与段落结构恢复                |
| `src/layout`    | 模板分页、美化与智能1页                          |
| `src/ai`        | 兼容接口客户端、建议校验、应用与侧栏工作台       |
| `src/exporters` | 页面渲染、PNG、PDF 与字体处理                    |
| `src/storage`   | IndexedDB 本机文档库                             |
| `src-tauri`     | Windows 窗口、托盘与安装包配置                   |
| `public`        | 字体、PDF 和 OCR 运行资源与许可                  |
| `tests`         | 内容、基线、美化、一页适配、AI 与表单模型测试    |

工程使用 Project v2，多页共享文档身份和历史。每页保存独立元素数组，`activePage` 表示当前交互页，连续页面组件协调其余页面的预览。旧 Project v1 通过 `unpackProject` 转换。

填写模式的结构化数据保存在可选 `resume` 字段中，生成元素通过 `formField`、`blockId` 等信息映射回字段。`packProject` 将重复图片归并到资源表，`unpackProject` 恢复并校验。模型配置由 AI 工作台独立保存。

表单编辑会按模板再生成页面。自由画布中的额外元素使用结构化草稿中的 extras 保留，一页适配前后的几何信息用于避免重复缩放。修改这些流程时应同时验证模式切换、撤销和工程往返。

## 验证改动

现有测试包括 Markdown 结构、图片资源打包、PDF 字体子集、段落合并、同行绑定、美化、智能1页、模型客户端、建议格式与表单同步。运行 `npm test` 查看当前用例结果。

涉及界面时，通过正常入口验证相关流程。建议使用自带虚构示例或脱敏资料，覆盖以下与改动有关的操作。

- 内容填写与自由画布切换，预填、富文本、条目排序和撤销重做。
- 连续页面直接编辑、缩放、基线绑定及多选。
- PDF / Markdown / 图片导入、校对、模板预览、导出与工程重新打开。
- 本机保存后刷新恢复。
- AI 变更使用模拟接口验证范围、替换、取消和错误处理，真实模型调用使用开发者自己的配置。

浏览器端到端测试脚本目前由开发会话执行，仓库内自动化测试入口为 Vitest。提交与所修复问题相关的回归用例即可。

## Windows 桌面构建

安装 Rust stable 与 Tauri 所需的 Windows 构建环境，包括 Microsoft C++ Build Tools 和 WebView2。安装步骤见 [Tauri 官方环境准备说明](https://v2.tauri.app/start/prerequisites/#windows)。

```sh
npm run desktop
npm run desktop:build
```

Tauri 调用前端构建，打包 `dist/` 及随附识别资源，NSIS 安装包输出到 `src-tauri/target/release/bundle/nsis/`。托盘逻辑位于 `src-tauri/src/main.rs`。关闭窗口隐藏应用，托盘退出结束进程。

## 静态部署与发布

前端产物可部署到静态托管，Vite 使用相对路径构建。通过 HTTP / HTTPS 服务访问 `dist/`，使用部署环境的站点地址。

`.github/workflows/pages.yml` 在 main 推送后执行依赖安装、检查、测试、构建和 GitHub Pages 部署。构建会从最新 Release 复制 Windows 安装包到站点下载目录。

桌面工作流在推送 `v*` 标签或手动触发时运行，构建 NSIS、上传 Release、整理安装包名称，然后触发 Pages 更新下载镜像。实际版本由 `package.json`、锁文件根条目、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 共同维护，站点更新时同步 `public/sw.js` 缓存标识。

发布应用版本前运行检查、测试和构建，并核对 Release 附件与 Pages 的下载入口。补充对应发布记录与 Release 说明。纯文档更新沿用当前应用版本。

## 资源与兼容

字体、OCR 模型和 PDF 资源是运行依赖，许可见 [第三方声明](../THIRD_PARTY.md)。更换资源时保留相应声明，验证首次加载与离线资源路径。

工程改动需要兼容已有文档及旧 `.a4canvas` 输入。修改模型、图片去重、引用或表单同步时，检查保存、重新打开和撤销后的状态一致性。
