/* 核对台页：录入、排序、筛选、导出；装箱与待检状态与装运台共享并实时同步 */

const fallbackThumbs = ["#d49b35", "#347d89", "#b54d48", "#4d7656", "#6d6378"];
let draggedId = null;

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  colorFilter: document.querySelector("#colorFilter"),
  searchInput: document.querySelector("#searchInput"),
  segmentForm: document.querySelector("#segmentForm"),
  codeInput: document.querySelector("#codeInput"),
  durationInput: document.querySelector("#durationInput"),
  shiftInput: document.querySelector("#shiftInput"),
  damageInput: document.querySelector("#damageInput"),
  thumbInput: document.querySelector("#thumbInput"),
  noteInput: document.querySelector("#noteInput"),
  segmentList: document.querySelector("#segmentList"),
  warningList: document.querySelector("#warningList"),
  totalDuration: document.querySelector("#totalDuration"),
  damageCount: document.querySelector("#damageCount"),
  segmentCount: document.querySelector("#segmentCount"),
  inspectionCount: document.querySelector("#inspectionCount"),
  exportBtn: document.querySelector("#exportBtn")
};

function getFilteredSegments() {
  const state = Store.getState();
  const color = els.colorFilter.value;
  const keyword = els.searchInput.value.trim();
  return state.segments.filter((item) => {
    const matchesColor = color === "all" || item.shift === color;
    const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
    return matchesColor && matchesKeyword;
  });
}

function renderStats() {
  const state = Store.getState();
  const total = state.segments.reduce((sum, item) => sum + Number(item.duration), 0);
  const damaged = state.segments.filter((item) => item.damage !== "完好").length;
  const inInspection = state.segments.filter((item) => Store.isInInspection(item.id)).length;
  els.totalDuration.textContent = formatDuration(total);
  els.damageCount.textContent = damaged;
  els.segmentCount.textContent = state.segments.length;
  els.inspectionCount.textContent = inInspection;
}

function locationBadge(item) {
  if (Store.isInInspection(item.id)) {
    return `<span class="loc-badge inspect">收货待检</span>`;
  }
  const state = Store.getState();
  const homes = state.boxes.filter((box) => box.itemIds.includes(item.id));
  if (!homes.length) return "";
  return homes
    .map((box) => {
      const dup = homes.length > 1 ? " dup" : "";
      return `<a class="loc-badge ${box.status}${dup}" href="shipping.html#box-${box.number}">${
        box.status === "sealed" ? "已封存 " : "装箱中 "
      }No.${Store.padded(box.number)}</a>`;
    })
    .join("");
}

function renderList() {
  const state = Store.getState();
  const segments = getFilteredSegments();
  els.segmentList.innerHTML =
    segments
      .map((item) => {
        const realIndex = state.segments.findIndex((segment) => segment.id === item.id);
        const hasDamage = item.damage !== "完好";
        return `
          <article class="segment-card" draggable="true" data-id="${item.id}">
            <div class="thumb">
              ${
                item.thumb
                  ? `<img src="${item.thumb}" alt="${escapeHtml(item.code)}缩略图" />`
                  : `<div class="film-placeholder" style="background:${fallbackThumbs[realIndex % fallbackThumbs.length]}">${escapeHtml(item.code)}</div>`
              }
            </div>
            <div class="segment-main">
              <div class="segment-title">
                <strong>${realIndex + 1}. ${escapeHtml(item.code)}</strong>
                <span>${formatDuration(item.duration)}</span>
                ${locationBadge(item)}
              </div>
              <div class="tag-row">
                <span class="tag">${escapeHtml(item.shift)}</span>
                <span class="tag ${hasDamage ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
              </div>
              <p class="segment-note">${escapeHtml(item.note || "没有备注。")}</p>
            </div>
            <div class="segment-actions">
              <button type="button" title="上移" data-move-up="${item.id}">↑</button>
              <button type="button" title="下移" data-move-down="${item.id}">↓</button>
              <button type="button" title="删除" data-delete="${item.id}">×</button>
            </div>
          </article>
        `;
      })
      .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

function renderWarnings() {
  const state = Store.getState();
  const items = [];
  state.segments.forEach((item, index) => {
    if (Store.isInInspection(item.id)) {
      items.push({
        index,
        item,
        cls: "inspect",
        text: "收货退回待检：新划痕或受潮，复检后才能重新装箱。"
      });
      return;
    }
    const reasons = [
      item.shift !== "正常" ? item.shift : "",
      item.damage !== "完好" ? item.damage : ""
    ].filter(Boolean);
    if (reasons.length) {
      items.push({ index, item, cls: "warn", text: `${reasons.join(" · ")}${item.note ? `：${item.note}` : ""}` });
    }
  });
  els.warningList.innerHTML =
    items
      .map(
        ({ index, item, cls, text }) => `
          <div class="warning-item ${cls}">
            <strong>${index + 1}. ${escapeHtml(item.code)}</strong>
            <span>${escapeHtml(text)}</span>
          </div>
        `
      )
      .join("") || `<p class="empty">当前清单没有颜色偏移、破损或待检提醒。</p>`;
}

function renderAll() {
  const state = Store.getState();
  if (document.activeElement !== els.reelTitle) els.reelTitle.value = state.reelTitle;
  renderStats();
  renderList();
  renderWarnings();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve("");
    reader.readAsDataURL(file);
  });
}

