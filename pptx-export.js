/**
 * PowerPoint Export Module (pptx-export.js)
 * สร้างไฟล์ PowerPoint (.pptx) ด้วย PptxGenJS แบบ Widescreen 16:9
 * รองรับการเลือกโครงการแบบ Multi-Select (1 โครงการ, หลายโครงการ หรือทั้งหมด)
 * และแยกส่งออกระหว่าง "Site Report (รายงานหน้างานและรูปถ่าย)" และ "กราฟวิเคราะห์และ KPI อื่นๆ"
 */

let pptxAvailableProjectsList = []; // [{ key, id, name }]
let selectedPptxProjectKeys = new Set();

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
    return `${p.name}${p.id ? ` (${p.id})` : ''}`;
  }
  if (selectedObjs.length <= 3) {
    return `เลือก ${selectedObjs.length} โครงการ: ${selectedObjs.map(p => p.name).join(', ')}`;
  }
  return `เลือก ${selectedObjs.length} โครงการ (${selectedObjs.slice(0, 2).map(p => p.name).join(', ')} และอีก ${selectedObjs.length - 2} โครงการ)`;
}

/**
 * ตรวจสอบจำนวนข้อมูลและกราฟที่พร้อมส่งออกตามโครงการที่เลือกเพื่อแสดงใน Modal
 */
