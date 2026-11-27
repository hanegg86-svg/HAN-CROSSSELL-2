/**
 * PowerPoint Export Module (pptx-export.js)
 * สร้างไฟล์ PowerPoint (.pptx) ด้วย PptxGenJS แบบ Widescreen 16:9
 * รองรับการเลือกโครงการแบบ Multi-Select (1 โครงการ, หลายโครงการ หรือทั้งหมด)
 * ตัดชื่อโครงการที่ยาวเกิน 20 ตัวอักษรเหลือ 20 ตัวอักษรในหัวข้อสไลด์เพื่อไม่ให้ล้นขอบ
 * รองรับหน้าสรุปรวม Site Visit ทั้งหมดใน 1 หน้า (Executive One-Page Summary) แสดงตารางรายโครงการ + สินค้าที่เกี่ยวข้อง + สรุปสาระสำคัญของแต่ละสินค้า
 * รองรับตัวเลือก AI (gemini-3.5-flash-lite) สรุปรวม Site Report รายโครงการให้เหลือ 1 หน้าสไลด์เฉพาะตอนสร้างไฟล์ PPTX
 * แสดงวันที่เข้าตรวจครบทุกวันจากรายงานย่อยทั้งหมดในโครงการ (ไม่ย่อเป็นช่วงวันที่)
 * ปรับปรุงระบบสรุปด้วย AI ให้กระชับ ตัดข้อความซ้ำซ้อนและข้อความสถานะปกติเก่าที่ขัดแย้งออก และยกเลิกการตัดข้อความทิ้งท้าย (...) เพื่อให้ข้อมูลครบถ้วน
 * เพิ่มสไลด์ตาราง Matrix คาดการณ์ยอดขาย (โครงการ x กลุ่มสินค้า) โดยตัดรายการสินค้าและโครงการที่ไม่มี Forecast ออกอัตโนมัติ
 * ดึงตัวกรองช่วงเดือน กลุ่มสินค้า (รวมตัวกรองเฉพาะสินค้าที่เคยเกิด Actual และสินค้าที่กดเพิ่มเอง) และหน่วยแสดงผลแยกอิสระระหว่างกราฟ Forecast (forecastDisplayMode) และตาราง Matrix (matrixDisplayMode)
 * รองรับรายการสินค้าจาก MATERIALNAME (ช่อง O) ของไฟล์ Dealer ที่ไม่มี App Name / Prd Group โดยแสดงเฉพาะค่า Actual (ไม่มี Opp)
 * หน้าสรุป KPI และตาราง Top Projects ดึงยอดขายจริงทั้งหมด (Actual) จากไฟล์ Dealer ตามโครงการและช่วงเวลาที่เลือก (รวมสินค้าที่ไม่มี Opp เช่น Post Plus)
 */

let pptxAvailableProjectsList = []; // [{ key, id, name }]
let selectedPptxProjectKeys = new Set();

/**
 * ตัดชื่อโครงการที่ยาวเกิน 20 ตัวอักษร ให้เหลือเฉพาะ 20 ตัวอักษรแรก
 */
function truncateProjectName20(name) {
  const clean = String(name || '').trim();
  if (clean.length > 20) {
    return clean.slice(0, 20);
  }
  return clean;
}

/**
 * แปลงข้อความวันที่เป็น Timestamp เพื่อใช้เรียงลำดับวันที่เข้าตรวจจากเก่าไปใหม่
 */
function parseVisitDateTimestamp(dateStr) {
  const clean = String(dateStr || '').trim();
  if (!clean || clean === '-') return Number.MAX_SAFE_INTEGER;

  // รูปแบบ DD/MM/YYYY หรือ D/M/YY
  const dmyMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10) - 1;
    let y = parseInt(dmyMatch[3], 10);
    if (typeof normalizeYear === 'function') {
      y = normalizeYear(y, false);
    } else if (y > 2400) {
      y -= 543;
    } else if (y < 100) {
      y += 2000;
    }
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  // รูปแบบ YYYY-MM-DD หรือ YYYY/MM/DD
  const ymdMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymdMatch) {
    let y = parseInt(ymdMatch[1], 10);
    if (y > 2400) y -= 543;
    const m = parseInt(ymdMatch[2], 10) - 1;
    const d = parseInt(ymdMatch[3], 10);
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) return dt.getTime();
  }

  const parsed = Date.parse(clean);
  return isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

/**
 * รวบรวมวันที่เข้าตรวจทั้งหมดจากรายการรายงานย่อยของโครงการ ตัดค่าซ้ำ และเรียงลำดับครบทุกวัน
 */
function collectAllUniqueVisitDates(items) {
  const uniqueDates = new Set();
  (items || []).forEach(it => {
    const raw = String(it?.visitDate || '').trim();
    if (!raw || raw === '-') return;
    raw.split(',').forEach(part => {
      const token = part.trim();
      if (token && token !== '-') {
        uniqueDates.add(token);
      }
    });
  });

  return Array.from(uniqueDates)
    .sort((a, b) => parseVisitDateTimestamp(a) - parseVisitDateTimestamp(b))
    .join(', ');
}

function buildAvailableProjectsForPptx() {
  const map = new Map();

  // 1. ดึงจากรายการโครงการหลักในไฟล์ยอดขาย
  if (Array.isArray(allProjectListGlobal)) {
    allProjectListGlobal.forEach(p => {
      if (!p) return;
      const key = String(p.key || p.id || p.name || '').trim();
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          key: key,
          id: String(p.id || '').trim(),
          name: String(p.name || p.id || 'ไม่ระบุชื่อโครงการ').trim()
        });
      }
    });
  }

  // 2. เสริมโครงการที่มีอยู่ในรายงาน Site Visit แต่ยังไม่อยู่ในรายการหลัก
  if (Array.isArray(siteVisitLogsGlobal)) {
    siteVisitLogsGlobal.forEach(v => {
      if (!v) return;
      const vId = String(v.projectId || '').trim();
      const vName = String(v.projectName || '').trim();
      const lookupKey = (vId && vId !== '-' && vId !== 'Unknown') ? vId : vName;
      if (!lookupKey) return;

      const alreadyExists = Array.from(map.values()).some(existing =>
        existing.key === lookupKey ||
        (vId && vId !== '-' && vId !== 'Unknown' && existing.id === vId) ||
        (vName && existing.name === vName)
      );

      if (!alreadyExists) {
        map.set(lookupKey, {
          key: lookupKey,
          id: (vId && vId !== '-' && vId !== 'Unknown') ? vId : '',
          name: vName || vId
        });
      }
    });
  }

  pptxAvailableProjectsList = Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'th')
  );
}

function openPptxExportModal() {
  const modal = document.getElementById('pptxExportModal');
  if (!modal) return;

  buildAvailableProjectsForPptx();

  // กำหนดค่าเริ่มต้นตามตัวกรองโครงการหลักด้านบน
  selectedPptxProjectKeys.clear();
  if (selectedMasterProject !== 'all') {
    const matched = pptxAvailableProjectsList.find(p =>
      p.key === selectedMasterProject ||
      p.id === selectedMasterProject ||
      p.name === selectedMasterProject
    );
    if (matched) {
      selectedPptxProjectKeys.add(matched.key);
    } else {
      pptxAvailableProjectsList.forEach(p => selectedPptxProjectKeys.add(p.key));
    }
  } else {
    pptxAvailableProjectsList.forEach(p => selectedPptxProjectKeys.add(p.key));
  }

  const searchInput = document.getElementById('pptxProjectSearchInput');
  if (searchInput) searchInput.value = '';

  renderPptxProjectCheckboxes();
  updatePptxExportPreviewStats();
  modal.classList.remove('hidden');
}

function closePptxExportModal() {
  const modal = document.getElementById('pptxExportModal');
  if (modal) modal.classList.add('hidden');
}

