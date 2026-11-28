"""把 Claude 导出的 zip / conversations.json 转成一堆 Markdown 文件。

用法: python to_markdown.py 导出文件.zip [更多文件...] [-o 输出文件夹]
只用标准库。
"""
import argparse
import json
import re
import sys
import zipfile
from datetime import datetime
from pathlib import Path


def load_items(path: Path):
    """返回 (文件名, json对象) 列表"""
    out = []
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                low = name.lower()
                if low.endswith(".json") and not low.startswith("__macosx/") and (
                    "conversation" in low or "project" in low or "memor" in low
                ):
                    with z.open(name) as f:
                        out.append((name.split("/")[-1], json.load(f)))
    else:
        with open(path, encoding="utf-8") as f:
            out.append((path.name, json.load(f)))
    return out


def fmt_time(iso: str) -> str:
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
    except ValueError:
        return iso


def result_text(content) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else json.dumps(content, ensure_ascii=False, indent=2)
    parts = []
    for c in content:
        if isinstance(c, str):
            parts.append(c)
        elif isinstance(c, dict):
            if c.get("type") == "text":
                parts.append(c.get("text") or "")
            elif c.get("title") or c.get("url"):
                parts.append("\n".join(str(x) for x in (c.get("title"), c.get("url"), c.get("text")) if x))
            else:
                parts.append(json.dumps(c, ensure_ascii=False, indent=2))
    return "\n\n".join(p for p in parts if p)


def fence(text: str, lang: str = "") -> str:
    """代码块：内容里有 ``` 时自动加长围栏"""
    n = 3
    while "`" * n in text:
        n += 1
    return "`" * n + lang + "\n" + text + "\n" + "`" * n


def message_md(m: dict) -> str:
    role = "我" if m.get("sender") == "human" else "Claude"
    lines = [f"## {role} · {fmt_time(m.get('created_at', ''))}", ""]
    blocks = m.get("content") if isinstance(m.get("content"), list) else []
    wrote = False
    for b in blocks:
        if not isinstance(b, dict):
            continue
        t = b.get("type")
        if t == "text" and (b.get("text") or "").strip():
            lines += [b["text"], ""]
            wrote = True
        elif t == "thinking":
            lines += ["<details><summary>思考过程</summary>", "", fence(b.get("thinking") or ""), "", "</details>", ""]
        elif t == "tool_use":
            inp = json.dumps(b.get("input") or {}, ensure_ascii=False, indent=2)
            lines += [f"<details><summary>🔧 调用工具 {b.get('name', '')}</summary>", "", fence(inp, "json"), "", "</details>", ""]
        elif t == "tool_result":
            lines += [f"<details><summary>📎 工具结果 {b.get('name', '')}</summary>", "", fence(result_text(b.get("content"))), "", "</details>", ""]
    if not wrote and (m.get("text") or "").strip() and not any(isinstance(b, dict) and b.get("type") == "text" for b in blocks):
        lines += [m["text"], ""]
    for a in m.get("attachments") or []:
        name = a.get("file_name", "")
        content = a.get("extracted_content") or ""
        if content:
            lines += [f"<details><summary>📄 附件 {name}</summary>", "", fence(content), "", "</details>", ""]
        else:
            lines += [f"> 📄 附件 {name}（导出不含内容）", ""]
    files = [f.get("file_name", "") for f in (m.get("files") or []) if isinstance(f, dict)]
    if files:
        lines += ["> 🖼 文件：" + "、".join(files) + "（导出不含原文件）", ""]
    return "\n".join(lines)


BAD = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_name(s: str, limit: int = 60) -> str:
    s = BAD.sub("_", s).strip().strip(".")
    return (s[:limit].rstrip() or "untitled")


def main():
    ap = argparse.ArgumentParser(description="Claude 导出数据 → Markdown")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=None, help="输出文件夹（默认：导出文件旁边的 claude-markdown）")
    args = ap.parse_args()

    out = args.out or args.files[0].resolve().parent / "claude-markdown"
    convs, projects, memories = {}, [], []
    for p in args.files:
        if not p.exists():
            sys.exit(f"找不到文件: {p}")
        for name, data in load_items(p):
            low = name.lower()
            if "memor" in low:
                memories.append(data)
            elif "project" in low:
                projects += data if isinstance(data, list) else []
            elif isinstance(data, list):
                for c in data:
                    cid = c.get("uuid") or str(id(c))
                    old = convs.get(cid)
                    if not old or (c.get("updated_at") or "") >= (old.get("updated_at") or ""):
                        convs[cid] = c
    if not convs:
        sys.exit("没找到对话数据（conversations.json）")

    out.mkdir(parents=True, exist_ok=True)
    used = set()
    index = ["# Claude 对话目录", "", f"共 {len(convs)} 个对话", ""]
    last_month = None
    for c in sorted(convs.values(), key=lambda x: x.get("updated_at") or "", reverse=True):
        title = (c.get("name") or "").strip() or "(无标题)"
        created = fmt_time(c.get("created_at", ""))
        updated = fmt_time(c.get("updated_at", ""))
        month = (updated or "未知")[:7]
        day = (updated or "0000-00-00")[:10]
        base = f"{month}/{day}_{safe_name(title)}"
        rel, n = base + ".md", 2
        while rel.lower() in used:
            rel, n = f"{base}_{n}.md", n + 1
        used.add(rel.lower())

        msgs = c.get("chat_messages") or []
        body = [f"# {title}", "", f"创建 {created} · 更新 {updated} · {len(msgs)} 条消息", ""]
        if c.get("summary"):
            body += ["> " + c["summary"].replace("\n", "\n> "), ""]
        body += [message_md(m) for m in msgs]
        target = out / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("\n".join(body), encoding="utf-8")

        if month != last_month:
            index += ["", f"## {month}", ""]
            last_month = month
        index.append(f"- [{title}]({rel.replace(' ', '%20')}) · {updated}")

    for p in projects:
        name = safe_name((p.get("name") or "").strip() or "project")
        pdir = out / "_projects" / name
        pdir.mkdir(parents=True, exist_ok=True)
        info = [f"# {p.get('name', '')}", "", p.get("description") or "", ""]
        if p.get("prompt_template"):
            info += ["## 项目指令", "", fence(p["prompt_template"]), ""]
        (pdir / "_项目说明.md").write_text("\n".join(info), encoding="utf-8")
        for d in p.get("docs") or []:
            (pdir / safe_name(d.get("filename") or "doc.txt", 100)).write_text(d.get("content") or "", encoding="utf-8")

    if memories:
        mem = ["# 记忆", ""]
        for m in memories:
            for item in m if isinstance(m, list) else [m]:
                if not isinstance(item, dict):
                    continue
                if item.get("conversations_memory"):
                    mem += ["## 全局记忆", "", item["conversations_memory"], ""]
                for k, v in (item.get("project_memories") or {}).items():
                    mem += [f"## 项目记忆 {k}", "", str(v), ""]
        (out / "_记忆.md").write_text("\n".join(mem), encoding="utf-8")

    (out / "_目录.md").write_text("\n".join(index) + "\n", encoding="utf-8")
    print(f"完成：{len(convs)} 个对话、{len(projects)} 个项目 → {out}")


if __name__ == "__main__":
    main()