async function addSegment(event) {
  event.preventDefault();
  await Store.addSegment({
    code: els.codeInput.value.trim(),
    duration: Number(els.durationInput.value),
    shift: els.shiftInput.value,
    damage: els.damageInput.value,
    note: els.noteInput.value.trim(),
    thumb: await readFileAsDataUrl(els.thumbInput.files[0])
  });
  els.segmentForm.reset();
  els.durationInput.value = 12;
}

function exportList() {
  const state = Store.getState();
  const lines = [
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `总时长：${formatDuration(state.segments.reduce((sum, item) => sum + Number(item.duration), 0))}`,
    "",
    ...state.segments.map(
      (item, index) =>
        `${index + 1}. ${item.code}｜${formatDuration(item.duration)}｜${item.shift}｜${item.damage}｜${
          item.note || "无备注"
        }`
    )
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-checklist.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

els.reelTitle.addEventListener("input", () => Store.setReelTitle(els.reelTitle.value));
els.colorFilter.addEventListener("change", renderList);
els.searchInput.addEventListener("input", renderList);
els.segmentForm.addEventListener("submit", addSegment);
els.exportBtn.addEventListener("click", exportList);

els.segmentList.addEventListener("click", (event) => {
  const up = event.target.closest("[data-move-up]");
  const down = event.target.closest("[data-move-down]");
  const remove = event.target.closest("[data-delete]");
  if (up) Store.reorderSegment(up.dataset.moveUp, -1);
  if (down) Store.reorderSegment(down.dataset.moveDown, 1);
  if (remove) {
    if (confirm("删除该片段会同时把它从所有运输箱和待检记录中移除，确定吗？")) {
      Store.removeSegmentCascade(remove.dataset.delete);
    }
  }
});

els.segmentList.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  draggedId = card.dataset.id;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

els.segmentList.addEventListener("dragend", (event) => {
  event.target.closest("[data-id]")?.classList.remove("dragging");
  draggedId = null;
});

els.segmentList.addEventListener("dragover", (event) => {
  const card = event.target.closest("[data-id]");
  const state = Store.getState();
  if (!card || !draggedId || card.dataset.id === draggedId) return;
  event.preventDefault();
  const fromIndex = state.segments.findIndex((item) => item.id === draggedId);
  const toIndex = state.segments.findIndex((item) => item.id === card.dataset.id);
  if (fromIndex < 0 || toIndex < 0) return;
  Store.moveSegmentTo(draggedId, toIndex);
});

// 装运台在另一标签页改动装箱数据后，本页自动刷新
Store.subscribe(renderAll);
renderAll();