function renderPptxProjectCheckboxes() {
  const container = document.getElementById('pptxProjectCheckboxList');
  const countBadge = document.getElementById('pptxSelectedProjectsCountBadge');
  if (countBadge) {
    countBadge.textContent = `เลือก ${selectedPptxProjectKeys.size} จาก ${pptxAvailableProjectsList.length} โครงการ`;
  }
  if (!container) return;

  if (pptxAvailableProjectsList.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-4">ยังไม่มีรายการโครงการในระบบ</div>`;
    return;
  }

  const searchTerm = (document.getElementById('pptxProjectSearchInput')?.value || '').toLowerCase().trim();
  const filtered = pptxAvailableProjectsList.filter(p => {
    if (!searchTerm) return true;
    return p.name.toLowerCase().includes(searchTerm) || p.id.toLowerCase().includes(searchTerm);
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-3">ไม่พบโครงการตามคำค้นหา</div>`;
    return;
  }

  container.innerHTML = filtered.map(p => {
    const isChecked = selectedPptxProjectKeys.has(p.key);
    const jsKey = escapeJsString(p.key);
    return `
      <label class="flex items-center justify-between gap-2 p-1.5 rounded-lg hover:bg-orange-50/70 border ${isChecked ? 'border-orange-200 bg-orange-50/30' : 'border-transparent'} cursor-pointer transition-colors">
        <div class="flex items-center gap-2 min-w-0">
          <input type="checkbox" ${isChecked ? 'checked' : ''}
                 onchange="toggleSinglePptxProject('${jsKey}', this.checked)"
                 class="rounded text-orange-600 focus:ring-orange-500 w-3.5 h-3.5 shrink-0">
          <span class="font-medium text-slate-800 truncate" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
        </div>
        <span class="text-[10px] font-mono text-slate-400 shrink-0">${escapeHtml(p.id || '-')}</span>
      </label>
    `;
  }).join('');
}

function toggleSinglePptxProject(projKey, isChecked) {
  if (isChecked) {
    selectedPptxProjectKeys.add(projKey);
  } else {
    selectedPptxProjectKeys.delete(projKey);
  }
  const countBadge = document.getElementById('pptxSelectedProjectsCountBadge');
  if (countBadge) {
    countBadge.textContent = `เลือก ${selectedPptxProjectKeys.size} จาก ${pptxAvailableProjectsList.length} โครงการ`;
  }
  updatePptxExportPreviewStats();
}

function toggleAllPptxProjects(shouldSelect) {
  const searchTerm = (document.getElementById('pptxProjectSearchInput')?.value || '').toLowerCase().trim();
  pptxAvailableProjectsList.forEach(p => {
    const matchSearch = !searchTerm ||
      p.name.toLowerCase().includes(searchTerm) ||
      p.id.toLowerCase().includes(searchTerm);

    if (matchSearch) {
      if (shouldSelect) {
        selectedPptxProjectKeys.add(p.key);
      } else {
        selectedPptxProjectKeys.delete(p.key);
      }
    }
  });
  renderPptxProjectCheckboxes();
  updatePptxExportPreviewStats();
}

/**
 * ตรวจสอบว่าโครงการที่ระบุอยู่ในรายการที่ผู้ใช้ติ๊กเลือกสำหรับ Export PowerPoint หรือไม่
 */
function isProjectSelectedForPptx(projId, projName, projKey = '') {
  if (!pptxAvailableProjectsList || pptxAvailableProjectsList.length === 0) return true;
  if (selectedPptxProjectKeys.size === 0) return false;
  if (selectedPptxProjectKeys.size === pptxAvailableProjectsList.length) return true;

  const cleanId = String(projId || '').trim();
  const cleanName = String(projName || '').trim();
  const cleanKey = String(projKey || '').trim();

  for (const key of selectedPptxProjectKeys) {
    if (cleanKey && key === cleanKey) return true;
    if (cleanId && key === cleanId) return true;
    if (cleanName && key === cleanName) return true;

    const projObj = pptxAvailableProjectsList.find(p => p.key === key);
    if (projObj) {
      if (cleanId && cleanId !== '-' && cleanId !== 'Unknown' && projObj.id === cleanId) return true;
      if (cleanName && projObj.name === cleanName) return true;
    }
  }
  return false;
}

/**
 * ตรวจสอบว่ากลุ่มสินค้าที่ระบุอยู่ในรายการที่เลือกของส่วน Sales Forecast หรือไม่
 */
function isProductSelectedForForecastPptx(productGroup) {
  if (!selectedForecastProducts || !Array.isArray(allForecastProductGroups) || allForecastProductGroups.length === 0) {
    return true;
  }
  return selectedForecastProducts.has(productGroup);
}

/**
 * สร้างข้อความสรุปชื่อโครงการที่เลือกสำหรับหัวข้อสไลด์ (ตัดชื่อแต่ละโครงการไม่เกิน 20 ตัวอักษร)
 */
function getSelectedProjectsSummaryLabel() {
  const total = pptxAvailableProjectsList.length;
  const count = selectedPptxProjectKeys.size;

  if (total === 0 || count === total) {
    return total > 0 ? `โครงการทั้งหมด (${total} โครงการ)` : 'โครงการทั้งหมด (All Projects)';
  }
  if (count === 0) {
    return 'ไม่ได้เลือกโครงการ (0 โครงการ)';
  }

  const selectedObjs = pptxAvailableProjectsList.filter(p => selectedPptxProjectKeys.has(p.key));
  if (selectedObjs.length === 1) {
    const p = selectedObjs[0];
    const shortName = truncateProjectName20(p.name);
    return `${shortName}${p.id ? ` (${p.id})` : ''}`;
  }
  if (selectedObjs.length <= 3) {
    return `เลือก ${selectedObjs.length} โครงการ: ${selectedObjs.map(p => truncateProjectName20(p.name)).join(', ')}`;
  }
  return `เลือก ${selectedObjs.length} โครงการ (${selectedObjs.slice(0, 2).map(p => truncateProjectName20(p.name)).join(', ')} และอีก ${selectedObjs.length - 2} โครงการ)`;
}

/**
 * จัดกลุ่มรายการ Site Visit ตามโครงการ (1 กลุ่ม = 1 โครงการ)
 */
function groupVisitsByProjectForPptx(visits) {
  const groupsMap = new Map();
  (visits || []).forEach(v => {
    const rawId = String(v.projectId || '').trim();
    const rawName = String(v.projectName || 'ไม่ระบุชื่อโครงการ').trim();
    const validId = (rawId && rawId !== '-' && rawId !== 'Unknown') ? rawId : '';
    const groupKey = validId || rawName.toLowerCase();

    if (!groupsMap.has(groupKey)) {
      groupsMap.set(groupKey, {
        groupKey,
        projectId: validId,
        projectName: rawName,
        items: []
      });
    }
    groupsMap.get(groupKey).items.push(v);
  });
  return Array.from(groupsMap.values());
}

/**
 * ตรวจสอบจำนวนข้อมูลและกราฟที่พร้อมส่งออกตามโครงการที่เลือกเพื่อแสดงใน Modal
 */
async function updatePptxExportPreviewStats() {
  const scopeLabelEl = document.getElementById('pptxScopeProjectLabel');
  const siteCountEl = document.getElementById('pptxPreviewSiteCount');
  const chartCountEl = document.getElementById('pptxPreviewChartCount');
  const useAiSummary = Boolean(document.getElementById('pptxAiSummarizeSiteReportCheckbox')?.checked);
  const includeOnePage = Boolean(document.getElementById('pptxIncludeSiteOnePageSummaryCheckbox')?.checked);

  if (scopeLabelEl) scopeLabelEl.textContent = getSelectedProjectsSummaryLabel();

  const visits = await getFilteredSiteVisitsForPptx();
  if (siteCountEl) {
    const onePageSuffix = (includeOnePage && visits.length > 0) ? ' + 1 สไลด์สรุป One Page' : '';
    if (useAiSummary && visits.length > 0) {
      const groupedProjects = groupVisitsByProjectForPptx(visits);
      siteCountEl.textContent = `${visits.length} รายการ (AI สรุปรวมเหลือ ${groupedProjects.length} สไลด์${onePageSuffix})`;
    } else {
      siteCountEl.textContent = `${visits.length} รายการ (${visits.length} สไลด์${onePageSuffix})`;
    }
  }

  const availableCharts = collectAvailableChartConfigs();
  const matrixData = computeForecastMatrixForPptx();
  if (chartCountEl) {
    const matrixLabel = matrixData
      ? ` + ตารางคาดการณ์ (${matrixData.products.length} สินค้า)`
      : '';
    chartCountEl.textContent = `KPI + ${availableCharts.length} กราฟวิเคราะห์${matrixLabel}`;
  }
}

/**
 * ดึงรายการ Site Visit ตามโครงการที่ติ๊กเลือกและตัวกรองเดือน
 */
async function getFilteredSiteVisitsForPptx() {
  let allVisits = Array.isArray(siteVisitLogsGlobal) ? siteVisitLogsGlobal : [];
  if (allVisits.length === 0 && typeof dbGetAll === 'function') {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    allVisits = await dbGetAll('site_visits');
  }

  let list = typeof filterSiteVisitsBySelectedMonths === 'function'
    ? filterSiteVisitsBySelectedMonths(allVisits)
    : allVisits;

  list = list.filter(item => isProjectSelectedForPptx(item.projectId, item.projectName));

  return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/**
 * ใช้ AI (gemini-3.5-flash-lite) สังเคราะห์รวมรายงานหน้างานหลายรายการของโครงการเดียวให้เหลือ 1 รายการสำหรับทำสไลด์ PPTX (1 โครงการ = 1 สไลด์)
 */
async function prepareSummarizedSiteVisitsForPptx(visits, statusTextEl) {
  const groups = groupVisitsByProjectForPptx(visits);
  const needsAi = groups.some(g => g.items.length > 1);

  let activeKey = geminiApiKey;
  if (!activeKey && typeof dbGet === 'function') {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    activeKey = (await dbGet('settings', 'gemini_api_key')) || '';
    geminiApiKey = activeKey;
  }

  if (needsAi && !activeKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const finalSlidesData = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];

    // หากโครงการนี้มีแค่ 1 รายงาน ใช้ข้อมูลเดิมทันทีโดยไม่ต้องเรียก AI
    if (group.items.length === 1) {
      finalSlidesData.push(group.items[0]);
      continue;
    }

    if (statusTextEl) {
      statusTextEl.textContent = `กำลังให้ AI (gemini-3.5-flash-lite) สรุปโครงการ "${truncateProjectName20(group.projectName)}" (${i + 1}/${groups.length})...`;
    }

    // รวบรวมรูปภาพหน้างานจากทุกรายการย่อยของโครงการนี้ (ตัดรูปซ้ำออก)
    const combinedImages = [];
    const seenImageKeys = new Set();
    group.items.forEach(item => {
      const itemImgs = (item.images && item.images.length > 0)
        ? item.images
        : (item.imageData ? [{ base64Data: item.imageData, mimeType: item.mimeType || 'image/jpeg' }] : []);

      itemImgs.forEach(imgObj => {
        if (!imgObj || !imgObj.base64Data) return;
        const cleanB64 = String(imgObj.base64Data).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const fingerprint = `${cleanB64.length}_${cleanB64.slice(0, 64)}`;
        if (!seenImageKeys.has(fingerprint)) {
          seenImageKeys.add(fingerprint);
          combinedImages.push({
            base64Data: cleanB64,
            mimeType: imgObj.mimeType || 'image/jpeg'
          });
        }
      });
    });

    const summarizedItem = await summarizeSingleProjectGroupWithAI(group, combinedImages, activeKey);
    finalSlidesData.push(summarizedItem);
  }

  return finalSlidesData;
}

/**
 * เรียกใช้โมเดล gemini-3.5-flash-lite เพื่อสรุปรวมรายงานหลายรายการของ 1 โครงการ
 * กำชับให้ยุบรวมเรื่องเดียวกันที่อัปเดตซ้ำข้ามสัปดาห์เป็น Bullet สั้นกระชับ ตัดข้อความสถานะปกติเก่าที่ขัดแย้งออก และคุมความยาวให้พอดีกรอบสไลด์โดยไม่ตัดใจความสำคัญ
 */
async function summarizeSingleProjectGroupWithAI(group, combinedImages, apiKey) {
  const allVisitDatesStr = collectAllUniqueVisitDates(group.items);

  // เรียงรายงานย่อยจากเก่าไปใหม่เพื่อให้ AI เห็นพัฒนาการและยึดสถานะล่าสุดเป็นหลัก
  const sortedItems = [...group.items].sort(
    (a, b) => parseVisitDateTimestamp(a.visitDate) - parseVisitDateTimestamp(b.visitDate)
  );

  const rawReportsText = sortedItems.map((item, idx) => {
    return `[รายงานย่อยที่ ${idx + 1}]
- วันที่เข้าตรวจ: ${item.visitDate || '-'}
- ผู้รับเหมา: ${item.contractor || '-'}
- ระดับความเสี่ยง: ${item.riskLevel || 'Low'}
- ความคืบหน้า & การใช้งานสินค้า: ${item.siteProgress || '-'}
- แผนเรียกสินค้า (Material Forecast): ${item.materialForecast || '-'}
- ปัญหา / ความเสี่ยง: ${item.issuesAndRisks || '-'}
- สิ่งที่ต้องติดตามต่อ: ${item.nextWeekActions || '-'}`;
  }).join('\n\n---\n\n');

  const promptText = `คุณคือผู้ช่วยวิศวกรและผู้จัดการฝ่ายขายโครงการก่อสร้าง (SCG B2B Sales) จงสังเคราะห์และสรุปรวมรายงานการเข้าเยี่ยมหน้างาน (Site Visit) จำนวน ${group.items.length} รายการต่อไปนี้ ซึ่งอยู่ภายใต้โครงการเดียวกันคือ "${group.projectName}" (${group.projectId || '-'}) ให้รวมเป็นรายงานสรุปฉบับเดียวสำหรับจัดวางลงในสไลด์ PowerPoint 1 หน้า

ข้อกำหนดสำคัญในการเขียนเพื่อให้อ่านง่าย กระชับ และพอดีกรอบสไลด์:
1. ห้ามนำข้อความของแต่ละสัปดาห์มาต่อกันด้วยเครื่องหมาย "|" ให้ "ยุบรวมเรื่องเดียวกันที่อัปเดตซ้ำข้ามสัปดาห์" โดยยึดสถานะล่าสุดเป็นหลัก และตัดคำฟุ่มเฟือย/คำเชื่อมยาวๆ ออก
2. ในช่อง "issuesAndRisks": หากสัปดาห์เก่าเคยระบุว่า "ไม่มีปัญหา/หน้างานปกติ" แต่สัปดาห์ถัดมามีปัญหาหรือความเสี่ยง ให้ "ตัดข้อความไม่มีปัญหาของสัปดาห์เก่าทิ้งไปเลย" แสดงเฉพาะปัญหาหรือความเสี่ยงที่เกิดขึ้นจริง
3. เขียนเป็นข้อสั้นๆ (ขึ้นต้นแต่ละข้อด้วย "• ") หัวข้อละ 2-3 ข้อ และ "สรุปให้กระชับอยู่ในช่วง 200-260 ตัวอักษรต่อช่อง" โดยยังเก็บตัวเลขสำคัญ ชื่อสินค้า คู่แข่ง และกำหนดการสำคัญไว้ครบถ้วน
4. ค่า "riskLevel" ต้องตอบเป็นภาษาอังกฤษคำใดคำหนึ่งเท่านั้น คือ "Low" หรือ "Medium" หรือ "High"

ตอบกลับเป็น JSON Object บริสุทธิ์เท่านั้น ตามโครงสร้างนี้:
{
  "contractor": "รายชื่อบริษัทผู้รับเหมาทั้งหมดที่เกี่ยวข้อง (คั่นด้วยเครื่องหมายจุลภาค)",
  "visitDate": "ระบุวันที่เข้าตรวจทั้งหมดทุกวันเรียงตามลำดับ คั่นด้วยเครื่องหมายจุลภาค ห้ามย่อเป็นช่วงวันที่",
  "siteProgress": "สรุปความคืบหน้าหน้างานและการใช้งานสินค้าล่าสุด (เป็น • Bullet สั้นกระชับ ~220-260 ตัวอักษร)",
  "materialForecast": "สรุปแผนเรียกสินค้าและปริมาณที่ต้องเข้าหน้างาน (เป็น • Bullet สั้นกระชับ ~200-250 ตัวอักษร)",
  "issuesAndRisks": "สรุปปัญหาและความเสี่ยงหน้างานที่ยังค้างอยู่ (หากไม่มีเลยให้ระบุ • หน้างานดำเนินไปตามแผนงานปกติ ~200-240 ตัวอักษร)",
  "nextWeekActions": "สรุปสิ่งที่ต้องติดตามต่อ (เป็น • Bullet สั้นกระชับ ~200-240 ตัวอักษร)",
  "riskLevel": "Low"
}

ข้อมูลรายงานย่อยของโครงการ (เรียงจากเก่าไปล่าสุด):
${rawReportsText}`;

  try {
    // บังคับใช้โมเดล gemini-3.5-flash-lite เท่านั้น
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText}`);
    }

    const resData = await response.json();
    const rawReply = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleanedJsonStr = rawReply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleanedJsonStr);

    const rawRisk = String(parsed.riskLevel || '').trim().toLowerCase();
    let finalRisk = 'Low';
    if (rawRisk.includes('high') || rawRisk.includes('วิกฤต')) finalRisk = 'High';
    else if (rawRisk.includes('med') || rawRisk.includes('เฝ้าระวัง')) finalRisk = 'Medium';

    return {
      projectId: group.projectId || '-',
      projectName: group.projectName,
      contractor: String(parsed.contractor || '-').trim(),
      visitDate: allVisitDatesStr || String(parsed.visitDate || '-').trim(),
      siteProgress: String(parsed.siteProgress || '-').trim(),
      materialForecast: String(parsed.materialForecast || '-').trim(),
      issuesAndRisks: String(parsed.issuesAndRisks || '-').trim(),
      nextWeekActions: String(parsed.nextWeekActions || '-').trim(),
      riskLevel: finalRisk,
      images: combinedImages,
      imageData: combinedImages.length > 0 ? combinedImages[0].base64Data : '',
      mimeType: combinedImages.length > 0 ? combinedImages[0].mimeType : ''
    };
  } catch (err) {
    console.error(`AI summarization fallback for project ${group.projectName}:`, err);
    // กรณีเรียก AI ไม่สำเร็จ ให้รวมข้อความแบบตัดซ้ำอัตโนมัติพร้อมแสดงวันที่เข้าตรวจครบทุกวัน
    const uniqueValues = (arr) => Array.from(new Set(arr.map(x => String(x || '').trim()).filter(x => x && x !== '-')));
    const contractors = uniqueValues(sortedItems.map(it => it.contractor));
    const progressList = uniqueValues(sortedItems.map(it => it.siteProgress));
    const forecastList = uniqueValues(sortedItems.map(it => it.materialForecast));
    let issuesList = uniqueValues(sortedItems.map(it => it.issuesAndRisks));
    if (issuesList.length > 1) {
      const nonNormalIssues = issuesList.filter(txt => !txt.includes('หน้างานดำเนินไปตามแผนงานปกติ'));
      if (nonNormalIssues.length > 0) issuesList = nonNormalIssues;
    }
    const actionsList = uniqueValues(sortedItems.map(it => it.nextWeekActions));

    let highestRisk = 'Low';
    if (sortedItems.some(it => it.riskLevel === 'High')) highestRisk = 'High';
    else if (sortedItems.some(it => it.riskLevel === 'Medium')) highestRisk = 'Medium';

    return {
      projectId: group.projectId || '-',
      projectName: group.projectName,
      contractor: contractors.join(', ') || '-',
      visitDate: allVisitDatesStr || '-',
      siteProgress: progressList.join('\n• ') ? (progressList.length > 1 ? `• ${progressList.join('\n• ')}` : progressList[0]) : '-',
      materialForecast: forecastList.join('\n• ') ? (forecastList.length > 1 ? `• ${forecastList.join('\n• ')}` : forecastList[0]) : '-',
      issuesAndRisks: issuesList.join('\n• ') ? (issuesList.length > 1 ? `• ${issuesList.join('\n• ')}` : issuesList[0]) : '-',
      nextWeekActions: actionsList.join('\n• ') ? (actionsList.length > 1 ? `• ${actionsList.join('\n• ')}` : actionsList[0]) : '-',
      riskLevel: highestRisk,
      images: combinedImages,
      imageData: combinedImages.length > 0 ? combinedImages[0].base64Data : '',
      mimeType: combinedImages.length > 0 ? combinedImages[0].mimeType : ''
    };
  }
}

/**
 * Fallback สกัดชื่อสินค้าที่เกี่ยวข้องและสรุปสาระสำคัญรายสินค้าจากข้อความรายงานหน้างาน
 */
function extractFallbackProductsForProject(projectId, projectName, combinedText) {
  const knownRules = [
    { label: 'ShinkoLite', regex: /shinkolite|ชินโคไลท์|อะคริลิค/i },
    { label: 'SCG Roof Truss', regex: /roof\s*truss|โครงหลังคา|โครงเหล็กหลังคา/i },
    { label: 'Metal Sheet', regex: /metal\s*sheet|เมทัลชีท|หลังคาเหล็ก|standing\s*seam|snaplock/i },
    { label: 'คอนกรีต CPAC (Slipform)', regex: /slipform|สลิปฟอร์ม/i },
    { label: 'คอนกรีต CPAC (Post-Tension)', regex: /post[\s\-]*tension|โพสต์เทนชั่น|พื้นโพสต์/i },
    { label: 'คอนกรีต CPAC', regex: /cpac|ซีแพค|คอนกรีต|เทคอนกรีต/i },
    { label: 'Silo Mortar / เครื่องพ่น', regex: /silo\s*mortar|mortar|มอร์ตาร์|ปูนฉาบ|เครื่องพ่น/i },
    { label: 'อิฐบล็อก Fast Brick', regex: /fast\s*brick|ฟาสต์บริค|อิฐมวลเบา|อิฐบล็อก/i }
  ];

  const foundProducts = [];
  const sentences = String(combinedText || '')
    .split(/[\n•|]+/)
    .map(s => s.trim())
    .filter(s => s && s !== '-' && !s.includes('หน้างานดำเนินไปตามแผนงานปกติ'));

  knownRules.forEach(rule => {
    if (rule.regex.test(combinedText)) {
      const matchedSentence = sentences.find(s => rule.regex.test(s)) || '';
      const shortNote = matchedSentence.length > 68
        ? `${matchedSentence.slice(0, 68)}...`
        : (matchedSentence || 'ติดตามความคืบหน้าและแผนเรียกสินค้า');
      foundProducts.push({ name: rule.label, summary: shortNote });
    }
  });

  // หากยังไม่พบคำสำคัญ ให้ดึงชื่อกลุ่มสินค้าจากไฟล์ยอดขายหลัก (projectsMapGlobal) มาแสดง
  if (foundProducts.length === 0 && typeof projectsMapGlobal === 'object' && projectsMapGlobal) {
    const pObj = Object.values(projectsMapGlobal).find(
      p => (projectId && p.id === projectId) || (projectName && p.name === projectName)
    );
    if (pObj && pObj.productDetails) {
      Object.keys(pObj.productDetails).slice(0, 3).forEach(prodName => {
        foundProducts.push({
          name: prodName,
          summary: sentences[0] ? sentences[0].slice(0, 65) : 'อัปเดตความคืบหน้าหน้างาน'
        });
      });
    }
  }

  if (foundProducts.length === 0) {
    const fallbackNote = sentences[0] ? sentences[0].slice(0, 85) : 'อัปเดตความคืบหน้าหน้างาน';
    return {
      productsText: 'สินค้าโครงการ (ทั่วไป)',
      summaryText: `• ${fallbackNote}`
    };
  }

  return {
    productsText: foundProducts.map(p => `• ${p.name}`).join('\n'),
    summaryText: foundProducts.map(p => `• ${p.name}: ${p.summary}`).join('\n')
  };
}

/**
 * สร้างเนื้อหาสรุปรวม Site Visit ทั้งหมดสำหรับหน้า Executive One-Page Summary
 * ใช้โมเดล gemini-3.5-flash-lite สกัดรายชื่อสินค้าที่เกี่ยวข้องและสรุปสาระสำคัญของแต่ละสินค้า พร้อม Fallback อัตโนมัติ
 */
async function prepareSiteVisitOnePageSummaryData(visits, statusTextEl) {
  const groups = groupVisitsByProjectForPptx(visits);

  let highRiskCount = 0;
  let mediumRiskCount = 0;
  let lowRiskCount = 0;

  const projectSummaries = groups.map(g => {
    const sorted = [...g.items].sort(
      (a, b) => parseVisitDateTimestamp(a.visitDate) - parseVisitDateTimestamp(b.visitDate)
    );

    let risk = 'Low';
    if (sorted.some(it => String(it.riskLevel || '').toLowerCase().includes('high'))) {
      risk = 'High';
      highRiskCount++;
    } else if (sorted.some(it => String(it.riskLevel || '').toLowerCase().includes('med'))) {
      risk = 'Medium';
      mediumRiskCount++;
    } else {
      lowRiskCount++;
    }

    const combinedProgress = sorted.map(it => it.siteProgress).filter(x => x && x !== '-').join(' | ');
    const combinedForecast = sorted.map(it => it.materialForecast).filter(x => x && x !== '-').join(' | ');
    const combinedIssue = sorted.map(it => it.issuesAndRisks).filter(x => x && x !== '-' && !x.includes('หน้างานดำเนินไปตามแผนงานปกติ')).join(' | ');
    const combinedAction = sorted.map(it => it.nextWeekActions).filter(x => x && x !== '-').join(' | ');

    const allCombinedText = [combinedProgress, combinedForecast, combinedIssue, combinedAction].filter(Boolean).join('\n');
    const fallbackProdInfo = extractFallbackProductsForProject(g.projectId, g.projectName, allCombinedText);

    return {
      projectId: g.projectId || '-',
      projectName: g.projectName,
      visitCount: g.items.length,
      risk,
      productsText: fallbackProdInfo.productsText,
      productSummaryText: fallbackProdInfo.summaryText,
      latestProgress: combinedProgress || '-',
      latestForecast: combinedForecast || '-',
      latestIssue: combinedIssue || 'หน้างานดำเนินไปตามแผนงานปกติ',
      latestAction: combinedAction || '-'
    };
  });

  // เรียงโครงการที่มีความเสี่ยงสูงขึ้นก่อน เพื่อให้ผู้บริหารเห็นจุดโฟกัสทันที
  const riskRank = { High: 0, Medium: 1, Low: 2 };
  projectSummaries.sort((a, b) => (riskRank[a.risk] ?? 2) - (riskRank[b.risk] ?? 2));

  // สร้าง Fallback สรุปภาพรวมผู้บริหารด้านขวา
  const buildFallbackExecutiveText = () => {
    const progressPoints = projectSummaries
      .filter(p => p.latestProgress && p.latestProgress !== '-')
      .slice(0, 3)
      .map(p => `• ${truncateProjectName20(p.projectName)}: ${p.latestProgress.slice(0, 75)}${p.latestProgress.length > 75 ? '...' : ''}`);

    const riskProjects = projectSummaries.filter(p => p.risk !== 'Low');
    const riskPoints = riskProjects.length > 0
      ? riskProjects.slice(0, 3).map(p => `• ${truncateProjectName20(p.projectName)}: ${p.latestIssue.slice(0, 75)}${p.latestIssue.length > 75 ? '...' : ''}`)
      : ['• ทุกโครงการดำเนินงานตามแผนปกติ ไม่พบความเสี่ยงระดับวิกฤต'];

    const actionPoints = projectSummaries
      .filter(p => (p.latestAction && p.latestAction !== '-') || (p.latestForecast && p.latestForecast !== '-'))
      .slice(0, 3)
      .map(p => {
        const act = (p.latestAction && p.latestAction !== '-') ? p.latestAction : p.latestForecast;
        return `• ${truncateProjectName20(p.projectName)}: ${act.slice(0, 75)}${act.length > 75 ? '...' : ''}`;
      });

    return {
      keyProgress: progressPoints.length > 0 ? progressPoints.join('\n') : '• อัปเดตความคืบหน้าและภาพถ่ายหน้างานครบถ้วนตามรอบการเข้าเยี่ยม',
      criticalRisks: riskPoints.join('\n'),
      keyActions: actionPoints.length > 0 ? actionPoints.join('\n') : '• ติดตามแผนเรียกสินค้าและประสานงานผู้รับเหมาตามกำหนดการ'
    };
  };

  let activeKey = geminiApiKey;
  if (!activeKey && typeof dbGet === 'function') {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    activeKey = (await dbGet('settings', 'gemini_api_key')) || '';
    geminiApiKey = activeKey;
  }

  let execSummary = buildFallbackExecutiveText();

  if (activeKey && projectSummaries.length > 0) {
    try {
      if (statusTextEl) {
        statusTextEl.textContent = 'กำลังให้ AI (gemini-3.5-flash-lite) สกัดสินค้าและสร้างหน้าสรุปรวม One Page...';
      }

      const digestInput = projectSummaries.map((p, idx) =>
        `[โครงการที่ ${idx + 1}] projectKey="${p.projectId !== '-' ? p.projectId : p.projectName}" | ชื่อโครงการ: ${p.projectName} (${p.projectId})\n` +
        `   - ความคืบหน้า & สินค้า: ${p.latestProgress}\n` +
        `   - แผนเรียกสินค้า: ${p.latestForecast}\n` +
        `   - ปัญหา/ความเสี่ยง: ${p.latestIssue}\n` +
        `   - แผนติดตามต่อ: ${p.latestAction}`
      ).join('\n\n');

      const promptText = `คุณคือผู้จัดการฝ่ายขายโครงการก่อสร้าง (SCG B2B Sales) จงวิเคราะห์รายงานการเข้าเยี่ยมหน้างาน (Site Visit) ทั้งหมดจำนวน ${projectSummaries.length} โครงการ เพื่อจัดทำสไลด์ผู้บริหารหน้าเดียว (Executive One-Page Summary)

สิ่งที่ต้องส่งกลับใน JSON:
1. "projects": อาเรย์ข้อมูลรายโครงการ (ครบทั้ง ${projectSummaries.length} โครงการ) โดยแต่ละโครงการให้สกัด:
   - "projectKey": ค่า projectKey ที่ตรงกับข้อมูลนำเข้า
   - "relatedProducts": รายชื่อสินค้าก่อสร้างที่เกี่ยวข้องในโครงการนั้น (ขึ้นต้นแต่ละตัวด้วย "• " เช่น "• ShinkoLite\\n• SCG Roof Truss" หรือ "• คอนกรีต CPAC (Slipform)")
   - "productSummaries": สรุปสาระสำคัญแยกตามแต่ละสินค้าในโครงการนั้นอย่างกระชับ (ขึ้นต้นแต่ละข้อด้วย "• ชื่อสินค้า: สาระสำคัญ/ปริมาณ/สถานะ" ความยาวรวม ~110-160 ตัวอักษร เพื่อให้อ่านง่ายในตาราง 1 หน้า)
2. "keyProgress": สรุปไฮไลต์ความคืบหน้าและปริมาณสินค้าเด่นภาพรวมทุกโครงการ (• Bullet สั้นกระชับ 2-3 ข้อ รวม ~180-230 ตัวอักษร)
3. "criticalRisks": สรุปปัญหาและความเสี่ยงสำคัญที่ต้องเฝ้าระวังเร่งด่วน (• Bullet สั้นกระชับ 2-3 ข้อ รวม ~180-230 ตัวอักษร)
4. "keyActions": สรุปแผนการติดตามงานและ Action สัปดาห์ถัดไป (• Bullet สั้นกระชับ 2-3 ข้อ รวม ~180-230 ตัวอักษร)

ตอบกลับเป็น JSON Object บริสุทธิ์เท่านั้น ตามโครงสร้างนี้:
{
  "projects": [
    {
      "projectKey": "P000...",
      "relatedProducts": "• สินค้า A\\n• สินค้า B",
      "productSummaries": "• สินค้า A: สรุปความคืบหน้า/ปริมาณ\\n• สินค้า B: สรุปสถานะ/แผนงาน"
    }
  ],
  "keyProgress": "...",
  "criticalRisks": "...",
  "keyActions": "..."
}

ข้อมูลรายงานทั้ง ${projectSummaries.length} โครงการ:
${digestInput}`;

      // บังคับใช้โมเดล gemini-3.5-flash-lite เท่านั้น
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(activeKey)}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: 'application/json'
          }
        })
      });

      if (response.ok) {
        const resData = await response.json();
        const rawReply = resData?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const cleanedJson = rawReply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const parsed = JSON.parse(cleanedJson);

        if (Array.isArray(parsed.projects)) {
          parsed.projects.forEach((aiProj, idx) => {
            const k = String(aiProj.projectKey || '').trim();
            const target = projectSummaries.find(
              ps => (k && (ps.projectId === k || ps.projectName === k))
            ) || projectSummaries[idx];

            if (target) {
              if (aiProj.relatedProducts && String(aiProj.relatedProducts).trim()) {
                target.productsText = String(aiProj.relatedProducts).trim();
              }
              if (aiProj.productSummaries && String(aiProj.productSummaries).trim()) {
                target.productSummaryText = String(aiProj.productSummaries).trim();
              }
            }
          });
        }

        if (parsed.keyProgress || parsed.criticalRisks || parsed.keyActions) {
          execSummary = {
            keyProgress: String(parsed.keyProgress || execSummary.keyProgress).trim(),
            criticalRisks: String(parsed.criticalRisks || execSummary.criticalRisks).trim(),
            keyActions: String(parsed.keyActions || execSummary.keyActions).trim()
          };
        }
      }
    } catch (err) {
      console.warn('Executive One-Page AI summary fallback used:', err);
    }
  }

  return {
    totalProjects: projectSummaries.length,
    totalVisits: visits.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    projectSummaries,
    execSummary
  };
}

/**
 * สร้างสไลด์ Executive One-Page Summary รวมภาพรวม Site Visit ทั้งหมดใน 1 หน้าสไลด์
 * ตารางด้านซ้ายแสดง 3 คอลัมน์: โครงการ | สินค้าที่เกี่ยวข้อง | สรุปสาระสำคัญของแต่ละสินค้า (ไม่แสดงวันที่เข้าตรวจและสถานะ)
 */
function addSiteVisitOnePageSummarySlide(pptx, onePageData) {
  if (!onePageData) return;

  const slide = pptx.addSlide();
  const meta = getCurrentFilterMetadataText();

  addSlideHeaderBar(
    slide,
    pptx,
    'ONE-PAGE SUMMARY',
    '0369A1',
    `สรุปภาพรวมการเข้าเยี่ยมหน้างาน (Site Visit Executive Summary)`,
    `ขอบเขต: ${meta.projLabel}   |   สรุปแยกตามโครงการและกลุ่มสินค้าที่เกี่ยวข้อง (รวม ${onePageData.totalVisits} รายงาน)`
  );

  // แถวที่ 1: 4 การ์ด KPI สรุปภาพรวม Site Visit
  const kpiCards = [
    {
      label: 'โครงการที่เข้าเยี่ยม',
      value: `${onePageData.totalProjects} โครงการ`,
      sub: `รวม ${onePageData.totalVisits} รายงาน/ครั้ง`,
      accent: '0284C7',
      bg: 'F0F9FF'
    },
    {
      label: 'สถานะปกติ (Low Risk)',
      value: `${onePageData.lowRiskCount} โครงการ`,
      sub: 'ดำเนินงานตามแผน',
      accent: '059669',
      bg: 'ECFDF5'
    },
    {
      label: 'เฝ้าระวัง (Medium Risk)',
      value: `${onePageData.mediumRiskCount} โครงการ`,
      sub: 'ต้องติดตามใกล้ชิด',
      accent: 'D97706',
      bg: 'FFFBEB'
    },
    {
      label: 'วิกฤต (High Risk)',
      value: `${onePageData.highRiskCount} โครงการ`,
      sub: 'เร่งแก้ไขปัญหาหน้างาน',
      accent: 'E11D48',
      bg: 'FFF1F2'
    }
  ];

  const cardW = 2.97;
  const gap = 0.18;
  kpiCards.forEach((c, idx) => {
    const xPos = 0.45 + idx * (cardW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.06, w: cardW, h: 1.12,
      fill: { color: c.bg },
      line: { color: c.accent, width: 1.1 }
    });
    slide.addText(c.label, {
      x: xPos + 0.14, y: 1.13, w: cardW - 0.28, h: 0.24,
      fontFace: 'Tahoma', fontSize: 9, bold: true, color: '334155'
    });
    slide.addText(c.value, {
      x: xPos + 0.14, y: 1.38, w: cardW - 0.28, h: 0.40,
      fontFace: 'Tahoma', fontSize: 15, bold: true, color: c.accent
    });
    slide.addText(c.sub, {
      x: xPos + 0.14, y: 1.82, w: cardW - 0.28, h: 0.25,
      fontFace: 'Tahoma', fontSize: 8.5, color: '64748B'
    });
  });

  // แถวที่ 2 ด้านซ้าย: ตาราง 3 คอลัมน์ (โครงการ | สินค้าที่เกี่ยวข้อง | สรุปสาระสำคัญของแต่ละสินค้า)
  const leftX = 0.45;
  const leftW = 7.45;
  const bodyY = 2.34;
  const bodyH = 4.92;

  slide.addShape(pptx.ShapeType.roundRect, {
    x: leftX, y: bodyY, w: leftW, h: bodyH,
    fill: { color: 'FFFFFF' },
    line: { color: 'CBD5E1', width: 1 }
  });

  slide.addText(`สรุปสินค้าที่เกี่ยวข้องและสาระสำคัญรายโครงการ (${onePageData.totalProjects} โครงการ)`, {
    x: leftX + 0.15, y: bodyY + 0.08, w: leftW - 0.30, h: 0.28,
    fontFace: 'Tahoma', fontSize: 10.5, bold: true, color: '0F172A'
  });

  const maxVisibleRows = Math.min(onePageData.projectSummaries.length, 9);
  const displayedProjects = onePageData.projectSummaries.slice(0, maxVisibleRows);
  const tableFontSize = maxVisibleRows >= 7 ? 7.6 : (maxVisibleRows >= 5 ? 8.1 : 8.6);

  const tableRows = [
    [
      { text: 'โครงการ', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'left' } },
      { text: 'สินค้าที่เกี่ยวข้อง', options: { bold: true, color: 'FFFFFF', fill: '0F766E', align: 'left' } },
      { text: 'สรุปสาระสำคัญของแต่ละสินค้า', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'left' } }
    ]
  ];

  displayedProjects.forEach((p, idx) => {
    const rowBg = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
    const prodBg = idx % 2 === 0 ? 'F0FDFA' : 'CCFBF1';
    const shortName = truncateProjectName20(p.projectName);
    const projCell = p.projectId && p.projectId !== '-' ? `${shortName}\n(${p.projectId})` : shortName;

    tableRows.push([
      { text: projCell, options: { fill: rowBg, bold: true, color: '0F172A', align: 'left' } },
      { text: p.productsText || '-', options: { fill: prodBg, bold: true, color: '115E59', align: 'left' } },
      { text: p.productSummaryText || '-', options: { fill: rowBg, color: '1E293B', align: 'left' } }
    ]);
  });

  if (onePageData.projectSummaries.length > maxVisibleRows) {
    const extraCount = onePageData.projectSummaries.length - maxVisibleRows;
    tableRows.push([
      {
        text: `+ อีก ${extraCount} โครงการ (ดูรายละเอียดครบถ้วนในสไลด์ถัดไป)`,
        options: { colspan: 3, fill: 'F1F5F9', italic: true, color: '475569', align: 'center' }
      }
    ]);
  }

  slide.addTable(tableRows, {
    x: leftX + 0.14,
    y: bodyY + 0.40,
    w: leftW - 0.28,
    colW: [1.75, 1.85, 3.57],
    fontFace: 'Tahoma',
    fontSize: tableFontSize,
    border: { type: 'solid', color: 'CBD5E1', pt: 0.6 },
    margin: [2.5, 4, 2.5, 4],
    valign: 'top'
  });

  // แถวที่ 2 ด้านขวา: 3 กล่องสรุปภาพรวมผู้บริหาร (Executive Highlights)
  const rightX = 8.08;
  const rightW = 4.80;
  const boxGap = 0.12;
  const boxH = (bodyH - boxGap * 2) / 3;

  const summaryBoxes = [
    {
      title: '1. ไฮไลต์ความคืบหน้า & ความต้องการสินค้า',
      body: onePageData.execSummary.keyProgress,
      bg: 'EFF6FF',
      border: 'BFDBFE',
      titleColor: '1E3A8A'
    },
    {
      title: '2. ประเด็นปัญหา & ความเสี่ยงที่ต้องเฝ้าระวัง',
      body: onePageData.execSummary.criticalRisks,
      bg: 'FFF1F2',
      border: 'FECDD3',
      titleColor: '9F1239'
    },
    {
      title: '3. แผนการติดตามงาน & Action สัปดาห์หน้า',
      body: onePageData.execSummary.keyActions,
      bg: 'ECFDF5',
      border: 'A7F3D0',
      titleColor: '065F46'
    }
  ];

  let curBoxY = bodyY;
  summaryBoxes.forEach(box => {
    slide.addShape(pptx.ShapeType.roundRect, {
      x: rightX, y: curBoxY, w: rightW, h: boxH,
      fill: { color: box.bg },
      line: { color: box.border, width: 1 }
    });

    slide.addText(box.title, {
      x: rightX + 0.14, y: curBoxY + 0.06, w: rightW - 0.28, h: 0.24,
      fontFace: 'Tahoma', fontSize: 9.5, bold: true, color: box.titleColor
    });

    const fitted = calcAutoFitTextLayout(box.body, rightW, boxH);
    slide.addText(fitted.text, {
      x: rightX + 0.14,
      y: curBoxY + 0.30,
      w: rightW - 0.28,
      h: boxH - 0.35,
      fontFace: 'Tahoma',
      fontSize: fitted.fontSize,
      color: '1E293B',
      valign: 'top',
      wrap: true,
      fit: 'shrink',
      lineSpacingMultiple: fitted.lineSpacingMultiple
    });

    curBoxY += boxH + boxGap;
  });
}

function getSelectElementOptionText(selectId) {
  const el = document.getElementById(selectId);
  if (!el || el.selectedIndex < 0 || !el.options[el.selectedIndex]) return '';
  return String(el.options[el.selectedIndex].text || '').trim();
}

function getForecastActualFilterNote() {
  if (typeof forecastOnlyDealerActual !== 'undefined' && forecastOnlyDealerActual) {
    const manualAddedCount = (typeof manualAddedForecastProducts !== 'undefined' && manualAddedForecastProducts)
      ? Array.from(manualAddedForecastProducts).filter(p => selectedForecastProducts && selectedForecastProducts.has(p)).length
      : 0;
    return manualAddedCount > 0
      ? ` | กรองสินค้าที่มี Actual (Dealer) + เพิ่มเอง ${manualAddedCount} รายการ`
      : ' | กรองเฉพาะสินค้าที่มี Actual (Dealer)';
  }
  return '';
}

/**
 * รวบรวมโครงสร้างกราฟวิเคราะห์ทั้ง 5 กราฟที่มีข้อมูลในระบบ พร้อมระบุช่วงเวลาและตัวกรองอยู่บนหัวสไลด์
 */
function collectAvailableChartConfigs() {
  const dealerUnitText = getUnitSuffix();
  const forecastUnitText = typeof getForecastUnitSuffix === 'function' ? getForecastUnitSuffix() : getUnitSuffix();
  const hasParsedRows = Array.isArray(parsedDataRowsGlobal) && parsedDataRowsGlobal.length > 0;
  const hasForecastMonths = Array.isArray(availableForecastMonths) && availableForecastMonths.length > 0;

  const dStartLabel = getSelectElementOptionText('dealerCompStartMonthSelect');
  const dEndLabel = getSelectElementOptionText('dealerCompEndMonthSelect');
  const dealerPeriodSuffix = (dStartLabel && dEndLabel)
    ? ` | ช่วงเวลา: ${dStartLabel === dEndLabel ? dStartLabel : `${dStartLabel} - ${dEndLabel}`}`
    : '';

  const fStartLabel = getSelectElementOptionText('forecastStartSelect');
  const fEndLabel = getSelectElementOptionText('forecastEndSelect');
  const forecastRangeSuffix = (fStartLabel && fEndLabel)
    ? ` | ช่วงเวลา: ${fStartLabel === fEndLabel ? fStartLabel : `${fStartLabel} - ${fEndLabel}`}`
    : '';

  const fSingleLabel = getSelectElementOptionText('forecastProjectSingleMonthSelect');
  const forecastSingleSuffix = fSingleLabel ? ` | เดือนที่ดู: ${fSingleLabel}` : '';
  const actualFilterNote = getForecastActualFilterNote();

  const candidates = [
    {
      id: 'dealerCompMonthlyChart',
      available: hasParsedRows && Array.isArray(allMonthHeadersGlobal) && allMonthHeadersGlobal.length > 0,
      title: `Ropp vs Dealer Actual รายเดือน (${dealerUnitText})`,
      subtitle: `เปรียบเทียบยอดโอกาส (Ropp) กับยอดขายจริงผ่าน Dealer แยกรายเดือน${dealerPeriodSuffix}`,
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProjectChart',
      available: hasParsedRows,
      title: `Ropp vs Dealer Actual ใน Top โครงการ (${dealerUnitText})`,
      subtitle: `เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer รายโครงการสูงสุด 10 อันดับ${dealerPeriodSuffix}`,
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProductChart',
      available: hasParsedRows,
      title: `Ropp vs Dealer Actual รายกลุ่มสินค้า (${dealerUnitText})`,
      subtitle: `เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer แยกตามกลุ่มสินค้าหลัก${dealerPeriodSuffix}`,
      category: 'Dealer Analytics'
    },
    {
      id: 'forecastProductChart',
      available: hasParsedRows && hasForecastMonths,
      title: `คาดการณ์ยอดขายล่วงหน้า รายกลุ่มสินค้า (${forecastUnitText})`,
      subtitle: `แผนโอกาสขายล่วงหน้า (Sales Forecast - Ropp) แยกตามกลุ่มสินค้า${forecastRangeSuffix}${actualFilterNote}`,
      category: 'Sales Forecast'
    },
    {
      id: 'forecastProjectChart',
      available: hasParsedRows && hasForecastMonths,
      title: `คาดการณ์ยอดขายล่วงหน้า รายโครงการ (${forecastUnitText})`,
      subtitle: `Stacked Bar แสดงสัดส่วนกลุ่มสินค้าที่คาดการณ์ล่วงหน้าในแต่ละโครงการ${forecastSingleSuffix}${actualFilterNote}`,
      category: 'Sales Forecast'
    }
  ];

  return candidates.filter(cfg => cfg.available);
}

/**
 * คำนวณข้อมูลตาราง Matrix คาดการณ์ยอดขาย (โครงการ x กลุ่มสินค้า) ตามโครงการ กลุ่มสินค้า และหน่วยของส่วนตาราง Matrix ที่เลือก (matrixDisplayMode)
 * และตัดรายการสินค้าและโครงการที่ไม่มี Forecast (ยอด <= 0) ออกทั้งหมด
 */
function computeForecastMatrixForPptx() {
  if (!Array.isArray(parsedDataRowsGlobal) || parsedDataRowsGlobal.length === 0) return null;
  if (!Array.isArray(availableForecastMonths) || availableForecastMonths.length === 0) return null;

  const activeMatrixMode = typeof matrixDisplayMode !== 'undefined' ? matrixDisplayMode : displayMode;
  const mMonth = document.getElementById('matrixMonthSelect');
  const rawIdx = mMonth ? parseInt(mMonth.value, 10) : NaN;
  const selectedMonthIdx = !Number.isNaN(rawIdx) ? rawIdx : 0;
  const targetMonth = availableForecastMonths[selectedMonthIdx];
  if (!targetMonth) return null;

  const matrix = {};
  const projectTotals = {};
  const productTotals = {};
  const projectMeta = {};
  let grandTotal = 0;

  parsedDataRowsGlobal.forEach(row => {
    const projectCode = (row[0] || '').trim();
    const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const projectKey = projectCode || projectName;

    if (!isProjectSelectedForPptx(projectCode, projectName, projectKey)) return;

    const productGroup = (row[4] || 'อื่นๆ').trim();
    if (!isProductSelectedForForecastPptx(productGroup)) return;

    const unitPrice = getUnitPrice(productGroup);
    const fUnit = parseNum(row[targetMonth.roppCol]);
    const fVal = activeMatrixMode === 'baht' ? (fUnit * unitPrice) : fUnit;

    if (fVal > 0) {
      if (!matrix[projectKey]) {
        matrix[projectKey] = {};
        projectTotals[projectKey] = 0;
        projectMeta[projectKey] = { code: projectCode, name: projectName };
      }
      matrix[projectKey][productGroup] = (matrix[projectKey][productGroup] || 0) + fVal;
      projectTotals[projectKey] += fVal;
      productTotals[productGroup] = (productTotals[productGroup] || 0) + fVal;
      grandTotal += fVal;
    }
  });

  // ตัดรายการสินค้าที่ไม่มี Forecast ออกทั้งหมด และเรียงจากยอดสูงสุดไปต่ำสุด
  const activeProducts = Object.entries(productTotals)
    .filter(e => e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);

  // ตัดโครงการที่ไม่มี Forecast ออกทั้งหมด และเรียงจากยอดสูงสุดไปต่ำสุด
  const activeProjects = Object.entries(projectTotals)
    .filter(e => e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(e => ({
      key: e[0],
      code: projectMeta[e[0]].code,
      name: projectMeta[e[0]].name,
      total: e[1]
    }));

  if (activeProjects.length === 0 || activeProducts.length === 0) return null;

  return {
    monthName: targetMonth.monthYear,
    projects: activeProjects,
    products: activeProducts,
    matrix: matrix,
    projectTotals: projectTotals,
    productTotals: productTotals,
    grandTotal: grandTotal
  };
}

/**
 * สร้างสไลด์ตาราง Matrix คาดการณ์ยอดขาย (โครงการ x กลุ่มสินค้า)
 * แบ่งหน้าสไลด์อัตโนมัติทั้งแนวตั้ง (สูงสุด 10 โครงการ/หน้า) และแนวนอน (สูงสุด 6 กลุ่มสินค้า/หน้า)
 */
function addForecastMatrixSlides(pptx) {
  const matrixData = computeForecastMatrixForPptx();
  if (!matrixData) return;

  const unitText = typeof getMatrixUnitSuffix === 'function' ? getMatrixUnitSuffix() : getUnitSuffix();
  const actualFilterNote = getForecastActualFilterNote();
  const MAX_COLS_PER_SLIDE = 6;
  const MAX_ROWS_PER_SLIDE = 10;

  const colChunks = [];
  for (let c = 0; c < matrixData.products.length; c += MAX_COLS_PER_SLIDE) {
    colChunks.push(matrixData.products.slice(c, c + MAX_COLS_PER_SLIDE));
  }

  const rowChunks = [];
  for (let r = 0; r < matrixData.projects.length; r += MAX_ROWS_PER_SLIDE) {
    rowChunks.push(matrixData.projects.slice(r, r + MAX_ROWS_PER_SLIDE));
  }

  const totalSlides = colChunks.length * rowChunks.length;
  let slideCounter = 0;

  rowChunks.forEach((projSlice, rPageIdx) => {
    colChunks.forEach((prodSlice, cPageIdx) => {
      slideCounter++;
      const slide = pptx.addSlide();

      const pageSuffix = totalSlides > 1 ? ` [หน้า ${slideCounter}/${totalSlides}]` : '';
      const colRangeNote = colChunks.length > 1
        ? ` | แสดงกลุ่มสินค้าที่ ${cPageIdx * MAX_COLS_PER_SLIDE + 1}-${cPageIdx * MAX_COLS_PER_SLIDE + prodSlice.length} จาก ${matrixData.products.length} สินค้า`
        : '';

      addSlideHeaderBar(
        slide,
        pptx,
        'FORECAST MATRIX',
        '4F46E5',
        `ตารางคาดการณ์ยอดขายล่วงหน้า — เดือน ${matrixData.monthName} (${unitText})${pageSuffix}`,
        `โครงการ × กลุ่มสินค้าที่มี Forecast (${matrixData.products.length} กลุ่มสินค้า, ${matrixData.projects.length} โครงการ)${colRangeNote}${actualFilterNote}`
      );

      // คำนวณความกว้างคอลัมน์ให้พอดีกับพื้นที่ 12.43 นิ้ว
      const tableTotalW = 12.43;
      const projColW = 2.95;
      const sumColW = 1.50;
      const remainingW = tableTotalW - projColW - sumColW;
      const singleProdColW = Number((remainingW / prodSlice.length).toFixed(4));
      const colWidths = [projColW, sumColW, ...prodSlice.map(() => singleProdColW)];

      // แถวหัวตาราง
      const headerRow = [
        {
          text: 'ชื่อโครงการ / รหัส',
          options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'left' }
        },
        {
          text: `ยอดรวม\n(${unitText})`,
          options: { bold: true, color: 'FFFFFF', fill: '312E81', align: 'right' }
        },
        ...prodSlice.map(prod => ({
          text: prod,
          options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'right' }
        }))
      ];

      const tableRows = [headerRow];

      // แถวข้อมูลแต่ละโครงการ
      projSlice.forEach((p, idx) => {
        const rowBg = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
        const shortName = truncateProjectName20(p.name);
        const projDisplay = p.code ? `${shortName}\n(${p.code})` : shortName;

        const dataCells = prodSlice.map(prod => {
          const val = (matrixData.matrix[p.key] && matrixData.matrix[p.key][prod]) || 0;
          return {
            text: val > 0 ? formatNumber(val) : '-',
            options: {
              fill: rowBg,
              align: 'right',
              color: val > 0 ? '0F172A' : '94A3B8',
              bold: val > 0
            }
          };
        });

        tableRows.push([
          {
            text: projDisplay,
            options: { fill: rowBg, bold: true, color: '0F172A', align: 'left' }
          },
          {
            text: formatNumber(p.total),
            options: { fill: 'EEF2FF', bold: true, color: '4338CA', align: 'right' }
          },
          ...dataCells
        ]);
      });

      // แถวสรุปยอดรวมทั้งสิ้นด้านล่างสุด
      const footerCells = prodSlice.map(prod => {
        const sumVal = matrixData.productTotals[prod] || 0;
        return {
          text: formatNumber(sumVal),
          options: { fill: 'E2E8F0', bold: true, color: '0F172A', align: 'right' }
        };
      });

      tableRows.push([
        {
          text: 'รวมทั้งสิ้น (ทุกโครงการที่เลือก)',
          options: { fill: 'E2E8F0', bold: true, color: '0F172A', align: 'left' }
        },
        {
          text: formatNumber(matrixData.grandTotal),
          options: { fill: 'C7D2FE', bold: true, color: '312E81', align: 'right' }
        },
        ...footerCells
      ]);

      slide.addTable(tableRows, {
        x: 0.45,
        y: 1.12,
        w: tableTotalW,
        colW: colWidths,
        fontFace: 'Tahoma',
        fontSize: 8.5,
        border: { type: 'solid', color: 'CBD5E1', pt: 0.75 },
        margin: [3, 4, 3, 4],
        valign: 'middle'
      });
    });
  });
}

/**
 * สร้างภาพ PNG พื้นหลังสีขาวจาก Chart.js บน Off-screen Canvas โดยกรองเฉพาะโครงการ ช่วงเวลา กลุ่มสินค้า และหน่วยแสดงผลที่เลือก
 */
function renderOffscreenChartPngForSelectedProjects(chartId) {
  if (!parsedDataRowsGlobal || parsedDataRowsGlobal.length === 0) return null;
  if (typeof Chart === 'undefined') return null;

  const unitSuffix = getUnitSuffix();
  const activeForecastMode = typeof forecastDisplayMode !== 'undefined' ? forecastDisplayMode : displayMode;
  const forecastUnitSuffix = typeof getForecastUnitSuffix === 'function' ? getForecastUnitSuffix() : getUnitSuffix();
  let chartConfig = null;

  if (chartId === 'dealerCompMonthlyChart' || chartId === 'dealerCompProjectChart' || chartId === 'dealerCompProductChart') {
    const sMonth = document.getElementById('dealerCompStartMonthSelect');
    const eMonth = document.getElementById('dealerCompEndMonthSelect');
    const rawStart = sMonth ? parseInt(sMonth.value, 10) : NaN;
    const rawEnd = eMonth ? parseInt(eMonth.value, 10) : NaN;

    let startIdx = !Number.isNaN(rawStart) ? rawStart : 0;
    let endIdx = !Number.isNaN(rawEnd) ? rawEnd : (allMonthHeadersGlobal.length - 1);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];

    const selectedMonthHeaders = allMonthHeadersGlobal.slice(startIdx, endIdx + 1);
    const monthlyRoppArr = new Array(selectedMonthHeaders.length).fill(0);
    const monthlyDealerActArr = new Array(selectedMonthHeaders.length).fill(0);
    const projectRoppMap = {};
    const productRoppMap = {};

    parsedDataRowsGlobal.forEach(row => {
      const projectCode = (row[0] || '').trim();
      const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
      const projectKey = projectCode || projectName;
      const productGroup = (row[4] || 'อื่นๆ').trim();

      // สินค้าที่ใช้ชื่อจาก MATERIALNAME (ช่อง O) จะแสดงเฉพาะค่า Actual เท่านั้น ไม่คิด Opp
      if (typeof dealerOnlyActualMaterialNamesSet !== 'undefined' && dealerOnlyActualMaterialNamesSet.has(productGroup)) return;

      if (!isProjectSelectedForPptx(projectCode, projectName, projectKey)) return;
      if (selectedDealerCompProducts.size > 0 && !selectedDealerCompProducts.has(productGroup)) return;

      const unitPrice = getUnitPrice(productGroup);
      let rowRoppSum = 0;

      selectedMonthHeaders.forEach((m, mIdx) => {
        const rUnit = parseNum(row[m.roppCol]);
        const rVal = displayMode === 'baht' ? (rUnit * unitPrice) : rUnit;
        rowRoppSum += rVal;
        monthlyRoppArr[mIdx] += rVal;
      });

      if (!projectRoppMap[projectKey]) {
        projectRoppMap[projectKey] = { name: projectName, code: projectCode, ropp: 0 };
      }
      projectRoppMap[projectKey].ropp += rowRoppSum;
      productRoppMap[productGroup] = (productRoppMap[productGroup] || 0) + rowRoppSum;
    });

    const projectDealerActMap = {};
    const projectDealerNameMap = {};
    const productDealerActMap = {};

    (matchedDealerList || []).forEach(item => {
      if (!isProjectSelectedForPptx(item.projectId, item.projectName)) return;
      if (selectedDealerCompProducts.size > 0 && !selectedDealerCompProducts.has(item.productGroup)) return;

      const matchedMIdx = typeof getDealerItemMonthHeaderIndex === 'function'
        ? getDealerItemMonthHeaderIndex(item, selectedMonthHeaders)
        : -1;
      if (matchedMIdx === -1) return;

      const actVal = displayMode === 'baht' ? item.netAmount : item.actual;
      monthlyDealerActArr[matchedMIdx] += actVal;
      projectDealerActMap[item.projectId] = (projectDealerActMap[item.projectId] || 0) + actVal;
      if (item.projectName && item.projectName !== '-') {
        projectDealerNameMap[item.projectId] = item.projectName;
      }
      productDealerActMap[item.productGroup] = (productDealerActMap[item.productGroup] || 0) + actVal;
    });

    if (chartId === 'dealerCompMonthlyChart') {
      chartConfig = {
        type: 'bar',
        data: {
          labels: selectedMonthHeaders.map(m => m.monthYear),
          datasets: [
            { label: `โอกาส (Ropp - ${unitSuffix})`, data: monthlyRoppArr, backgroundColor: '#60a5fa', borderRadius: 4 },
            { label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`, data: monthlyDealerActArr, backgroundColor: '#059669', borderRadius: 4 }
          ]
        },
        options: {
          responsive: false,
          animation: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Tahoma', size: 13 } } } },
          scales: {
            x: { ticks: { font: { family: 'Tahoma', size: 12 } } },
            y: { ticks: { font: { family: 'Tahoma', size: 12 }, callback: (v) => v.toLocaleString() } }
          }
        }
      };
    } else if (chartId === 'dealerCompProjectChart') {
      const allKeys = new Set([...Object.keys(projectRoppMap), ...Object.keys(projectDealerActMap)]);
      const list = Array.from(allKeys).map(key => {
        const fallbackName = projectDealerNameMap[key] || key;
        const roppData = projectRoppMap[key] || { name: fallbackName, code: key, ropp: 0 };
        const dealerAct = projectDealerActMap[key] || 0;
        return { name: roppData.name || fallbackName, ropp: roppData.ropp, dealerAct, total: roppData.ropp + dealerAct };
      }).sort((a, b) => b.total - a.total).slice(0, 10);

      chartConfig = {
        type: 'bar',
        data: {
          labels: list.map(p => p.name.length > 18 ? p.name.slice(0, 18) + '...' : p.name),
          datasets: [
            { label: `โอกาส (Ropp - ${unitSuffix})`, data: list.map(p => p.ropp), backgroundColor: '#60a5fa', borderRadius: 4 },
            { label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`, data: list.map(p => p.dealerAct), backgroundColor: '#059669', borderRadius: 4 }
          ]
        },
        options: {
          responsive: false,
          animation: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Tahoma', size: 13 } } } },
          scales: {
            x: { ticks: { font: { family: 'Tahoma', size: 11 } } },
            y: { ticks: { font: { family: 'Tahoma', size: 12 }, callback: (v) => v.toLocaleString() } }
          }
        }
      };
    } else if (chartId === 'dealerCompProductChart') {
      const allProds = new Set([...Object.keys(productRoppMap), ...Object.keys(productDealerActMap)]);
      const list = Array.from(allProds).map(prod => {
        const isOnlyActual = typeof dealerOnlyActualMaterialNamesSet !== 'undefined' && dealerOnlyActualMaterialNamesSet.has(prod);
        const ropp = isOnlyActual ? 0 : (productRoppMap[prod] || 0);
        const dealerAct = productDealerActMap[prod] || 0;
        return { name: prod, ropp, dealerAct, total: ropp + dealerAct };
      }).sort((a, b) => b.total - a.total).slice(0, 10);

      chartConfig = {
        type: 'bar',
        data: {
          labels: list.map(p => p.name.length > 26 ? p.name.slice(0, 26) + '...' : p.name),
          datasets: [
            { label: `โอกาส (Ropp - ${unitSuffix})`, data: list.map(p => p.ropp), backgroundColor: '#60a5fa', borderRadius: 4 },
            { label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`, data: list.map(p => p.dealerAct), backgroundColor: '#059669', borderRadius: 4 }
          ]
        },
        options: {
          indexAxis: 'y',
          responsive: false,
          animation: false,
          plugins: { legend: { position: 'top', labels: { boxWidth: 14, font: { family: 'Tahoma', size: 13 } } } },
          scales: {
            x: { ticks: { font: { family: 'Tahoma', size: 12 }, callback: (v) => v.toLocaleString() } },
            y: { ticks: { font: { family: 'Tahoma', size: 11 } } }
          }
        }
      };
    }
  } else if (chartId === 'forecastProductChart') {
    const fStart = document.getElementById('forecastStartSelect');
    const fEnd = document.getElementById('forecastEndSelect');
    const rawFStart = fStart ? parseInt(fStart.value, 10) : NaN;
    const rawFEnd = fEnd ? parseInt(fEnd.value, 10) : NaN;

    let startIdx = !Number.isNaN(rawFStart) ? rawFStart : 0;
    let endIdx = !Number.isNaN(rawFEnd) ? rawFEnd : Math.min(availableForecastMonths.length - 1, 2);
    if (startIdx > endIdx) [startIdx, endIdx] = [endIdx, startIdx];

    const selectedMonths = availableForecastMonths.slice(startIdx, endIdx + 1);
    const forecastProducts = {};

    parsedDataRowsGlobal.forEach(row => {
      const projectCode = (row[0] || '').trim();
      const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
      const projectKey = projectCode || projectName;
      if (!isProjectSelectedForPptx(projectCode, projectName, projectKey)) return;

      const productGroup = (row[4] || 'อื่นๆ').trim();
      if (!isProductSelectedForForecastPptx(productGroup)) return;

      const unitPrice = getUnitPrice(productGroup);
      if (!forecastProducts[productGroup]) {
        forecastProducts[productGroup] = new Array(selectedMonths.length).fill(0);
      }
      selectedMonths.forEach((fm, fIdx) => {
        const fUnit = parseNum(row[fm.roppCol]);
        const fVal = activeForecastMode === 'baht' ? (fUnit * unitPrice) : fUnit;
        forecastProducts[productGroup][fIdx] += fVal;
      });
    });

    const topProds = Object.entries(forecastProducts)
      .map(([name, vals]) => ({ name, vals, total: vals.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);

    chartConfig = {
      type: 'bar',
      data: {
        labels: selectedMonths.map(m => m.monthYear),
        datasets: topProds.map(p => ({
          label: `${p.name} (${forecastUnitSuffix})`,
          data: p.vals,
          backgroundColor: getProductColor(p.name),
          borderRadius: 4
        }))
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Tahoma', size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Tahoma', size: 12 } } },
          y: { stacked: true, ticks: { font: { family: 'Tahoma', size: 12 }, callback: (v) => v.toLocaleString() } }
        }
      }
    };
  } else if (chartId === 'forecastProjectChart') {
    const fSingle = document.getElementById('forecastProjectSingleMonthSelect');
    const rawFSingle = fSingle ? parseInt(fSingle.value, 10) : NaN;
    const selectedMonthIdx = !Number.isNaN(rawFSingle) ? rawFSingle : 0;
    const targetMonth = availableForecastMonths[selectedMonthIdx];
    if (!targetMonth) return null;

    const projectTotals = {};
    const projectProductMap = {};
    const allGroups = new Set();

    parsedDataRowsGlobal.forEach(row => {
      const projectCode = (row[0] || '').trim();
      const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
      const projectKey = projectCode || projectName;
      if (!isProjectSelectedForPptx(projectCode, projectName, projectKey)) return;

      const productGroup = (row[4] || 'อื่นๆ').trim();
      if (!isProductSelectedForForecastPptx(productGroup)) return;

      const unitPrice = getUnitPrice(productGroup);
      const fUnit = parseNum(row[targetMonth.roppCol]);
      const fVal = activeForecastMode === 'baht' ? (fUnit * unitPrice) : fUnit;

      if (fVal > 0) {
        projectTotals[projectName] = (projectTotals[projectName] || 0) + fVal;
        if (!projectProductMap[projectName]) projectProductMap[projectName] = {};
        projectProductMap[projectName][productGroup] = (projectProductMap[projectName][productGroup] || 0) + fVal;
        allGroups.add(productGroup);
      }
    });

    const topProjects = Object.entries(projectTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(entry => entry[0]);

    const datasets = Array.from(allGroups).map(prod => ({
      label: `${prod} (${forecastUnitSuffix})`,
      data: topProjects.map(proj => (projectProductMap[proj] && projectProductMap[proj][prod]) || 0),
      backgroundColor: getProductColor(prod),
      borderRadius: 2
    })).filter(ds => ds.data.some(v => v > 0));

    chartConfig = {
      type: 'bar',
      data: {
        labels: topProjects.map(p => p.length > 18 ? p.slice(0, 18) + '...' : p),
        datasets: datasets
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Tahoma', size: 11 } } } },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Tahoma', size: 11 } } },
          y: { stacked: true, ticks: { font: { family: 'Tahoma', size: 12 }, callback: (v) => v.toLocaleString() } }
        }
      }
    };
  }

  if (!chartConfig) return null;

  const whiteBgPlugin = {
    id: 'pptxWhiteBackground',
    beforeDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, chart.width, chart.height);
      ctx.restore();
    }
  };

  chartConfig.plugins = [whiteBgPlugin];

  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = 1120;
  offscreenCanvas.height = 520;
  const ctx = offscreenCanvas.getContext('2d');

  const tempChart = new Chart(ctx, chartConfig);
  const dataUrl = offscreenCanvas.toDataURL('image/png');
  tempChart.destroy();

  return { dataUrl };
}

