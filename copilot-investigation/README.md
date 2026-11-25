# Copilot 调查工作区模板

给 VS Code 里的 GitHub Copilot(agent 模式)用的一套文件:信息源地图、工作规则、几个调查提示词。

## 文件

| 文件 | 用途 |
|---|---|
| `dot-github/copilot-instructions.md` | 工作规则,Copilot 每次对话自动读取 |
| `dot-github/source-map.md` | 信息源地图,填上实际位置后使用 |
| `dot-github/prompts/00-连通性检查` | 第一天用,测试每个来源能不能访问 |
| `dot-github/prompts/01-建手册索引` | 只需跑一次,之后按需更新 |
| `dot-github/prompts/10-功能问答` | 回答功能相关的询问 |
| `dot-github/prompts/11-故障调查` | 故障原因调查 |
| `dot-github/prompts/12-版本差异` | 两个版本或分支的比较 |
| `sync.bat` | 拉取最新版并安装到工作区 |

## 用法

1. 在工作电脑上建一个空文件夹当调查工作区,例如 `C:\work\investigation`。
2. 双击 `sync.bat`,输入工作区路径。文件会复制到工作区的 `.github\` 下。
3. 用 VS Code 打开工作区,填写 `.github\source-map.md`。
4. Copilot Chat 切到 Agent,模型选 Opus,输入 `/00-连通性检查`。
5. 之后按需要输入 `/10-功能问答` 等,把【】里的内容填上再发送。

斜杠命令没有出现时,打开对应的提示词文件,把内容贴进对话。

## 更新

再次双击 `sync.bat`。规则和提示词会更新成最新版,`source-map.md` 已经存在时不会被覆盖。

## 注意

- 填好的 `source-map.md` 和 `work\` 下的内容只留在工作电脑上。
- 数据库账号密码放环境变量 `DB_USER`、`DB_PASS`。

## Work IQ(可选)

需要管理员同意和 Node.js。在工作区建 `.vscode\mcp.json`:

```json
{
  "servers": {
    "workiq": {
      "command": "npx",
      "args": ["-y", "@microsoft/workiq", "mcp"]
    }
  }
}
```

第一次使用前在终端执行 `npx -y @microsoft/workiq accept-eula`。
说明文档:<https://learn.microsoft.com/microsoft-365-copilot/extensibility/workiq-overview>
