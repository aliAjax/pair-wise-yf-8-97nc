/* 装运台页：编号运输箱、防潮剂、封箱判定与锁定、收货退回待检、装箱数/筛选/导出 */

const els = {
  reelTitle: document.querySelector("#reelTitle"),
  searchInput: document.querySelector("#searchInput"),
  boxStatusFilter: document.querySelector("#boxStatusFilter"),
  poolFilter: document.querySelector("#poolFilter"),
  newBoxBtn: document.querySelector("#newBoxBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  poolList: document.querySelector("#poolList"),
  boxList: document.querySelector("#boxList"),
  railBlockers: document.querySelector("#railBlockers"),
  railUnboxed: document.querySelector("#railUnboxed"),
  railInspection: document.querySelector("#railInspection"),
  boxCount: document.querySelector("#boxCount"),
  packedCount: document.querySelector("#packedCount"),
  pendingCount: document.querySelector("#pendingCount"),
  desiccantCount: document.querySelector("#desiccantCount")
};

// ---------- 片段池 ----------

function getFilteredPool() {
  const state = Store.getState();
  const keyword = els.searchInput.value.trim();
  const mode = els.poolFilter.value;
  return state.segments.filter((item) => {
    const inInspection = Store.isInInspection(item.id);
    const location = Store.locateSegment(item.id);
    if (mode === "unboxed" && (location || inInspection)) return false;
    if (mode === "issue" && Store.segmentIssue(item) === "" && !inInspection) return false;
    if (mode === "inspection" && !inInspection) return false;
    const matchesKeyword = !keyword || `${item.code}${item.note}${item.damage}`.includes(keyword);
    return matchesKeyword;
  });
}

function boxesOf(segmentId) {
  return Store.getState().boxes.filter((box) => box.itemIds.includes(segmentId));
}

function renderPool() {
  const state = Store.getState();
  const openBoxes = state.boxes.filter((box) => box.status === "open");
  const segments = getFilteredPool();

  els.poolList.innerHTML = segments
    .map((item) => {
      const order = state.segments.findIndex((segment) => segment.id === item.id) + 1;
      const inInspection = Store.isInInspection(item.id);
      const homes = boxesOf(item.id);
      const sealedHome = homes.find((box) => box.status === "sealed");
      const tags = `
        <span class="tag ${item.shift !== "正常" ? "damage" : ""}">${escapeHtml(item.shift)}</span>
        <span class="tag ${item.damage !== "完好" ? "damage" : "ok"}">${escapeHtml(item.damage)}</span>
      `;
      let action;
      if (inInspection) {
        action = `<button type="button" class="mini inspect" data-pass="${item.id}">复检通过</button>`;
      } else if (sealedHome) {
        action = `<span class="pool-loc">已封存于 No.${Store.padded(sealedHome.number)}</span>`;
      } else if (openBoxes.length) {
        const homeNumbers = new Set(homes.map((box) => box.number));
        const options = openBoxes
          .map(
            (box) =>
              `<option value="${box.number}" ${homeNumbers.has(box.number) ? "disabled" : ""}>No.${Store.padded(
                box.number
              )}${homeNumbers.has(box.number) ? "（已在本箱）" : ""}</option>`
          )
          .join("");
        action = `
          <span class="pool-add">
            <select data-target-box="${item.id}" aria-label="目标运输箱">${options}</select>
            <button type="button" class="mini primary" data-add="${item.id}">装入</button>
          </span>
        `;
      } else {
        action = `<span class="pool-loc muted">先新建运输箱</span>`;
      }
      const homeHint =
        homes.length && !sealedHome
          ? `<span class="pool-loc">已在：${homes
              .map((box) => `No.${Store.padded(box.number)}`)
              .join("、")}（落入两箱时两箱都不能封）</span>`
          : "";
      return `
        <article class="pool-card ${inInspection ? "is-inspect" : ""}">
          <div class="pool-card-head">
            <strong>${order}. ${escapeHtml(item.code)}</strong>
            <span>${formatDuration(item.duration)}</span>
          </div>
          <div class="tag-row">${tags}${inInspection ? `<span class="tag inspect-tag">待检</span>` : ""}</div>
          ${homeHint}
          ${action}
        </article>
      `;
    })
    .join("") || `<p class="empty">没有符合筛选的片段。</p>`;
}

// ---------- 运输箱 ----------

function renderBoxItem(box, id, order) {
  const segment = Store.getSegment(id);
  if (!segment) return "";
  const issue = Store.segmentIssue(segment);
  if (box.status === "open") {
    return `
      <li class="box-item ${issue ? "has-issue" : ""}">
        <span class="item-order">${order}</span>
        <strong>${escapeHtml(segment.code)}</strong>
        <span class="item-meta">${formatDuration(segment.duration)}｜${escapeHtml(segment.shift)}｜${escapeHtml(
      segment.damage
    )}</span>
        <button type="button" class="mini" data-remove-box="${box.number}" data-remove-id="${id}">移出</button>
      </li>
    `;
  }
  const scratchOn = Store.hasActiveFinding(id, box.number, "新划痕");
  const dampOn = Store.hasActiveFinding(id, box.number, "受潮");
  return `
    <li class="box-item sealed ${issue ? "has-issue" : ""}">
      <span class="item-order">${order}</span>
      <strong>${escapeHtml(segment.code)}</strong>
      <span class="item-meta">${formatDuration(segment.duration)}</span>
      <span class="receipt-actions">
        <button type="button" class="mini ${scratchOn ? "danger on" : ""}" data-find-box="${box.number}" data-find-id="${id}" data-find-type="新划痕">新划痕</button>
        <button type="button" class="mini ${dampOn ? "danger on" : ""}" data-find-box="${box.number}" data-find-id="${id}" data-find-type="受潮">受潮</button>
      </span>
    </li>
  `;
}

function renderFindingsLog(box) {
  const state = Store.getState();
  const records = Object.entries(state.inspection.findings)
    .flatMap(([segmentId, list]) => list.filter((finding) => finding.boxCode === box.number).map((finding) => ({ segmentId, finding })))
    .sort((a, b) => a.finding.at.localeCompare(b.finding.at));
  if (!records.length) return "";
  return `
    <div class="findings-log">
      <h4>收货核验记录</h4>
      <ul>
        ${records
          .map(({ segmentId, finding }) => {
            const segment = state.segments.find((item) => item.id === segmentId);
            return `
              <li class="${finding.resolved ? "resolved" : "active"}">
                <strong>${escapeHtml(segment ? segment.code : "已删除片段")}</strong>
                <span>${escapeHtml(finding.type)} · ${formatTime(finding.at)}</span>
                <em>${
                  finding.resolved
                    ? finding.outcome === "restored"
                      ? "已撤回归位"
                      : "已复检通过"
                    : "已退回待检，其余片段照常封存"
                }</em>
              </li>
            `;
          })
          .join("")}
      </ul>
    </div>
  `;
}

function renderBox(box) {
  const state = Store.getState();
  const sealed = box.status === "sealed";
  const orderedIds = Store.sortedItemIds(box.itemIds);
  const blockers = sealed ? [] : Store.boxBlockers(box.number);
  const overCapacity = box.capacity !== "" && box.capacity !== null && orderedIds.length > Number(box.capacity);
  const noDesiccant = Number(box.desiccant) === 0;

  const headControls = sealed
    ? `<span class="hint">勾选条目上的「新划痕 / 受潮」做收货核验</span>`
    : `<button type="button" class="mini danger" data-delete-box="${box.number}">删除箱</button>`;

  const settings = sealed
    ? ""
    : `
      <div class="box-settings">
        <label>
          防潮剂（袋）
          <input type="number" min="0" step="1" value="${Number(box.desiccant) || 0}"
                 data-desiccant="${box.number}" data-focus="desiccant-${box.number}" />
        </label>
        <label>
          装箱上限（段，留空不限）
          <input type="number" min="0" step="1" placeholder="不限" value="${box.capacity === "" ? "" : box.capacity}"
                 data-capacity="${box.number}" data-focus="capacity-${box.number}" />
        </label>
      </div>
    `;

  const items = orderedIds
    .map((id) => {
      const order = state.segments.findIndex((segment) => segment.id === id) + 1;
      return renderBoxItem(box, id, order);
    })
    .join("");

  const notices = [];
  if (!sealed && noDesiccant) notices.push(`<li class="notice-warn">未放防潮剂，外地运输建议至少 1 袋。</li>`);
  if (overCapacity)
    notices.push(
      `<li class="notice-warn">已装 ${orderedIds.length} 段，超过装箱上限 ${box.capacity} 段，注意超重。</li>`
    );
  if (!sealed) {
    blockers.forEach((reason) => notices.push(`<li class="notice-block">${escapeHtml(reason)}</li>`));
  }

  const footer = sealed
    ? `<p class="sealed-at">已封箱锁定 · ${formatTime(box.sealedAt)}</p>`
    : `
      <div class="box-footer">
        ${notices.length ? `<ul class="box-notices">${notices.join("")}</ul>` : ""}
        <button type="button" class="primary" data-seal="${box.number}" ${blockers.length ? "disabled" : ""}>
          ${blockers.length ? "存在问题，不能封箱" : "封箱并锁定"}
        </button>
      </div>
    `;

  return `
    <article class="box-card ${sealed ? "sealed" : "open"}" id="box-${box.number}">
      <header>
        <div class="box-title">
          <h3>运输箱 No.${Store.padded(box.number)}</h3>
          <span class="status-badge ${sealed ? "sealed" : "open"}">${sealed ? "已封存" : "待封箱"}</span>
        </div>
        <div class="box-head-meta">
          <span>${orderedIds.length} 段 · ${Number(box.desiccant) || 0} 袋防潮剂${
    box.capacity !== "" && box.capacity !== null ? ` · 上限 ${box.capacity}` : ""
  }</span>
          ${headControls}
        </div>
      </header>
      ${settings}
      <ol class="box-items">
        ${items || `<li class="empty">空箱，从左侧片段池装入。</li>`}
      </ol>
      ${renderFindingsLog(box)}
      ${footer}
    </article>
  `;
}

function renderBoxes() {
  const state = Store.getState();
  const status = els.boxStatusFilter.value;
  const boxes = state.boxes.filter((box) => status === "all" || box.status === status);
  els.boxList.innerHTML = boxes
    .map(renderBox)
    .join("") || `<p class="empty">${state.boxes.length ? "没有符合状态筛选的运输箱。" : "还没有运输箱，点击右上角「新建运输箱」开始装箱。"}</p>`;
}

// ---------- 右侧核对栏 ----------

function renderRail() {
  const state = Store.getState();

  const openBlocks = state.boxes
    .filter((box) => box.status === "open")
    .map((box) => ({ box, blockers: Store.boxBlockers(box.number) }))
    .filter((entry) => entry.blockers.length);
  els.railBlockers.innerHTML = openBlocks.length
    ? openBlocks
        .map(
          ({ box, blockers }) => `
            <div class="rail-item block">
              <strong>No.${Store.padded(box.number)}</strong>
              <ul>${blockers.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
            </div>
          `
        )
        .join("")
    : `<p class="empty">待封箱没有阻断问题。</p>`;

  const unboxed = state.segments.filter((item) => !Store.locateSegment(item.id) && !Store.isInInspection(item.id));
  els.railUnboxed.innerHTML = unboxed.length
    ? `<div class="chip-row">${unboxed
        .map((item) => {
          const issue = Store.segmentIssue(item);
          return `<span class="chip ${issue ? "warn" : ""}" title="${escapeHtml(item.note || "")}">${escapeHtml(
            item.code
          )}${issue ? `（${escapeHtml(issue)}）` : ""}</span>`;
        })
        .join("")}</div>`
    : `<p class="empty">没有漏带片段。</p>`;

  const inspectItems = state.segments.filter((item) => Store.isInInspection(item.id));
  els.railInspection.innerHTML = inspectItems.length
    ? inspectItems
        .map((item) => {
          const records = state.inspection.findings[item.id].filter((finding) => !finding.resolved);
          const detail = records
            .map((finding) => `No.${Store.padded(finding.boxCode)} 退回 · ${finding.type}`)
            .join("；");
          return `
            <div class="rail-item inspect">
              <strong>${escapeHtml(item.code)}</strong>
              <span>${escapeHtml(detail)}</span>
              <button type="button" class="mini inspect" data-pass="${item.id}">复检通过</button>
            </div>
          `;
        })
        .join("")
    : `<p class="empty">暂无收货退回的片段。</p>`;
}

// ---------- 统计 ----------

function renderStats() {
  const state = Store.getState();
  const packedEntries = state.boxes.reduce((sum, box) => sum + box.itemIds.length, 0);
  const inInspection = state.segments.filter((item) => Store.isInInspection(item.id)).length;
  const unboxed = state.segments.filter((item) => !Store.locateSegment(item.id) && !Store.isInInspection(item.id)).length;
  const desiccant = state.boxes.reduce((sum, box) => sum + (Number(box.desiccant) || 0), 0);
  els.boxCount.textContent = state.boxes.length;
  els.packedCount.textContent = packedEntries;
  els.pendingCount.textContent = `${unboxed} / ${inInspection}`;
  els.desiccantCount.textContent = desiccant;
}

// ---------- 渲染与焦点保持 ----------

let didInitialScroll = false;

function renderAll() {
  const state = Store.getState();
  const active = document.activeElement;
  const focusKey = active?.dataset?.focus;
  const caret = active && (active.type === "number" || active.type === "text") ? active.selectionStart : null;

  if (active !== els.reelTitle && active !== els.searchInput) els.reelTitle.value = state.reelTitle;
  renderStats();
  renderPool();
  renderBoxes();
  renderRail();

  if (focusKey) {
    const restored = document.querySelector(`[data-focus="${focusKey}"]`);
    if (restored) {
      restored.focus();
      if (caret !== null) restored.setSelectionRange(caret, caret);
    }
  }
  if (!didInitialScroll && location.hash) {
    document.querySelector(location.hash)?.scrollIntoView({ behavior: "smooth", block: "center" });
    didInitialScroll = true;
  }
}

// ---------- 导出装箱单 ----------

function exportManifest() {
  const state = Store.getState();
  const sealedCount = state.boxes.filter((box) => box.status === "sealed").length;
  const openCount = state.boxes.length - sealedCount;
  const packedEntries = state.boxes.reduce((sum, box) => sum + box.itemIds.length, 0);
  const desiccant = state.boxes.reduce((sum, box) => sum + (Number(box.desiccant) || 0), 0);

  const lines = [
    "胶片卷装箱单",
    `胶片卷：${state.reelTitle || "未命名胶片卷"}`,
    `导出时间：${formatTime(new Date().toISOString())}`,
    `运输箱：${state.boxes.length} 个（已封存 ${sealedCount}，待封箱 ${openCount}）`,
    `已装箱条目：${packedEntries} 段；防潮剂合计：${desiccant} 袋`,
    ""
  ];

  state.boxes.forEach((box) => {
    const orderedIds = Store.sortedItemIds(box.itemIds);
    lines.push(
      `No.${Store.padded(box.number)}｜${box.status === "sealed" ? `已封存（${formatTime(box.sealedAt)}）` : "待封箱"}`
    );
    lines.push(
      `防潮剂：${Number(box.desiccant) || 0} 袋；装箱上限：${
        box.capacity === "" || box.capacity === null ? "不限" : `${box.capacity} 段`
      }；片段数：${orderedIds.length}`
    );
    orderedIds.forEach((id, i) => {
      const segment = Store.getSegment(id);
      if (segment) {
        lines.push(
          `  ${i + 1}. ${segment.code}｜${formatDuration(segment.duration)}｜${segment.shift}｜${
            segment.damage
          }｜${segment.note || "无备注"}`
        );
      }
    });
    if (box.status === "open") {
      Store.boxBlockers(box.number).forEach((reason) => lines.push(`  [不能封箱] ${reason}`));
    }
    const findings = Object.entries(state.inspection.findings)
      .flatMap(([segmentId, list]) =>
        list
          .filter((finding) => finding.boxCode === box.number)
          .map((finding) => ({ segmentId, finding }))
      )
      .sort((a, b) => a.finding.at.localeCompare(b.finding.at));
    findings.forEach(({ segmentId, finding }) => {
      const segment = Store.getSegment(segmentId);
      const result = !finding.resolved
        ? "退回待检"
        : finding.outcome === "restored"
          ? "撤回归位"
          : "复检通过";
      lines.push(`  [收货${result}] ${segment ? segment.code : "已删除片段"}｜${finding.type}｜${formatTime(finding.at)}`);
    });
    lines.push("");
  });

  const unboxed = state.segments.filter((item) => !Store.locateSegment(item.id) && !Store.isInInspection(item.id));
  lines.push(`漏带片段（${unboxed.length} 段）：`);
  unboxed.forEach((item) => {
    const issue = Store.segmentIssue(item);
    lines.push(`  - ${item.code}${issue ? `（${issue}）` : ""}`);
  });
  lines.push("");

  const inspectItems = state.segments.filter((item) => Store.isInInspection(item.id));
  lines.push(`收货待检（${inspectItems.length} 段）：`);
  inspectItems.forEach((item) => {
    state.inspection.findings[item.id]
      .filter((finding) => !finding.resolved)
      .forEach((finding) => {
        lines.push(
          `  - ${item.code}｜自 No.${Store.padded(finding.boxCode)} 退回｜${finding.type}｜${formatTime(finding.at)}`
        );
      });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.reelTitle || "film-reel"}-装箱单.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------- 事件 ----------

els.newBoxBtn.addEventListener("click", () => Store.createBox());
els.exportBtn.addEventListener("click", exportManifest);
els.reelTitle.addEventListener("input", () => Store.setReelTitle(els.reelTitle.value));
els.searchInput.addEventListener("input", renderPool);
els.boxStatusFilter.addEventListener("change", renderBoxes);
els.poolFilter.addEventListener("change", renderPool);

els.poolList.addEventListener("click", (event) => {
  const addBtn = event.target.closest("[data-add]");
  const passBtn = event.target.closest("[data-pass]");
  if (addBtn) {
    const id = addBtn.dataset.add;
    const select = els.poolList.querySelector(`[data-target-box="${id}"]`);
    const result = Store.addToBox(Number(select.value), id);
    if (!result.ok) alert(result.reason);
    return;
  }
  if (passBtn) Store.passInspection(passBtn.dataset.pass);
});

els.boxList.addEventListener("click", (event) => {
  const sealBtn = event.target.closest("[data-seal]");
  const deleteBtn = event.target.closest("[data-delete-box]");
  const removeBtn = event.target.closest("[data-remove-box]");
  const findBtn = event.target.closest("[data-find-box]");

  if (sealBtn) {
    const result = Store.sealBox(Number(sealBtn.dataset.seal));
    if (!result.ok) alert(`不能封箱：\n${result.blockers.map((r) => `· ${r}`).join("\n")}`);
    return;
  }
  if (deleteBtn) {
    const number = Number(deleteBtn.dataset.deleteBox);
    if (confirm(`删除 No.${Store.padded(number)} 号运输箱？箱内条目会回到片段池。`)) {
      Store.deleteBox(number);
    }
    return;
  }
  if (removeBtn) {
    Store.removeFromBox(Number(removeBtn.dataset.removeBox), removeBtn.dataset.removeId);
    return;
  }
  if (findBtn) {
    const { findBox, findId, findType } = findBtn.dataset;
    const result = Store.toggleReceivingFinding(Number(findBox), findId, findType);
    if (!result.ok) alert(result.reason);
  }
});

els.railInspection.addEventListener("click", (event) => {
  const passBtn = event.target.closest("[data-pass]");
  if (passBtn) Store.passInspection(passBtn.dataset.pass);
});

els.boxList.addEventListener("input", (event) => {
  const desiccant = event.target.closest("[data-desiccant]");
  const capacity = event.target.closest("[data-capacity]");
  if (desiccant) {
    const value = Math.max(0, Math.floor(Number(desiccant.value) || 0));
    Store.setBoxField(Number(desiccant.dataset.desiccant), "desiccant", value);
  }
  if (capacity) {
    const raw = capacity.value.trim();
    Store.setBoxField(
      Number(capacity.dataset.capacity),
      "capacity",
      raw === "" ? "" : Math.max(0, Math.floor(Number(raw) || 0))
    );
  }
});

// 核对台在另一标签页改动片段后，本页自动刷新
Store.subscribe(renderAll);
renderAll();