/**
 * ฟังก์ชันหลักสำหรับสั่ง Export PowerPoint
 * @param {'combined'|'site_only'|'charts_only'|'separate_files'} mode
 */
async function executePptxExport(mode = 'combined') {
  if (typeof PptxGenJS === 'undefined') {
    alert('ไม่พบไลบรารี PptxGenJS กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือรีเฟรชหน้าเว็บอีกครั้ง');
    return;
  }

  if (pptxAvailableProjectsList.length > 0 && selectedPptxProjectKeys.size === 0) {
    alert('กรุณาเลือกโครงการอย่างน้อย 1 โครงการก่อนสั่ง Export PowerPoint');
    return;
  }

  const statusBox = document.getElementById('pptxExportProgressBox');
  const statusText = document.getElementById('pptxExportProgressText');
  const actionBtns = document.querySelectorAll('.pptx-export-action-btn');
  const useAiSummary = Boolean(document.getElementById('pptxAiSummarizeSiteReportCheckbox')?.checked);
  const includeOnePage = Boolean(document.getElementById('pptxIncludeSiteOnePageSummaryCheckbox')?.checked);

  if (statusBox) statusBox.classList.remove('hidden');
  if (statusText) statusText.textContent = 'กำลังเตรียมข้อมูลและสร้างสไลด์ PowerPoint...';
  actionBtns.forEach(btn => { btn.disabled = true; });

  try {
    const rawVisits = await getFilteredSiteVisitsForPptx();
    let visits = [...rawVisits];
    const charts = collectAvailableChartConfigs();
    const matrixData = computeForecastMatrixForPptx();
    const hasSalesData = (Array.isArray(projectList) && projectList.length > 0) ||
                         (Array.isArray(matchedDealerList) && matchedDealerList.length > 0) ||
                         Boolean(matrixData);

    if (mode === 'site_only' && visits.length === 0) {
      alert('ไม่พบข้อมูล Site Report สำหรับโครงการที่เลือก');
      return;
    }

    if (mode === 'charts_only' && !hasSalesData && charts.length === 0) {
      alert('ไม่พบข้อมูล KPI, ตารางคาดการณ์ หรือกราฟวิเคราะห์ กรุณาอัปโหลดไฟล์ยอดขาย CSV ก่อน');
      return;
    }

    if ((mode === 'combined' || mode === 'separate_files') && visits.length === 0 && !hasSalesData && charts.length === 0) {
      alert('ยังไม่มีข้อมูลสำหรับ Export PowerPoint กรุณาอัปโหลดไฟล์ยอดขายหรือเพิ่มรายงานหน้างานก่อน');
      return;
    }

    const needsSiteSlides = (mode === 'site_only' || mode === 'combined' || mode === 'separate_files') && visits.length > 0;

    // เตรียมข้อมูลสรุปรวม 1 หน้า (Executive One-Page Summary) หากผู้ใช้ติ๊กเลือก
    let onePageSummaryData = null;
    if (needsSiteSlides && includeOnePage) {
      onePageSummaryData = await prepareSiteVisitOnePageSummaryData(rawVisits, statusText);
    }

    // หากผู้ใช้ติ๊กเลือก "ให้ AI สรุปรวม Site Report รายโครงการ (1 โครงการ = 1 สไลด์)" และโหมดนี้มีการสร้างสไลด์ Site Report
    if (useAiSummary && needsSiteSlides) {
      try {
        visits = await prepareSummarizedSiteVisitsForPptx(visits, statusText);
      } catch (aiErr) {
        if (aiErr && aiErr.message === 'MISSING_GEMINI_API_KEY') {
          alert('กรุณาตั้งค่า Gemini API Key ก่อนใช้งานฟังก์ชัน AI สรุปรวม Site Report');
          if (typeof openGeminiKeyModal === 'function') openGeminiKeyModal();
          return;
        }
        throw aiErr;
      }
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    let projSlug = '_All_Projects';
    if (pptxAvailableProjectsList.length > 0 && selectedPptxProjectKeys.size < pptxAvailableProjectsList.length) {
      if (selectedPptxProjectKeys.size === 1) {
        const onlyProj = pptxAvailableProjectsList.find(p => selectedPptxProjectKeys.has(p.key));
        const rawName = onlyProj ? (onlyProj.id || truncateProjectName20(onlyProj.name)) : 'Selected';
        projSlug = `_${String(rawName).replace(/[^a-zA-Z0-9ก-๙_-]/g, '_').slice(0, 25)}`;
      } else {
        projSlug = `_${selectedPptxProjectKeys.size}_Projects`;
      }
    }

    if (mode === 'separate_files') {
      let exportedCount = 0;

      if (visits.length > 0) {
        if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ที่ 1: Site Visit Report (.pptx)...';
        const pptxSite = createBasePptxInstance('Weekly Site Visit Report');
        addCoverSlide(pptxSite, 'รายงานความคืบหน้าหน้างาน (Weekly Site Visit Report)', 'สรุปผลการเข้าเยี่ยมหน้างาน แผนเรียกสินค้า และภาพถ่ายประกอบ');
        buildSiteReportSlides(pptxSite, visits, false, onePageSummaryData);
        await pptxSite.writeFile({ fileName: `Site_Report${projSlug}_${dateStamp}.pptx` });
        exportedCount++;
      }

      if (hasSalesData || charts.length > 0) {
        if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ที่ 2: Sales Analytics, Forecast Matrix & Charts (.pptx)...';
        const pptxCharts = createBasePptxInstance('Sales & Cross-sell Analytics');
        addCoverSlide(pptxCharts, 'รายงานวิเคราะห์ยอดขาย กราฟ และตารางคาดการณ์', 'สรุปตัวชี้วัด KPI, เปรียบเทียบ Ropp vs Dealer Actual, กราฟและตารางคาดการณ์ยอดขายล่วงหน้า');
        buildAnalyticsAndChartSlides(pptxCharts, charts, false);
        await pptxCharts.writeFile({ fileName: `Sales_Charts_Analytics${projSlug}_${dateStamp}.pptx` });
        exportedCount++;
      }

      if (exportedCount === 0) {
        alert('ไม่พบข้อมูลสำหรับสร้างไฟล์ PowerPoint');
      } else {
        closePptxExportModal();
      }
      return;
    }

    if (mode === 'site_only') {
      if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ PowerPoint: Site Report...';
      const pptx = createBasePptxInstance('Weekly Site Visit Report');
      addCoverSlide(pptx, 'รายงานความคืบหน้าหน้างาน (Weekly Site Visit Report)', 'สรุปผลการเข้าเยี่ยมหน้างาน แผนเรียกสินค้า และภาพถ่ายประกอบ');
      buildSiteReportSlides(pptx, visits, false, onePageSummaryData);
      await pptx.writeFile({ fileName: `Site_Report${projSlug}_${dateStamp}.pptx` });
      closePptxExportModal();
      return;
    }

    if (mode === 'charts_only') {
      if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ PowerPoint: Sales Analytics, Forecast Matrix & Charts...';
      const pptx = createBasePptxInstance('Sales & Cross-sell Analytics');
      addCoverSlide(pptx, 'รายงานวิเคราะห์ยอดขาย กราฟ และตารางคาดการณ์', 'สรุปตัวชี้วัด KPI, เปรียบเทียบ Ropp vs Dealer Actual, กราฟและตารางคาดการณ์ยอดขายล่วงหน้า');
      buildAnalyticsAndChartSlides(pptx, charts, false);
      await pptx.writeFile({ fileName: `Sales_Charts_Analytics${projSlug}_${dateStamp}.pptx` });
      closePptxExportModal();
      return;
    }

    // โหมด combined: รวมทั้ง 2 ส่วนใน 1 ไฟล์ โดยคั่นด้วยหน้าแบ่งหมวด (Section Divider) ชัดเจน
    if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ PowerPoint รวมทั้ง 2 ส่วน...';
    const pptx = createBasePptxInstance('Sales Analytics & Site Visit Report');
    addCoverSlide(
      pptx,
      'Sales Analytics & Weekly Site Visit Report',
      'รายงานสรุปผลประกอบการ กราฟวิเคราะห์ ตารางคาดการณ์ยอดขาย และความคืบหน้าหน้างาน'
    );

    if (hasSalesData || charts.length > 0) {
      buildAnalyticsAndChartSlides(pptx, charts, true);
    }
    if (visits.length > 0) {
      buildSiteReportSlides(pptx, visits, true, onePageSummaryData);
    }

    await pptx.writeFile({ fileName: `Sales_And_SiteReport${projSlug}_${dateStamp}.pptx` });
    closePptxExportModal();
  } catch (err) {
    console.error('PPTX Export Error:', err);
    alert('เกิดข้อผิดพลาดในการสร้างไฟล์ PowerPoint: ' + err.message);
  } finally {
    if (statusBox) statusBox.classList.add('hidden');
    actionBtns.forEach(btn => { btn.disabled = false; });
  }
}

function createBasePptxInstance(title) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 inches (16:9)
  pptx.author = 'Sales & Cross-sell Analytics Dashboard';
  pptx.subject = title;
  pptx.title = title;
  return pptx;
}

