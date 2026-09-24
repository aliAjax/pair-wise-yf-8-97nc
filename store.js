/*
 * 共享数据层：核对台（app.js）与装运台（shipping.js）共用。
 * 纯前端、无依赖、无后台；两页读写同一个 localStorage 键，实现本地数据同步。
 */
window.Store = (() => {
  const storageKey = "zfl17-film-strip-desk";

  const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];

  // 片长估重规则（纸质片段按秒数估重），用于装运台超重判定
  const WEIGHT_PER_SECOND = 20; // 每秒约 20 克
  const DESICCANT_WEIGHT = 30; // 每包防潮剂约 30 克
  const DEFAULT_WEIGHT_LIMIT = 600; // 运输箱默认限重 600 克

  function createDefaultState() {
    const a001 = {
      id: crypto.randomUUID(),
      code: "A-001",
      duration: 18,
      shift: "正常",
      damage: "完好",
      note: "开场街景，节奏平稳，适合保留原顺序。",
      thumb: ""
    };
    const a006 = {
      id: crypto.randomUUID(),
      code: "A-006",
      duration: 9,
      shift: "偏红",
      damage: "轻微划痕",
      note: "人物近景左侧有划痕，试映时留意是否明显。",
      thumb: ""
    };
    const a012 = {
      id: crypto.randomUUID(),
      code: "A-012",
      duration: 14,
      shift: "褪色",
      damage: "接片松动",
      note: "接片位置靠近段尾，放映前建议重新压平。",
      thumb: ""
    };

    // 示例：#1、#2 两箱都装了 A-006（重复入箱），且 A-006 有偏色与划痕；A-012 尚未装箱（漏带）
    const box1 = {
      id: crypto.randomUUID(),
      number: 1,
      weightLimit: DEFAULT_WEIGHT_LIMIT,
      desiccant: 1,
      itemIds: [a001.id, a006.id],
      sealed: false,
      sealedAt: null,
      sealedWeight: null,
      sealedCount: null,
      received: false,
      receivedAt: null,
      returns: []
    };
    const box2 = {
      id: crypto.randomUUID(),
      number: 2,
      weightLimit: DEFAULT_WEIGHT_LIMIT,
      desiccant: 0,
      itemIds: [a006.id],
      sealed: false,
      sealedAt: null,
      sealedWeight: null,
      sealedCount: null,
      received: false,
      receivedAt: null,
      returns: []
    };

    return {
      reelTitle: "春日试映A卷",
      segments: [a001, a006, a012],
      boxes: [box1, box2]
    };
  }

  function normalizeBox(raw) {
    return {
      id: raw.id || crypto.randomUUID(),
      number: Number(raw.number) || 1,
      weightLimit: Number(raw.weightLimit) || DEFAULT_WEIGHT_LIMIT,
      desiccant: Number(raw.desiccant) || 0,
      itemIds: Array.isArray(raw.itemIds) ? raw.itemIds : [],
      sealed: Boolean(raw.sealed),
      sealedAt: raw.sealedAt || null,
      sealedWeight: raw.sealedWeight == null ? null : Number(raw.sealedWeight),
      sealedCount: raw.sealedCount == null ? null : Number(raw.sealedCount),
      received: Boolean(raw.received),
      receivedAt: raw.receivedAt || null,
      returns: Array.isArray(raw.returns) ? raw.returns : []
    };
  }

  function loadState() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return structuredClone(createDefaultState());
    try {
      const parsed = JSON.parse(saved);
      const state = { ...structuredClone(createDefaultState()), ...parsed };
      // 旧版本数据没有 boxes 字段时给空数组，避免塞入示例箱
      if (!Array.isArray(parsed.boxes)) state.boxes = [];
      state.boxes = state.boxes.map(normalizeBox);
      // 裁剪指向已删除片段的悬挂条目，保证箱内清单与片段库一致
      const validIds = new Set(state.segments.map((segment) => segment.id));
      state.boxes.forEach((box) => {
        box.itemIds = box.itemIds.filter((id) => validIds.has(id));
        box.returns = box.returns.filter((record) => validIds.has(record.segmentId));
      });
      return state;
    } catch {
      return structuredClone(createDefaultState());
    }
  }

  function saveState(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function formatDuration(seconds) {
    const value = Number(seconds) || 0;
    const minutes = Math.floor(value / 60);
    const rest = String(value % 60).padStart(2, "0");
    return `${minutes}:${rest}`;
  }

  function formatStamp(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // 单片段估重（克）
  function segmentWeight(segment) {
    return Math.max(0, Number(segment.duration) || 0) * WEIGHT_PER_SECOND;
  }

  // 删除片段时级联清出所有运输箱与待检记录，防止箱内悬挂编号
  function removeSegmentCascade(state, segmentId) {
    state.segments = state.segments.filter((item) => item.id !== segmentId);
    state.boxes.forEach((box) => {
      box.itemIds = box.itemIds.filter((id) => id !== segmentId);
      box.returns = (box.returns || []).filter((record) => record.segmentId !== segmentId);
    });
  }

  // 新箱编号取现有最大号 +1
  function nextBoxNumber(boxes) {
    return boxes.reduce((max, box) => Math.max(max, Number(box.number) || 0), 0) + 1;
  }

  return {
    storageKey,
    fallbackThumbs,
    WEIGHT_PER_SECOND,
    DESICCANT_WEIGHT,
    DEFAULT_WEIGHT_LIMIT,
    loadState,
    saveState,
    formatDuration,
    formatStamp,
    escapeHtml,
    segmentWeight,
    removeSegmentCascade,
    nextBoxNumber
  };
})();
