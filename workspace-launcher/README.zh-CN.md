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