function getCurrentFilterMetadataText() {
  const projLabel = getSelectedProjectsSummaryLabel();
  const mainUnit = displayMode === 'baht' ? 'บาท' : 'Unit';
  const fMode = typeof forecastDisplayMode !== 'undefined' ? forecastDisplayMode : displayMode;
  const fUnit = fMode === 'baht' ? 'บาท' : 'Unit';
  const mMode = typeof matrixDisplayMode !== 'undefined' ? matrixDisplayMode : displayMode;
  const mUnit = mMode === 'baht' ? 'บาท' : 'Unit';

  const unitLabel = (mainUnit === fUnit && mainUnit === mUnit)
    ? (mainUnit === 'บาท' ? 'มูลค่า (บาท)' : 'ปริมาณ (Unit)')
    : `หลัก: ${mainUnit} | กราฟ Forecast: ${fUnit} | ตาราง Matrix: ${mUnit}`;
  const dateLabel = new Date().toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  return { projLabel, unitLabel, dateLabel };
}

/**
 * สร้างสไลด์ปก (Title Slide)
 */
function addCoverSlide(pptx, mainTitle, subTitle) {
  const slide = pptx.addSlide();
  const meta = getCurrentFilterMetadataText();

  slide.background = { color: '1E1B4B' };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.28, h: 7.5,
    fill: { color: '4F46E5' }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.28, y: 0, w: 0.1, h: 7.5,
    fill: { color: '0EA5E9' }
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.9, y: 1.1, w: 4.4, h: 0.42,
    fill: { color: '312E81' },
    line: { color: '6366F1', width: 1 }
  });
  slide.addText('SALES & CROSS-SELL ANALYTICS DASHBOARD', {
    x: 0.9, y: 1.1, w: 4.4, h: 0.42,
    fontFace: 'Tahoma', fontSize: 10, bold: true, color: 'A5B4FC', align: 'center', valign: 'middle'
  });

  slide.addText(mainTitle, {
    x: 0.9, y: 1.85, w: 11.4, h: 1.4,
    fontFace: 'Tahoma', fontSize: 30, bold: true, color: 'FFFFFF', valign: 'top'
  });

  slide.addText(subTitle, {
    x: 0.9, y: 3.35, w: 11.0, h: 0.7,
    fontFace: 'Tahoma', fontSize: 15, color: 'CBD5E1', valign: 'top'
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.9, y: 4.55, w: 11.4, h: 1.85,
    fill: { color: '0F172A' },
    line: { color: '334155', width: 1 }
  });

  slide.addText([
    { text: 'ขอบเขตโครงการ:  ', options: { bold: true, color: '38BDF8', fontSize: 13 } },
    { text: `${meta.projLabel}\n`, options: { color: 'F8FAFC', fontSize: 13 } },
    { text: 'หน่วยแสดงผลข้อมูล:  ', options: { bold: true, color: '34D399', fontSize: 13 } },
    { text: `${meta.unitLabel}\n`, options: { color: 'F8FAFC', fontSize: 13 } },
    { text: 'วันที่สร้างรายงาน:  ', options: { bold: true, color: 'FBBF24', fontSize: 13 } },
    { text: `${meta.dateLabel}`, options: { color: 'F8FAFC', fontSize: 13 } }
  ], {
    x: 1.25, y: 4.7, w: 10.7, h: 1.55,
    fontFace: 'Tahoma', valign: 'middle', lineSpacingMultiple: 1.35
  });
}

