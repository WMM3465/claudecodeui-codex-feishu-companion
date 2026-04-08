# Windows 轻量启动器

这个目录提供的是一个 **轻量启动器方案**，不是完整打包 CloudCLI 和 bridge 的桌面壳。

双击启动器后的行为：

1. 检查 `http://localhost:3001` 是否已经在线
2. 如果没在线，自动启动 `server/index.js`
3. 检查飞书 bridge daemon 是否在线
4. 如果没在线，自动启动 `daemon.mjs`
5. 用系统默认浏览器打开工作台链接

## 文件说明

- `launch-workspace.ps1`
  真正的启动脚本，包含日志、端口检测、bridge 检测和浏览器打开逻辑
- `start-workspace.cmd`
  直接调用 PowerShell 启动脚本
- `launcher-config.example.json`
  配置模板，给不同电脑改路径用
- `package-launcher.sed`
  使用 Windows 自带 `iexpress.exe` 打包成 exe 的配置文件

## 配置项

需要根据自己的电脑修改：

- `nodePath`
- `cloudCliRoot`
- `bridgeDaemonPath`

另外建议同时确认：

- `workspaceUrl`
- 默认工作目录是否符合自己习惯
- 本机浏览器默认关联是否正常

## 别人拿到这个项目后，最常需要改的地方

如果这是从别人的电脑复制过来的项目，请不要直接照搬原配置。至少要检查：

### 1. Node 路径

必须改成自己电脑上的 `node.exe` 路径。

示例：

```json
"nodePath": "C:\\Program Files\\nodejs\\node.exe"
```

### 2. CloudCLI 根目录

必须改成自己这份仓库在本机的真实路径。

示例：

```json
"cloudCliRoot": "D:\\work\\claudecodeui"
```

### 3. bridge daemon 路径

必须改成自己本机的 `daemon.mjs` 路径，而不是原作者电脑上的路径。

示例：

```json
"bridgeDaemonPath": "C:\\Users\\你的用户名\\.codex\\skills\\Claude-to-IM-skill\\dist\\daemon.mjs"
```

### 4. 如果飞书已经接好了

那只需要确认：

- bridge 配置能正常运行
- daemon 路径正确
- 本机 `CloudCLI` 路径正确
- 默认工作目录正确

不需要重复创建飞书应用。

### 5. 如果飞书还没接好

那除了这份启动器配置，还要自己完成：

- 飞书自建应用
- Bot 开通
- 权限配置
- 事件订阅
- callback / long connection
- `App ID / App Secret`

## 推荐的使用方式

第一次部署时，建议按这个顺序：

1. 先复制 `launcher-config.example.json` 为 `launcher-config.json`
2. 先把 3 个关键路径改成自己电脑的真实路径
3. 先运行 `start-workspace.cmd`
4. 确认工作台能打开
5. 再考虑是否重新打包成自己的 exe

## 关于 exe 的说明

仓库里的启动器方案适合做成“点一下就打开工作台”的入口，但要注意：

- **不同电脑路径不同**
- 所以最稳的是先改配置，再用脚本启动验证
- 验证通过后，再给自己的环境打包 exe

换句话说：

- `start-workspace.cmd` 适合第一次部署和排错
- exe 更适合路径已经固定后的日常使用

## 本地日志

启动日志会写到：

`%LOCALAPPDATA%\\FeishuCodexLauncher\\launcher.log`

## 如何打包成 exe

1. 复制 `launcher-config.example.json` 为 `launcher-config.json`
2. 修改好自己的路径
3. 用管理员 PowerShell 运行：

```powershell
iexpress.exe /N .\\workspace-launcher\\package-launcher.sed
```

## 已验证行为

当前这套脚本已经在开发机上做过实际测试：

- 工作台在线时可以直接拉起浏览器
- bridge 在线时不会重复启动
- 浏览器优先走系统默认浏览器

## 说明

这个启动器适合“像点微信一样双击打开工作台”的场景。
它不是跨平台方案，目前只针对 Windows。
