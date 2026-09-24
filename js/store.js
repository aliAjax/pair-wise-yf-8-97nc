/**
 * 共享数据层：本地保存、装运判定与全部修改动作。
 * 核对台与装运台两页都读写同一个 localStorage 键，storage 事件负责跨页同步。
 */
const Store = (() => {
  const storageKey = "zfl17-film-strip-desk";

  const defaultState = {
    reelTitle: "春日试映A卷",
    segments: [
      {
        id: "seed-1",
        code: "A-001",
        duration: 18,
        shift: "正常",
        damage: "完好",
        note: "开场街景，节奏平稳，适合保留原顺序。",
        thumb: ""
      },
      {
        id: "seed-2",
        code: "A-006",
        duration: 9,
        shift: "偏红",
        damage: "轻微划痕",
        note: "人物近景左侧有划痕，试映时留意是否明显。",
        thumb: ""
      },
      {
        id: "seed-3",
        code: "A-012",
        duration: 14,
        shift: "褪色",
        damage: "接片松动",
        note: "接片位置靠近段尾，放映前建议重新压平。",
        thumb: ""
      }
    ],
    boxes: [],
    boxSeq: 0,
    inspection: {
      // segmentId -> [{ boxCode, type: "新划痕" | "受潮", at, resolved: false }]
      findings: {}
    }
  };

  const listeners = new Set();
  let state = loadState();

  function loadState() {
    const saved = localStorage.getItem(storageKey);
    const base = structuredClone(defaultState);
    if (!saved) return base;
    try {
      const parsed = JSON.parse(saved);
      return {
        ...base,
        ...parsed,
        boxes: Array.isArray(parsed.boxes) ? parsed.boxes : [],
        boxSeq: typeof parsed.boxSeq === "number" ? parsed.boxSeq : 0,
        inspection: { findings: parsed.inspection?.findings ?? {} }
      };
    } catch {
      return base;
    }
  }

  function persist() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function mutate(fn) {
    const result = fn(state);
    persist();
    listeners.forEach((listener) => listener(state));
    return result;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  // storage 事件：另一页（或另一标签页）写入后，重新载入并通知本页
  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    state = loadState();
    listeners.forEach((listener) => listener(state));
  });

  // ---------- 查询 ----------

  const getState = () => state;
  const getSegment = (id) => state.segments.find((item) => item.id === id);

  function boxByNumber(number) {
    return state.boxes.find((box) => box.number === number);
  }

  function locateSegment(id) {
    for (const box of state.boxes) {
      if (box.itemIds.includes(id)) {
        return { boxNumber: box.number, boxStatus: box.status };
      }
    }
    return null;
  }

  /** 待检：有收货退回记录且尚未复检通过 */
  function isInInspection(segmentId) {
    return (state.inspection.findings[segmentId] ?? []).some((finding) => !finding.resolved);
  }

  function segmentIssue(segment) {
    // 装运前的问题：破损（非完好）或偏色（非正常）
    if (segment.damage !== "完好") return segment.damage;
    if (segment.shift !== "正常") return segment.shift;
    return "";
  }

  /**
   * 封箱判定（领域规则，页面只读结果）：
   * - 空箱不能封；
   * - 箱内有破损或偏色片段不能封；
   * - 同一片段落入两个运输箱不能封（以编号较小、未封的箱为冲突提示）；
   * 条目顺序始终按核对台放映顺序排列，不随装箱操作改变。
   */
  function boxBlockers(boxNumber, source = state) {
    const box = source.boxes.find((item) => item.number === boxNumber);
    if (!box) return ["运输箱不存在。"];
    const blockers = [];
    if (box.itemIds.length === 0) blockers.push("空箱，还没有装入片段。");

    const seen = new Map();
    for (const other of source.boxes) {
      if (other.number === box.number) continue;
      for (const id of other.itemIds) seen.set(id, other.number);
    }

    for (const id of box.itemIds) {
      const segment = source.segments.find((item) => item.id === id);
      if (!segment) continue;
      if (segment.damage !== "完好") blockers.push(`${segment.code} 存在破损（${segment.damage}）`);
      if (segment.shift !== "正常") blockers.push(`${segment.code} 颜色偏移（${segment.shift}）`);
      if (seen.has(id)) {
        blockers.push(`${segment.code} 同时落入 ${padded(seen.get(id))} 号箱，同一片段只能装一箱`);
      }
    }
    return blockers;
  }

  function sortedItemIds(ids, source = state) {
    return [...ids].sort((a, b) => {
      const ia = source.segments.findIndex((item) => item.id === a);
      const ib = source.segments.findIndex((item) => item.id === b);
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    });
  }

  function padded(number) {
    return String(number).padStart(3, "0");
  }

  // ---------- 核对台动作 ----------

  function addSegment(segment) {
    mutate((draft) => {
      draft.segments.push({ id: crypto.randomUUID(), thumb: "", ...segment });
    });
  }

  function reorderSegment(id, direction) {
    mutate((draft) => {
      const index = draft.segments.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= draft.segments.length) return;
      const [item] = draft.segments.splice(index, 1);
      draft.segments.splice(target, 0, item);
    });
  }

  function moveSegmentTo(id, toIndex) {
    mutate((draft) => {
      const from = draft.segments.findIndex((item) => item.id === id);
      if (from < 0 || toIndex < 0 || toIndex >= draft.segments.length) return;
      const [item] = draft.segments.splice(from, 1);
      draft.segments.splice(toIndex, 0, item);
    });
  }

  /** 删除片段时同步清出所有运输箱与待检记录（已封箱同样允许，避免幽灵条目） */
  function removeSegmentCascade(id) {
    mutate((draft) => {
      draft.segments = draft.segments.filter((item) => item.id !== id);
      for (const box of draft.boxes) {
        box.itemIds = box.itemIds.filter((itemId) => itemId !== id);
      }
      delete draft.inspection.findings[id];
    });
  }

  function setReelTitle(title) {
    mutate((draft) => {
      draft.reelTitle = title;
    });
  }

  // ---------- 装运台动作 ----------

  function createBox() {
    return mutate((draft) => {
      draft.boxSeq += 1;
      const number = draft.boxSeq;
      draft.boxes.push({
        number,
        itemIds: [],
        desiccant: 1,
        capacity: "",
        status: "open",
        sealedAt: null
      });
      return number;
    });
  }

  /** 只有未封箱可改；返回 false 表示已锁定 */
  function setBoxField(number, field, value) {
    return mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      if (!box || box.status === "sealed") return false;
      box[field] = value;
      return true;
    });
  }

  function addToBox(number, segmentId) {
    return mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      if (!box || box.status === "sealed") return { ok: false, reason: "该箱已封箱锁定。" };
      if (!draft.segments.some((item) => item.id === segmentId)) {
        return { ok: false, reason: "片段不存在。" };
      }
      if (isInInspectionIn(draft, segmentId)) {
        return { ok: false, reason: "该片段正在待检，复检通过后才能装箱。" };
      }
      if (box.itemIds.includes(segmentId)) {
        return { ok: false, reason: "该片段已在本箱。" };
      }
      // 允许与另一箱重复装入：封箱判定会拦下“同一片段落入两箱”的箱，
      // 由员工自行从其中一箱移出，而不是悄悄阻止装箱操作。
      box.itemIds.push(segmentId); // 展示时按放映顺序排序，保存原序追加即可
      return { ok: true };
    });
  }

  function removeFromBox(number, segmentId) {
    mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      if (!box || box.status === "sealed") return false;
      box.itemIds = box.itemIds.filter((id) => id !== segmentId);
      return true;
    });
  }

  function deleteBox(number) {
    return mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      if (!box) return false;
      if (box.status === "sealed") return false; // 封箱后锁定，不能删除
      draft.boxes = draft.boxes.filter((item) => item.number !== number);
      return true;
    });
  }

  /** 封箱：判定不通过时不动数据，返回原因列表 */
  function sealBox(number) {
    const blockers = boxBlockers(number);
    if (blockers.length) return { ok: false, blockers };
    mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      box.status = "sealed";
      box.sealedAt = new Date().toISOString();
      box.itemIds = sortedItemIds(box.itemIds, draft);
    });
    return { ok: true };
  }

  /**
   * 收货核验：只把勾选了新划痕/受潮的片段退回待检，
   * 其余条目留在箱内，箱保持封存（锁定）。
   */
  function toggleReceivingFinding(number, segmentId, type) {
    return mutate((draft) => {
      const box = draft.boxes.find((item) => item.number === number);
      if (!box || box.status !== "sealed") return { ok: false, reason: "只有已封箱能做收货核验。" };
      const records = (draft.inspection.findings[segmentId] ??= []);
      const index = records.findIndex(
        (f) => f.boxCode === box.number && f.type === type && !f.resolved
      );
      if (index >= 0) {
        // 误点取消：撤回退回，片段放回原箱（按放映顺序归位），箱继续封存；
        // 核验记录保留，标记 resolved 供装箱单/日志追溯。
        records[index].resolved = true;
        records[index].outcome = "restored";
        if (!box.itemIds.includes(segmentId)) {
          box.itemIds = sortedItemIds([...box.itemIds, segmentId], draft);
        }
        return { ok: true, active: false };
      }
      records.push({ boxCode: box.number, type, at: new Date().toISOString(), resolved: false });
      box.itemIds = box.itemIds.filter((id) => id !== segmentId);
      return { ok: true, active: true };
    });
  }

  function hasActiveFinding(segmentId, boxNumber, type) {
    return (state.inspection.findings[segmentId] ?? []).some(
      (finding) => finding.boxCode === boxNumber && finding.type === type && !finding.resolved
    );
  }

  /** 待检片段复检通过：回到普通片段池（不自动装箱，由装运台重新安排） */
  function passInspection(segmentId) {
    mutate((draft) => {
      const records = draft.inspection.findings[segmentId];
      if (!records) return;
      records.forEach((finding) => {
        finding.resolved = true;
        finding.outcome = "inspected";
      });
    });
  }

  function isInInspectionIn(draft, segmentId) {
    return (draft.inspection.findings[segmentId] ?? []).some((finding) => !finding.resolved);
  }

  return {
    getState,
    subscribe,
    getSegment,
    boxByNumber,
    locateSegment,
    isInInspection,
    segmentIssue,
    boxBlockers,
    sortedItemIds,
    padded,
    addSegment,
    reorderSegment,
    moveSegmentTo,
    removeSegmentCascade,
    setReelTitle,
    createBox,
    setBoxField,
    addToBox,
    removeFromBox,
    deleteBox,
    sealBox,
    toggleReceivingFinding,
    hasActiveFinding,
    passInspection
  };
})();