/**
 * สร้างสไลด์คั่นหมวด (Section Divider Slide)
 */
function addSectionDividerSlide(pptx, sectionNumber, sectionTitle, sectionDesc, accentHex) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F8FAFC' };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.18,
    fill: { color: accentHex }
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.0, y: 2.1, w: 2.2, h: 0.48,
    fill: { color: accentHex }
  });
  slide.addText(`SECTION ${sectionNumber}`, {
    x: 1.0, y: 2.1, w: 2.2, h: 0.48,
    fontFace: 'Tahoma', fontSize: 12, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle'
  });

  slide.addText(sectionTitle, {
    x: 1.0, y: 2.8, w: 11.3, h: 1.1,
    fontFace: 'Tahoma', fontSize: 32, bold: true, color: '0F172A'
  });

  slide.addText(sectionDesc, {
    x: 1.0, y: 4.0, w: 11.0, h: 0.8,
    fontFace: 'Tahoma', fontSize: 15, color: '475569'
  });
}

function addSlideHeaderBar(slide, pptx, badgeText, badgeColor, titleText, subText, options = {}) {
  slide.background = { color: 'F8FAFC' };

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 13.333, h: 0.92,
    fill: { color: 'FFFFFF' },
    line: { color: 'E2E8F0', width: 1 }
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.45, y: 0.22, w: 1.95, h: 0.46,
    fill: { color: badgeColor }
  });
  slide.addText(badgeText, {
    x: 0.45, y: 0.22, w: 1.95, h: 0.46,
    fontFace: 'Tahoma', fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle'
  });

  const maxTextW = options.maxTextW || 10.3;
  const subFontSize = String(subText || '').length > 75 ? 9 : 10;

  slide.addText(titleText, {
    x: 2.55, y: 0.10, w: maxTextW, h: 0.36,
    fontFace: 'Tahoma', fontSize: 16, bold: true, color: '0F172A', valign: 'middle'
  });

  slide.addText(subText, {
    x: 2.55, y: 0.46, w: maxTextW, h: 0.42,
    fontFace: 'Tahoma', fontSize: subFontSize, color: '64748B', valign: 'top', wrap: true
  });
}

