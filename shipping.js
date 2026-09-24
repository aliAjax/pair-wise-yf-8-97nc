/* 胶片装运台：选片入编号运输箱、登记防潮剂、封箱判定/锁定、收货退回待检。数据层见 store.js。 */

let state = Store.loadState();
let selectedBoxId = state.boxes[0]?.id || null;
let receiptBoxId = null; // 当前展开收货登记表的箱
const receiptDraft = {}; // segmentId -> { scratch, damp }，未提交前可反复改

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  statusFilter: document.querySelector("#statusFilter"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  exportBtn: document.querySelector("#exportBtn"),
  addBoxBtn: document.querySelector("#addBoxBtn"),
  boxList: document.querySelector("#boxList"),
  segmentList: document.querySelector("#segmentList"),
  boxDetail: document.querySelector("#boxDetail"),
  returnList: document.querySelector("#returnList"),
  boxCount: document.querySelector("#boxCount"),
  packedCount: document.querySelector("#packedCount"),
  returnCount: document.querySelector("#returnCount"),
  globalHint: document.querySelector("#globalHint")
};

/* ---------- 查询与判定 ---------- */

function getSegment(id) {
  return state.segments.find((item) => item.id === id);
}

function getBox(id) {
  return state.boxes.find((box) => box.id === id);
}

function boxItems(box) {
  return box.itemIds.map(getSegment).filter(Boolean);
}

function boxWeight(box) {
  const filmWeight = boxItems(box).reduce((sum, item) => sum + Store.segmentWeight(item), 0);
  return filmWeight + (Number(box.desiccant) || 0) * Store.DESICCANT_WEIGHT;
}

// 装着同一编号片段的箱（含本箱）
function holdingBoxes(segmentId, exceptBoxId = null) {
  return state.boxes.filter((box) => box.id !== exceptBoxId && box.itemIds.includes(segmentId));
}

// 该片段是否已在收货后被退回待检（可能跨多箱）
function returnRecords(segmentId) {
  return state.boxes.flatMap((box) =>
    (box.returns || []).filter((record) => record.segmentId === segmentId).map((record) => ({ box, record }))
  );
}

/*
 * 封箱判定：
 * - 破损或偏色的片段在箱内 → 不能封
 * - 同一片段同时落入两箱 → 相关条目算重复 → 不能封
 * - 超重 → 不能封
 * 防潮剂为 0 只作提醒，不阻断封箱；箱内条目始终保留装入顺序。
 */
function evaluateBox(box) {
  const seen = new Map();
  const items = box.itemIds.map((id, order) => {
    const segment = getSegment(id);
    seen.set(id, (seen.get(id) || 0) + 1);
    return { id, order, segment };
  });

  const evaluated = items
    .filter((entry) => entry.segment)
    .map((entry) => {
      const { segment } = entry;
      const reasons = [];
      if (segment.shift !== "正常") reasons.push(segment.shift);
      if (segment.damage !== "完好") reasons.push(segment.damage);
      const duplicatedHere = seen.get(segment.id) > 1;
      const others = holdingBoxes(segment.id, box.id);
      const duplicated = duplicatedHere || others.length > 0;
      if (duplicated) {
        const where = [
          duplicatedHere ? `#${box.number}内重复` : "",
          ...others.map((other) => `#${other.number}`)
        ]
          .filter(Boolean)
          .join("、");
        reasons.push(`同段落入两箱（${where}）`);
      }
      return {
        id: segment.id,
        code: segment.code,
        problem: segment.shift !== "正常" || segment.damage !== "完好",
        duplicated,
        reasons
      };
    });

  const weight = boxWeight(box);
  const overweight = weight > Number(box.weightLimit);
  const empty = box.itemIds.length === 0;
  const canSeal = !empty && !overweight && evaluated.every((entry) => !entry.problem && !entry.duplicated);

  return { items: evaluated, weight, overweight, empty, canSeal };
}

function getFilteredSegments() {
  const status = els.statusFilter.value;
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  return state.segments.filter((segment) => {
    const packed = state.boxes.some((box) => box.itemIds.includes(segment.id));
    const returned = returnRecords(segment.id).length > 0;
    const problem = segment.damage !== "完好" || segment.shift !== "正常";
    const matchesStatus =
      status === "all" ||
      (status === "unpacked" && !packed) ||
      (status === "packed" && packed) ||
      (status === "problem" && problem) ||
      (status === "returned" && returned);
    const matchesColor = color === "all" || segment.shift === color;
    const matchesKeyword = !keyword || `${segment.code}${segment.note}${segment.damage}`.includes(keyword);
    return matchesStatus && matchesColor && matchesKeyword;
  });
}