async function updatePptxExportPreviewStats() {
  const scopeLabelEl = document.getElementById('pptxScopeProjectLabel');
  const siteCountEl = document.getElementById('pptxPreviewSiteCount');
  const chartCountEl = document.getElementById('pptxPreviewChartCount');

  if (scopeLabelEl) scopeLabelEl.textContent = getSelectedProjectsSummaryLabel();

  const visits = await getFilteredSiteVisitsForPptx();
  if (siteCountEl) {
    siteCountEl.textContent = `${visits.length} รายการ (${visits.length} สไลด์)`;
  }

  const availableCharts = collectAvailableChartConfigs();
  if (chartCountEl) {
    chartCountEl.textContent = `KPI + ${availableCharts.length} กราฟวิเคราะห์`;
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
 * รวบรวมโครงสร้างกราฟวิเคราะห์ทั้ง 5 กราฟที่มีข้อมูลในระบบ
 */
function collectAvailableChartConfigs() {
  const unitText = getUnitSuffix();
  const hasParsedRows = Array.isArray(parsedDataRowsGlobal) && parsedDataRowsGlobal.length > 0;
  const hasForecastMonths = Array.isArray(availableForecastMonths) && availableForecastMonths.length > 0;

  const candidates = [
    {
      id: 'dealerCompMonthlyChart',
      available: hasParsedRows && Array.isArray(allMonthHeadersGlobal) && allMonthHeadersGlobal.length > 0,
      title: `Ropp vs Dealer Actual รายเดือน (${unitText})`,
      subtitle: 'เปรียบเทียบยอดโอกาส (Ropp) กับยอดขายจริงผ่านผู้แทนจำหน่าย (Dealer Actual) แยกรายเดือน',
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProjectChart',
      available: hasParsedRows,
      title: `Ropp vs Dealer Actual ใน Top โครงการ (${unitText})`,
      subtitle: 'เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer รายโครงการสูงสุด 10 อันดับ (เฉพาะโครงการที่เลือก)',
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProductChart',
      available: hasParsedRows,
      title: `Ropp vs Dealer Actual รายกลุ่มสินค้า (${unitText})`,
      subtitle: 'เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer แยกตามกลุ่มสินค้าหลัก (เฉพาะโครงการที่เลือก)',
      category: 'Dealer Analytics'
    },
    {
      id: 'forecastProductChart',
      available: hasParsedRows && hasForecastMonths,
      title: `คาดการณ์ยอดขายล่วงหน้า รายกลุ่มสินค้า (${unitText})`,
      subtitle: 'แผนโอกาสขายล่วงหน้า (Sales Forecast - Ropp) แยกตามกลุ่มสินค้า (เฉพาะโครงการที่เลือก)',
      category: 'Sales Forecast'
    },
    {
      id: 'forecastProjectChart',
      available: hasParsedRows && hasForecastMonths,
      title: `คาดการณ์ยอดขายล่วงหน้า รายโครงการ (${unitText})`,
      subtitle: 'Stacked Bar แสดงสัดส่วนกลุ่มสินค้าที่คาดการณ์ล่วงหน้าในแต่ละโครงการ (เฉพาะโครงการที่เลือก)',
      category: 'Sales Forecast'
    }
  ];

  return candidates.filter(cfg => cfg.available);
}

/**
 * สร้างภาพ PNG พื้นหลังสีขาวจาก Chart.js บน Off-screen Canvas โดยกรองเฉพาะโครงการที่เลือก
 */
function renderOffscreenChartPngForSelectedProjects(chartId) {
  if (!parsedDataRowsGlobal || parsedDataRowsGlobal.length === 0) return null;
  if (typeof Chart === 'undefined') return null;

  const unitSuffix = getUnitSuffix();
  let chartConfig = null;

  if (chartId === 'dealerCompMonthlyChart' || chartId === 'dealerCompProjectChart' || chartId === 'dealerCompProductChart') {
    const sMonth = document.getElementById('dealerCompStartMonthSelect');
    const eMonth = document.getElementById('dealerCompEndMonthSelect');
    let startIdx = sMonth ? (parseInt(sMonth.value, 10) || 0) : 0;
    let endIdx = eMonth ? (parseInt(eMonth.value, 10) || (allMonthHeadersGlobal.length - 1)) : (allMonthHeadersGlobal.length - 1);
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
        const roppData = projectRoppMap[key] || { name: key, code: key, ropp: 0 };
        const dealerAct = projectDealerActMap[key] || 0;
        return { name: roppData.name || key, ropp: roppData.ropp, dealerAct, total: roppData.ropp + dealerAct };
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
        const ropp = productRoppMap[prod] || 0;
        const dealerAct = productDealerActMap[prod] || 0;
        return { name: prod, ropp, dealerAct, total: ropp + dealerAct };
      }).sort((a, b) => b.total - a.total).slice(0, 10);

      chartConfig = {
        type: 'bar',
        data: {
          labels: list.map(p => p.name),
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
    const startIdx = fStart ? (parseInt(fStart.value, 10) || 0) : 0;
    const endIdx = fEnd ? (parseInt(fEnd.value, 10) || Math.min(availableForecastMonths.length - 1, 2)) : Math.min(availableForecastMonths.length - 1, 2);
    const selectedMonths = availableForecastMonths.slice(startIdx, endIdx + 1);
    const forecastProducts = {};

    parsedDataRowsGlobal.forEach(row => {
      const projectCode = (row[0] || '').trim();
      const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
      const projectKey = projectCode || projectName;
      if (!isProjectSelectedForPptx(projectCode, projectName, projectKey)) return;

      const productGroup = (row[4] || 'อื่นๆ').trim();
      if (selectedForecastProducts.size > 0 && !selectedForecastProducts.has(productGroup)) return;

      const unitPrice = getUnitPrice(productGroup);
      if (!forecastProducts[productGroup]) {
        forecastProducts[productGroup] = new Array(selectedMonths.length).fill(0);
      }
      selectedMonths.forEach((fm, fIdx) => {
        const fUnit = parseNum(row[fm.roppCol]);
        const fVal = displayMode === 'baht' ? (fUnit * unitPrice) : fUnit;
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
          label: p.name,
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
    const selectedMonthIdx = fSingle ? (parseInt(fSingle.value, 10) || 0) : 0;
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
      if (selectedForecastProducts.size > 0 && !selectedForecastProducts.has(productGroup)) return;

      const unitPrice = getUnitPrice(productGroup);
      const fUnit = parseNum(row[targetMonth.roppCol]);
      const fVal = displayMode === 'baht' ? (fUnit * unitPrice) : fUnit;

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
      label: prod,
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

  if (statusBox) statusBox.classList.remove('hidden');
  if (statusText) statusText.textContent = 'กำลังเตรียมข้อมูลและสร้างสไลด์ PowerPoint...';
  actionBtns.forEach(btn => { btn.disabled = true; });

  try {
    const visits = await getFilteredSiteVisitsForPptx();
    const charts = collectAvailableChartConfigs();
    const hasSalesData = Array.isArray(projectList) && projectList.length > 0;

    if (mode === 'site_only' && visits.length === 0) {
      alert('ไม่พบข้อมูล Site Report สำหรับโครงการที่เลือก');
      return;
    }

    if (mode === 'charts_only' && !hasSalesData && charts.length === 0) {
      alert('ไม่พบข้อมูล KPI หรือกราฟวิเคราะห์ กรุณาอัปโหลดไฟล์ยอดขาย CSV ก่อน');
      return;
    }

    if ((mode === 'combined' || mode === 'separate_files') && visits.length === 0 && !hasSalesData && charts.length === 0) {
      alert('ยังไม่มีข้อมูลสำหรับ Export PowerPoint กรุณาอัปโหลดไฟล์ยอดขายหรือเพิ่มรายงานหน้างานก่อน');
      return;
    }

    const dateStamp = new Date().toISOString().slice(0, 10);
    let projSlug = '_All_Projects';
    if (pptxAvailableProjectsList.length > 0 && selectedPptxProjectKeys.size < pptxAvailableProjectsList.length) {
      if (selectedPptxProjectKeys.size === 1) {
        const onlyProj = pptxAvailableProjectsList.find(p => selectedPptxProjectKeys.has(p.key));
        const rawName = onlyProj ? (onlyProj.id || onlyProj.name) : 'Selected';
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
        buildSiteReportSlides(pptxSite, visits, false);
        await pptxSite.writeFile({ fileName: `Site_Report${projSlug}_${dateStamp}.pptx` });
        exportedCount++;
      }

      if (hasSalesData || charts.length > 0) {
        if (statusText) statusText.textContent = 'กำลังสร้างไฟล์ที่ 2: Sales Analytics & Charts (.pptx)...';
        const pptxCharts = createBasePptxInstance('Sales & Cross-sell Analytics');
        addCoverSlide(pptxCharts, 'รายงานวิเคราะห์ยอดขายและกราฟ (Sales & Cross-sell Analytics)', 'สรุปตัวชี้วัด KPI, เปรียบเทียบ Ropp vs Dealer Actual และคาดการณ์ยอดขายล่วงหน้า');
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
      const pptx = createBasePptxInstance('Weekly Site Visit Report');
      addCoverSlide(pptx, 'รายงานความคืบหน้าหน้างาน (Weekly Site Visit Report)', 'สรุปผลการเข้าเยี่ยมหน้างาน แผนเรียกสินค้า และภาพถ่ายประกอบ');
      buildSiteReportSlides(pptx, visits, false);
      await pptx.writeFile({ fileName: `Site_Report${projSlug}_${dateStamp}.pptx` });
      closePptxExportModal();
      return;
    }

    if (mode === 'charts_only') {
      const pptx = createBasePptxInstance('Sales & Cross-sell Analytics');
      addCoverSlide(pptx, 'รายงานวิเคราะห์ยอดขายและกราฟ (Sales & Cross-sell Analytics)', 'สรุปตัวชี้วัด KPI, เปรียบเทียบ Ropp vs Dealer Actual และคาดการณ์ยอดขายล่วงหน้า');
      buildAnalyticsAndChartSlides(pptx, charts, false);
      await pptx.writeFile({ fileName: `Sales_Charts_Analytics${projSlug}_${dateStamp}.pptx` });
      closePptxExportModal();
      return;
    }

    // โหมด combined: รวมทั้ง 2 ส่วนใน 1 ไฟล์ โดยคั่นด้วยหน้าแบ่งหมวด (Section Divider) ชัดเจน
    const pptx = createBasePptxInstance('Sales Analytics & Site Visit Report');
    addCoverSlide(
      pptx,
      'Sales Analytics & Weekly Site Visit Report',
      'รายงานสรุปผลประกอบการ กราฟวิเคราะห์ยอดขาย และความคืบหน้าหน้างาน'
    );

    if (hasSalesData || charts.length > 0) {
      buildAnalyticsAndChartSlides(pptx, charts, true);
    }
    if (visits.length > 0) {
      buildSiteReportSlides(pptx, visits, true);
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
  const unitLabel = displayMode === 'baht' ? 'มูลค่า (บาท)' : 'ปริมาณ (Unit)';
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

function addSlideHeaderBar(slide, pptx, badgeText, badgeColor, titleText, subText) {
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

  slide.addText(titleText, {
    x: 2.55, y: 0.14, w: 10.3, h: 0.38,
    fontFace: 'Tahoma', fontSize: 16, bold: true, color: '0F172A', valign: 'middle'
  });

  slide.addText(subText, {
    x: 2.55, y: 0.50, w: 10.3, h: 0.30,
    fontFace: 'Tahoma', fontSize: 10, color: '64748B', valign: 'middle'
  });
}

// ==========================================
// ส่วนที่ 1: สไลด์ KPI และกราฟวิเคราะห์อื่นๆ (คำนวณเฉพาะโครงการที่เลือก)
// ==========================================
function buildAnalyticsAndChartSlides(pptx, charts, includeSectionDivider) {
  if (includeSectionDivider) {
    addSectionDividerSlide(
      pptx,
      '01',
      'Sales KPI & Analytics Charts',
      'สรุปตัวชี้วัดหลัก (KPI), ตารางโครงการเด่น, เปรียบเทียบ Ropp vs Dealer Actual และคาดการณ์ยอดขาย',
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
}

function computeKpiStatsForSelectedProjects() {
  let totalRopp = 0;
  let totalAct = 0;
  let crossSellCount = 0;

  const filteredProjects = (projectList || []).filter(p =>
    isProjectSelectedForPptx(p.id, p.name, p.key)
  );

  filteredProjects.forEach(p => {
    totalRopp += p.totalRopp || 0;
    if (Array.isArray(p.boughtProducts) && p.boughtProducts.length > 1) {
      crossSellCount++;
    }
  });

  (matchedDealerList || []).forEach(item => {
    if (isProjectSelectedForPptx(item.projectId, item.projectName)) {
      totalAct += (displayMode === 'baht' ? item.netAmount : item.actual);
    }
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
    filteredProjects
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
    { label: `ยอดขายจริงรวม (${unitText})`, value: formatNumber(stats.totalAct), sub: 'Dealer Actual', accent: '059669', bg: 'ECFDF5' },
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
      tableRows.push([
        { text: p.id || '-', options: { fill: rowBg, align: 'center', color: '475569' } },
        { text: p.name || '-', options: { fill: rowBg, bold: true, color: '0F172A' } },
        { text: boughtText, options: { fill: rowBg, color: '334155' } },
        { text: formatNumber(p.totalRopp), options: { fill: rowBg, align: 'right', color: '1D4ED8' } },
        { text: formatNumber(p.totalAct), options: { fill: rowBg, align: 'right', bold: true, color: '047857' } },
        { text: `${(p.rate || 0).toFixed(1)}%`, options: { fill: rowBg, align: 'center', bold: true, color: '4338CA' } }
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
// ส่วนที่ 2: สไลด์ Site Report (รายงานความคืบหน้าและรูปถ่ายหน้างาน)
// ==========================================
function buildSiteReportSlides(pptx, visits, includeSectionDivider) {
  if (!visits || visits.length === 0) return;

  if (includeSectionDivider) {
    addSectionDividerSlide(
      pptx,
      '02',
      'Weekly Site Visit Report',
      `รายงานความคืบหน้าหน้างาน แผนเรียกสินค้า ปัญหา/ความเสี่ยง และรูปถ่ายประกอบ (${visits.length} รายการ)`,
      '0284C7'
    );
  }

  visits.forEach((item, index) => {
    const slide = pptx.addSlide();

    const projTitle = `${index + 1}. ${item.projectName || 'ไม่ระบุชื่อโครงการ'}${item.projectId && item.projectId !== '-' ? ` (${item.projectId})` : ''}`;
    const subInfo = `ผู้รับเหมา: ${item.contractor || '-'}   |   วันที่เข้าตรวจ: ${item.visitDate || '-'}`;

    addSlideHeaderBar(
      slide,
      pptx,
      'SITE REPORT',
      '0284C7',
      projTitle,
      subInfo
    );

    let riskBg = 'DCFCE7';
    let riskColor = '15803D';
    let riskLabel = 'ปกติ (Low Risk)';
    if (item.riskLevel === 'High') {
      riskBg = 'FFE4E6';
      riskColor = 'BE123C';
      riskLabel = 'วิกฤต (High Risk)';
    } else if (item.riskLevel === 'Medium') {
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

    const sections = [
      {
        title: '1. ความคืบหน้า & การใช้งานสินค้า',
        body: item.siteProgress || '-',
        bg: 'FFFFFF',
        border: 'CBD5E1',
        titleColor: '0F172A',
        h: 1.55
      },
      {
        title: '2. แผนเรียกสินค้า (Material Forecast)',
        body: item.materialForecast || '-',
        bg: 'EEF2FF',
        border: 'C7D2FE',
        titleColor: '312E81',
        h: 1.35
      },
      {
        title: '3. ปัญหา / ความเสี่ยงหน้างาน',
        body: item.issuesAndRisks || '-',
        bg: 'FFF1F2',
        border: 'FECDD3',
        titleColor: '9F1239',
        h: 1.35
      },
      {
        title: '4. สิ่งที่ต้องติดตามต่อสัปดาห์หน้า',
        body: item.nextWeekActions || '-',
        bg: 'ECFDF5',
        border: 'A7F3D0',
        titleColor: '065F46',
        h: 1.35
      }
    ];

    let curY = 1.12;
    sections.forEach(sec => {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: 0.45, y: curY, w: leftPanelW, h: sec.h,
        fill: { color: sec.bg },
        line: { color: sec.border, width: 1 }
      });

      slide.addText(sec.title, {
        x: 0.62, y: curY + 0.08, w: leftPanelW - 0.34, h: 0.28,
        fontFace: 'Tahoma', fontSize: 10.5, bold: true, color: sec.titleColor
      });

      slide.addText(String(sec.body), {
        x: 0.62, y: curY + 0.36, w: leftPanelW - 0.34, h: sec.h - 0.44,
        fontFace: 'Tahoma', fontSize: 10, color: '1E293B', valign: 'top', lineSpacingMultiple: 1.2
      });

      curY += sec.h + 0.14;
    });

    if (hasPhotos) {
      const rightX = 7.12;
      const rightW = 5.76;
      const rightY = 1.12;
      const rightH = 5.82;

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
window.executePptxExport = executePptxExport;