// ==========================================
// ส่วนที่ 1: สไลด์ KPI, กราฟวิเคราะห์ และตาราง Matrix คาดการณ์ยอดขาย
// ==========================================
function buildAnalyticsAndChartSlides(pptx, charts, includeSectionDivider) {
  if (includeSectionDivider) {
    addSectionDividerSlide(
      pptx,
      '01',
      'Sales KPI, Charts & Forecast Matrix',
      'สรุปตัวชี้วัดหลัก (KPI), เปรียบเทียบ Ropp vs Dealer Actual, กราฟและตารางคาดการณ์ยอดขาย',
      '4F46E5'
    );
  }

  addKpiSummarySlide(pptx);

  charts.forEach(chartCfg => {
    const captured = renderOffscreenChartPngForSelectedProjects(chartCfg.id);
    if (!captured) return;

    const slide = pptx.addSlide();
    const badgeColor = chartCfg.category === 'Dealer Analytics' ? '059669' : '4F46E5';
    addSlideHeaderBar(
      slide,
      pptx,
      chartCfg.category.toUpperCase(),
      badgeColor,
      chartCfg.title,
      chartCfg.subtitle
    );

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.45, y: 1.12, w: 12.43, h: 6.05,
      fill: { color: 'FFFFFF' },
      line: { color: 'CBD5E1', width: 1 }
    });

    slide.addImage({
      data: captured.dataUrl,
      x: 0.65,
      y: 1.28,
      w: 12.03,
      h: 5.73,
      sizing: { type: 'contain', w: 12.03, h: 5.73 }
    });
  });

  // เพิ่มสไลด์ตาราง Matrix คาดการณ์ยอดขาย (ตัดรายการสินค้าที่ไม่มี Forecast ออก)
  addForecastMatrixSlides(pptx);
}