/* ---------- 渲染：顶部统计与漏带提醒 ---------- */

function renderStats() {
  const sealed = state.boxes.filter((box) => box.sealed).length;
  els.boxCount.textContent = `${sealed}/${state.boxes.length}`;

  const packedIds = new Set(state.boxes.flatMap((box) => box.itemIds));
  const returnedIds = new Set(
    state.boxes.flatMap((box) => (box.returns || []).map((record) => record.segmentId))
  );
  els.packedCount.textContent = String(packedIds.size);
  els.returnCount.textContent = String(returnedIds.size);

  const missing = state.segments.filter((segment) => !packedIds.has(segment.id));
  if (missing.length) {
    els.globalHint.textContent = `发货前注意：还有 ${missing.length} 个片段未装箱（${missing
      .map((item) => item.code)
      .join("、")}），避免漏带。`;
    els.globalHint.classList.add("show");
  } else {
    els.globalHint.textContent = "";
    els.globalHint.classList.remove("show");
  }
}

/* ---------- 渲染：运输箱列表 ---------- */

function boxStatusBadge(box) {
  if (!box.sealed) return `<span class="badge badge-open">待封箱</span>`;
  if (box.received && box.returns.length) return `<span class="badge badge-returned">已收货·部分退回</span>`;
  if (box.received) return `<span class="badge badge-sealed">已收货封存</span>`;
  return `<span class="badge badge-sealed">已封箱锁定</span>`;
}

function renderBoxList() {
  if (!state.boxes.length) {
    els.boxList.innerHTML = `<p class="empty">还没有运输箱，点「＋ 新箱」开始装运。</p>`;
    return;
  }
  els.boxList.innerHTML = state.boxes
    .map((box) => {
      const result = box.sealed
        ? { weight: box.sealedWeight ?? boxWeight(box), overweight: (box.sealedWeight ?? boxWeight(box)) > Number(box.weightLimit) }
        : evaluateBox(box);
      const weight = result.weight;
      const limit = Number(box.weightLimit);
      const ratio = Math.max(0, Math.min(1, weight / limit));
      const issueCount = box.sealed ? 0 : result.items.filter((entry) => entry.problem || entry.duplicated).length;
      return `
        <button type="button" class="box-card ${box.id === selectedBoxId ? "selected" : ""}" data-select-box="${box.id}">
          <div class="box-card-head">
            <strong>#${box.number} 运输箱</strong>
            ${boxStatusBadge(box)}
          </div>
          <div class="box-card-meta">
            <span>${box.sealed ? box.sealedCount ?? box.itemIds.length : box.itemIds.length} 条</span>
            <span>防潮剂 ${box.desiccant} 包</span>
          </div>
          <div class="weight-line ${result.overweight ? "over" : ""}">
            <div class="weight-bar"><i style="width:${ratio * 100}%"></i></div>
            <span>${weight}g / ${limit}g${result.overweight ? " · 超重" : ""}</span>
          </div>
          <div class="box-card-flags">
            ${!box.sealed && result.overweight ? `<span class="mini-badge bad">超重</span>` : ""}
            ${!box.sealed && issueCount ? `<span class="mini-badge bad">${issueCount} 条异常/重复</span>` : ""}
            ${box.returns.length ? `<span class="mini-badge warn">${box.returns.length} 条退回</span>` : ""}
          </div>
        </button>
      `;
    })
    .join("");
}

/* ---------- 渲染：当前箱详情与封箱判定 ---------- */

