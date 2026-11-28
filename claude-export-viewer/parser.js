/* Claude 导出数据解析：读 zip / json，整理成统一结构。浏览器和 Node 都能用。 */
(function (root) {
  'use strict';

  // ---------- ZIP ----------
  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }
  function u64(v, o) { return u32(v, o) + u32(v, o + 4) * 4294967296; }

  async function sliceBuf(blob, start, end) {
    return new Uint8Array(await blob.slice(start, end).arrayBuffer());
  }

  // 列出 zip 里的文件（只读文件尾部的中央目录，不把整个 zip 读进内存）
  async function listZip(blob) {
    const size = blob.size;
    const tailLen = Math.min(size, 65557 + 20);
    const tail = await sliceBuf(blob, size - tailLen, size);
    const tv = new DataView(tail.buffer);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (u32(tv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip 文件');
    let count = u16(tv, eocd + 10);
    let cdSize = u32(tv, eocd + 12);
    let cdOff = u32(tv, eocd + 16);
    // ZIP64
    if (eocd >= 20 && u32(tv, eocd - 20) === 0x07064b50) {
      const z64Off = u64(tv, eocd - 20 + 8);
      const z = await sliceBuf(blob, z64Off, z64Off + 56);
      const zv = new DataView(z.buffer);
      if (u32(zv, 0) === 0x06064b50) {
        count = u64(zv, 32);
        cdSize = u64(zv, 40);
        cdOff = u64(zv, 48);
      }
    }
    const cd = await sliceBuf(blob, cdOff, cdOff + cdSize);
    const cv = new DataView(cd.buffer);
    const dec = new TextDecoder('utf-8');
    const entries = [];
    let p = 0;
    for (let n = 0; n < count && p + 46 <= cd.length; n++) {
      if (u32(cv, p) !== 0x02014b50) break;
      const method = u16(cv, p + 10);
      let csize = u32(cv, p + 20);
      let usize = u32(cv, p + 24);
      const nameLen = u16(cv, p + 28);
      const extraLen = u16(cv, p + 30);
      const commentLen = u16(cv, p + 32);
      let localOff = u32(cv, p + 42);
      const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
      // ZIP64 扩展字段
      let e = p + 46 + nameLen;
      const eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        const id = u16(cv, e), len = u16(cv, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (usize === 0xffffffff) { usize = u64(cv, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(cv, q); q += 8; }
          if (localOff === 0xffffffff) { localOff = u64(cv, q); q += 8; }
        }
        e += 4 + len;
      }
      entries.push({ name, method, csize, usize, localOff });
      p = eEnd + commentLen;
    }
    return entries;
  }

  async function readZipEntry(blob, entry) {
    const lh = await sliceBuf(blob, entry.localOff, entry.localOff + 30);
    const lv = new DataView(lh.buffer);
    if (u32(lv, 0) !== 0x04034b50) throw new Error('zip 内部结构损坏: ' + entry.name);
    const start = entry.localOff + 30 + u16(lv, 26) + u16(lv, 28);
    const part = blob.slice(start, start + entry.csize);
    if (entry.method === 0) return await part.text();
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('这个浏览器不支持解压 zip，请先解压，再选里面的 conversations.json');
      }
      const stream = part.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return await new Response(stream).text();
    }
    throw new Error('不支持的压缩方式 ' + entry.method + ': ' + entry.name);
  }

  // ---------- 整理 ----------
  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  function resultText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content, null, 2);
    return content.map(function (c) {
      if (c == null) return '';
      if (typeof c === 'string') return c;
      if (c.type === 'text') return str(c.text);
      if (c.type === 'knowledge' || c.title || c.url) {
        return [c.title, c.url, c.text].filter(Boolean).join('\n');
      }
      if (c.type === 'image') return '[图片]';
      return JSON.stringify(c, null, 2);
    }).filter(Boolean).join('\n\n');
  }

  function normBlock(b) {
    if (!b || typeof b !== 'object') return null;
    switch (b.type) {
      case 'text': return { kind: 'text', text: str(b.text) };
      case 'thinking': return { kind: 'thinking', text: str(b.thinking || b.text) };
      case 'tool_use': return { kind: 'tool_use', name: str(b.name), input: b.input == null ? {} : b.input };
      case 'tool_result': return { kind: 'tool_result', name: str(b.name), text: resultText(b.content), isError: !!b.is_error };
      case 'voice_note': return { kind: 'text', text: str(b.text || b.transcript || b.title) };
      default: {
        const raw = Object.assign({}, b);
        delete raw.start_timestamp; delete raw.stop_timestamp;
        return { kind: 'other', type: str(b.type || 'unknown'), raw: raw };
      }
    }
  }

  function normMessage(m) {
    const role = m.sender === 'human' || m.role === 'user' ? 'human' : 'assistant';
    let blocks = Array.isArray(m.content) ? m.content.map(normBlock).filter(Boolean) : [];
    blocks = blocks.filter(function (b) { return !(b.kind === 'text' && !b.text.trim()); });
    if (!blocks.length && str(m.text).trim()) blocks = [{ kind: 'text', text: str(m.text) }];
    const attachments = (m.attachments || []).map(function (a) {
      return { name: str(a.file_name || a.name), size: a.file_size || 0, content: str(a.extracted_content) };
    });
    const files = (m.files || m.files_v2 || []).map(function (f) { return str(f.file_name || f.name); }).filter(Boolean);
    return {
      id: str(m.uuid),
      role: role,
      time: str(m.created_at),
      blocks: blocks,
      attachments: attachments,
      files: files
    };
  }

  function normConversation(c) {
    const msgs = Array.isArray(c.chat_messages) ? c.chat_messages : (Array.isArray(c.messages) ? c.messages : []);
    return {
      id: str(c.uuid || c.id),
      title: str(c.name || c.title).trim() || '(无标题)',
      summary: str(c.summary),
      created: str(c.created_at),
      updated: str(c.updated_at || c.created_at),
      messages: msgs.map(normMessage)
    };
  }

  function normProject(p) {
    return {
      id: str(p.uuid),
      name: str(p.name).trim() || '(无名项目)',
      description: str(p.description),
      instructions: str(p.prompt_template),
      created: str(p.created_at),
      updated: str(p.updated_at || p.created_at),
      docs: (p.docs || []).map(function (d) { return { name: str(d.filename || d.name), content: str(d.content) }; })
    };
  }

  function emptyData() { return { conversations: [], projects: [], memories: [] }; }

  // 合并多次导入（按 uuid 去重，保留更新时间较新的）
  function merge(target, add) {
    function mergeList(key, timeKey) {
      const map = new Map();
      target[key].forEach(function (x) { map.set(x.id || Math.random(), x); });
      add[key].forEach(function (x) {
        const k = x.id || Math.random();
        const old = map.get(k);
        if (!old || str(x[timeKey]) >= str(old[timeKey])) map.set(k, x);
      });
      target[key] = Array.from(map.values());
    }
    mergeList('conversations', 'updated');
    mergeList('projects', 'updated');
    add.memories.forEach(function (m) { if (target.memories.indexOf(m) < 0) target.memories.push(m); });
    target.conversations.sort(function (a, b) { return a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0; });
    return target;
  }

  function memoryTexts(json) {
    const out = [];
    (Array.isArray(json) ? json : [json]).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      if (m.conversations_memory) out.push('【全局记忆】\n' + str(m.conversations_memory));
      const pm = m.project_memories;
      if (pm && typeof pm === 'object') {
        Object.keys(pm).forEach(function (k) { out.push('【项目记忆 ' + k + '】\n' + str(pm[k])); });
      }
    });
    return out;
  }

  // 按 json 内容判断是哪种数据
  function absorbJson(data, json, fileName) {
    const name = (fileName || '').toLowerCase();
    const arr = Array.isArray(json) ? json : null;
    const first = arr && arr.length ? arr[0] : null;
    if (name.indexOf('memor') >= 0) { data.memories = data.memories.concat(memoryTexts(json)); return 'memories'; }
    if (name.indexOf('project') >= 0 || (first && 'docs' in first && !('chat_messages' in first))) {
      data.projects = data.projects.concat(arr ? arr.map(normProject) : []);
      return 'projects';
    }
    if (name.indexOf('conversation') >= 0 || (first && 'chat_messages' in first) || (arr && !arr.length)) {
      data.conversations = data.conversations.concat(arr ? arr.map(normConversation) : []);
      return 'conversations';
    }
    if (json && !arr && Array.isArray(json.conversations)) {
      data.conversations = data.conversations.concat(json.conversations.map(normConversation));
      return 'conversations';
    }
    return null;
  }

  // 读一个文件（zip 或 json），返回整理好的数据
  async function parseFile(blob, fileName, onProgress) {
    const data = emptyData();
    const name = (fileName || blob.name || '').toLowerCase();
    const head = await sliceBuf(blob, 0, 4);
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (isZip) {
      const entries = await listZip(blob);
      const wanted = entries.filter(function (e) {
        const n = e.name.toLowerCase();
        return n.endsWith('.json') && !n.startsWith('__macosx/') &&
          (n.indexOf('conversation') >= 0 || n.indexOf('project') >= 0 || n.indexOf('memor') >= 0);
      });
      if (!wanted.length) throw new Error('zip 里没找到 conversations.json');
      for (const e of wanted) {
        if (onProgress) onProgress('解压 ' + e.name + ' (' + Math.round(e.usize / 1048576) + ' MB)');
        const text = await readZipEntry(blob, e);
        if (onProgress) onProgress('解析 ' + e.name);
        absorbJson(data, JSON.parse(text), e.name.split('/').pop());
      }
    } else {
      if (onProgress) onProgress('解析 ' + name);
      const kind = absorbJson(data, JSON.parse(await blob.text()), name);
      if (!kind) throw new Error('认不出这个 json 的格式：' + name);
    }
    return data;
  }

  const api = {
    listZip: listZip, readZipEntry: readZipEntry, parseFile: parseFile,
    normConversation: normConversation, emptyData: emptyData, merge: merge, absorbJson: absorbJson
  };
  root.ClaudeExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