/**
 * คำนวณสรุป KPI และรวมยอดขายจริงทั้งหมด (Dealer Actual) รายโครงการ
 * โดยรวมสินค้าที่ไม่มี Opportunity ในไฟล์ยอดขายหลัก (เช่น Post Plus) และกรองตามช่วงเวลาที่เลือก
 */
function computeKpiStatsForSelectedProjects() {
  let totalRopp = 0;
  let totalAct = 0;
  let crossSellCount = 0;

  const projectSummaryMap = new Map();

  // 1. รวบรวมข้อมูลพื้นฐานและ Ropp จาก projectList (ไฟล์ยอดขายหลัก)
  const filteredProjects = (projectList || []).filter(p =>
    isProjectSelectedForPptx(p.id, p.name, p.key)
  );

  filteredProjects.forEach(p => {
    const pId = String(p.id || '').trim();
    const pName = String(p.name || p.id || 'ไม่ระบุชื่อโครงการ').trim();
    const mapKey = pId || pName;

    totalRopp += p.totalRopp || 0;

    if (!projectSummaryMap.has(mapKey)) {
      projectSummaryMap.set(mapKey, {
        key: p.key || mapKey,
        id: pId,
        name: pName,
        totalRopp: p.totalRopp || 0,
        totalAct: 0,
        dealerProductTotals: {},
        fallbackSalesActProducts: Array.isArray(p.boughtProducts) ? [...p.boughtProducts] : [],
        fallbackSalesActTotal: p.totalAct || 0,
        rate: 0
      });
    } else {
      const existing = projectSummaryMap.get(mapKey);
      existing.totalRopp += p.totalRopp || 0;
      existing.fallbackSalesActTotal += p.totalAct || 0;
    }
  });

  // Helper หา Entry ของโครงการใน projectSummaryMap (จับคู่ด้วยรหัสโครงการหรือชื่อโครงการ)
  function findOrCreateProjectSummaryEntry(rawId, rawName) {
    const cleanId = String(rawId || '').trim();
    const cleanName = String(rawName || '').trim();
    const validId = (cleanId && cleanId !== '-') ? cleanId : '';

    if (validId && projectSummaryMap.has(validId)) {
      return projectSummaryMap.get(validId);
    }

    for (const entry of projectSummaryMap.values()) {
      if (validId && entry.id && entry.id === validId) return entry;
      if (cleanName && cleanName !== '-' && entry.name && entry.name === cleanName) return entry;
    }

    const newKey = validId || cleanName || 'Unknown';
    const created = {
      key: newKey,
      id: validId,
      name: (cleanName && cleanName !== '-') ? cleanName : newKey,
      totalRopp: 0,
      totalAct: 0,
      dealerProductTotals: {},
      fallbackSalesActProducts: [],
      fallbackSalesActTotal: 0,
      rate: 0
    };
    projectSummaryMap.set(newKey, created);
    return created;
  }

  const hasDealerData = Array.isArray(matchedDealerList) && matchedDealerList.length > 0;

  // 2. รวมยอดขายจริงทั้งหมด (Actual) จากไฟล์ Dealer ตามโครงการและช่วงเวลาที่เลือก (รวมสินค้าที่ไม่มี Opp เช่น Post Plus)
  if (hasDealerData) {
    matchedDealerList.forEach(item => {
      if (!isProjectSelectedForPptx(item.projectId, item.projectName)) return;
      if (typeof isDealerItemInMasterMonthRange === 'function' && !isDealerItemInMasterMonthRange(item)) return;

      const actVal = displayMode === 'baht' ? (item.netAmount || 0) : (item.actual || 0);
      totalAct += actVal;

      const entry = findOrCreateProjectSummaryEntry(item.projectId, item.projectName);
      entry.totalAct += actVal;

      const prodLabel = String(item.productGroup || '').trim();
      if (prodLabel && prodLabel !== '-' && (actVal > 0 || (item.actual || 0) > 0 || (item.netAmount || 0) > 0)) {
        entry.dealerProductTotals[prodLabel] = (entry.dealerProductTotals[prodLabel] || 0) + actVal;
      }
    });
  }

  // 3. สรุปรายชื่อสินค้าที่เกิด Actual แล้ว, อัตรา % Realized และจำนวนโครงการ Cross-sell ของแต่ละโครงการ
  const mergedProjectsList = Array.from(projectSummaryMap.values()).map(entry => {
    let boughtProducts = [];
    if (hasDealerData) {
      boughtProducts = Object.entries(entry.dealerProductTotals)
        .filter(([, val]) => val > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([prodName]) => prodName);
    } else {
      entry.totalAct = entry.fallbackSalesActTotal;
      boughtProducts = entry.fallbackSalesActProducts;
      totalAct += entry.totalAct;
    }

    if (boughtProducts.length > 1) {
      crossSellCount++;
    }

    const rate = entry.totalRopp > 0 ? (entry.totalAct / entry.totalRopp) * 100 : 0;

    return {
      key: entry.key,
      id: entry.id,
      name: entry.name,
      totalRopp: entry.totalRopp,
      totalAct: entry.totalAct,
      boughtProducts: boughtProducts,
      rate: rate
    };
  });

  const filteredInactive = (inactiveList || []).filter(it =>
    isProjectSelectedForPptx(it.projectCode, it.projectName)
  );
  const inactiveCount = filteredInactive.length;
  const inactiveRev = filteredInactive.reduce((acc, curr) => acc + (curr.totalPastAct || 0), 0);

  const realizeRate = totalRopp > 0 ? ((totalAct / totalRopp) * 100).toFixed(1) : '0';

  return {
    totalRopp,
    totalAct,
    realizeRate,
    crossSellCount,
    inactiveCount,
    inactiveRev,
    filteredProjects: mergedProjectsList
  };
}