function renderJudge(box) {
  const result = evaluateBox(box);
  const entries = result.items
    .map((entry) => {
      const tags = entry.reasons.map((reason) => `<span class="mini-badge bad">${Store.escapeHtml(reason)}</span>`).join(" ");
      return `
        <div class="box-item">
          <span class="box-item-code">${entry.order + 1}. ${Store.escapeHtml(entry.code)}</span>
          <span class="box-item-tags">${tags || '<span class="mini-badge ok">合格</span>'}</span>
          <button type="button" class="mini icon-btn" title="移回片段池" data-remove-item="${entry.id}" data-box="${box.id}">移出</button>
        </div>
      `;
    })
    .join("");

  const blocks = [];
  if (result.empty) blocks.push("箱内还没有片段");
  if (result.overweight) blocks.push(`超重：${result.weight}g 已超过限重 ${box.weightLimit}g`);
  const flagged = result.items.filter((entry) => entry.problem || entry.duplicated);
  if (flagged.length) blocks.push(`破损/偏色或重复入箱：${flagged.map((entry) => entry.code).join("、")}`);

  const verdict = result.canSeal
    ? `<div class="verdict ok">检查通过，可以封箱。封箱后将锁定，不能再改。</div>`
    : `<div class="verdict bad">暂不能封箱：${Store.escapeHtml(blocks.join("；"))}。请调整后再封，已装条目保持原顺序。</div>`;

  const desiccantHint = Number(box.desiccant) === 0 ? `<p class="soft-hint">本箱未放防潮剂，长途寄送建议补放。</p>` : "";

  return `
    <div class="box-items">${entries || `<p class="empty">空箱，从中间片段池装入。</p>`}</div>
    ${desiccantHint}
    ${verdict}
  `;
}

function renderReceipt(box) {
  const items = boxItems(box);
  const rows = items
    .map((segment) => {
      const draft = receiptDraft[segment.id] || (receiptDraft[segment.id] = { scratch: false, damp: false });
      return `
        <div class="receipt-row">
          <strong>${Store.escapeHtml(segment.code)}</strong>
          <label class="check"><input type="checkbox" data-receipt="${segment.id}" data-field="scratch" ${draft.scratch ? "checked" : ""}/> 新划痕</label>
          <label class="check"><input type="checkbox" data-receipt="${segment.id}" data-field="damp" ${draft.damp ? "checked" : ""}/> 受潮</label>
        </div>
      `;
    })
    .join("");
  return `
    <div class="receipt">
      <p class="soft-hint">逐条核对收货外观；只勾选有新划痕或受潮的片段，其余随箱继续封存。</p>
      <div class="receipt-rows">${rows}</div>
      <div class="receipt-actions">
        <button type="button" class="primary" data-submit-receipt="${box.id}">提交收货核对</button>
        <button type="button" data-cancel-receipt>取消</button>
      </div>
    </div>
  `;
}

function renderDetail() {
  const box = getBox(selectedBoxId);
  if (!box) {
    els.boxDetail.innerHTML = `<p class="empty">请选择或新建一个运输箱。</p>`;
    return;
  }

  if (!box.sealed) {
    els.boxDetail.innerHTML = `
      <div class="box-fields">
        <label>箱号
          <input type="number" min="1" value="${box.number}" data-box-field="number" />
        </label>
        <label>限重（克）
          <input type="number" min="1" value="${box.weightLimit}" data-box-field="weightLimit" />
        </label>
        <label>防潮剂（包）
          <input type="number" min="0" value="${box.desiccant}" data-box-field="desiccant" />
        </label>
      </div>
      ${renderJudge(box)}
      <div class="detail-actions">
        <button type="button" class="primary" data-seal="${box.id}" ${evaluateBox(box).canSeal ? "" : "disabled"}>封箱并锁定</button>
        <button type="button" data-remove-box="${box.id}">删除此箱</button>
      </div>
    `;
    return;
  }

  // 已封箱：只读锁定信息
  const items = boxItems(box)
    .map((segment, index) => {
      const record = (box.returns || []).find((item) => item.segmentId === segment.id);
      return `
        <div class="box-item locked">
          <span class="box-item-code">${index + 1}. ${Store.escapeHtml(segment.code)}</span>
          ${record ? `<span class="mini-badge warn">已退回：${Store.escapeHtml(reasonText(record))}</span>` : `<span class="mini-badge ok">随箱封存</span>`}
        </div>
      `;
    })
    .join("");

  const sealedLine = `
    <p class="soft-hint">封箱于 ${Store.escapeHtml(Store.formatStamp(box.sealedAt))}，封箱重量 ${box.sealedWeight}g，共 ${box.sealedCount} 条；已锁定不能更改。</p>
  `;
  const receivedLine = box.received
    ? `<p class="soft-hint">收货登记于 ${Store.escapeHtml(Store.formatStamp(box.receivedAt))}。</p>`
    : "";
  const receiptEntry =
    receiptBoxId === box.id
      ? renderReceipt(box)
      : !box.received
        ? `<button type="button" class="primary" data-start-receipt="${box.id}">收货外观核对</button>`
        : "";

  els.boxDetail.innerHTML = `
    <div class="locked-head">
      <strong>#${box.number} 运输箱</strong>
      ${boxStatusBadge(box)}
    </div>
    ${sealedLine}
    <div class="box-items">${items}</div>
    ${receivedLine}
    <div class="detail-actions">${receiptEntry}</div>
  `;
}