function addKpiSummarySlide(pptx) {
  const slide = pptx.addSlide();
  const meta = getCurrentFilterMetadataText();
  const unitText = getUnitSuffix();
  const stats = computeKpiStatsForSelectedProjects();

  addSlideHeaderBar(
    slide,
    pptx,
    'KPI OVERVIEW',
    '4F46E5',
    `สรุปตัวชี้วัดยอดขายและโอกาสทางธุรกิจ (${meta.projLabel})`,
    `ข้อมูล ณ วันที่ ${meta.dateLabel} | หน่วยแสดงผล: ${meta.unitLabel}`
  );

  const cards = [
    { label: `มูลค่าโอกาสรวม (${unitText})`, value: formatNumber(stats.totalRopp), sub: 'Total Ropp', accent: '2563EB', bg: 'EFF6FF' },
    { label: `ยอดขายจริงรวม (${unitText})`, value: formatNumber(stats.totalAct), sub: 'Dealer Actual (ทั้งหมด)', accent: '059669', bg: 'ECFDF5' },
    { label: 'อัตราความสำเร็จ', value: `${stats.realizeRate}%`, sub: 'Realized Rate', accent: '4F46E5', bg: 'EEF2FF' },
    { label: 'โครงการ Cross-sell', value: `${stats.crossSellCount} โครงการ`, sub: 'ซื้อ > 1 กลุ่มสินค้า', accent: 'D97706', bg: 'FFFBEB' },
    { label: 'Actual หาย > 2 เดือน', value: `${stats.inactiveCount} รายการ`, sub: `ในอดีต: ${formatNumber(stats.inactiveRev)} ${unitText}`, accent: 'E11D48', bg: 'FFF1F2' }
  ];

  const cardW = 2.34;
  const gap = 0.18;
  cards.forEach((c, idx) => {
    const xPos = 0.45 + idx * (cardW + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: xPos, y: 1.15, w: cardW, h: 1.55,
      fill: { color: c.bg },
      line: { color: c.accent, width: 1.2 }
    });
    slide.addText(c.label, {
      x: xPos + 0.12, y: 1.25, w: cardW - 0.24, h: 0.32,
      fontFace: 'Tahoma', fontSize: 9.5, bold: true, color: '334155'
    });
    slide.addText(c.value, {
      x: xPos + 0.12, y: 1.62, w: cardW - 0.24, h: 0.52,
      fontFace: 'Tahoma', fontSize: 15, bold: true, color: c.accent
    });
    slide.addText(c.sub, {
      x: xPos + 0.12, y: 2.22, w: cardW - 0.24, h: 0.32,
      fontFace: 'Tahoma', fontSize: 9, color: '64748B'
    });
  });

  const topProjects = [...stats.filteredProjects]
    .sort((a, b) => (b.totalAct - a.totalAct) || (b.totalRopp - a.totalRopp))
    .slice(0, 8);

  slide.addText('สรุปโครงการสำคัญตามขอบเขตที่เลือก (Top Projects by Actual & Opportunity)', {
    x: 0.45, y: 2.92, w: 12.4, h: 0.35,
    fontFace: 'Tahoma', fontSize: 12, bold: true, color: '0F172A'
  });

  const tableRows = [
    [
      { text: 'รหัสโครงการ', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } },
      { text: 'ชื่อโครงการ', options: { bold: true, color: 'FFFFFF', fill: '1E293B' } },
      { text: 'สินค้าที่เกิด Actual แล้ว', options: { bold: true, color: 'FFFFFF', fill: '1E293B' } },
      { text: `ยอดโอกาส (${unitText})`, options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'right' } },
      { text: `ยอดจริง (${unitText})`, options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'right' } },
      { text: '% Realized', options: { bold: true, color: 'FFFFFF', fill: '1E293B', align: 'center' } }
    ]
  ];

  if (topProjects.length === 0) {
    tableRows.push([
      { text: '-', options: { align: 'center', color: '64748B' } },
      { text: 'ไม่พบข้อมูลโครงการตามเงื่อนไขที่เลือก', options: { color: '64748B' } },
      { text: '-', options: { color: '64748B' } },
      { text: '0.00', options: { align: 'right', color: '64748B' } },
      { text: '0.00', options: { align: 'right', color: '64748B' } },
      { text: '0.0%', options: { align: 'center', color: '64748B' } }
    ]);
  } else {
    topProjects.forEach((p, idx) => {
      const rowBg = idx % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
      const boughtText = p.boughtProducts && p.boughtProducts.length > 0
        ? p.boughtProducts.slice(0, 3).join(', ') + (p.boughtProducts.length > 3 ? ` (+${p.boughtProducts.length - 3})` : '')
        : '-';
      const rateDisplay = p.totalRopp > 0
        ? `${(p.rate || 0).toFixed(1)}%`
        : (p.totalAct > 0 ? '100%+' : '0.0%');

      tableRows.push([
        { text: p.id || '-', options: { fill: rowBg, align: 'center', color: '475569' } },
        { text: p.name || '-', options: { fill: rowBg, bold: true, color: '0F172A' } },
        { text: boughtText, options: { fill: rowBg, color: '334155' } },
        { text: formatNumber(p.totalRopp), options: { fill: rowBg, align: 'right', color: '1D4ED8' } },
        { text: formatNumber(p.totalAct), options: { fill: rowBg, align: 'right', bold: true, color: '047857' } },
        { text: rateDisplay, options: { fill: rowBg, align: 'center', bold: true, color: '4338CA' } }
      ]);
    });
  }

  slide.addTable(tableRows, {
    x: 0.45,
    y: 3.32,
    w: 12.43,
    colW: [1.45, 3.35, 3.33, 1.65, 1.65, 1.0],
    fontFace: 'Tahoma',
    fontSize: 9.5,
    border: { type: 'solid', color: 'CBD5E1', pt: 0.75 },
    margin: [4, 6, 4, 6],
    valign: 'middle'
  });
}

// ==========================================
// ส่วนที่ 2: สไลด์ Site Report (หน้าสรุป One Page + รายงานความคืบหน้าและรูปถ่ายหน้างาน)
// ==========================================

/**
 * คำนวณขนาดตัวอักษรและระยะห่างบรรทัดอัตโนมัติให้พอดีกับความสูงของกล่องข้อความ
 * ยกเลิกการตัดคำทิ้ง (...) เพื่อให้ข้อมูลครบถ้วนทุกตัวอักษร ยอมให้ล้นกรอบได้เล็กน้อยหากยาวมากเพื่อให้ผู้ใช้แก้ไขเองใน PowerPoint
 */
function calcAutoFitTextLayout(rawText, boxWidthInches, boxHeightInches) {
  const cleanText = String(rawText || '-').replace(/\r\n/g, '\n').trim() || '-';
  const textAreaH = Math.max(0.55, boxHeightInches - 0.36);

  // ประมาณจำนวนตัวอักษรต่อ 1 บรรทัดตามความกว้างกล่อง (กรณีมีรูปด้านซ้าย 6.45 นิ้ว หรือเต็มจอ 12.43 นิ้ว)
  const baseCharsPerLine = boxWidthInches >= 10 ? 118 : (boxWidthInches <= 5.2 ? 44 : 60);

  const fontSteps = [
    { size: 9.5, lineHeightIn: 0.182, spacing: 1.12 },
    { size: 9.0, lineHeightIn: 0.170, spacing: 1.10 },
    { size: 8.5, lineHeightIn: 0.158, spacing: 1.08 },
    { size: 8.0, lineHeightIn: 0.146, spacing: 1.05 },
    { size: 7.5, lineHeightIn: 0.136, spacing: 1.03 },
    { size: 7.0, lineHeightIn: 0.126, spacing: 1.00 },
    { size: 6.5, lineHeightIn: 0.118, spacing: 1.00 }
  ];

  for (const step of fontSteps) {
    const charsPerLine = Math.max(24, Math.floor(baseCharsPerLine * (9.5 / step.size)));
    const paragraphs = cleanText.split('\n');
    let estimatedLines = 0;

    paragraphs.forEach(p => {
      const len = p.trim().length;
      estimatedLines += len === 0 ? 1 : Math.ceil(len / charsPerLine);
    });

    const maxAllowedLines = Math.floor(textAreaH / step.lineHeightIn);
    if (estimatedLines <= maxAllowedLines) {
      return {
        text: cleanText,
        fontSize: step.size,
        lineSpacingMultiple: step.spacing
      };
    }
  }

  // กรณียังยาวเกินแม้ลดฟอนต์เหลือ 6.5pt แล้ว ให้คงข้อความไว้ทั้งหมด 100% ห้ามตัดทิ้ง เพื่อให้ผู้ใช้ปรับแต่งเองใน PowerPoint ได้ครบ
  const minStep = fontSteps[fontSteps.length - 1];
  return {
    text: cleanText,
    fontSize: minStep.size,
    lineSpacingMultiple: minStep.spacing
  };
}

function buildSiteReportSlides(pptx, visits, includeSectionDivider, onePageSummaryData = null) {
  if (!visits || visits.length === 0) return;

  if (includeSectionDivider) {
    const extraNote = onePageSummaryData ? 'รวมหน้าสรุปภาพรวม One Page และรายละเอียด' : '';
    addSectionDividerSlide(
      pptx,
      '02',
      'Weekly Site Visit Report',
      `รายงานความคืบหน้าหน้างาน แผนเรียกสินค้า ปัญหา/ความเสี่ยง และภาพถ่ายประกอบ (${extraNote}${visits.length} รายการ)`,
      '0284C7'
    );
  }

  // แทรกสไลด์สรุปรวม Site Visit ทั้งหมดใน 1 หน้า (Executive One-Page Summary) ก่อนหน้ารายละเอียดรายโครงการ
  if (onePageSummaryData) {
    addSiteVisitOnePageSummarySlide(pptx, onePageSummaryData);
  }

  visits.forEach((item, index) => {
    const slide = pptx.addSlide();

    const shortProjName = truncateProjectName20(item.projectName || 'ไม่ระบุชื่อโครงการ');
    const projTitle = `${index + 1}. ${shortProjName}${item.projectId && item.projectId !== '-' ? ` (${item.projectId})` : ''}`;
    const formattedDates = collectAllUniqueVisitDates([item]) || (item.visitDate || '-');
    const subInfo = `ผู้รับเหมา: ${item.contractor || '-'}   |   วันที่เข้าตรวจ: ${formattedDates}`;

    addSlideHeaderBar(
      slide,
      pptx,
      'SITE REPORT',
      '0284C7',
      projTitle,
      subInfo,
      { maxTextW: 8.15 }
    );

    const rawRisk = String(item.riskLevel || '').trim().toLowerCase();
    let riskBg = 'DCFCE7';
    let riskColor = '15803D';
    let riskLabel = 'ปกติ (Low Risk)';
    if (rawRisk.includes('high') || rawRisk.includes('วิกฤต')) {
      riskBg = 'FFE4E6';
      riskColor = 'BE123C';
      riskLabel = 'วิกฤต (High Risk)';
    } else if (rawRisk.includes('med') || rawRisk.includes('เฝ้าระวัง')) {
      riskBg = 'FEF3C7';
      riskColor = 'B45309';
      riskLabel = 'เฝ้าระวัง (Medium Risk)';
    }

    slide.addShape(pptx.ShapeType.roundRect, {
      x: 10.85, y: 0.22, w: 2.03, h: 0.46,
      fill: { color: riskBg },
      line: { color: riskColor, width: 1 }
    });
    slide.addText(riskLabel, {
      x: 10.85, y: 0.22, w: 2.03, h: 0.46,
      fontFace: 'Tahoma', fontSize: 10, bold: true, color: riskColor, align: 'center', valign: 'middle'
    });

    const imagesList = (item.images && item.images.length > 0)
      ? item.images
      : (item.imageData ? [{ base64Data: item.imageData, mimeType: item.mimeType || 'image/jpeg' }] : []);

    const hasPhotos = imagesList.length > 0;
    const leftPanelW = hasPhotos ? 6.45 : 12.43;

    // ความสูงรวม 4 กล่อง + ช่องว่าง = 1.62 + 1.48 + 1.38 + 1.38 + (3 * 0.11) = 6.19 นิ้ว (จบที่ y = 7.26 นิ้ว พอดีขอบล่างสไลด์ 7.5 นิ้ว)
    const sections = [
      {
        title: '1. ความคืบหน้า & การใช้งานสินค้า',
        body: item.siteProgress || '-',
        bg: 'FFFFFF',
        border: 'CBD5E1',
        titleColor: '0F172A',
        h: 1.62
      },
      {
        title: '2. แผนเรียกสินค้า (Material Forecast)',
        body: item.materialForecast || '-',
        bg: 'EEF2FF',
        border: 'C7D2FE',
        titleColor: '312E81',
        h: 1.48
      },
      {
        title: '3. ปัญหา / ความเสี่ยงหน้างาน',
        body: item.issuesAndRisks || '-',
        bg: 'FFF1F2',
        border: 'FECDD3',
        titleColor: '9F1239',
        h: 1.38
      },
      {
        title: '4. สิ่งที่ต้องติดตามต่อ',
        body: item.nextWeekActions || '-',
        bg: 'ECFDF5',
        border: 'A7F3D0',
        titleColor: '065F46',
        h: 1.38
      }
    ];

    let curY = 1.07;
    sections.forEach(sec => {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.45, y: curY, w: leftPanelW, h: sec.h,
        fill: { color: sec.bg },
        line: { color: sec.border, width: 1 }
      });

      slide.addText(sec.title, {
        x: 0.60, y: curY + 0.06, w: leftPanelW - 0.30, h: 0.25,
        fontFace: 'Tahoma', fontSize: 10, bold: true, color: sec.titleColor
      });

      const fitted = calcAutoFitTextLayout(sec.body, leftPanelW, sec.h);

      slide.addText(fitted.text, {
        x: 0.60,
        y: curY + 0.31,
        w: leftPanelW - 0.30,
        h: sec.h - 0.36,
        fontFace: 'Tahoma',
        fontSize: fitted.fontSize,
        color: '1E293B',
        valign: 'top',
        wrap: true,
        fit: 'shrink',
        lineSpacingMultiple: fitted.lineSpacingMultiple
      });

      curY += sec.h + 0.11;
    });

    if (hasPhotos) {
      const rightX = 7.12;
      const rightW = 5.76;
      const rightY = 1.07;
      const rightH = 6.19;

      slide.addShape(pptx.ShapeType.roundRect, {
        x: rightX, y: rightY, w: rightW, h: rightH,
        fill: { color: 'FFFFFF' },
        line: { color: 'BAE6FD', width: 1 }
      });

      const showImages = imagesList.slice(0, 4);
      const captionSuffix = imagesList.length > 4 ? ` (แสดง 4 จากทั้งหมด ${imagesList.length} รูป)` : ` (${imagesList.length} รูป)`;

      slide.addText(`รูปถ่ายประกอบหน้างาน${captionSuffix}`, {
        x: rightX + 0.18, y: rightY + 0.1, w: rightW - 0.36, h: 0.3,
        fontFace: 'Tahoma', fontSize: 10.5, bold: true, color: '0369A1'
      });

      const imgAreaX = rightX + 0.18;
      const imgAreaY = rightY + 0.46;
      const imgAreaW = rightW - 0.36;
      const imgAreaH = rightH - 0.62;

      if (showImages.length === 1) {
        addFormattedSitePhoto(slide, showImages[0], imgAreaX, imgAreaY, imgAreaW, imgAreaH);
      } else if (showImages.length === 2) {
        const halfH = (imgAreaH - 0.15) / 2;
        addFormattedSitePhoto(slide, showImages[0], imgAreaX, imgAreaY, imgAreaW, halfH);
        addFormattedSitePhoto(slide, showImages[1], imgAreaX, imgAreaY + halfH + 0.15, imgAreaW, halfH);
      } else {
        const cellW = (imgAreaW - 0.15) / 2;
        const cellH = (imgAreaH - 0.15) / 2;
        showImages.forEach((imgObj, pIdx) => {
          const col = pIdx % 2;
          const row = Math.floor(pIdx / 2);
          const px = imgAreaX + col * (cellW + 0.15);
          const py = imgAreaY + row * (cellH + 0.15);
          addFormattedSitePhoto(slide, imgObj, px, py, cellW, cellH);
        });
      }
    }
  });
}

function addFormattedSitePhoto(slide, imgObj, x, y, w, h) {
  if (!imgObj || !imgObj.base64Data) return;
  const cleanB64 = String(imgObj.base64Data).replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
  const mime = imgObj.mimeType || 'image/jpeg';
  slide.addImage({
    data: `data:${mime};base64,${cleanB64}`,
    x: x,
    y: y,
    w: w,
    h: h,
    sizing: { type: 'contain', w: w, h: h }
  });
}

window.openPptxExportModal = openPptxExportModal;
window.closePptxExportModal = closePptxExportModal;
window.renderPptxProjectCheckboxes = renderPptxProjectCheckboxes;
window.toggleSinglePptxProject = toggleSinglePptxProject;
window.toggleAllPptxProjects = toggleAllPptxProjects;
window.updatePptxExportPreviewStats = updatePptxExportPreviewStats;
window.executePptxExport = executePptxExport;