function reasonText(record) {
  if (record.scratch && record.damp) return "新划痕＋受潮";
  if (record.scratch) return "新划痕";
  if (record.damp) return "受潮";
  return record.reason || "外观异常";
}

/* ---------- 渲染：片段池 ---------- */

function renderSegmentPool() {
  const segments = getFilteredSegments();
  const selectedBox = getBox(selectedBoxId);
  els.segmentList.innerHTML = segments
    .map((segment, index) => {
      const realIndex = state.segments.findIndex((item) => item.id === segment.id);
      const hasDamage = segment.damage !== "完好";
      const heldBy = state.boxes.filter((box) => box.itemIds.includes(segment.id));
      const returns = returnRecords(segment.id);
      const heldText = heldBy.length ? `在 ${heldBy.map((box) => `#${box.number}`).join("、")}` : "待装";
      const canAdd = selectedBox && !selectedBox.sealed && !selectedBox.itemIds.includes(segment.id);
      const addTitle = !selectedBox
        ? "先在左侧选择一个运输箱"
        : selectedBox.sealed
          ? "该箱已封箱锁定"
          : selectedBox.itemIds.includes(segment.id)
            ? "已在此箱中"
            : `装入 #${selectedBox.number} 箱`;

      return `
        <article class="segment-card compact" data-id="${segment.id}">
          <div class="thumb">
            ${
              segment.thumb
                ? `<img src="${segment.thumb}" alt="${Store.escapeHtml(segment.code)}缩略图" />`
                : `<div class="film-placeholder" style="background:${Store.fallbackThumbs[realIndex % Store.fallbackThumbs.length]}">${Store.escapeHtml(segment.code)}</div>`
            }
          </div>
          <div class="segment-main">
            <div class="segment-title">
              <strong>${realIndex + 1}. ${Store.escapeHtml(segment.code)}</strong>
              <span>${Store.formatDuration(segment.duration)} · ${Store.segmentWeight(segment)}g</span>
            </div>
            <div class="tag-row">
              <span class="tag">${Store.escapeHtml(segment.shift)}</span>
              <span class="tag ${hasDamage ? "damage" : "ok"}">${Store.escapeHtml(segment.damage)}</span>
              ${returns.length ? `<span class="tag damage">退回待检（${returns.map(({ box }) => `#${box.number}`).join("、")}）</span>` : `<span class="tag location">${heldText}</span>`}
            </div>
          </div>
          <div class="segment-actions">
            <button type="button" title="${addTitle}" data-add="${segment.id}" ${canAdd ? "" : "disabled"}>装入选中箱</button>
          </div>
        </article>
      `;
    })
    .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

/* ---------- 渲染：收货后待检 ---------- */

function renderReturns() {
  const entries = state.boxes.flatMap((box) =>
    (box.returns || []).map((record) => ({ box, record }))
  );
  els.returnList.innerHTML = entries
    .map(({ box, record }) => {
      const segment = getSegment(record.segmentId);
      if (!segment) return "";
      return `
        <div class="warning-item">
          <strong>${Store.escapeHtml(segment.code)}（来自 #${box.number}）</strong>
          <span>${Store.escapeHtml(reasonText(record))} · ${Store.formatStamp(record.at)}</span>
          <button type="button" class="mini" data-release="${record.id}" data-box="${box.id}">复检通过，移出待检</button>
        </div>
      `;
    })
    .join("") || `<p class="empty">收货后暂无退回片段；其余箱照常封存。</p>`;
}

function renderAll() {
  Store.saveState(state);
  if (!getBox(selectedBoxId)) {
    selectedBoxId = state.boxes[0]?.id || null;
    receiptBoxId = null;
  }
  els.reelTitle.value = state.reelTitle;
  renderStats();
  renderBoxList();
  renderDetail();
  renderSegmentPool();
  renderReturns();
}

/* ---------- 操作 ---------- */

function addBox() {
  const box = {
    id: crypto.randomUUID(),
    number: Store.nextBoxNumber(state.boxes),
    weightLimit: Store.DEFAULT_WEIGHT_LIMIT,
    desiccant: 1,
    itemIds: [],
    sealed: false,
    sealedAt: null,
    sealedWeight: null,
    sealedCount: null,
    received: false,
    receivedAt: null,
    returns: []
  };
  state.boxes.push(box);
  selectedBoxId = box.id;
  receiptBoxId = null;
  renderAll();
}

function updateBoxField(box, field, rawValue) {
  if (box.sealed) return;
  // 仅在失焦 change 时提交；清空或非法输入回滚为原值，避免输入过程被打断
  const value = Math.trunc(Number(rawValue));
  if (!rawValue.trim() || !Number.isFinite(value)) {
    renderAll();
    return;
  }
  if (field === "number") {
    box.number = Math.max(1, value);
  } else if (field === "weightLimit") {
    box.weightLimit = Math.max(1, value);
  } else if (field === "desiccant") {
    box.desiccant = Math.max(0, value);
  }
  renderAll();
}

function addToBox(segmentId) {
  const box = getBox(selectedBoxId);
  if (!box || box.sealed) return;
  if (box.itemIds.includes(segmentId)) return;
  // 只追加，不重排，箱内顺序就是装入顺序
  box.itemIds.push(segmentId);
  renderAll();
}

function removeFromBox(boxId, segmentId) {
  const box = getBox(boxId);
  if (!box || box.sealed) return;
  box.itemIds = box.itemIds.filter((id) => id !== segmentId);
  renderAll();
}

function sealBox(boxId) {
  const box = getBox(boxId);
  if (!box || box.sealed) return;
  const result = evaluateBox(box);
  if (!result.canSeal) return;
  box.sealed = true;
  box.sealedAt = new Date().toISOString();
  box.sealedWeight = result.weight;
  box.sealedCount = box.itemIds.length;
  receiptBoxId = null;
  renderAll();
}

function submitReceipt(boxId) {
  const box = getBox(boxId);
  if (!box || !box.sealed || box.received) return;
  const now = new Date().toISOString();
  // 只有勾选了新划痕或受潮的片段退回待检，其余条目随箱照常封存
  boxItems(box).forEach((segment) => {
    const draft = receiptDraft[segment.id] || { scratch: false, damp: false };
    const existed = (box.returns || []).some((record) => record.segmentId === segment.id);
    if ((draft.scratch || draft.damp) && !existed) {
      box.returns.push({
        id: crypto.randomUUID(),
        segmentId: segment.id,
        scratch: draft.scratch,
        damp: draft.damp,
        at: now
      });
    }
  });
  box.received = true;
  box.receivedAt = now;
  receiptBoxId = null;
  Object.keys(receiptDraft).forEach((key) => delete receiptDraft[key]);
  renderAll();
}

function releaseFromQuarantine(boxId, recordId) {
  const box = getBox(boxId);
  if (!box) return;
  box.returns = (box.returns || []).filter((record) => record.id !== recordId);
  renderAll();
}

/* ---------- 导出装箱单 ---------- */

function exportPackingList() {
  const packedIds = new Set(state.boxes.flatMap((box) => box.itemIds));
  const missing = state.segments.filter((segment) => !packedIds.has(segment.id));
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `装箱单导出时间：${Store.formatStamp(new Date().toISOString())}`,
    `运输箱：${state.boxes.length} 箱（已封 ${state.boxes.filter((box) => box.sealed).length} 箱），已装片段 ${packedIds.size} 条`,
    ""
  ];

  state.boxes.forEach((box) => {
    const result = box.sealed ? null : evaluateBox(box);
    const status = !box.sealed
      ? result.canSeal
        ? "待封箱（可封）"
        : "待封箱（暂不能封）"
      : box.received
        ? box.returns.length
          ? "已收货·部分退回"
          : "已收货封存"
        : "已封箱锁定";
    lines.push(`运输箱 #${box.number}｜${status}｜限重 ${box.weightLimit}g｜${box.sealed ? `封箱重量 ${box.sealedWeight}g` : `当前重量 ${result.weight}g`}｜防潮剂 ${box.desiccant} 包｜片段 ${box.itemIds.length} 条`);
    if (box.sealed && box.sealedAt) lines.push(`封箱时间：${Store.formatStamp(box.sealedAt)}`);
    boxItems(box).forEach((segment, index) => {
      const flags = [segment.shift !== "正常" ? segment.shift : "", segment.damage !== "完好" ? segment.damage : ""].filter(Boolean).join("·");
      lines.push(`  ${index + 1}. ${segment.code}｜${Store.formatDuration(segment.duration)}｜${Store.segmentWeight(segment)}g${flags ? `｜${flags}` : ""}`);
    });
    if (!box.sealed && result) {
      const flagged = result.items.filter((entry) => entry.problem || entry.duplicated);
      if (result.overweight) lines.push(`  阻断：超重 ${result.weight}g > ${box.weightLimit}g`);
      flagged.forEach((entry) => lines.push(`  阻断：${entry.code} ${entry.reasons.join("、")}`));
      if (Number(box.desiccant) === 0) lines.push(`  提醒：未放防潮剂`);
    }
    if (box.received) lines.push(`收货登记：${Store.formatStamp(box.receivedAt)}`);
    (box.returns || []).forEach((record) => {
      const segment = getSegment(record.segmentId);
      lines.push(`  退回待检：${segment ? segment.code : "已删除片段"}｜${reasonText(record)}｜${Store.formatStamp(record.at)}`);
    });
    lines.push("");
  });

  lines.push(`未装箱片段（${missing.length} 条）：${missing.length ? missing.map((item) => item.code).join("、") : "无"}`);
  const returned = state.boxes.flatMap((box) =>
    (box.returns || []).map((record) => {
      const segment = getSegment(record.segmentId);
      return segment ? `${segment.code}（#${box.number}·${reasonText(record)}）` : "";
    })
  ).filter(Boolean);
  lines.push(`退回待检片段（${returned.length} 条）：${returned.length ? returned.join("、") : "无"}`);

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-packing-list.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/* ---------- 事件 ---------- */

els.reelTitle.addEventListener("input", () => {
  state.reelTitle = els.reelTitle.value;
  Store.saveState(state);
});
els.statusFilter.addEventListener("change", renderSegmentPool);
els.colorFilter.addEventListener("change", renderSegmentPool);
els.searchInput.addEventListener("input", renderSegmentPool);
els.exportBtn.addEventListener("click", exportPackingList);
els.addBoxBtn.addEventListener("click", addBox);

els.boxList.addEventListener("click", (event) => {
  const card = event.target.closest("[data-select-box]");
  if (card) {
    selectedBoxId = card.dataset.selectBox;
    receiptBoxId = null;
    renderAll();
  }
});

els.boxDetail.addEventListener("change", (event) => {
  const field = event.target.closest("[data-box-field]");
  const receipt = event.target.closest("[data-receipt]");
  const box = getBox(selectedBoxId);
  if (field && box && !box.sealed) {
    updateBoxField(box, field.dataset.boxField, field.value);
  }
  if (receipt) {
    const id = receipt.dataset.receipt;
    const draft = receiptDraft[id] || (receiptDraft[id] = { scratch: false, damp: false });
    draft[receipt.dataset.field] = receipt.checked;
  }
});

els.boxDetail.addEventListener("click", (event) => {
  const seal = event.target.closest("[data-seal]");
  const removeBox = event.target.closest("[data-remove-box]");
  const removeItem = event.target.closest("[data-remove-item]");
  const startReceipt = event.target.closest("[data-start-receipt]");
  const cancelReceipt = event.target.closest("[data-cancel-receipt]");
  const submitReceiptBtn = event.target.closest("[data-submit-receipt]");
  if (seal) sealBox(seal.dataset.seal);
  if (removeBox) {
    const box = getBox(removeBox.dataset.removeBox);
    if (box && !box.sealed) {
      state.boxes = state.boxes.filter((item) => item.id !== box.id);
      selectedBoxId = state.boxes[0]?.id || null;
      renderAll();
    }
  }
  if (removeItem) removeFromBox(removeItem.dataset.box, removeItem.dataset.removeItem);
  if (startReceipt) {
    receiptBoxId = startReceipt.dataset.startReceipt;
    renderAll();
  }
  if (cancelReceipt) {
    receiptBoxId = null;
    renderAll();
  }
  if (submitReceiptBtn) submitReceipt(submitReceiptBtn.dataset.submitReceipt);
});

els.segmentList.addEventListener("click", (event) => {
  const add = event.target.closest("[data-add]");
  if (add && !add.disabled) addToBox(add.dataset.add);
});

els.returnList.addEventListener("click", (event) => {
  const release = event.target.closest("[data-release]");
  if (release) releaseFromQuarantine(release.dataset.box, release.dataset.release);
});

// 核对台等其他标签页写入后，本地同步最新数据
window.addEventListener("storage", (event) => {
  if (event.key !== Store.storageKey || !event.newValue) return;
  try {
    state = JSON.parse(event.newValue);
  } catch {
    return;
  }
  receiptBoxId = null;
  renderAll();
});

renderAll();
