/**
 * Sales Engine & Master Filters (sales-engine.js)
 * จัดการข้อมูลไฟล์ยอดขายหลัก Ropp vs Act, Master Filter, KPI, ตารางโครงการ, Inactive และ Cross-sell
 * ปรับปรุง:
 * 1. ยอดขายจริงรวม (Total Act) และอัตราความสำเร็จคำนวณจากไฟล์ Dealer CSV (matchedDealerList) โดยตรง
 * 2. รองรับปุ่ม "รวมข้อมูลโครงการ" (ย้ายเฉพาะยอด Actual และรายงาน Site Visit เข้าโครงการหลัก)
 * 3. รองรับปุ่ม "Backup JSON" และ "Restore JSON" แบบเลือกหมวดหมู่ได้ และประกอบไฟล์แบบแบ่งส่วน (Chunked Blob Assembly)
 * 4. เชื่อมตัวกรองรายงาน Weekly แบบเลือกได้ 1 เดือนหรือหลายเดือน (Multi-Select Month Filter) เข้ากับปุ่มใน Section 1 และ Modal Export
 * 5. เพิ่มระบบ "ตารางพักรายการเตรียม Export (Export Staging Table)" และระบบ AI สรุป 2 โหมด (สรุปรวมเป็น 1 แถว / สรุปแยกตามรายโครงการ) ด้วย gemini-3.5-flash-lite
 * 6. รองรับเมนูพับเก็บได้บนหน้าจอมือถือ (toggleMobileHeaderTools)
 */

function toggleMobileHeaderTools() {
  const container = document.getElementById('headerToolsContainer');
  const btn = document.getElementById('toggleMobileHeaderToolsBtn');
  if (!container) return;
  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (btn) btn.innerHTML = '<span>✖️</span> <span>ปิดเมนู</span>';
  } else {
    container.classList.add('hidden');
    if (btn) btn.innerHTML = '<span>⚙️</span> <span>เมนู</span>';
  }
}

function handleSalesFile(file) {
  if (!file) return;
  readFileWithEncodingDetection(file, function(csvText) {
    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      complete: function(results) {
        salesRawRows = results.data;
        dbSave('cached_files', { fileType: 'sales_data', data: salesRawRows });
        processSalesCSV(salesRawRows);
        if (dealerRawRows) {
          processDealerCSV(dealerRawRows);
        }
      },
      error: function(err) {
        alert('เกิดข้อผิดพลาดในการอ่านไฟล์ยอดขาย: ' + err.message);
      }
    });
  });
}

function processSalesCSV(rows) {
  if (!rows || rows.length < 2) return;
  validProjectIdsSet.clear();

  const dropZone = document.getElementById('dropZone');
  const dashboardSection = document.getElementById('dashboardSection');
  if (dropZone) dropZone.classList.add('hidden');
  if (dashboardSection) dashboardSection.classList.remove('hidden');

  let row0 = rows[0] || [];
  let row1 = rows[1] || [];
  let row2 = rows[2] || [];

  let dataStartRowIdx = 1;
  let monthRow = row0;
  let typeRow = row1;

  const hasRoppActInRow2Cols = row2.slice(13).some(c => /\b(ropp|act)\b/i.test(String(c || '').trim()));
  const hasRoppActInRow1Cols = row1.slice(13).some(c => /\b(ropp|act)\b/i.test(String(c || '').trim()));
  const hasRoppActInRow0Cols = row0.slice(13).some(c => /\b(ropp|act)\b/i.test(String(c || '').trim()));

  if (hasRoppActInRow2Cols) {
    monthRow = row1;
    typeRow = row2;
    dataStartRowIdx = 3;
  } else if (hasRoppActInRow1Cols) {
    monthRow = row0;
    typeRow = row1;
    dataStartRowIdx = 2;
  } else if (hasRoppActInRow0Cols) {
    monthRow = row1;
    typeRow = row0;
    dataStartRowIdx = 2;
  }

  const maxCols = Math.max(monthRow.length, typeRow.length);
  const monthHeaders = [];
  let fallbackIndex = 0;
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth();

  for (let col = 13; col < maxCols; col += 2) {
    const roppColIdx = col;
    const actColIdx = col + 1;

    let detectedMonth = (monthRow[roppColIdx] || monthRow[actColIdx] || '').trim();
    if (!detectedMonth || !isDateOrMonthStr(detectedMonth)) {
      let alt = (typeRow[roppColIdx] || typeRow[actColIdx] || '').trim();
      if (isDateOrMonthStr(alt)) {
        detectedMonth = alt;
      }
    }
    detectedMonth = detectedMonth.replace(/\b(ropp|act)\b/gi, '').trim();
    const parsedDate = parseMonthYearDate(detectedMonth);

    monthHeaders.push({
      index: fallbackIndex,
      monthYear: detectedMonth || `งวด ${fallbackIndex + 1}`,
      parsedDate: parsedDate,
      roppCol: roppColIdx,
      actCol: actColIdx
    });
    fallbackIndex++;
  }

  allMonthHeadersGlobal = monthHeaders;

  let futureMonthHeaders = monthHeaders.filter(m => {
    if (!m.parsedDate) return false;
    if (m.parsedDate.year > currentYear) return true;
    if (m.parsedDate.year === currentYear && m.parsedDate.month >= currentMonth) return true;
    return false;
  });

  if (futureMonthHeaders.length === 0) {
    futureMonthHeaders = monthHeaders.slice(-4);
  }
  availableForecastMonths = futureMonthHeaders;

  const dataRows = rows.slice(dataStartRowIdx);
  parsedDataRowsGlobal = dataRows;

  const prodGroupSet = new Set();
  const projectsMapUnique = new Map();
  const projectsMap = {};
  const mergedPastActivityMap = new Map(); // ใช้รวบรวมยอดซื้อจริงในอดีตตามโครงการเป้าหมายสำหรับคำนวณ Inactive

  function ensureProjectEntry(key, code, name) {
    if (!projectsMap[key]) {
      projectsMap[key] = {
        id: code,
        name: name,
        key: key,
        totalRopp: 0,
        totalAct: 0,
        productsAct: {},
        productsRopp: {},
        productDetails: {}
      };
    }
  }

  dataRows.forEach(r => {
    const projectCode = (r[0] || '').trim();
    if (projectCode) {
      validProjectIdsSet.add(projectCode);
    }
    const p = (r[4] || '').trim();
    if (p) prodGroupSet.add(p);

    const projectName = (r[1] || r[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const projectKey = projectCode || projectName;
    if (projectKey && !projectsMapUnique.has(projectKey)) {
      projectsMapUnique.set(projectKey, {
        id: projectCode,
        name: projectName,
        key: projectKey
      });
    }

    ensureProjectEntry(projectKey, projectCode, projectName);

    // ตรวจสอบกฎการรวมโครงการ (ย้ายเฉพาะ Actual ไปยัง Main Project โดยคง Ropp ไว้ที่โครงการเดิม)
    const mergedTarget = typeof getMergedTargetProjectInfo === 'function'
      ? getMergedTargetProjectInfo(projectCode, projectName, projectKey)
      : null;
    const actualTargetKey = mergedTarget ? mergedTarget.key : projectKey;
    if (mergedTarget) {
      ensureProjectEntry(actualTargetKey, mergedTarget.id, mergedTarget.name);
    }

    const unitPrice = getUnitPrice(p);
    let rowRoppSum = 0;
    let rowActSum = 0;
    let rowRoppUnitSum = 0;
    let rowActUnitSum = 0;

    monthHeaders.forEach((m, mIdx) => {
      const rUnit = parseNum(r[m.roppCol]);
      const aUnit = parseNum(r[m.actCol]);
      rowRoppUnitSum += rUnit;
      rowActUnitSum += aUnit;

      const rVal = displayMode === 'baht' ? (rUnit * unitPrice) : rUnit;
      const aVal = displayMode === 'baht' ? (aUnit * unitPrice) : aUnit;

      rowRoppSum += rVal;
      rowActSum += aVal;

      // สะสมประวัติการซื้อจริงในอดีตตามโครงการเป้าหมาย (actualTargetKey) เพื่อตรวจ Inactive
      let isNotFuture = true;
      if (m.parsedDate) {
        if (m.parsedDate.year > currentYear || (m.parsedDate.year === currentYear && m.parsedDate.month > currentMonth)) {
          isNotFuture = false;
        }
      }
      if (isNotFuture && aVal > 0 && (projectCode || r[1] || r[2])) {
        const effCode = mergedTarget ? mergedTarget.id : projectCode;
        const effName = mergedTarget ? mergedTarget.name : projectName;
        const groupKey = `${actualTargetKey}||${p || 'อื่นๆ'}`;
        if (!mergedPastActivityMap.has(groupKey)) {
          mergedPastActivityMap.set(groupKey, {
            projectName: effName,
            projectCode: effCode,
            productGroup: p || 'อื่นๆ',
            monthlyVals: new Array(monthHeaders.length).fill(0)
          });
        }
        mergedPastActivityMap.get(groupKey).monthlyVals[mIdx] += aVal;
      }
    });

    // Ropp อยู่ที่โครงการเดิมเสมอ (ไม่รวม Ropp ข้ามโครงการ)
    projectsMap[projectKey].totalRopp += rowRoppSum;
    if (!projectsMap[projectKey].productDetails[p]) {
      projectsMap[projectKey].productDetails[p] = {
        productGroup: p,
        unitPrice: unitPrice,
        roppUnit: 0,
        actUnit: 0,
        roppBaht: 0,
        actBaht: 0
      };
    }
    projectsMap[projectKey].productDetails[p].roppUnit += rowRoppUnitSum;
    projectsMap[projectKey].productDetails[p].roppBaht += (rowRoppUnitSum * unitPrice);
    if (rowRoppSum > 0) {
      projectsMap[projectKey].productsRopp[p] = (projectsMap[projectKey].productsRopp[p] || 0) + rowRoppSum;
    }

    // Actual ถูกรวมเข้าโครงการหลัก (actualTargetKey)
    projectsMap[actualTargetKey].totalAct += rowActSum;
    if (!projectsMap[actualTargetKey].productDetails[p]) {
      projectsMap[actualTargetKey].productDetails[p] = {
        productGroup: p,
        unitPrice: unitPrice,
        roppUnit: 0,
        actUnit: 0,
        roppBaht: 0,
        actBaht: 0
      };
    }
    projectsMap[actualTargetKey].productDetails[p].actUnit += rowActUnitSum;
    projectsMap[actualTargetKey].productDetails[p].actBaht += (rowActUnitSum * unitPrice);

    if (rowActSum > 0) {
      projectsMap[actualTargetKey].productsAct[p] = (projectsMap[actualTargetKey].productsAct[p] || 0) + rowActSum;
    }
  });

  projectsMapGlobal = projectsMap;
  const unitSuffix = getUnitSuffix();

  projectList = Object.values(projectsMap).map(p => {
    const rate = p.totalRopp > 0 ? (p.totalAct / p.totalRopp) * 100 : 0;
    const boughtProducts = Object.keys(p.productsAct);
    const oppProducts = Object.entries(p.productsRopp)
      .sort((a, b) => b[1] - a[1])
      .map(([name, val]) => `${name} (${formatNumber(val)} ${unitSuffix})`);

    return {
      ...p,
      rate: rate,
      boughtProducts: boughtProducts,
      topOppProducts: oppProducts.slice(0, 3)
    };
  });

  crossSellProjectsList = projectList.filter(p => p.boughtProducts.length > 1);

  allForecastProductGroups = Array.from(prodGroupSet).sort((a, b) => a.localeCompare(b, 'th'));
  if (selectedForecastProducts.size === 0) selectedForecastProducts = new Set(allForecastProductGroups);
  if (selectedDealerCompProducts.size === 0) selectedDealerCompProducts = new Set(allForecastProductGroups);

  allProjectListGlobal = Array.from(projectsMapUnique.values()).sort((a, b) => a.name.localeCompare(b.name, 'th'));

  inactiveList = [];
  missingPriceProducts.clear();

  dataRows.forEach(row => {
    const projectCode = (row[0] || '').trim();
    if (!projectCode && !row[1] && !row[2]) return;
    const productGroup = (row[4] || 'อื่นๆ').trim();
    const unitPrice = getUnitPrice(productGroup);
    if (unitPrice === 0) {
      missingPriceProducts.add(productGroup);
    }
  });

  mergedPastActivityMap.forEach(entry => {
    let hasPastSales = false;
    let lastActiveMonthYear = '-';
    let lastActiveDateObj = null;
    let lastActiveActVal = 0;
    let totalPastAct = 0;
    let pastMonthsCountWithSales = 0;

    entry.monthlyVals.forEach((aVal, mIdx) => {
      if (aVal > 0) {
        const m = monthHeaders[mIdx];
        hasPastSales = true;
        lastActiveMonthYear = m.monthYear;
        lastActiveActVal = aVal;
        totalPastAct += aVal;
        pastMonthsCountWithSales++;
        if (m.parsedDate) {
          lastActiveDateObj = m.parsedDate;
        }
      }
    });

    if (hasPastSales) {
      let inactiveMonths = 0;
      if (lastActiveDateObj) {
        inactiveMonths = (currentYear - lastActiveDateObj.year) * 12 + (currentMonth - lastActiveDateObj.month);
      } else {
        inactiveMonths = 2;
      }

      if (inactiveMonths >= 2) {
        const avgPastAct = pastMonthsCountWithSales > 0 ? (totalPastAct / pastMonthsCountWithSales) : 0;
        inactiveList.push({
          projectName: entry.projectName,
          projectCode: entry.projectCode,
          productGroup: entry.productGroup,
          lastMonthYear: lastActiveMonthYear,
          lastActiveDateObj: lastActiveDateObj,
          lastActVal: lastActiveActVal,
          avgPastAct: avgPastAct,
          inactiveMonths: inactiveMonths,
          totalPastAct: totalPastAct
        });
      }
    }
  });

  const banner = document.getElementById('missingPriceBanner');
  const missingList = document.getElementById('missingList');
  if (missingPriceProducts.size > 0 && displayMode === 'baht') {
    document.getElementById('missingCount').textContent = missingPriceProducts.size;
    missingList.innerHTML = Array.from(missingPriceProducts).map(item => `
      <span class="bg-amber-100 text-amber-900 border border-amber-300 text-[11px] font-medium px-2 py-0.5 rounded-md">
        ${escapeHtml(item)}
      </span>
    `).join('');
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  populateMasterProjectSelect();
  initForecastControls();
  initDealerComparisonControls();
  updateUIUnitLabels();
  applyMasterProjectFilter();
}

function handlePriceFile(file) {
  if (!file) return;
  readFileWithEncodingDetection(file, function(csvText) {
    Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      complete: function(results) {
        processPriceCSV(results.data);
        dbSave('cached_files', { fileType: 'price_data', data: results.data });
        alert('อัปเดตตารางราคาต่อหน่วยเรียบร้อยแล้ว');
        if (salesRawRows) {
          processSalesCSV(salesRawRows);
        }
      }
    });
  });
}

function processPriceCSV(rows) {
  if (!rows || rows.length < 2) return;
  const header = rows[0].map(c => String(c || '').trim().toLowerCase());
  let prodCol = header.findIndex(h => h.includes('สินค้า') || h.includes('product') || h.includes('item'));
  let priceCol = header.findIndex(h => h.includes('ราคา/หน่วย') || h.includes('price') || h.includes('ราคา'));
  if (prodCol === -1) prodCol = 0;
  if (priceCol === -1) priceCol = header.length - 1;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const prod = (row[prodCol] || '').trim();
    const price = parseNum(row[priceCol]);
    if (prod && price > 0) {
      unitPrices[prod] = price;
    }
  }
}

// Master Project Filter: All-in-One Link
function populateMasterProjectSelect() {
  const masterSelect = document.getElementById('masterProjectSelect');
  const modalSiteSelect = document.getElementById('modalSiteProjectSelect');
  if (!masterSelect) return;

  let optionsHtml = '<option value="all">เลือกโครงการทั้งหมด</option>';
  allProjectListGlobal.forEach(p => {
    optionsHtml += `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)} (${escapeHtml(p.id || '-')})</option>`;
  });

  masterSelect.innerHTML = optionsHtml;
  masterSelect.value = selectedMasterProject;

  if (modalSiteSelect) {
    let modalOptions = '<option value="auto">🤖 ให้อ่านและระบุอัตโนมัติจากภาพ</option>';
    allProjectListGlobal.forEach(p => {
      modalOptions += `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)} (${escapeHtml(p.id || '-')})</option>`;
    });
    modalSiteSelect.innerHTML = modalOptions;
  }
}

function applyMasterProjectFilter() {
  updateKpiSummary();
  if (typeof renderWeeklySiteVisitDashboard === 'function') {
    renderWeeklySiteVisitDashboard();
  }
  renderDealerTable();
  updateDealerComparisonCharts();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
  renderInactiveTable();
  renderProjectTable();
}

/**
 * คำนวณสรุป KPI Dashboard โดยคำนวณยอดขายจริงรวม (Total Act) จากไฟล์ Dealer CSV (matchedDealerList)
 */
function updateKpiSummary() {
  let filteredRopp = 0;
  let filteredAct = 0;
  let filteredInactiveCount = 0;
  let filteredInactiveRev = 0;
  let filteredCrossSell = 0;

  const proj = selectedMasterProject !== 'all' ? projectsMapGlobal[selectedMasterProject] : null;

  if (selectedMasterProject === 'all') {
    projectList.forEach(p => {
      filteredRopp += p.totalRopp;
      if (p.boughtProducts.length > 1) filteredCrossSell++;
    });
    filteredInactiveCount = inactiveList.length;
    filteredInactiveRev = inactiveList.reduce((acc, curr) => acc + curr.totalPastAct, 0);

    // คำนวณยอดขายจริงรวมจากไฟล์ Dealer (matchedDealerList) ทั้งหมด
    matchedDealerList.forEach(item => {
      filteredAct += (displayMode === 'baht' ? item.netAmount : item.actual);
    });
  } else {
    if (proj) {
      filteredRopp = proj.totalRopp;
      if (Object.keys(proj.productsAct).length > 1) filteredCrossSell = 1;
    }
    const projInactive = inactiveList.filter(it => 
      it.projectCode === selectedMasterProject || 
      it.projectName === selectedMasterProject ||
      (proj && (it.projectCode === proj.id || it.projectName === proj.name))
    );
    filteredInactiveCount = projInactive.length;
    filteredInactiveRev = projInactive.reduce((acc, curr) => acc + curr.totalPastAct, 0);

    // คำนวณยอดขายจริงเฉพาะโครงการที่เลือกจากไฟล์ Dealer (matchedDealerList)
    matchedDealerList.forEach(item => {
      const isMatch = item.projectId === selectedMasterProject || 
                      item.projectName === selectedMasterProject ||
                      (proj && (item.projectId === proj.id || item.projectName === proj.name));
      if (isMatch) {
        filteredAct += (displayMode === 'baht' ? item.netAmount : item.actual);
      }
    });
  }

  document.getElementById('kpiTotalRopp').textContent = formatNumber(filteredRopp);
  document.getElementById('kpiTotalAct').textContent = formatNumber(filteredAct);
  const rate = filteredRopp > 0 ? ((filteredAct / filteredRopp) * 100).toFixed(1) : 0;
  document.getElementById('kpiRealizeRate').textContent = `${rate}%`;

  document.getElementById('kpiCrossSellCount').textContent = filteredCrossSell;
  document.getElementById('kpiInactiveCount').textContent = `${filteredInactiveCount} รายการ`;
  document.getElementById('kpiInactiveRevenue').textContent = `ในอดีต: ${formatNumber(filteredInactiveRev)} ${getUnitSuffix()}`;
}

// Inactive & Project Analysis Tables
function renderProjectTable() {
  const tbody = document.getElementById('projectTableBody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('projectSearchInput')?.value || '').toLowerCase();

  let list = projectList.filter(p => {
    if (selectedMasterProject !== 'all') {
      const matchProj = p.id === selectedMasterProject || p.name === selectedMasterProject || p.key === selectedMasterProject;
      if (!matchProj) return false;
    }
    return (p.name || '').toLowerCase().includes(searchTerm) || (p.id || '').toLowerCase().includes(searchTerm);
  });

  let sortKey = currentSort.column;
  if (sortKey === 'ropp') sortKey = 'totalRopp';
  if (sortKey === 'act') sortKey = 'totalAct';
  if (sortKey === 'rate') sortKey = 'rate';
  if (sortKey === 'name') sortKey = 'name';

  list.sort((a, b) => {
    let valA = a[sortKey] !== undefined ? a[sortKey] : 0;
    let valB = b[sortKey] !== undefined ? b[sortKey] : 0;

    if (sortKey === 'name') {
      valA = (a.name || '').toString();
      valB = (b.name || '').toString();
      return currentSort.order === 'asc'
        ? valA.localeCompare(valB, 'th')
        : valB.localeCompare(valA, 'th');
    }

    valA = Number(valA) || 0;
    valB = Number(valB) || 0;
    return currentSort.order === 'asc' ? (valA - valB) : (valB - valA);
  });

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">ไม่พบข้อมูลโครงการตามเงื่อนไขที่เลือก</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(p => {
    const projectKey = p.id || p.name;
    const jsKey = escapeJsString(projectKey);
    return `
      <tr class="hover:bg-slate-50 transition-colors bg-white">
        <td class="py-3 px-4">
          <button onclick="openProjectModal('${jsKey}')" class="text-left group focus:outline-none">
            <div class="font-semibold text-indigo-600 group-hover:text-indigo-800 group-hover:underline flex items-center gap-1">
              <span>${escapeHtml(p.name)}</span>
              <svg class="w-3.5 h-3.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(p.id || '-')} (คลิกเพื่อดูสินค้า)</div>
          </button>
        </td>
        <td class="py-3 px-4">
          <div class="flex flex-wrap gap-1 max-w-xs">
            ${p.boughtProducts.length > 0
              ? p.boughtProducts.map(b => `<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-[11px] font-medium border border-emerald-100">${escapeHtml(b)}</span>`).join('')
              : '<span class="text-slate-300">-</span>'}
          </div>
        </td>
        <td class="py-3 px-4">
          <div class="flex flex-wrap gap-1 max-w-sm">
            ${p.topOppProducts.length > 0
              ? p.topOppProducts.map(o => `<span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-[11px] font-medium border border-blue-100">${escapeHtml(o)}</span>`).join('')
              : '<span class="text-slate-300">-</span>'}
          </div>
        </td>
        <td class="py-3 px-4 text-right font-medium text-slate-700">${formatNumber(p.totalRopp)}</td>
        <td class="py-3 px-4 text-right font-bold text-emerald-600">${formatNumber(p.totalAct)}</td>
        <td class="py-3 px-4 text-right">
          <span class="inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${p.rate >= 50 ? 'bg-emerald-100 text-emerald-800' : p.rate > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">
            ${p.rate.toFixed(1)}%
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

function sortTable(column) {
  if (currentSort.column === column) {
    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort.column = column;
    currentSort.order = 'desc';
  }

  ['name', 'ropp', 'act', 'rate'].forEach(col => {
    const el = document.getElementById('sort-' + col);
    if (el) el.textContent = '⇅';
  });

  const activeEl = document.getElementById('sort-' + column);
  if (activeEl) activeEl.textContent = currentSort.order === 'asc' ? '▲' : '▼';

  renderProjectTable();
}

function renderInactiveTable() {
  const tbody = document.getElementById('inactiveTableBody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('inactiveSearchInput')?.value || '').toLowerCase();
  const filterMonth = document.getElementById('inactiveMonthFilter')?.value || 'all';

  let filtered = inactiveList.filter(item => {
    if (selectedMasterProject !== 'all') {
      const matchProj = item.projectCode === selectedMasterProject || item.projectName === selectedMasterProject;
      if (!matchProj) return false;
    }
    const matchSearch = item.projectName.toLowerCase().includes(searchTerm) ||
                        item.projectCode.toLowerCase().includes(searchTerm) ||
                        item.productGroup.toLowerCase().includes(searchTerm);
    if (!matchSearch) return false;
    if (filterMonth === '2') return item.inactiveMonths === 2;
    if (filterMonth === '3+') return item.inactiveMonths >= 3;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">ไม่พบโครงการที่ยอดขายหายไปเกิน 2 เดือน</td></tr>`;
    return;
  }

  const sortCol = currentInactiveSort.column;
  const isAsc = currentInactiveSort.order === 'asc';

  filtered.sort((a, b) => {
    let valA = a[sortCol];
    let valB = b[sortCol];

    if (sortCol === 'projectName' || sortCol === 'productGroup') {
      return isAsc
        ? String(valA || '').localeCompare(String(valB || ''), 'th')
        : String(valB || '').localeCompare(String(valA || ''), 'th');
    }
    if (sortCol === 'lastMonthYear') {
      let timeA = a.lastActiveDateObj ? a.lastActiveDateObj.dateObj.getTime() : 0;
      let timeB = b.lastActiveDateObj ? b.lastActiveDateObj.dateObj.getTime() : 0;
      return isAsc ? timeA - timeB : timeB - timeA;
    }
    return isAsc ? ((valA || 0) - (valB || 0)) : ((valB || 0) - (valA || 0));
  });

  tbody.innerHTML = filtered.map(item => {
    const isCritical = item.inactiveMonths >= 3;
    const badgeColor = isCritical
      ? 'bg-rose-100 text-rose-700 border-rose-200'
      : 'bg-amber-100 text-amber-700 border-amber-200';
    const badgeText = isCritical ? 'วิกฤต (3 ด.+)' : 'เฝ้าระวัง (2 ด.)';

    return `
      <tr class="hover:bg-rose-50/50 transition-colors bg-white">
        <td class="py-3 px-4">
          <div class="font-medium text-slate-900">${escapeHtml(item.projectName)}</div>
          <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(item.projectCode || '-')}</div>
        </td>
        <td class="py-3 px-4 font-medium text-slate-700">${escapeHtml(item.productGroup)}</td>
        <td class="py-3 px-4 text-center font-medium text-slate-800 bg-rose-50/60 rounded">${escapeHtml(item.lastMonthYear)}</td>
        <td class="py-3 px-4 text-right font-medium text-slate-800">${formatNumber(item.lastActVal)}</td>
        <td class="py-3 px-4 text-right text-slate-600">${formatNumber(item.avgPastAct)}</td>
        <td class="py-3 px-4 text-center font-bold text-rose-600">${item.inactiveMonths} เดือน</td>
        <td class="py-3 px-4 text-center">
          <span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeColor}">
            ${badgeText}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

function sortInactive(column) {
  if (currentInactiveSort.column === column) {
    currentInactiveSort.order = currentInactiveSort.order === 'asc' ? 'desc' : 'asc';
  } else {
    currentInactiveSort.column = column;
    currentInactiveSort.order = 'desc';
  }

  ['projectName', 'productGroup', 'lastMonthYear', 'lastActVal', 'avgPastAct', 'inactiveMonths'].forEach(col => {
    const el = document.getElementById('sort-inactive-' + col);
    if (el) el.textContent = '⇅';
  });

  const activeEl = document.getElementById('sort-inactive-' + column);
  if (activeEl) activeEl.textContent = currentInactiveSort.order === 'asc' ? '▲' : '▼';

  renderInactiveTable();
}

function openCrossSellModal() {
  renderCrossSellTable();
  const modal = document.getElementById('crossSellModal');
  if (modal) modal.classList.remove('hidden');
}

function closeCrossSellModal() {
  const modal = document.getElementById('crossSellModal');
  if (modal) modal.classList.add('hidden');
}

function renderCrossSellTable() {
  const tbody = document.getElementById('crossSellTableBody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('crossSellSearchInput')?.value || '').toLowerCase().trim();
  const unitSuffix = getUnitSuffix();

  let list = crossSellProjectsList.filter(p => {
    if (selectedMasterProject !== 'all') {
      const matchProj = p.id === selectedMasterProject || p.name === selectedMasterProject || p.key === selectedMasterProject;
      if (!matchProj) return false;
    }
    const matchName = (p.name || '').toLowerCase().includes(searchTerm) || (p.id || '').toLowerCase().includes(searchTerm);
    const matchProduct = p.boughtProducts.some(b => b.toLowerCase().includes(searchTerm));
    return matchName || matchProduct;
  });

  const elCount = document.getElementById('crossSellModalCount');
  if (elCount) elCount.textContent = `${list.length} จาก ${crossSellProjectsList.length} โครงการ`;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">ไม่พบโครงการที่มียอดซื้อจริงมากกว่า 1 กลุ่มสินค้าตามเงื่อนไข</td></tr>`;
    return;
  }

  list.sort((a, b) => b.boughtProducts.length - a.boughtProducts.length || b.totalAct - a.totalAct);

  tbody.innerHTML = list.map(p => {
    const projectKey = p.id || p.name;
    const jsKey = escapeJsString(projectKey);
    return `
      <tr class="hover:bg-amber-50/40 transition-colors">
        <td class="py-3 px-4">
          <button onclick="closeCrossSellModal(); openProjectModal('${jsKey}')" class="text-left group focus:outline-none">
            <div class="font-semibold text-indigo-600 group-hover:text-indigo-800 group-hover:underline flex items-center gap-1">
              <span>${escapeHtml(p.name)}</span>
              <svg class="w-3.5 h-3.5 text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(p.id || '-')}</div>
          </button>
        </td>
        <td class="py-3 px-3 text-center">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
            ${p.boughtProducts.length} สินค้า
          </span>
        </td>
        <td class="py-3 px-4">
          <div class="flex flex-wrap gap-1">
            ${p.boughtProducts.map(b => {
              const val = p.productsAct[b] || 0;
              return `<span class="bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded text-[11px] font-medium" title="${formatNumber(val)} ${unitSuffix}">
                ${escapeHtml(b)} <span class="font-bold text-emerald-600">(${formatNumber(val)})</span>
              </span>`;
            }).join('')}
          </div>
        </td>
        <td class="py-3 px-4 text-right font-bold text-emerald-600 whitespace-nowrap">
          ${formatNumber(p.totalAct)} ${unitSuffix}
        </td>
      </tr>
    `;
  }).join('');
}

function openProjectModal(projectKey) {
  currentModalProjectKey = projectKey;
  const p = projectsMapGlobal[projectKey];
  if (!p) return;

  const unitSuffix = getUnitSuffix();
  document.getElementById('modalProjectId').textContent = p.id || 'ไม่มีรหัส';
  document.getElementById('modalProjectName').textContent = p.name;
  document.getElementById('modalTotalRopp').textContent = `${formatNumber(p.totalRopp)} ${unitSuffix}`;
  document.getElementById('modalTotalAct').textContent = `${formatNumber(p.totalAct)} ${unitSuffix}`;

  const rate = p.totalRopp > 0 ? ((p.totalAct / p.totalRopp) * 100).toFixed(1) : 0;
  document.getElementById('modalRealizeRate').textContent = `${rate}%`;

  const tbody = document.getElementById('modalProductTableBody');
  const details = Object.values(p.productDetails || {});
  details.sort((a, b) => b.actBaht - a.actBaht || b.roppBaht - a.roppBaht);

  if (details.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-400">ไม่พบรายการสินค้า</td></tr>`;
  } else {
    tbody.innerHTML = details.map(item => {
      let statusBadge = '';
      if (item.actBaht > 0 && item.roppBaht > 0) {
        statusBadge = '<span class="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200 font-semibold text-[10px]">ซื้อแล้ว + มี Opp เพิ่ม</span>';
      } else if (item.actBaht > 0) {
        statusBadge = '<span class="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200 font-semibold text-[10px]">ซื้อแล้ว</span>';
      } else if (item.roppBaht > 0) {
        statusBadge = '<span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-200 font-semibold text-[10px]">เป้าหมาย Cross-sell</span>';
      } else {
        statusBadge = '<span class="text-slate-400 text-[10px]">-</span>';
      }

      return `
        <tr class="hover:bg-slate-50 transition-colors">
          <td class="py-3 px-4 font-medium text-slate-800">${escapeHtml(item.productGroup)}</td>
          <td class="py-3 px-3 text-right text-slate-600">${formatNumber(item.unitPrice)}</td>
          <td class="py-3 px-3 text-right text-blue-600 font-mono">${formatNumber(item.roppUnit)}</td>
          <td class="py-3 px-3 text-right text-emerald-600 font-mono font-medium">${formatNumber(item.actUnit)}</td>
          <td class="py-3 px-4 text-right font-medium text-blue-700">${formatNumber(item.roppBaht)}</td>
          <td class="py-3 px-4 text-right font-bold text-emerald-600">${formatNumber(item.actBaht)}</td>
          <td class="py-3 px-4 text-center">${statusBadge}</td>
        </tr>
      `;
    }).join('');
  }

  document.getElementById('projectModal').classList.remove('hidden');
}

function closeModal() {
  const modal = document.getElementById('projectModal');
  if (modal) modal.classList.add('hidden');
  currentModalProjectKey = null;
}

function exportInactiveToExcel() {
  if (!inactiveList || inactiveList.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }
  const unitSuffix = getUnitSuffix();
  const filtered = inactiveList.filter(item => {
    if (selectedMasterProject !== 'all') {
      return item.projectCode === selectedMasterProject || item.projectName === selectedMasterProject;
    }
    return true;
  });

  const data = filtered.map(item => ({
    "รหัสโครงการ": item.projectCode || '-',
    "ชื่อโครงการ": item.projectName,
    "กลุ่มสินค้า (Col E)": item.productGroup,
    "เดือน/ปี ที่ซื้อล่าสุด": item.lastMonthYear,
    [`ยอดซื้อเดือนล่าสุด (${unitSuffix})`]: item.lastActVal,
    [`ยอดซื้อเฉลี่ยในอดีต (${unitSuffix}/ด.)`]: item.avgPastAct,
    "ขาดการซื้อไป (เดือน)": item.inactiveMonths,
    "ระดับความเสี่ยง": item.inactiveMonths >= 3 ? 'วิกฤต (3 ด.+)' : 'เฝ้าระวัง (2 ด.)'
  }));
  downloadExcel(data, `Inactive_Sales_Monitor_${displayMode}`, 'Inactive_Actual');
}

function exportProjectsToExcel() {
  if (!projectList || projectList.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }
  const unitSuffix = getUnitSuffix();
  const filtered = projectList.filter(p => {
    if (selectedMasterProject !== 'all') {
      return p.id === selectedMasterProject || p.name === selectedMasterProject || p.key === selectedMasterProject;
    }
    return true;
  });

  const data = filtered.map(p => ({
    "รหัสโครงการ": p.id || '-',
    "ชื่อโครงการ": p.name,
    "สินค้าที่เกิด Actual แล้ว": p.boughtProducts.join(', '),
    "สินค้า Top Opp (3 อันดับ)": p.topOppProducts.join(', '),
    [`ยอดโอกาสรวม (${unitSuffix})`]: p.totalRopp,
    [`ยอดขายจริงรวม (${unitSuffix})`]: p.totalAct,
    "อัตราความสำเร็จ (%)": parseFloat(p.rate.toFixed(2))
  }));
  downloadExcel(data, `Cross_Sell_Project_Analysis_${displayMode}`, 'Projects');
}

function exportCrossSellToExcel() {
  if (!crossSellProjectsList || crossSellProjectsList.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }
  const unitSuffix = getUnitSuffix();
  const filtered = crossSellProjectsList.filter(p => {
    if (selectedMasterProject !== 'all') {
      return p.id === selectedMasterProject || p.name === selectedMasterProject || p.key === selectedMasterProject;
    }
    return true;
  });

  const data = filtered.map(p => ({
    "รหัสโครงการ": p.id || '-',
    "ชื่อโครงการ": p.name,
    "จำนวนสินค้าที่ซื้อจริง": p.boughtProducts.length,
    "รายการสินค้าที่ซื้อจริง (Actual)": p.boughtProducts.map(b => `${b} (${formatNumber(p.productsAct[b] || 0)})`).join(', '),
    [`ยอดขายจริงรวม (${unitSuffix})`]: p.totalAct,
    [`ยอดโอกาสรวม (${unitSuffix})`]: p.totalRopp
  }));
  downloadExcel(data, `Cross_Sell_Projects_${displayMode}`, 'CrossSell_Projects');
}

function exportModalProductsToExcel() {
  if (!currentModalProjectKey || !projectsMapGlobal[currentModalProjectKey]) {
    alert('ไม่พบข้อมูลโครงการ');
    return;
  }
  const p = projectsMapGlobal[currentModalProjectKey];
  const details = Object.values(p.productDetails || {});
  const data = details.map(item => ({
    "รหัสโครงการ": p.id || '-',
    "ชื่อโครงการ": p.name,
    "กลุ่มสินค้า (Col E)": item.productGroup,
    "ราคาต่อหน่วย (บาท)": item.unitPrice,
    "ปริมาณ Opp (Unit)": item.roppUnit,
    "ปริมาณ Act (Unit)": item.actUnit,
    "มูลค่า Ropp (บาท)": item.roppBaht,
    "มูลค่า Act (บาท)": item.actBaht,
    "สถานะ": (item.actBaht > 0 && item.roppBaht > 0) ? 'ซื้อแล้ว + มี Opp เพิ่ม' : (item.actBaht > 0 ? 'ซื้อแล้ว' : (item.roppBaht > 0 ? 'เป้าหมาย Cross-sell' : '-'))
  }));
  downloadExcel(data, `Project_Products_${p.id || 'Details'}`, 'Product_Details');
}

// ==========================================
// Multi-Select Month Filter สำหรับรายงาน Weekly Site Visit
// ==========================================
let selectedWeeklyFilterMonths = new Set(); // เก็บ key รูปแบบ 'YYYY-MM'
let allWeeklyAvailableMonths = []; // [{ key: '2026-11', label: 'พ.ย. 2026', sortVal: 202611 }]
let weeklyMonthFilterInitialized = false;
let allWeeklyModalVisitsPool = []; // เก็บรายการรายงานหน้างานทั้งหมดไว้กรองตามเดือนภายใน Modal

function getVisitMonthInfo(visit) {
  const thaiMonthsShort = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  if (!visit) return null;

  const rawDateStr = String(visit.visitDate || '').trim();
  if (rawDateStr && rawDateStr !== '-') {
    // 1. รูปแบบ DD/MM/YYYY หรือ D/M/YY (เช่น 06/11/2026 หรือ 6/11/69)
    const dmyMatch = rawDateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (dmyMatch) {
      const mNum = parseInt(dmyMatch[2], 10);
      let yNum = parseInt(dmyMatch[3], 10);
      if (mNum >= 1 && mNum <= 12) {
        yNum = normalizeYear(yNum, false);
        const key = `${yNum}-${String(mNum).padStart(2, '0')}`;
        return {
          key,
          label: `${thaiMonthsShort[mNum - 1]} ${yNum}`,
          sortVal: yNum * 100 + mNum
        };
      }
    }

    // 2. รูปแบบ YYYY-MM-DD หรือ YYYY/MM/DD
    const ymdMatch = rawDateStr.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (ymdMatch) {
      let yNum = normalizeYear(parseInt(ymdMatch[1], 10), false);
      const mNum = parseInt(ymdMatch[2], 10);
      if (mNum >= 1 && mNum <= 12) {
        const key = `${yNum}-${String(mNum).padStart(2, '0')}`;
        return {
          key,
          label: `${thaiMonthsShort[mNum - 1]} ${yNum}`,
          sortVal: yNum * 100 + mNum
        };
      }
    }

    // 3. รูปแบบเดือนย่อไทย/อังกฤษ เช่น พ.ย. 2026, Nov 26
    const parsed = parseMonthYearDate(rawDateStr);
    if (parsed && !isNaN(parsed.year) && !isNaN(parsed.month)) {
      const mNum = parsed.month + 1;
      const key = `${parsed.year}-${String(mNum).padStart(2, '0')}`;
      return {
        key,
        label: `${thaiMonthsShort[parsed.month]} ${parsed.year}`,
        sortVal: parsed.year * 100 + mNum
      };
    }
  }

  // 4. สำรองจากวันที่สร้างรายการ (createdAt)
  if (visit.createdAt) {
    const dt = new Date(visit.createdAt);
    if (!isNaN(dt.getTime())) {
      const yNum = dt.getFullYear();
      const mNum = dt.getMonth() + 1;
      const key = `${yNum}-${String(mNum).padStart(2, '0')}`;
      return {
        key,
        label: `${thaiMonthsShort[mNum - 1]} ${yNum}`,
        sortVal: yNum * 100 + mNum
      };
    }
  }

  return { key: 'unknown', label: 'ไม่ระบุเดือน', sortVal: 0 };
}

function ensureWeeklyMonthFilterUI() {
  if (document.getElementById('weeklySectionMonthDropdownBtn')) return;

  const section = document.getElementById('weeklySiteVisitSection');
  if (!section) return;

  const headerBar = section.firstElementChild;
  if (!headerBar) return;
  const actionsWrap = headerBar.lastElementChild;
  if (!actionsWrap) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.innerHTML = `
    <button id="weeklySectionMonthDropdownBtn" type="button"
            class="inline-flex items-center gap-1.5 bg-white hover:bg-sky-50 text-sky-900 border border-sky-300 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-all">
      <span>📅</span>
      <span id="weeklySectionMonthDropdownLabel">เลือกเดือนทั้งหมด</span>
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
      </svg>
    </button>
    <div id="weeklySectionMonthDropdownMenu" class="hidden absolute left-0 sm:right-0 sm:left-auto mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-2">
      <div class="flex justify-between items-center pb-2 border-b border-slate-100">
        <span class="text-xs font-bold text-slate-700">กรองเดือนรายงาน Weekly</span>
        <div class="flex gap-2">
          <button type="button" onclick="selectAllWeeklyMonths(true)" class="text-[11px] text-sky-600 hover:underline font-medium">เลือกทั้งหมด</button>
          <span class="text-slate-300">|</span>
          <button type="button" onclick="selectAllWeeklyMonths(false)" class="text-[11px] text-slate-500 hover:underline">ล้างค่า</button>
        </div>
      </div>
      <div id="weeklySectionMonthCheckboxList" class="max-h-52 overflow-y-auto custom-scrollbar space-y-1.5 text-xs text-slate-700"></div>
    </div>
  `;
  actionsWrap.insertBefore(wrapper, actionsWrap.firstChild);
}

function toggleWeeklyMonthDropdown(e, targetMenuId = 'weeklySectionMonthDropdownMenu') {
  if (e) e.stopPropagation();
  const sectionMenu = document.getElementById('weeklySectionMonthDropdownMenu');
  const modalMenu = document.getElementById('weeklyModalMonthDropdownMenu');
  const targetMenu = document.getElementById(targetMenuId);

  if (sectionMenu && sectionMenu !== targetMenu) sectionMenu.classList.add('hidden');
  if (modalMenu && modalMenu !== targetMenu) modalMenu.classList.add('hidden');
  if (targetMenu) targetMenu.classList.toggle('hidden');
}

function refreshWeeklyAvailableMonths(visitsList) {
  ensureWeeklyMonthFilterUI();
  const list = Array.isArray(visitsList) ? visitsList : (Array.isArray(siteVisitLogsGlobal) ? siteVisitLogsGlobal : []);
  const monthMap = new Map();

  list.forEach(v => {
    const info = getVisitMonthInfo(v);
    if (info && !monthMap.has(info.key)) {
      monthMap.set(info.key, info);
    }
  });

  const prevKeys = new Set(allWeeklyAvailableMonths.map(m => m.key));
  allWeeklyAvailableMonths = Array.from(monthMap.values()).sort((a, b) => b.sortVal - a.sortVal);

  if (!weeklyMonthFilterInitialized) {
    selectedWeeklyFilterMonths = new Set(allWeeklyAvailableMonths.map(m => m.key));
    weeklyMonthFilterInitialized = true;
  } else {
    const wasAllSelected = prevKeys.size > 0 && selectedWeeklyFilterMonths.size === prevKeys.size;
    allWeeklyAvailableMonths.forEach(m => {
      if (!prevKeys.has(m.key) && wasAllSelected) {
        selectedWeeklyFilterMonths.add(m.key);
      }
    });
    const validNow = new Set(allWeeklyAvailableMonths.map(m => m.key));
    Array.from(selectedWeeklyFilterMonths).forEach(k => {
      if (!validNow.has(k)) selectedWeeklyFilterMonths.delete(k);
    });
  }

  renderWeeklyMonthCheckboxes();
}

function renderWeeklyMonthCheckboxes() {
  const checkboxLists = [
    document.getElementById('weeklySectionMonthCheckboxList'),
    document.getElementById('weeklyModalMonthCheckboxList')
  ].filter(Boolean);

  const labelEls = [
    document.getElementById('weeklySectionMonthDropdownLabel'),
    document.getElementById('weeklyModalMonthDropdownLabel')
  ].filter(Boolean);

  checkboxLists.forEach(listEl => {
    if (allWeeklyAvailableMonths.length === 0) {
      listEl.innerHTML = `<div class="text-slate-400 text-center py-2">ยังไม่มีข้อมูลเดือน</div>`;
    } else {
      listEl.innerHTML = allWeeklyAvailableMonths.map(m => {
        const isChecked = selectedWeeklyFilterMonths.has(m.key);
        const jsKey = escapeJsString(m.key);
        return `
          <label class="flex items-center gap-2 hover:bg-sky-50 p-1.5 rounded cursor-pointer transition-colors">
            <input type="checkbox" value="${escapeHtml(m.key)}" ${isChecked ? 'checked' : ''}
                   onchange="toggleWeeklyFilterMonth('${jsKey}')"
                   class="rounded text-sky-600 focus:ring-sky-500 w-3.5 h-3.5">
            <span class="flex-1 font-medium text-slate-700">${escapeHtml(m.label)}</span>
          </label>
        `;
      }).join('');
    }
  });

  const total = allWeeklyAvailableMonths.length;
  const count = selectedWeeklyFilterMonths.size;
  let labelText = 'เลือกเดือนทั้งหมด';
  if (total === 0 || count === total) {
    labelText = 'เลือกเดือนทั้งหมด';
  } else if (count === 0) {
    labelText = 'ไม่ได้เลือกเดือน (0)';
  } else if (count === 1) {
    const onlyKey = Array.from(selectedWeeklyFilterMonths)[0];
    const found = allWeeklyAvailableMonths.find(m => m.key === onlyKey);
    labelText = found ? found.label : 'เลือก 1 เดือน';
  } else {
    labelText = `เลือก ${count} เดือน`;
  }

  labelEls.forEach(labelEl => {
    labelEl.textContent = labelText;
  });
}

function refreshWeeklyModalCandidatesKeepSearch() {
  const proj = selectedMasterProject !== 'all' ? projectsMapGlobal[selectedMasterProject] : null;
  const filtered = filterSiteVisitsBySelectedMonths(allWeeklyModalVisitsPool).filter(v => {
    if (selectedMasterProject === 'all') return true;
    return v.projectId === selectedMasterProject ||
           v.projectName === selectedMasterProject ||
           (proj && (v.projectId === proj.id || v.projectName === proj.name));
  });

  filtered.sort((a, b) => {
    const tA = a.createdAt ? new Date(a.createdAt).getTime() : (Number(a.id) || 0);
    const tB = b.createdAt ? new Date(b.createdAt).getTime() : (Number(b.id) || 0);
    return tB - tA;
  });

  weeklyExportCandidatesCache = filtered;
  weeklyExportSelectedIds = new Set(filtered.map((v, idx) => String(v.id !== undefined ? v.id : idx)));
  hideWeeklyAiSummaryPreview();
  renderWeeklyExportItemsList();
}

function toggleWeeklyFilterMonth(monthKey) {
  if (selectedWeeklyFilterMonths.has(monthKey)) {
    selectedWeeklyFilterMonths.delete(monthKey);
  } else {
    selectedWeeklyFilterMonths.add(monthKey);
  }
  renderWeeklyMonthCheckboxes();

  if (typeof window.__origRenderWeeklySiteVisitDashboard === 'function') {
    window.renderWeeklySiteVisitDashboard();
  }
  const exportModal = document.getElementById('weeklySelectExportModal');
  if (exportModal && !exportModal.classList.contains('hidden')) {
    refreshWeeklyModalCandidatesKeepSearch();
  }
}

function selectAllWeeklyMonths(shouldSelectAll) {
  if (shouldSelectAll) {
    selectedWeeklyFilterMonths = new Set(allWeeklyAvailableMonths.map(m => m.key));
  } else {
    selectedWeeklyFilterMonths.clear();
  }
  renderWeeklyMonthCheckboxes();

  if (typeof window.__origRenderWeeklySiteVisitDashboard === 'function') {
    window.renderWeeklySiteVisitDashboard();
  }
  const exportModal = document.getElementById('weeklySelectExportModal');
  if (exportModal && !exportModal.classList.contains('hidden')) {
    refreshWeeklyModalCandidatesKeepSearch();
  }
}

const selectAllWeeklyFilterMonths = selectAllWeeklyMonths;

function filterSiteVisitsBySelectedMonths(visitsList) {
  const list = Array.isArray(visitsList) ? visitsList : [];
  if (!weeklyMonthFilterInitialized || allWeeklyAvailableMonths.length === 0) {
    return list;
  }
  return list.filter(v => {
    const info = getVisitMonthInfo(v);
    return info ? selectedWeeklyFilterMonths.has(info.key) : false;
  });
}

function installWeeklySiteVisitMonthFilterHooks() {
  ensureWeeklyMonthFilterUI();

  if (typeof window.renderWeeklySiteVisitDashboard === 'function' && !window.renderWeeklySiteVisitDashboard.__wrappedWithMonthFilter) {
    const origRender = window.renderWeeklySiteVisitDashboard;
    window.__origRenderWeeklySiteVisitDashboard = origRender;
    const wrappedRender = function(...args) {
      refreshWeeklyAvailableMonths(siteVisitLogsGlobal);
      const backupLogs = siteVisitLogsGlobal;
      try {
        siteVisitLogsGlobal = filterSiteVisitsBySelectedMonths(backupLogs);
        return origRender.apply(this, args);
      } finally {
        siteVisitLogsGlobal = backupLogs;
      }
    };
    wrappedRender.__wrappedWithMonthFilter = true;
    window.renderWeeklySiteVisitDashboard = wrappedRender;
  }

  if (typeof window.copyWeeklySummaryText === 'function' && !window.copyWeeklySummaryText.__wrappedWithMonthFilter) {
    const origCopy = window.copyWeeklySummaryText;
    const wrappedCopy = function(...args) {
      const backupLogs = siteVisitLogsGlobal;
      try {
        siteVisitLogsGlobal = filterSiteVisitsBySelectedMonths(backupLogs);
        return origCopy.apply(this, args);
      } finally {
        siteVisitLogsGlobal = backupLogs;
      }
    };
    wrappedCopy.__wrappedWithMonthFilter = true;
    window.copyWeeklySummaryText = wrappedCopy;
  }

  if (typeof window.exportSiteVisitsToExcel === 'function' && !window.exportSiteVisitsToExcel.__wrappedWithMonthFilter) {
    const origExport = window.exportSiteVisitsToExcel;
    const wrappedExport = function(...args) {
      const backupLogs = siteVisitLogsGlobal;
      try {
        siteVisitLogsGlobal = filterSiteVisitsBySelectedMonths(backupLogs);
        return origExport.apply(this, args);
      } finally {
        siteVisitLogsGlobal = backupLogs;
      }
    };
    wrappedExport.__wrappedWithMonthFilter = true;
    window.exportSiteVisitsToExcel = wrappedExport;
  }
}

// ==========================================
// Ensure Modals Exist in DOM (Fallback Safety)
// ==========================================
function ensureMergeAndBackupModalsExist() {
  if (!document.body) return;

  let mergeModal = document.getElementById('mergeProjectsModal');
  if (!mergeModal) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="mergeProjectsModal" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-100">
          <div class="p-5 border-b border-teal-100 bg-teal-50/80 flex justify-between items-center">
            <div class="flex items-center gap-2">
              <span class="text-xl">🔗</span>
              <div>
                <h3 class="text-base font-bold text-teal-950">รวมข้อมูลโครงการ (เฉพาะ Actual และ Report Site Visit)</h3>
                <p class="text-xs text-teal-700">เลือกโครงการหลัก (Main) และเลือกโครงการรองที่จะนำยอด Actual และรายงานหน้างานมารวม</p>
              </div>
            </div>
            <button onclick="closeMergeProjectsModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-full">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-5 overflow-y-auto space-y-4 custom-scrollbar text-xs">
            <div class="p-3 rounded-xl bg-teal-50/60 border border-teal-200 text-teal-900 text-[11px] leading-relaxed">
              ℹ️ <strong>ขอบเขตการรวมข้อมูล:</strong> ระบบจะย้ายเฉพาะ <strong>ยอดขายจริง (Actual ทั้งจากไฟล์หลักและ Dealer)</strong> และ <strong>รายงาน/รูปภาพหน้างาน (Site Visit)</strong> จากโครงการรองไปรวมไว้ที่โครงการหลัก โดย <strong>ไม่นำยอดโอกาส (Ropp / Forecast)</strong> มารวมด้วย
            </div>
            <div>
              <label class="block font-bold text-slate-700 mb-1">1. เลือกโครงการหลัก (Main Project) ที่ต้องการให้เป็นตัวหลัก:</label>
              <select id="mergeMainProjectSelect" onchange="renderMergeSourceProjectsList()" class="w-full px-3 py-2 border border-teal-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white font-semibold text-teal-900">
                <option value="">-- กรุณาเลือกโครงการหลัก --</option>
              </select>
            </div>
            <div>
              <div class="flex justify-between items-center mb-1">
                <label class="font-bold text-slate-700">2. เลือกโครงการรองที่จะนำมารวม (เลือกได้มากกว่า 1 โครงการ):</label>
                <input type="text" id="mergeSourceSearchInput" oninput="renderMergeSourceProjectsList()" placeholder="ค้นหาโครงการรอง..." class="px-2.5 py-1 border border-slate-200 rounded-md text-[11px] focus:outline-none focus:ring-1 focus:ring-teal-500 w-44">
              </div>
              <div id="mergeSourceProjectsList" class="max-h-44 overflow-y-auto custom-scrollbar border border-slate-200 rounded-xl p-2 space-y-1 bg-slate-50/50">
                <div class="text-slate-400 text-center py-4">กรุณาอัปโหลดไฟล์ยอดขายและเลือกโครงการหลักก่อน</div>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" onclick="confirmMergeProjects()" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                <span>🔗</span> บันทึกการรวมข้อมูลเข้าโครงการหลัก
              </button>
            </div>
            <div class="border-t border-slate-200 pt-4 space-y-2">
              <div class="flex justify-between items-center">
                <h4 class="font-bold text-slate-700">รายการจับคู่รวมโครงการที่ใช้งานอยู่:</h4>
                <button type="button" onclick="clearAllMergeRules()" class="text-[11px] text-rose-600 hover:underline">ล้างการรวมทั้งหมด</button>
              </div>
              <div id="activeMergeRulesContainer" class="space-y-2 max-h-40 overflow-y-auto custom-scrollbar">
                <div class="text-slate-400 text-center py-3 bg-slate-50 rounded-lg border border-slate-100">ยังไม่มีการตั้งค่าการรวมโครงการ</div>
              </div>
            </div>
          </div>
          <div class="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
            <button onclick="closeMergeProjectsModal()" class="px-5 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors">
              ปิดหน้าต่าง
            </button>
          </div>
        </div>
      </div>
    `;
    mergeModal = wrapper.firstElementChild;
    document.body.appendChild(mergeModal);
  } else if (mergeModal.parentElement !== document.body) {
    document.body.appendChild(mergeModal);
  }

  let backupModal = document.getElementById('backupJsonModal');
  if (!backupModal) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="backupJsonModal" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100">
          <div class="p-5 border-b border-slate-200 bg-slate-100/80 flex justify-between items-center">
            <div class="flex items-center gap-2">
              <span class="text-xl">💾</span>
              <h3 class="text-base font-bold text-slate-900">สำรองข้อมูล (Backup JSON)</h3>
            </div>
            <button onclick="closeBackupJsonModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-full">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-5 space-y-3.5 text-xs">
            <p class="text-slate-600 leading-relaxed">
              เลือกหมวดข้อมูลจาก <strong>IndexedDB</strong> ที่ต้องการส่งออกเป็นไฟล์ <code>.json</code> เพื่อลดขนาดไฟล์และใช้กู้คืนเฉพาะส่วนได้ทันที
            </p>
            <div class="flex justify-between items-center pb-1 border-b border-slate-100">
              <span class="font-bold text-slate-700">เลือกหมวดข้อมูลที่ต้องการ Backup:</span>
              <div class="flex gap-2">
                <button type="button" onclick="toggleAllBackupCategories(true)" class="text-[11px] text-indigo-600 hover:underline font-medium">เลือกทั้งหมด</button>
                <span class="text-slate-300">|</span>
                <button type="button" onclick="toggleAllBackupCategories(false)" class="text-[11px] text-slate-500 hover:underline">ล้างการเลือก</button>
              </div>
            </div>
            <div id="backupCategoriesContainer" class="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-0.5">
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatSales" class="backup-cat-checkbox rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5">
                  <span class="font-medium text-slate-800">📊 ไฟล์ยอดขายหลัก (Sales CSV)</span>
                </div>
                <span id="backupStatSales" class="text-[11px] font-bold text-slate-400">กำลังตรวจ...</span>
              </label>
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatDealer" class="backup-cat-checkbox rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5">
                  <span class="font-medium text-slate-800">🏬 ไฟล์ผู้แทนจำหน่าย (Dealer CSV)</span>
                </div>
                <span id="backupStatDealer" class="text-[11px] font-bold text-slate-400">กำลังตรวจ...</span>
              </label>
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 hover:bg-slate-100/80 border border-slate-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatPrice" class="backup-cat-checkbox rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5">
                  <span class="font-medium text-slate-800">🏷️ ตารางราคาต่อหน่วย (Price CSV)</span>
                </div>
                <span id="backupStatPrice" class="text-[11px] font-bold text-slate-400">กำลังตรวจ...</span>
              </label>
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-sky-50/60 hover:bg-sky-50 border border-sky-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatSiteVisits" class="backup-cat-checkbox rounded text-sky-600 focus:ring-sky-500 w-3.5 h-3.5">
                  <span class="font-medium text-sky-950">📸 รายงานและรูปภาพ Site Visit</span>
                </div>
                <span id="backupStatSiteVisits" class="text-[11px] font-bold text-sky-700">กำลังตรวจ...</span>
              </label>
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-teal-50/60 hover:bg-teal-50 border border-teal-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatMergeRules" class="backup-cat-checkbox rounded text-teal-600 focus:ring-teal-500 w-3.5 h-3.5">
                  <span class="font-medium text-teal-950">🔗 กฎการรวมข้อมูลโครงการ</span>
                </div>
                <span id="backupStatMergeRules" class="text-[11px] font-bold text-teal-700">กำลังตรวจ...</span>
              </label>
              <label class="flex items-center justify-between p-2.5 rounded-xl bg-purple-50/50 hover:bg-purple-50 border border-purple-200 cursor-pointer transition-colors">
                <div class="flex items-center gap-2.5">
                  <input type="checkbox" id="backupCatApiKey" class="rounded text-purple-600 focus:ring-purple-500 w-3.5 h-3.5">
                  <span class="font-medium text-purple-950">🔑 Gemini API Key</span>
                </div>
                <span id="backupStatApiKey" class="text-[11px] font-bold text-slate-400">กำลังตรวจ...</span>
              </label>
            </div>
          </div>
          <div class="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
            <button onclick="closeBackupJsonModal()" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors">
              ยกเลิก
            </button>
            <button onclick="executeBackupJsonDownload()" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
              <span>💾</span> ดาวน์โหลดไฟล์ Backup (.json)
            </button>
          </div>
        </div>
      </div>
    `;
    backupModal = wrapper.firstElementChild;
    document.body.appendChild(backupModal);
  } else if (backupModal.parentElement !== document.body) {
    document.body.appendChild(backupModal);
  }

  let weeklyExportModal = document.getElementById('weeklySelectExportModal');
  if (!weeklyExportModal) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <div id="weeklySelectExportModal" class="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 hidden flex items-center justify-center p-2 sm:p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-100">
          <div class="p-4 sm:p-5 border-b border-indigo-100 bg-indigo-50/80 flex justify-between items-center shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xl">📋</span>
              <div>
                <h3 class="text-sm sm:text-base font-bold text-indigo-950">Export รายงาน Updated Site Weekly (.xlsx)</h3>
                <p class="text-[11px] sm:text-xs text-indigo-700">สรุปด้วย AI หรือเลือกงานเพิ่มลง "ตารางเตรียม Export" เพื่อรวมทุกโครงการส่งออกเป็นไฟล์ Excel 3 คอลัมน์เดียว</p>
              </div>
            </div>
            <button onclick="closeWeeklySelectExportModal()" class="text-slate-400 hover:text-slate-600 p-1 rounded-full">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="p-4 sm:p-5 overflow-y-auto space-y-4 custom-scrollbar text-xs flex-1">
            <div class="space-y-2.5">
              <div class="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 pb-2 border-b border-slate-100">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-slate-800">1. เลือกงานที่ต้องการ:</span>
                  <input type="text" id="weeklyExportSearchInput" oninput="renderWeeklyExportItemsList()" placeholder="ค้นหาชื่อโครงการ, วันที่ หรือข้อความ..."
                         class="text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white w-full sm:w-52">
                  <div class="relative">
                    <button id="weeklyModalMonthDropdownBtn" type="button" class="inline-flex items-center gap-1.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-200 text-xs font-semibold px-2.5 py-1.5 rounded-lg shadow-sm transition-all">
                      <span>📅</span>
                      <span id="weeklyModalMonthDropdownLabel">เลือกเดือนทั้งหมด</span>
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <div id="weeklyModalMonthDropdownMenu" class="hidden absolute left-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-2">
                      <div class="flex justify-between items-center pb-2 border-b border-slate-100">
                        <span class="text-xs font-bold text-slate-700">เลือกเดือน (1 หรือหลายเดือน)</span>
                        <div class="flex gap-2">
                          <button type="button" onclick="selectAllWeeklyMonths(true)" class="text-[11px] text-sky-600 hover:underline font-medium">เลือกทั้งหมด</button>
                          <span class="text-slate-300">|</span>
                          <button type="button" onclick="selectAllWeeklyMonths(false)" class="text-[11px] text-slate-500 hover:underline">ล้างค่า</button>
                        </div>
                      </div>
                      <div id="weeklyModalMonthCheckboxList" class="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5 text-xs text-slate-700"></div>
                    </div>
                  </div>
                </div>
                <div class="flex items-center justify-between sm:justify-end gap-2">
                  <span id="weeklyExportSelectedCount" class="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">เลือก 0 รายการ</span>
                  <button type="button" onclick="toggleAllWeeklyExportItems(true)" class="text-[11px] text-indigo-600 hover:underline font-semibold">เลือกทั้งหมด</button>
                  <span class="text-slate-300">|</span>
                  <button type="button" onclick="toggleAllWeeklyExportItems(false)" class="text-[11px] text-slate-500 hover:underline">ล้างการเลือก</button>
                </div>
              </div>
              <div id="weeklyExportItemsList" class="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-0.5">
                <div class="text-slate-400 text-center py-6">กำลังโหลดรายการรายงานหน้างาน...</div>
              </div>
              <div class="flex flex-wrap items-center gap-2 pt-1">
                <button id="aiSummarizeWeeklyBtn" type="button" onclick="summarizeSelectedWeeklyWithAI('single')" class="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                  <span>🤖</span> <span>ให้ AI สรุปรวมเป็น 1 แถว</span>
                </button>
                <button id="aiSummarizeByProjectBtn" type="button" onclick="summarizeSelectedWeeklyWithAI('by_project')" class="px-3 py-1.5 bg-fuchsia-600 hover:bg-fuchsia-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                  <span>🏢</span> <span>ให้ AI สรุปแยกตามรายโครงการ</span>
                </button>
                <button type="button" onclick="addSelectedItemsRawToStaging()" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                  <span>➕</span> <span>เพิ่มงานที่เลือกลงตาราง (แยกแถว)</span>
                </button>
              </div>
            </div>
            <div id="weeklyAiSummaryPreviewBox" class="hidden p-4 rounded-xl bg-purple-50/80 border border-purple-200 space-y-3">
              <div class="flex flex-wrap justify-between items-center gap-2">
                <span class="font-bold text-purple-950 flex items-center gap-1.5">
                  <span>✨</span> <span id="weeklyAiPreviewTitle">ผลสรุปจาก AI (gemini-3.5-flash-lite) — แก้ไขข้อความก่อนเพิ่มลงตารางได้</span>
                </span>
                <button type="button" onclick="hideWeeklyAiSummaryPreview()" class="text-[11px] text-slate-500 hover:text-rose-600 hover:underline">ปิดกล่องสรุป AI</button>
              </div>
              <div id="aiWeeklyPreviewRowsContainer" class="space-y-3 max-h-56 overflow-y-auto custom-scrollbar pr-1"></div>
              <div class="flex justify-end pt-1 border-t border-purple-200/70">
                <button type="button" onclick="commitAiPreviewToStaging()" class="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                  <span>✅</span> <span>เพิ่มผลสรุป AI นี้ลงตารางเตรียม Export</span>
                </button>
              </div>
            </div>
            <div id="weeklyStagingSection" class="border border-emerald-200 rounded-xl overflow-hidden bg-emerald-50/30">
              <div class="px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 flex flex-wrap justify-between items-center gap-2">
                <div class="flex items-center gap-2">
                  <span class="font-bold text-emerald-950">2. ตารางเตรียม Export (รวมผลสรุป AI และงานอื่นๆ ในไฟล์เดียว):</span>
                  <span id="weeklyStagingCountBadge" class="bg-emerald-600 text-white text-[11px] font-bold px-2 py-0.5 rounded-full">0 แถว</span>
                </div>
                <button type="button" onclick="clearWeeklyStagingTable()" class="text-[11px] text-rose-600 hover:underline font-semibold">ล้างตารางทั้งหมด</button>
              </div>
              <div class="overflow-x-auto custom-scrollbar max-h-56 bg-white">
                <table class="w-full text-left text-xs border-collapse">
                  <thead class="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th class="py-2 px-3 w-1/4">1. ชื่อโครงการ</th>
                      <th class="py-2 px-3 w-1/3">2. สรุปการทำงานอาทิตย์ที่ผ่านมา</th>
                      <th class="py-2 px-3 w-1/3">3. แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไป</th>
                      <th class="py-2 px-2 text-center w-14">จัดการ</th>
                    </tr>
                  </thead>
                  <tbody id="weeklyStagingTableBody" class="divide-y divide-slate-100">
                    <tr>
                      <td colspan="4" class="py-6 text-center text-slate-400">ยังไม่มีรายการในตารางเตรียม Export — เลือกงานด้านบนแล้วกดปุ่มสรุปด้วย AI หรือเพิ่มงานลงตารางได้เลย</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap justify-between items-center gap-2 shrink-0">
            <span id="weeklyFooterReadyHint" class="text-[11px] text-slate-600 font-medium">
              พร้อมส่งออก Excel 3 คอลัมน์: <strong class="text-emerald-700">0 แถว</strong>
            </span>
            <div class="flex items-center gap-2 ml-auto">
              <button onclick="closeWeeklySelectExportModal()" class="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors">
                ปิดหน้าต่าง
              </button>
              <button id="mainExportWeeklyExcelBtn" type="button" onclick="executeWeeklyStagingExcelExport()" class="px-4 sm:px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors flex items-center gap-1.5">
                <span>📥</span> <span>Export Excel ทั้งหมด (<span id="weeklyFooterExportCount">0</span> แถว)</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
    weeklyExportModal = wrapper.firstElementChild;
    document.body.appendChild(weeklyExportModal);
  } else if (weeklyExportModal.parentElement !== document.body) {
    document.body.appendChild(weeklyExportModal);
  }
}

// ==========================================
// Weekly Site Update Select, AI Summarizer (1 แถว / แยกโครงการ) & Export Staging Table
// ==========================================
let weeklyExportCandidatesCache = [];
let weeklyExportSelectedIds = new Set();
let weeklyAiPreviewDraftRows = []; // [{ projectCol, lastWeekCol, nextWeekCol }]
let weeklyStagingRows = []; // [{ sourceType, projectCol, lastWeekCol, nextWeekCol }]

function buildWeeklyThreeColumnsData(visit) {
  const projectCol = `${visit.projectName || 'ไม่ระบุชื่อโครงการ'}${visit.projectId && visit.projectId !== '-' ? ` (${visit.projectId})` : ''}`;

  // คอลัมน์ที่ 2: สรุปการทำงานอาทิตย์ที่ผ่านมา
  const lastWeekLines = [];
  if (visit.visitDate && String(visit.visitDate).trim() && String(visit.visitDate).trim() !== '-') {
    lastWeekLines.push(`วันที่เข้าตรวจ: ${String(visit.visitDate).trim()}`);
  }
  if (visit.contractor && String(visit.contractor).trim() && String(visit.contractor).trim() !== '-') {
    lastWeekLines.push(`ผู้รับเหมา: ${String(visit.contractor).trim()}`);
  }
  if (visit.siteProgress && String(visit.siteProgress).trim() && String(visit.siteProgress).trim() !== '-') {
    lastWeekLines.push(`ความคืบหน้า: ${String(visit.siteProgress).trim()}`);
  }
  if (visit.issuesAndRisks && String(visit.issuesAndRisks).trim() && String(visit.issuesAndRisks).trim() !== '-') {
    lastWeekLines.push(`ปัญหา/ความเสี่ยง: ${String(visit.issuesAndRisks).trim()}`);
  }
  if (lastWeekLines.length === 0) {
    const imgCount = Array.isArray(visit.images) ? visit.images.length : 0;
    lastWeekLines.push(imgCount > 0 ? `อัปเดตรูปถ่ายหน้างานจำนวน ${imgCount} รูป` : '-');
  }

  // คอลัมน์ที่ 3: แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไป
  const nextWeekLines = [];
  if (visit.materialForecast && String(visit.materialForecast).trim() && String(visit.materialForecast).trim() !== '-') {
    nextWeekLines.push(`แผนเรียกสินค้า: ${String(visit.materialForecast).trim()}`);
  }
  if (visit.nextWeekActions && String(visit.nextWeekActions).trim() && String(visit.nextWeekActions).trim() !== '-') {
    nextWeekLines.push(`สิ่งที่ต้องติดตาม: ${String(visit.nextWeekActions).trim()}`);
  }
  if (nextWeekLines.length === 0) {
    nextWeekLines.push('-');
  }

  return {
    projectCol,
    lastWeekCol: lastWeekLines.join('\n'),
    nextWeekCol: nextWeekLines.join('\n')
  };
}

function hideWeeklyAiSummaryPreview() {
  const previewBox = document.getElementById('weeklyAiSummaryPreviewBox');
  if (previewBox) previewBox.classList.add('hidden');
  weeklyAiPreviewDraftRows = [];
}

const clearWeeklyAiSummaryPreview = hideWeeklyAiSummaryPreview;

async function openWeeklySelectExportModal() {
  ensureMergeAndBackupModalsExist();
  const modal = document.getElementById('weeklySelectExportModal');
  if (!modal) return;

  try {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    let allVisits = await dbGetAll('site_visits');
    if ((!allVisits || allVisits.length === 0) && Array.isArray(siteVisitLogsGlobal)) {
      allVisits = siteVisitLogsGlobal;
    }

    allWeeklyModalVisitsPool = Array.isArray(allVisits) ? allVisits : [];
    refreshWeeklyAvailableMonths(allWeeklyModalVisitsPool);

    const proj = selectedMasterProject !== 'all' ? projectsMapGlobal[selectedMasterProject] : null;
    const filtered = filterSiteVisitsBySelectedMonths(allWeeklyModalVisitsPool).filter(v => {
      if (selectedMasterProject === 'all') return true;
      return v.projectId === selectedMasterProject ||
             v.projectName === selectedMasterProject ||
             (proj && (v.projectId === proj.id || v.projectName === proj.name));
    });

    filtered.sort((a, b) => {
      const tA = a.createdAt ? new Date(a.createdAt).getTime() : (Number(a.id) || 0);
      const tB = b.createdAt ? new Date(b.createdAt).getTime() : (Number(b.id) || 0);
      return tB - tA;
    });

    weeklyExportCandidatesCache = filtered;
    weeklyExportSelectedIds = new Set(filtered.map((v, idx) => String(v.id !== undefined ? v.id : idx)));

    const searchInput = document.getElementById('weeklyExportSearchInput');
    if (searchInput) searchInput.value = '';

    hideWeeklyAiSummaryPreview();
    renderWeeklyExportItemsList();
    renderWeeklyStagingTable();
    modal.classList.remove('hidden');
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการโหลดรายการรายงานหน้างาน: ' + err.message);
  }
}

function closeWeeklySelectExportModal() {
  const modal = document.getElementById('weeklySelectExportModal');
  if (modal) modal.classList.add('hidden');
  const modalMenu = document.getElementById('weeklyModalMonthDropdownMenu');
  if (modalMenu) modalMenu.classList.add('hidden');
}

function updateWeeklyExportSelectedCount() {
  const el = document.getElementById('weeklyExportSelectedCount');
  if (el) {
    el.textContent = `เลือก ${weeklyExportSelectedIds.size} จาก ${weeklyExportCandidatesCache.length} รายการ`;
  }
}

function toggleSingleWeeklyExportItem(itemId, isChecked) {
  if (isChecked) {
    weeklyExportSelectedIds.add(String(itemId));
  } else {
    weeklyExportSelectedIds.delete(String(itemId));
  }
  updateWeeklyExportSelectedCount();
}

function toggleAllWeeklyExportItems(shouldSelect) {
  const searchTerm = (document.getElementById('weeklyExportSearchInput')?.value || '').toLowerCase().trim();
  weeklyExportCandidatesCache.forEach((v, idx) => {
    const idStr = String(v.id !== undefined ? v.id : idx);
    const cols = buildWeeklyThreeColumnsData(v);
    const matchSearch = !searchTerm ||
      cols.projectCol.toLowerCase().includes(searchTerm) ||
      cols.lastWeekCol.toLowerCase().includes(searchTerm) ||
      cols.nextWeekCol.toLowerCase().includes(searchTerm);

    if (matchSearch) {
      if (shouldSelect) {
        weeklyExportSelectedIds.add(idStr);
      } else {
        weeklyExportSelectedIds.delete(idStr);
      }
    }
  });
  renderWeeklyExportItemsList();
}

function renderWeeklyExportItemsList() {
  const container = document.getElementById('weeklyExportItemsList');
  if (!container) return;

  if (!weeklyExportCandidatesCache || weeklyExportCandidatesCache.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-6 bg-slate-50 rounded-xl border border-slate-100">ไม่พบรายการรายงานหน้างานตามตัวกรองโครงการและเดือนที่เลือก</div>`;
    updateWeeklyExportSelectedCount();
    return;
  }

  const searchTerm = (document.getElementById('weeklyExportSearchInput')?.value || '').toLowerCase().trim();
  const visibleItems = weeklyExportCandidatesCache
    .map((v, idx) => ({
      v,
      idStr: String(v.id !== undefined ? v.id : idx),
      cols: buildWeeklyThreeColumnsData(v)
    }))
    .filter(item => {
      if (!searchTerm) return true;
      return item.cols.projectCol.toLowerCase().includes(searchTerm) ||
             item.cols.lastWeekCol.toLowerCase().includes(searchTerm) ||
             item.cols.nextWeekCol.toLowerCase().includes(searchTerm);
    });

  if (visibleItems.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-5 bg-slate-50 rounded-xl border border-slate-100">ไม่พบรายการตามคำค้นหา</div>`;
    updateWeeklyExportSelectedCount();
    return;
  }

  container.innerHTML = visibleItems.map(({ v, idStr, cols }) => {
    const isChecked = weeklyExportSelectedIds.has(idStr);
    const jsId = escapeJsString(idStr);

    return `
      <label class="flex items-start gap-2.5 p-2.5 rounded-xl bg-white hover:bg-indigo-50/40 border ${isChecked ? 'border-indigo-300 bg-indigo-50/20' : 'border-slate-200'} cursor-pointer transition-colors">
        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleSingleWeeklyExportItem('${jsId}', this.checked)"
               class="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 shrink-0">
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex flex-wrap items-center justify-between gap-1">
            <span class="font-bold text-slate-900 truncate">${escapeHtml(cols.projectCol)}</span>
            <span class="text-[10px] font-mono bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-md shrink-0">
              ${escapeHtml(v.visitDate || '-')}
            </span>
          </div>
          <div class="text-[11px] text-slate-600 whitespace-pre-line line-clamp-1 leading-relaxed">
            <span class="font-semibold text-slate-700">อาทิตย์ที่ผ่านมา:</span> ${escapeHtml(cols.lastWeekCol)}
          </div>
          <div class="text-[11px] text-indigo-700 whitespace-pre-line line-clamp-1 leading-relaxed">
            <span class="font-semibold">แผนสัปดาห์ต่อไป:</span> ${escapeHtml(cols.nextWeekCol)}
          </div>
        </div>
      </label>
    `;
  }).join('');

  updateWeeklyExportSelectedCount();
}

/**
 * ให้ AI (gemini-3.5-flash-lite) สรุปรายการที่เลือกได้ 2 โหมด:
 * - mode === 'single': รวมทุกรายการที่เลือกเป็น 1 แถวเดียว
 * - mode === 'by_project': จัดกลุ่มและสรุปรวมแยกทีละโครงการ (ได้แถวละ 1 โครงการ)
 */
async function summarizeSelectedWeeklyWithAI(mode = 'single') {
  const selectedItems = weeklyExportCandidatesCache.filter((v, idx) => {
    const idStr = String(v.id !== undefined ? v.id : idx);
    return weeklyExportSelectedIds.has(idStr);
  });

  if (selectedItems.length === 0) {
    alert('กรุณาเลือกรายการรายงานหน้างานอย่างน้อย 1 รายการก่อนกดให้ AI สรุป');
    return;
  }

  let activeKey = geminiApiKey;
  if (!activeKey && db) {
    activeKey = await dbGet('settings', 'gemini_api_key') || '';
    geminiApiKey = activeKey;
  }
  if (!activeKey) {
    alert('กรุณาตั้งค่า Gemini API Key ก่อนใช้งานสรุปข้อความด้วย AI');
    if (typeof openGeminiKeyModal === 'function') openGeminiKeyModal();
    return;
  }

  const singleBtn = document.getElementById('aiSummarizeWeeklyBtn');
  const byProjBtn = document.getElementById('aiSummarizeByProjectBtn');
  const origSingleHtml = singleBtn ? singleBtn.innerHTML : '';
  const origByProjHtml = byProjBtn ? byProjBtn.innerHTML : '';

  if (singleBtn) singleBtn.disabled = true;
  if (byProjBtn) byProjBtn.disabled = true;

  const activeBtn = mode === 'by_project' ? byProjBtn : singleBtn;
  if (activeBtn) {
    activeBtn.innerHTML = `<svg class="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> <span>กำลังสรุปด้วย gemini-3.5-flash-lite...</span>`;
  }

  try {
    const combinedRawText = selectedItems.map((v, i) => {
      const cols = buildWeeklyThreeColumnsData(v);
      return `[รายการที่ ${i + 1}]\nชื่อโครงการ: ${cols.projectCol}\nสรุปการทำงานอาทิตย์ที่ผ่านมา:\n${cols.lastWeekCol}\nแผนงานสัปดาห์ต่อไป:\n${cols.nextWeekCol}`;
    }).join('\n\n---\n\n');

    let promptText = '';
    if (mode === 'by_project') {
      promptText = `คุณคือผู้ช่วยฝ่ายขายโครงการก่อสร้าง (SCG B2B Sales) จงจัดกลุ่มและสรุปข้อมูลรายงานหน้างานต่อไปนี้จำนวน ${selectedItems.length} รายการ โดย "แยกสรุปทีละโครงการ" (หากมีหลายรายการที่เป็นโครงการเดียวกัน ให้ยุบรวมเป็น 1 รายการของโครงการนั้น และตัดข้อความที่ซ้ำซ้อนออก)
แต่ละโครงการให้แบ่งออกเป็น 3 ส่วนสำหรับลงตาราง Excel:
1. "projectName": ชื่อโครงการ (พร้อมรหัสโครงการถ้ามี)
2. "lastWeekSummary": สรุปการทำงานอาทิตย์ที่ผ่านมาของโครงการนั้น (ความคืบหน้า การใช้งานสินค้า วันที่ตรวจ และปัญหา/ความเสี่ยง)
3. "nextWeekPlan": แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไปของโครงการนั้น (แผนเรียกสินค้า และสิ่งที่ต้องติดตามต่อ)

ตอบกลับเป็น JSON Object เท่านั้น ตามรูปแบบนี้:
{"rows": [{"projectName": "...", "lastWeekSummary": "...", "nextWeekPlan": "..."}]}

ข้อมูลรายงานที่เลือก:
${combinedRawText}`;
    } else {
      promptText = `คุณคือผู้ช่วยฝ่ายขายโครงการก่อสร้าง (SCG B2B Sales) จงสรุปและเรียบเรียงข้อมูลรายงานหน้างานต่อไปนี้ที่ผู้ใช้เลือกมาจำนวน ${selectedItems.length} รายการ ให้รวมเป็นสรุปชุดเดียวที่กระชับ ชัดเจน ตัดข้อความที่ซ้ำซ้อนออก และแบ่งออกเป็น 3 ส่วนสำหรับลงตาราง Excel:
1. "projectName": ชื่อโครงการ (หากเป็นโครงการเดียวกันให้ใช้ชื่อหลักชื่อเดียว พร้อมรหัสโครงการถ้ามี หากมีหลายโครงการให้ระบุรวมกันอย่างกระชับ)
2. "lastWeekSummary": สรุปการทำงานอาทิตย์ที่ผ่านมา (รวมความคืบหน้าหน้างาน การใช้งานสินค้า วันที่ตรวจ และปัญหา/ความเสี่ยงที่พบ)
3. "nextWeekPlan": แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไป (รวมแผนเรียกสินค้า และสิ่งที่ต้องติดตามต่อ)

ตอบกลับเป็น JSON Object เท่านั้น ตามรูปแบบนี้:
{"rows": [{"projectName": "...", "lastWeekSummary": "...", "nextWeekPlan": "..."}]}

ข้อมูลรายงานที่เลือก:
${combinedRawText}`;
    }

    // บังคับใช้โมเดล gemini-3.5-flash-lite เท่านั้น
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(activeKey)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errBody}`);
    }

    const resultJson = await response.json();
    const rawReply = resultJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleanedJsonStr = rawReply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsedSummary = JSON.parse(cleanedJsonStr);

    let rawRows = [];
    if (Array.isArray(parsedSummary)) {
      rawRows = parsedSummary;
    } else if (parsedSummary && Array.isArray(parsedSummary.rows)) {
      rawRows = parsedSummary.rows;
    } else if (parsedSummary && typeof parsedSummary === 'object') {
      rawRows = [parsedSummary];
    }

    weeklyAiPreviewDraftRows = rawRows.map(r => ({
      projectCol: String(r.projectName || r.projectCol || '-').trim(),
      lastWeekCol: String(r.lastWeekSummary || r.lastWeekCol || '-').trim(),
      nextWeekCol: String(r.nextWeekPlan || r.nextWeekCol || '-').trim()
    }));

    const titleEl = document.getElementById('weeklyAiPreviewTitle');
    if (titleEl) {
      titleEl.textContent = mode === 'by_project'
        ? `ผลสรุปแยกตามรายโครงการจาก AI (${weeklyAiPreviewDraftRows.length} โครงการ) — แก้ไขข้อความก่อนเพิ่มลงตารางได้`
        : 'ผลสรุปรวมเป็น 1 แถวจาก AI (gemini-3.5-flash-lite) — แก้ไขข้อความก่อนเพิ่มลงตารางได้';
    }

    renderWeeklyAiPreviewRows();
    const previewBox = document.getElementById('weeklyAiSummaryPreviewBox');
    if (previewBox) {
      previewBox.classList.remove('hidden');
      previewBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการสรุปข้อความด้วย AI: ' + err.message);
  } finally {
    if (singleBtn) {
      singleBtn.disabled = false;
      singleBtn.innerHTML = origSingleHtml;
    }
    if (byProjBtn) {
      byProjBtn.disabled = false;
      byProjBtn.innerHTML = origByProjHtml;
    }
  }
}

function renderWeeklyAiPreviewRows() {
  const container = document.getElementById('aiWeeklyPreviewRowsContainer');
  if (!container) return;

  if (!weeklyAiPreviewDraftRows || weeklyAiPreviewDraftRows.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = weeklyAiPreviewDraftRows.map((row, idx) => `
    <div class="p-3 rounded-xl bg-white border border-purple-200 shadow-sm space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold text-purple-800">รายการสรุป AI #${idx + 1}</span>
        ${weeklyAiPreviewDraftRows.length > 1 ? `
          <button type="button" onclick="removeAiPreviewDraftRow(${idx})" class="text-[11px] text-rose-500 hover:text-rose-700 hover:underline font-semibold">
            ลบรายการนี้
          </button>
        ` : ''}
      </div>
      <div>
        <label class="block font-semibold text-slate-700 mb-0.5">1. ชื่อโครงการ:</label>
        <input type="text" value="${escapeHtml(row.projectCol)}"
               oninput="updateAiPreviewDraftField(${idx}, 'projectCol', this.value)"
               class="w-full px-2.5 py-1.5 border border-purple-200 rounded-lg bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-purple-500">
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div>
          <label class="block font-semibold text-slate-700 mb-0.5">2. สรุปการทำงานอาทิตย์ที่ผ่านมา:</label>
          <textarea rows="3" oninput="updateAiPreviewDraftField(${idx}, 'lastWeekCol', this.value)"
                    class="w-full px-2.5 py-1.5 border border-purple-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 leading-relaxed">${escapeHtml(row.lastWeekCol)}</textarea>
        </div>
        <div>
          <label class="block font-semibold text-slate-700 mb-0.5">3. แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไป:</label>
          <textarea rows="3" oninput="updateAiPreviewDraftField(${idx}, 'nextWeekCol', this.value)"
                    class="w-full px-2.5 py-1.5 border border-purple-200 rounded-lg bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500 leading-relaxed">${escapeHtml(row.nextWeekCol)}</textarea>
        </div>
      </div>
    </div>
  `).join('');
}

function updateAiPreviewDraftField(idx, field, value) {
  if (weeklyAiPreviewDraftRows[idx]) {
    weeklyAiPreviewDraftRows[idx][field] = value;
  }
}

function removeAiPreviewDraftRow(idx) {
  weeklyAiPreviewDraftRows.splice(idx, 1);
  if (weeklyAiPreviewDraftRows.length === 0) {
    hideWeeklyAiSummaryPreview();
  } else {
    renderWeeklyAiPreviewRows();
  }
}

function commitAiPreviewToStaging() {
  if (!weeklyAiPreviewDraftRows || weeklyAiPreviewDraftRows.length === 0) return;

  weeklyAiPreviewDraftRows.forEach(draft => {
    weeklyStagingRows.push({
      sourceType: 'AI สรุป',
      projectCol: (draft.projectCol || '').trim() || '-',
      lastWeekCol: (draft.lastWeekCol || '').trim() || '-',
      nextWeekCol: (draft.nextWeekCol || '').trim() || '-'
    });
  });

  hideWeeklyAiSummaryPreview();
  // ล้างการติ๊กด้านบนเพื่อให้ผู้ใช้เลือกกลุ่มงานหรือโครงการถัดไปได้สะดวก
  weeklyExportSelectedIds.clear();
  renderWeeklyExportItemsList();
  renderWeeklyStagingTable();

  const stagingSec = document.getElementById('weeklyStagingSection');
  if (stagingSec) {
    stagingSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function addSelectedItemsRawToStaging() {
  const selectedItems = weeklyExportCandidatesCache.filter((v, idx) => {
    const idStr = String(v.id !== undefined ? v.id : idx);
    return weeklyExportSelectedIds.has(idStr);
  });

  if (selectedItems.length === 0) {
    alert('กรุณาติ๊กเลือกรายการงานด้านบนอย่างน้อย 1 รายการก่อนกดเพิ่มลงตาราง');
    return;
  }

  selectedItems.forEach(v => {
    const cols = buildWeeklyThreeColumnsData(v);
    weeklyStagingRows.push({
      sourceType: 'รายการปกติ',
      projectCol: cols.projectCol,
      lastWeekCol: cols.lastWeekCol,
      nextWeekCol: cols.nextWeekCol
    });
  });

  weeklyExportSelectedIds.clear();
  renderWeeklyExportItemsList();
  renderWeeklyStagingTable();

  const stagingSec = document.getElementById('weeklyStagingSection');
  if (stagingSec) {
    stagingSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function renderWeeklyStagingTable() {
  const tbody = document.getElementById('weeklyStagingTableBody');
  const countBadge = document.getElementById('weeklyStagingCountBadge');
  const footerHint = document.getElementById('weeklyFooterReadyHint');
  const footerCount = document.getElementById('weeklyFooterExportCount');

  const total = weeklyStagingRows.length;
  if (countBadge) countBadge.textContent = `${total} แถว`;
  if (footerCount) footerCount.textContent = String(total);
  if (footerHint) {
    footerHint.innerHTML = `พร้อมส่งออก Excel 3 คอลัมน์: <strong class="text-emerald-700">${total} แถว</strong>`;
  }

  if (!tbody) return;

  if (total === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="py-6 text-center text-slate-400">
          ยังไม่มีรายการในตารางเตรียม Export — เลือกงานด้านบนแล้วกดปุ่มสรุปด้วย AI หรือเพิ่มงานลงตารางได้เลย
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = weeklyStagingRows.map((row, idx) => {
    const badgeHtml = row.sourceType === 'AI สรุป'
      ? `<span class="inline-block bg-purple-100 text-purple-800 text-[10px] font-bold px-1.5 py-0.5 rounded mb-1">✨ AI สรุป</span>`
      : `<span class="inline-block bg-sky-100 text-sky-800 text-[10px] font-bold px-1.5 py-0.5 rounded mb-1">📋 รายการปกติ</span>`;

    return `
      <tr class="hover:bg-emerald-50/30 align-top">
        <td class="p-2 border-r border-slate-100">
          ${badgeHtml}
          <textarea rows="3" oninput="updateWeeklyStagingCell(${idx}, 'projectCol', this.value)"
                    class="w-full px-2 py-1 border border-slate-200 rounded bg-white text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-emerald-500 text-[11px] leading-snug">${escapeHtml(row.projectCol)}</textarea>
        </td>
        <td class="p-2 border-r border-slate-100">
          <textarea rows="4" oninput="updateWeeklyStagingCell(${idx}, 'lastWeekCol', this.value)"
                    class="w-full px-2 py-1 border border-slate-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-[11px] leading-snug">${escapeHtml(row.lastWeekCol)}</textarea>
        </td>
        <td class="p-2 border-r border-slate-100">
          <textarea rows="4" oninput="updateWeeklyStagingCell(${idx}, 'nextWeekCol', this.value)"
                    class="w-full px-2 py-1 border border-slate-200 rounded bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-[11px] leading-snug">${escapeHtml(row.nextWeekCol)}</textarea>
        </td>
        <td class="p-2 text-center align-middle">
          <button type="button" onclick="removeWeeklyStagingRow(${idx})" title="ลบแถวนี้"
                  class="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors">
            🗑️
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateWeeklyStagingCell(idx, field, value) {
  if (weeklyStagingRows[idx]) {
    weeklyStagingRows[idx][field] = value;
  }
}

function removeWeeklyStagingRow(idx) {
  weeklyStagingRows.splice(idx, 1);
  renderWeeklyStagingTable();
}

function clearWeeklyStagingTable() {
  if (weeklyStagingRows.length === 0) return;
  if (!confirm('ต้องการล้างรายการทั้งหมดในตารางเตรียม Export ใช่หรือไม่?')) return;
  weeklyStagingRows = [];
  renderWeeklyStagingTable();
}

function executeWeeklyStagingExcelExport() {
  let rowsToExport = weeklyStagingRows;

  // กรณียังไม่ได้กดเพิ่มลงตารางเตรียม Export แต่มีรายการที่ติ๊กเลือกไว้ด้านบน ให้ถามยืนยันส่งออกโดยตรงได้ทันที
  if (!rowsToExport || rowsToExport.length === 0) {
    const checkedItems = weeklyExportCandidatesCache.filter((v, idx) => {
      const idStr = String(v.id !== undefined ? v.id : idx);
      return weeklyExportSelectedIds.has(idStr);
    });

    if (checkedItems.length > 0) {
      const proceedDirect = confirm(
        `ตารางเตรียม Export ด้านล่างยังว่างอยู่ (0 แถว)\nต้องการส่งออกรายการที่ติ๊กเลือกไว้ด้านบนจำนวน ${checkedItems.length} รายการ (แบบแยกแถว) ทันทีเลยหรือไม่?`
      );
      if (!proceedDirect) return;
      rowsToExport = checkedItems.map(v => buildWeeklyThreeColumnsData(v));
    } else {
      alert('ยังไม่มีรายการสำหรับ Export กรุณาเลือกงานด้านบนแล้วกดสรุปด้วย AI หรือเพิ่มลงตารางเตรียม Export ก่อน');
      return;
    }
  }

  const excelRows = rowsToExport.map(r => ({
    "ชื่อโครงการ": (r.projectCol || '').trim() || '-',
    "สรุปการทำงานอาทิตย์ที่ผ่านมา": (r.lastWeekCol || '').trim() || '-',
    "แผนงานที่จะต้องทำต่อในสัปดาห์ต่อไป": (r.nextWeekCol || '').trim() || '-'
  }));

  const ws = XLSX.utils.json_to_sheet(excelRows);
  ws['!cols'] = [{ wch: 38 }, { wch: 65 }, { wch: 65 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Weekly_Site_Update');
  XLSX.writeFile(wb, `Weekly_Site_Update_${new Date().toISOString().slice(0, 10)}.xlsx`);

  closeWeeklySelectExportModal();
}

const executeWeeklySelectedExcelExport = executeWeeklyStagingExcelExport;

// ==========================================
// Merge Projects Feature (เฉพาะ Actual และ Report Site Visit)
// ==========================================
function updateActiveMergeBadge() {
  const badge = document.getElementById('activeMergeCountBadge');
  if (!badge) return;
  const rules = Array.isArray(projectMergeRules) ? projectMergeRules : [];
  const totalMergedSources = rules.reduce((sum, r) => sum + (r.sources ? r.sources.length : 0), 0);
  if (totalMergedSources > 0) {
    badge.textContent = String(totalMergedSources);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function openMergeProjectsModal() {
  ensureMergeAndBackupModalsExist();
  const modal = document.getElementById('mergeProjectsModal');
  if (!modal) return;
  populateMergeModalControls();
  renderActiveMergeRules();
  modal.classList.remove('hidden');
}

function closeMergeProjectsModal() {
  const modal = document.getElementById('mergeProjectsModal');
  if (modal) modal.classList.add('hidden');
}

function populateMergeModalControls() {
  const mainSelect = document.getElementById('mergeMainProjectSelect');
  if (!mainSelect) return;

  const prevVal = mainSelect.value;
  let opts = '<option value="">-- กรุณาเลือกโครงการหลัก --</option>';
  (allProjectListGlobal || []).forEach(p => {
    opts += `<option value="${escapeHtml(p.key)}">${escapeHtml(p.name)} (${escapeHtml(p.id || '-')})</option>`;
  });
  mainSelect.innerHTML = opts;

  const hasPrevOption = Array.from(mainSelect.options).some(opt => opt.value === prevVal);
  if (prevVal && hasPrevOption) {
    mainSelect.value = prevVal;
  } else if (selectedMasterProject !== 'all') {
    const hasMasterOption = Array.from(mainSelect.options).some(opt => opt.value === selectedMasterProject);
    if (hasMasterOption) mainSelect.value = selectedMasterProject;
  }

  renderMergeSourceProjectsList();
}

function renderMergeSourceProjectsList() {
  const container = document.getElementById('mergeSourceProjectsList');
  const mainSelect = document.getElementById('mergeMainProjectSelect');
  const searchInput = document.getElementById('mergeSourceSearchInput');
  if (!container || !mainSelect) return;

  const mainKey = mainSelect.value;
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();

  if (!allProjectListGlobal || allProjectListGlobal.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-4">ยังไม่มีรายการโครงการ กรุณาอัปโหลดไฟล์ยอดขายหลักก่อน</div>`;
    return;
  }

  if (!mainKey) {
    container.innerHTML = `<div class="text-slate-400 text-center py-4">กรุณาเลือกโครงการหลัก (Main Project) ด้านบนก่อน</div>`;
    return;
  }

  const existingRuleForMain = projectMergeRules.find(r => r.mainKey === mainKey);
  const preselectedSourceKeys = new Set(existingRuleForMain ? existingRuleForMain.sources.map(s => s.key) : []);

  const candidates = allProjectListGlobal.filter(p => {
    if (p.key === mainKey) return false;
    if (searchTerm) {
      return (p.name || '').toLowerCase().includes(searchTerm) || (p.id || '').toLowerCase().includes(searchTerm);
    }
    return true;
  });

  if (candidates.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-4">ไม่พบโครงการรองตามคำค้นหา</div>`;
    return;
  }

  container.innerHTML = candidates.map(p => {
    const isChecked = preselectedSourceKeys.has(p.key);
    const otherRule = projectMergeRules.find(r => r.mainKey !== mainKey && r.sources.some(s => s.key === p.key));
    const statusTag = otherRule
      ? `<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">รวมอยู่กับ: ${escapeHtml(otherRule.mainName)}</span>`
      : '';

    return `
      <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-white hover:bg-teal-50/60 border border-slate-100 cursor-pointer transition-colors">
        <div class="flex items-center gap-2 min-w-0">
          <input type="checkbox" name="mergeSourceCheckbox" value="${escapeHtml(p.key)}" ${isChecked ? 'checked' : ''}
                 class="rounded text-teal-600 focus:ring-teal-500 w-3.5 h-3.5">
          <div class="truncate">
            <div class="font-medium text-slate-800 truncate">${escapeHtml(p.name)}</div>
            <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(p.id || '-')}</div>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          ${statusTag}
        </div>
      </label>
    `;
  }).join('');
}

async function syncSiteVisitsWithMergeRules() {
  try {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    const allVisits = await dbGetAll('site_visits');
    if (!allVisits || allVisits.length === 0) return;

    for (const visit of allVisits) {
      const baseId = visit.origProjectId !== undefined ? visit.origProjectId : visit.projectId;
      const baseName = visit.origProjectName !== undefined ? visit.origProjectName : visit.projectName;
      const target = typeof getMergedTargetProjectInfo === 'function'
        ? getMergedTargetProjectInfo(baseId, baseName)
        : null;

      if (target) {
        const nextId = target.id || baseId;
        const nextName = target.name || baseName;
        if (visit.projectId !== nextId || visit.projectName !== nextName || visit.origProjectId === undefined) {
          await dbSave('site_visits', {
            ...visit,
            origProjectId: baseId || '',
            origProjectName: baseName || '',
            projectId: nextId,
            projectName: nextName
          });
        }
      } else if (visit.origProjectId !== undefined || visit.origProjectName !== undefined) {
        // กรณียกเลิกการรวม ให้คืนค่ากลับไปยังโครงการเดิม
        const restoredId = visit.origProjectId || visit.projectId;
        const restoredName = visit.origProjectName || visit.projectName;
        const cleanVisit = { ...visit, projectId: restoredId, projectName: restoredName };
        delete cleanVisit.origProjectId;
        delete cleanVisit.origProjectName;
        await dbSave('site_visits', cleanVisit);
      }
    }

    if (typeof loadSiteVisitLogsFromDB === 'function') {
      await loadSiteVisitLogsFromDB();
    }
  } catch (err) {
    console.error('Error syncing site visits with merge rules:', err);
  }
}

async function confirmMergeProjects() {
  const mainSelect = document.getElementById('mergeMainProjectSelect');
  const mainKey = mainSelect ? mainSelect.value : '';
  if (!mainKey) {
    alert('กรุณาเลือกโครงการหลัก (Main Project) ก่อน');
    return;
  }

  const mainProjObj = allProjectListGlobal.find(p => p.key === mainKey);
  if (!mainProjObj) return;

  const checkedBoxes = Array.from(document.querySelectorAll('input[name="mergeSourceCheckbox"]:checked'));
  const selectedSourceKeys = checkedBoxes.map(cb => cb.value);

  if (selectedSourceKeys.length === 0) {
    alert('กรุณาเลือกโครงการรองอย่างน้อย 1 โครงการเพื่อนำมารวม');
    return;
  }

  // ตัดโครงการรองที่เลือกออกจากการเป็น Main ของกฎอื่น (ป้องกันการซ้อนทับ) และลบออกจากกลุ่มอื่น
  projectMergeRules = projectMergeRules
    .filter(r => r.mainKey !== mainKey && !selectedSourceKeys.includes(r.mainKey))
    .map(r => ({
      ...r,
      sources: r.sources.filter(s => !selectedSourceKeys.includes(s.key) && s.key !== mainKey)
    }))
    .filter(r => r.sources.length > 0);

  const sourceObjects = selectedSourceKeys
    .map(k => allProjectListGlobal.find(p => p.key === k))
    .filter(Boolean)
    .map(p => ({ key: p.key, id: p.id, name: p.name }));

  projectMergeRules.push({
    mainKey: mainProjObj.key,
    mainId: mainProjObj.id,
    mainName: mainProjObj.name,
    sources: sourceObjects
  });

  if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
  await dbSave('settings', { key: 'project_merge_rules', value: projectMergeRules });
  updateActiveMergeBadge();

  await syncSiteVisitsWithMergeRules();
  if (salesRawRows) processSalesCSV(salesRawRows);
  if (dealerRawRows) processDealerCSV(dealerRawRows);

  renderMergeSourceProjectsList();
  renderActiveMergeRules();
  alert(`รวมข้อมูล Actual และ Report Site Visit จาก ${sourceObjects.length} โครงการ เข้าสู่ "${mainProjObj.name}" เรียบร้อยแล้ว`);
}

function renderActiveMergeRules() {
  const container = document.getElementById('activeMergeRulesContainer');
  if (!container) return;

  if (!projectMergeRules || projectMergeRules.length === 0) {
    container.innerHTML = `<div class="text-slate-400 text-center py-3 bg-slate-50 rounded-lg border border-slate-100">ยังไม่มีการตั้งค่าการรวมโครงการ</div>`;
    return;
  }

  container.innerHTML = projectMergeRules.map(rule => {
    const jsMainKey = escapeJsString(rule.mainKey);
    return `
      <div class="p-3 rounded-xl bg-teal-50/50 border border-teal-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div class="space-y-1">
          <div class="font-bold text-teal-950 flex items-center gap-1.5">
            <span class="bg-teal-600 text-white text-[10px] px-1.5 py-0.5 rounded">Main</span>
            <span>${escapeHtml(rule.mainName)} (${escapeHtml(rule.mainId || '-')})</span>
          </div>
          <div class="flex flex-wrap gap-1 items-center text-[11px] text-slate-600">
            <span class="font-medium text-slate-500">รวมจาก:</span>
            ${rule.sources.map(s => `
              <span class="bg-white border border-teal-200 text-teal-800 px-2 py-0.5 rounded-md">
                ${escapeHtml(s.name)} (${escapeHtml(s.id || '-')})
              </span>
            `).join('')}
          </div>
        </div>
        <button type="button" onclick="removeMergeRule('${jsMainKey}')" class="px-2.5 py-1 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-lg text-[11px] font-semibold shrink-0 transition-colors">
          ยกเลิกการรวม
        </button>
      </div>
    `;
  }).join('');
}

async function removeMergeRule(mainKey) {
  projectMergeRules = projectMergeRules.filter(r => r.mainKey !== mainKey);
  if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
  await dbSave('settings', { key: 'project_merge_rules', value: projectMergeRules });
  updateActiveMergeBadge();

  await syncSiteVisitsWithMergeRules();
  if (salesRawRows) processSalesCSV(salesRawRows);
  if (dealerRawRows) processDealerCSV(dealerRawRows);

  renderMergeSourceProjectsList();
  renderActiveMergeRules();
}

async function clearAllMergeRules() {
  if (!projectMergeRules || projectMergeRules.length === 0) return;
  if (!confirm('ต้องการยกเลิกการรวมข้อมูลโครงการทั้งหมดใช่หรือไม่?')) return;

  projectMergeRules = [];
  if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
  await dbSave('settings', { key: 'project_merge_rules', value: projectMergeRules });
  updateActiveMergeBadge();

  await syncSiteVisitsWithMergeRules();
  if (salesRawRows) processSalesCSV(salesRawRows);
  if (dealerRawRows) processDealerCSV(dealerRawRows);

  renderMergeSourceProjectsList();
  renderActiveMergeRules();
}

// ==========================================
// Backup & Restore JSON Feature (เลือกหมวดหมู่ได้ + Chunked Blob Assembly)
// ==========================================
const BACKUP_CATEGORY_LABELS = {
  sales: 'ไฟล์ยอดขายหลัก (Sales CSV)',
  dealer: 'ไฟล์ผู้แทนจำหน่าย (Dealer CSV)',
  price: 'ตารางราคาต่อหน่วย (Price CSV)',
  site_visits: 'รายงานและรูปภาพ Site Visit',
  merge_rules: 'กฎการรวมข้อมูลโครงการ',
  api_key: 'Gemini API Key'
};

function toggleAllBackupCategories(shouldSelect) {
  const boxes = document.querySelectorAll('.backup-cat-checkbox');
  boxes.forEach(cb => {
    cb.checked = Boolean(shouldSelect);
  });
  const apiBox = document.getElementById('backupCatApiKey');
  if (apiBox && !shouldSelect) {
    apiBox.checked = false;
  }
}

async function openBackupJsonModal() {
  ensureMergeAndBackupModalsExist();
  const modal = document.getElementById('backupJsonModal');
  if (!modal) return;

  modal.classList.remove('hidden');

  try {
    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    const cachedFiles = await dbGetAll('cached_files');
    const siteVisits = await dbGetAll('site_visits');
    const savedKey = await dbGet('settings', 'gemini_api_key');

    const salesRec = cachedFiles.find(f => f.fileType === 'sales_data');
    const dealerRec = cachedFiles.find(f => f.fileType === 'dealer_data');
    const priceRec = cachedFiles.find(f => f.fileType === 'price_data');

    const hasSales = Boolean(salesRec && Array.isArray(salesRec.data) && salesRec.data.length > 0);
    const hasDealer = Boolean(dealerRec && Array.isArray(dealerRec.data) && dealerRec.data.length > 0);
    const hasPrice = Boolean(priceRec && Array.isArray(priceRec.data) && priceRec.data.length > 0);
    const hasSiteVisits = Array.isArray(siteVisits) && siteVisits.length > 0;
    const hasMergeRules = Array.isArray(projectMergeRules) && projectMergeRules.length > 0;
    const hasApiKey = Boolean(savedKey || geminiApiKey);

    const setCatState = (cbId, statId, isAvailable, availableText, emptyText, defaultChecked) => {
      const cb = document.getElementById(cbId);
      const stat = document.getElementById(statId);
      if (cb) cb.checked = Boolean(defaultChecked);
      if (stat) {
        stat.textContent = isAvailable ? availableText : emptyText;
        stat.className = isAvailable
          ? 'text-[11px] font-bold text-emerald-600'
          : 'text-[11px] font-medium text-slate-400';
      }
    };

    setCatState(
      'backupCatSales',
      'backupStatSales',
      hasSales,
      `มีข้อมูล (${hasSales ? salesRec.data.length.toLocaleString() : 0} แถว)`,
      'ไม่มีข้อมูล',
      hasSales
    );
    setCatState(
      'backupCatDealer',
      'backupStatDealer',
      hasDealer,
      `มีข้อมูล (${hasDealer ? dealerRec.data.length.toLocaleString() : 0} แถว)`,
      'ไม่มีข้อมูล',
      hasDealer
    );
    setCatState(
      'backupCatPrice',
      'backupStatPrice',
      hasPrice,
      `มีข้อมูล (${hasPrice ? priceRec.data.length.toLocaleString() : 0} แถว)`,
      'ใช้ค่าเริ่มต้นระบบ',
      hasPrice
    );
    setCatState(
      'backupCatSiteVisits',
      'backupStatSiteVisits',
      hasSiteVisits,
      `${siteVisits.length} รายการ`,
      '0 รายการ',
      hasSiteVisits
    );
    setCatState(
      'backupCatMergeRules',
      'backupStatMergeRules',
      hasMergeRules,
      `${projectMergeRules.length} กลุ่ม`,
      '0 กลุ่ม',
      hasMergeRules
    );
    // API Key ไม่ติ๊กเป็นค่าเริ่มต้นเพื่อความปลอดภัย
    setCatState(
      'backupCatApiKey',
      'backupStatApiKey',
      hasApiKey,
      'บันทึกไว้แล้ว',
      'ไม่ได้ระบุ',
      false
    );
  } catch (err) {
    console.error('Error inspecting IndexedDB for backup:', err);
  }
}

function closeBackupJsonModal() {
  const modal = document.getElementById('backupJsonModal');
  if (modal) modal.classList.add('hidden');
}

async function executeBackupJsonDownload() {
  try {
    const selectedCategories = [];
    if (document.getElementById('backupCatSales')?.checked) selectedCategories.push('sales');
    if (document.getElementById('backupCatDealer')?.checked) selectedCategories.push('dealer');
    if (document.getElementById('backupCatPrice')?.checked) selectedCategories.push('price');
    if (document.getElementById('backupCatSiteVisits')?.checked) selectedCategories.push('site_visits');
    if (document.getElementById('backupCatMergeRules')?.checked) selectedCategories.push('merge_rules');
    if (document.getElementById('backupCatApiKey')?.checked) selectedCategories.push('api_key');

    if (selectedCategories.length === 0) {
      alert('กรุณาเลือกหมวดข้อมูลที่ต้องการสำรองอย่างน้อย 1 หมวด');
      return;
    }

    if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
    const settingsAll = await dbGetAll('settings');
    const cachedFilesAll = await dbGetAll('cached_files');
    const siteVisitsAll = selectedCategories.includes('site_visits') ? await dbGetAll('site_visits') : [];

    // คัดกรองเฉพาะ settings ตามหมวดที่เลือก
    const filteredSettings = settingsAll.filter(item => {
      if (!item || !item.key) return false;
      if (item.key === 'project_merge_rules') return selectedCategories.includes('merge_rules');
      if (item.key === 'gemini_api_key') return selectedCategories.includes('api_key');
      return false;
    });

    // คัดกรองเฉพาะ cached_files ตามหมวดที่เลือก
    const filteredCachedFiles = cachedFilesAll.filter(item => {
      if (!item || !item.fileType) return false;
      if (item.fileType === 'sales_data') return selectedCategories.includes('sales');
      if (item.fileType === 'dealer_data') return selectedCategories.includes('dealer');
      if (item.fileType === 'price_data') return selectedCategories.includes('price');
      return false;
    });

    // แยกประกอบ JSON เป็นชิ้นส่วนย่อย (Chunks) เพื่อป้องกันข้อผิดพลาด Invalid string length เมื่อมีรูปภาพและไฟล์ขนาดใหญ่
    const chunks = [];
    chunks.push(
      `{"appName":"SalesAnalyticsDashboard","dbName":${JSON.stringify(DB_NAME)},"dbVersion":${JSON.stringify(DB_VERSION)},"exportedAt":${JSON.stringify(new Date().toISOString())},"selectedCategories":${JSON.stringify(selectedCategories)},"stores":{`
    );

    // 1. Store: settings
    chunks.push(`"settings":${JSON.stringify(filteredSettings)},`);

    // 2. Store: cached_files (แปลงทีละแถวข้อมูลเพื่อไม่ให้เกิด String ก้อนใหญ่)
    chunks.push('"cached_files":[');
    for (let i = 0; i < filteredCachedFiles.length; i++) {
      if (i > 0) chunks.push(',');
      const item = filteredCachedFiles[i];
      if (item && Array.isArray(item.data)) {
        const { data, ...restMeta } = item;
        const metaJson = JSON.stringify(restMeta);
        const prefix = metaJson === '{}' ? '{' : metaJson.slice(0, -1) + ',';
        chunks.push(prefix + '"data":[');
        for (let r = 0; r < data.length; r++) {
          if (r > 0) chunks.push(',');
          chunks.push(JSON.stringify(data[r]));
        }
        chunks.push(']}');
      } else {
        chunks.push(JSON.stringify(item));
      }
    }
    chunks.push('],');

    // 3. Store: site_visits (แปลงทีละรายการและแยกรูปภาพ Base64 ทีละรูป)
    chunks.push('"site_visits":[');
    for (let i = 0; i < siteVisitsAll.length; i++) {
      if (i > 0) chunks.push(',');
      const visit = siteVisitsAll[i];
      if (visit && Array.isArray(visit.images)) {
        const { images, ...visitMeta } = visit;
        const vMetaJson = JSON.stringify(visitMeta);
        const prefix = vMetaJson === '{}' ? '{' : vMetaJson.slice(0, -1) + ',';
        chunks.push(prefix + '"images":[');
        for (let imgIdx = 0; imgIdx < images.length; imgIdx++) {
          if (imgIdx > 0) chunks.push(',');
          chunks.push(JSON.stringify(images[imgIdx]));
        }
        chunks.push(']}');
      } else {
        chunks.push(JSON.stringify(visit));
      }
    }
    chunks.push(']}}');

    const blob = new Blob(chunks, { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `SalesAnalytics_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    closeBackupJsonModal();
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการสร้างไฟล์ Backup JSON: ' + err.message);
  }
}

async function handleRestoreJsonFile(file) {
  if (!file) return;
  try {
    // ใช้ Response(file).json() เพื่ออ่านไฟล์ Backup ขนาดใหญ่แบบ Stream โดยไม่ติดขีดจำกัดความยาว String
    let parsed;
    try {
      parsed = await new Response(file).json();
    } catch (streamErr) {
      const rawText = await file.text();
      parsed = JSON.parse(rawText);
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.stores) {
      alert('รูปแบบไฟล์ Backup JSON ไม่ถูกต้อง กรุณาเลือกไฟล์ที่ส่งออกจากแอปนี้เท่านั้น');
      return;
    }

    const stores = parsed.stores;
    const settingsList = Array.isArray(stores.settings) ? stores.settings : [];
    const cachedFilesList = Array.isArray(stores.cached_files) ? stores.cached_files : [];
    const siteVisitsList = Array.isArray(stores.site_visits) ? stores.site_visits : [];
    const hasSelectedCategories = Array.isArray(parsed.selectedCategories);

    const exportDateLabel = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('th-TH') : '-';

    if (hasSelectedCategories) {
      const catNamesText = parsed.selectedCategories
        .map(c => `• ${BACKUP_CATEGORY_LABELS[c] || c}`)
        .join('\n');

      const ok = confirm(
        `ยืนยันการกู้คืนข้อมูลเฉพาะหมวดที่มีในไฟล์ Backup?\n` +
        `• วันที่สำรองข้อมูล: ${exportDateLabel}\n` +
        `• หมวดที่จะถูกกู้คืนและเขียนทับ:\n${catNamesText}\n\n` +
        `ℹ️ หมวดข้อมูลอื่นที่ไม่ได้อยู่ในไฟล์นี้จะยังคงอยู่ตามเดิม`
      );
      if (!ok) return;

      if (!db && typeof initIndexedDB === 'function') await initIndexedDB();
      const cats = new Set(parsed.selectedCategories);

      if (cats.has('sales')) {
        const salesItem = cachedFilesList.find(f => f && f.fileType === 'sales_data');
        if (salesItem) await dbSave('cached_files', salesItem);
        else await dbDelete('cached_files', 'sales_data');
      }
      if (cats.has('dealer')) {
        const dealerItem = cachedFilesList.find(f => f && f.fileType === 'dealer_data');
        if (dealerItem) await dbSave('cached_files', dealerItem);
        else await dbDelete('cached_files', 'dealer_data');
      }
      if (cats.has('price')) {
        const priceItem = cachedFilesList.find(f => f && f.fileType === 'price_data');
        if (priceItem) await dbSave('cached_files', priceItem);
        else await dbDelete('cached_files', 'price_data');
      }
      if (cats.has('site_visits')) {
        await dbClearStore('site_visits');
        for (const item of siteVisitsList) {
          if (item) await dbSave('site_visits', item);
        }
      }
      if (cats.has('merge_rules')) {
        const mergeItem = settingsList.find(s => s && s.key === 'project_merge_rules');
        if (mergeItem) await dbSave('settings', mergeItem);
        else await dbDelete('settings', 'project_merge_rules');
      }
      if (cats.has('api_key')) {
        const keyItem = settingsList.find(s => s && s.key === 'gemini_api_key');
        if (keyItem) await dbSave('settings', keyItem);
        else await dbDelete('settings', 'gemini_api_key');
      }
    } else {
      // รองรับไฟล์ Backup แบบเต็มรูปแบบเดิม
      const ok = confirm(
        `ยืนยันการกู้คืนข้อมูลทั้งหมดจากไฟล์ Backup?\n` +
        `• วันที่สำรองข้อมูล: ${exportDateLabel}\n` +
        `• ไฟล์ข้อมูลที่แคชไว้: ${cachedFilesList.length} ชุด\n` +
        `• รายงานและรูปภาพ Site Visit: ${siteVisitsList.length} รายการ\n\n` +
        `⚠️ ข้อมูลปัจจุบันในเครื่องจะถูกแทนที่ด้วยข้อมูลจากไฟล์นี้`
      );
      if (!ok) return;

      if (!db && typeof initIndexedDB === 'function') await initIndexedDB();

      await dbClearStore('settings');
      await dbClearStore('cached_files');
      await dbClearStore('site_visits');

      for (const item of settingsList) {
        if (item && item.key) await dbSave('settings', item);
      }
      for (const item of cachedFilesList) {
        if (item && item.fileType) await dbSave('cached_files', item);
      }
      for (const item of siteVisitsList) {
        if (item) await dbSave('site_visits', item);
      }
    }

    // โหลด State ใหม่ทั้งหมดจาก IndexedDB
    const savedKey = await dbGet('settings', 'gemini_api_key');
    geminiApiKey = savedKey || '';
    if (typeof updateApiKeyStatusUI === 'function') {
      updateApiKeyStatusUI();
    }

    const savedMergeRules = await dbGet('settings', 'project_merge_rules');
    projectMergeRules = Array.isArray(savedMergeRules) ? savedMergeRules : [];
    updateActiveMergeBadge();

    await syncSiteVisitsWithMergeRules();

    const cachedPrice = await dbGet('cached_files', 'price_data');
    if (cachedPrice && cachedPrice.data) {
      processPriceCSV(cachedPrice.data);
    }

    const cachedSales = await dbGet('cached_files', 'sales_data');
    if (cachedSales && cachedSales.data) {
      salesRawRows = cachedSales.data;
      processSalesCSV(salesRawRows);
    }

    const cachedDealer = await dbGet('cached_files', 'dealer_data');
    if (cachedDealer && cachedDealer.data) {
      dealerRawRows = cachedDealer.data;
      processDealerCSV(dealerRawRows);
    }

    if (typeof loadSiteVisitLogsFromDB === 'function') {
      await loadSiteVisitLogsFromDB();
    }

    alert('กู้คืนข้อมูล (Restore JSON) เรียบร้อยแล้ว');
  } catch (err) {
    alert('ไม่สามารถอ่านไฟล์ JSON ได้: ' + err.message);
  }
}

// ผูกฟังก์ชันเข้ากับ window และ Event Delegation ระดับ document เพื่อให้ปุ่มทำงานได้เสมอ
window.toggleMobileHeaderTools = toggleMobileHeaderTools;
window.openMergeProjectsModal = openMergeProjectsModal;
window.closeMergeProjectsModal = closeMergeProjectsModal;
window.renderMergeSourceProjectsList = renderMergeSourceProjectsList;
window.confirmMergeProjects = confirmMergeProjects;
window.removeMergeRule = removeMergeRule;
window.clearAllMergeRules = clearAllMergeRules;
window.toggleAllBackupCategories = toggleAllBackupCategories;
window.openBackupJsonModal = openBackupJsonModal;
window.closeBackupJsonModal = closeBackupJsonModal;
window.executeBackupJsonDownload = executeBackupJsonDownload;
window.handleRestoreJsonFile = handleRestoreJsonFile;
window.toggleWeeklyMonthDropdown = toggleWeeklyMonthDropdown;
window.toggleWeeklyFilterMonth = toggleWeeklyFilterMonth;
window.selectAllWeeklyMonths = selectAllWeeklyMonths;
window.selectAllWeeklyFilterMonths = selectAllWeeklyFilterMonths;
window.openWeeklySelectExportModal = openWeeklySelectExportModal;
window.closeWeeklySelectExportModal = closeWeeklySelectExportModal;
window.toggleSingleWeeklyExportItem = toggleSingleWeeklyExportItem;
window.toggleAllWeeklyExportItems = toggleAllWeeklyExportItems;
window.renderWeeklyExportItemsList = renderWeeklyExportItemsList;
window.summarizeSelectedWeeklyWithAI = summarizeSelectedWeeklyWithAI;
window.hideWeeklyAiSummaryPreview = hideWeeklyAiSummaryPreview;
window.clearWeeklyAiSummaryPreview = clearWeeklyAiSummaryPreview;
window.updateAiPreviewDraftField = updateAiPreviewDraftField;
window.removeAiPreviewDraftRow = removeAiPreviewDraftRow;
window.commitAiPreviewToStaging = commitAiPreviewToStaging;
window.addSelectedItemsRawToStaging = addSelectedItemsRawToStaging;
window.renderWeeklyStagingTable = renderWeeklyStagingTable;
window.updateWeeklyStagingCell = updateWeeklyStagingCell;
window.removeWeeklyStagingRow = removeWeeklyStagingRow;
window.clearWeeklyStagingTable = clearWeeklyStagingTable;
window.executeWeeklyStagingExcelExport = executeWeeklyStagingExcelExport;
window.executeWeeklySelectedExcelExport = executeWeeklySelectedExcelExport;

document.addEventListener('click', (e) => {
  const mergeBtn = e.target.closest('#openMergeProjectsModalBtn');
  if (mergeBtn) {
    e.preventDefault();
    openMergeProjectsModal();
    return;
  }
  const backupBtn = e.target.closest('#openBackupModalBtn');
  if (backupBtn) {
    e.preventDefault();
    openBackupJsonModal();
    return;
  }
  const weeklyExportBtn = e.target.closest('#openWeeklySelectExportModalBtn');
  if (weeklyExportBtn) {
    e.preventDefault();
    openWeeklySelectExportModal();
    return;
  }

  // เปิด/ปิด Dropdown ตัวกรองเดือน Weekly ใน Section 1
  const sectionMonthBtn = e.target.closest('#weeklySectionMonthDropdownBtn');
  if (sectionMonthBtn) {
    e.preventDefault();
    toggleWeeklyMonthDropdown(e, 'weeklySectionMonthDropdownMenu');
    return;
  }

  // เปิด/ปิด Dropdown ตัวกรองเดือน Weekly ภายใน Modal Export
  const modalMonthBtn = e.target.closest('#weeklyModalMonthDropdownBtn');
  if (modalMonthBtn) {
    e.preventDefault();
    toggleWeeklyMonthDropdown(e, 'weeklyModalMonthDropdownMenu');
    return;
  }

  // ปิดเมนู Dropdown ตัวกรองเดือน Weekly เมื่อคลิกพื้นที่อื่น
  const sectionMonthMenu = document.getElementById('weeklySectionMonthDropdownMenu');
  if (sectionMonthMenu && !sectionMonthMenu.contains(e.target)) {
    sectionMonthMenu.classList.add('hidden');
  }

  const modalMonthMenu = document.getElementById('weeklyModalMonthDropdownMenu');
  if (modalMonthMenu && !modalMonthMenu.contains(e.target)) {
    modalMonthMenu.classList.add('hidden');
  }
});

// ==========================================
// Initialization & Global Event Listeners
// ==========================================
async function initializeSalesEngineApp() {
  ensureMergeAndBackupModalsExist();
  installWeeklySiteVisitMonthFilterHooks();

  try {
    await initIndexedDB();
    const savedKey = await dbGet('settings', 'gemini_api_key');
    if (savedKey) {
      geminiApiKey = savedKey;
      if (typeof updateApiKeyStatusUI === 'function') {
        updateApiKeyStatusUI();
      }
    }

    const savedMergeRules = await dbGet('settings', 'project_merge_rules');
    if (Array.isArray(savedMergeRules)) {
      projectMergeRules = savedMergeRules;
      updateActiveMergeBadge();
    }

    const cachedPrice = await dbGet('cached_files', 'price_data');
    if (cachedPrice && cachedPrice.data) {
      processPriceCSV(cachedPrice.data);
    }

    const cachedSales = await dbGet('cached_files', 'sales_data');
    if (cachedSales && cachedSales.data) {
      salesRawRows = cachedSales.data;
      processSalesCSV(salesRawRows);
    }

    const cachedDealer = await dbGet('cached_files', 'dealer_data');
    if (cachedDealer && cachedDealer.data) {
      dealerRawRows = cachedDealer.data;
      processDealerCSV(dealerRawRows);
    }

    if (typeof loadSiteVisitLogsFromDB === 'function') {
      await loadSiteVisitLogsFromDB();
    }
  } catch (err) {
    console.error('DB Initialization error:', err);
  }

  // Master Project Select Listener (All-in-One Link)
  const masterProjectSelect = document.getElementById('masterProjectSelect');
  if (masterProjectSelect) {
    masterProjectSelect.addEventListener('change', (e) => {
      selectedMasterProject = e.target.value;
      applyMasterProjectFilter();
    });
  }

  // Restore JSON File Input Listener
  const restoreJsonFileInput = document.getElementById('restoreJsonFileInput');
  if (restoreJsonFileInput) {
    restoreJsonFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleRestoreJsonFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  // File Inputs Event Listeners
  const dropZone = document.getElementById('dropZone');
  const salesFileInput = document.getElementById('salesFileInput');
  const priceFileInput = document.getElementById('priceFileInput');
  const dealerFileInput = document.getElementById('dealerFileInput');
  const unitDisplayModeSelect = document.getElementById('unitDisplayModeSelect');

  if (dropZone && salesFileInput) {
    dropZone.addEventListener('click', () => salesFileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dropzone-active');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dropzone-active');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dropzone-active');
      if (e.dataTransfer.files.length) {
        handleSalesFile(e.dataTransfer.files[0]);
      }
    });
  }

  if (salesFileInput) {
    salesFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleSalesFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  if (priceFileInput) {
    priceFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handlePriceFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  if (dealerFileInput) {
    dealerFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleDealerFile(e.target.files[0]);
        e.target.value = '';
      }
    });
  }

  if (unitDisplayModeSelect) {
    unitDisplayModeSelect.addEventListener('change', (e) => {
      displayMode = e.target.value;
      updateUIUnitLabels();
      if (salesRawRows) {
        processSalesCSV(salesRawRows);
      }
      if (dealerRawRows) {
        renderDealerTable();
        updateDealerComparisonCharts();
      }
      updateKpiSummary();
    });
  }

  // Modals Buttons
  document.getElementById('openGeminiModalBtn')?.addEventListener('click', openGeminiKeyModal);
  document.getElementById('openSiteVisitModalBtn')?.addEventListener('click', openSiteVisitModal);

  // Direct Site Visit Upload in Weekly Section
  const weeklyDirectInput = document.getElementById('weeklyDirectFileInput');
  const weeklyInlineZone = document.getElementById('weeklyInlineDropZone');

  if (weeklyDirectInput) {
    weeklyDirectInput.addEventListener('change', (e) => {
      handleDirectSitePhotoUpload(e.target.files);
      e.target.value = '';
    });
  }

  if (weeklyInlineZone && weeklyDirectInput) {
    weeklyInlineZone.addEventListener('click', () => weeklyDirectInput.click());
    weeklyInlineZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      weeklyInlineZone.classList.add('dropzone-sky-active');
    });
    weeklyInlineZone.addEventListener('dragleave', () => {
      weeklyInlineZone.classList.remove('dropzone-sky-active');
    });
    weeklyInlineZone.addEventListener('drop', (e) => {
      e.preventDefault();
      weeklyInlineZone.classList.remove('dropzone-sky-active');
      handleDirectSitePhotoUpload(e.dataTransfer.files);
    });
  }

  // Site Visit Drop Zone in Modal (AI Analysis)
  const siteDropZone = document.getElementById('siteVisitDropZone');
  const siteFileInput = document.getElementById('siteVisitFileInput');
  if (siteDropZone && siteFileInput) {
    siteDropZone.addEventListener('click', () => siteFileInput.click());
    siteDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      siteDropZone.classList.add('dropzone-sky-active');
    });
    siteDropZone.addEventListener('dragleave', () => {
      siteDropZone.classList.remove('dropzone-sky-active');
    });
    siteDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      siteDropZone.classList.remove('dropzone-sky-active');
      handleSiteVisitFilesSelected(e.dataTransfer.files);
    });
    siteFileInput.addEventListener('change', (e) => {
      handleSiteVisitFilesSelected(e.target.files);
      e.target.value = '';
    });
  }

  // Forecast & Matrix Inputs
  document.getElementById('forecastStartSelect')?.addEventListener('change', handleForecastProductRangeChange);
  document.getElementById('forecastEndSelect')?.addEventListener('change', handleForecastProductRangeChange);
  document.getElementById('forecastProjectSingleMonthSelect')?.addEventListener('change', updateForecastProjectChart);
  document.getElementById('matrixMonthSelect')?.addEventListener('change', updateForecastMatrix);
  document.getElementById('matrixSearchInput')?.addEventListener('input', renderForecastMatrixTable);

  // Search Table Inputs
  document.getElementById('projectSearchInput')?.addEventListener('input', renderProjectTable);
  document.getElementById('inactiveSearchInput')?.addEventListener('input', renderInactiveTable);
  document.getElementById('inactiveMonthFilter')?.addEventListener('change', renderInactiveTable);

  // Dealer Inputs
  document.getElementById('dealerSearchInput')?.addEventListener('input', renderDealerTable);
  document.getElementById('dealerYearFilter')?.addEventListener('change', renderDealerTable);
  document.getElementById('dealerMonthFilter')?.addEventListener('change', renderDealerTable);

  // Dealer Comparison Month Range Filters
  document.getElementById('dealerCompStartMonthSelect')?.addEventListener('change', handleDealerCompMonthRangeChange);
  document.getElementById('dealerCompEndMonthSelect')?.addEventListener('change', handleDealerCompMonthRangeChange);

  // Toggle Dropdown Menus
  const dropdownPairs = [
    { btn: 'forecastProductDropdownBtn', menu: 'forecastProductDropdownMenu' },
    { btn: 'dealerCompProductDropdownBtn', menu: 'dealerCompProductDropdownMenu' }
  ];

  dropdownPairs.forEach(pair => {
    const btn = document.getElementById(pair.btn);
    const menu = document.getElementById(pair.menu);
    if (btn && menu) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownPairs.forEach(p => {
          const m = document.getElementById(p.menu);
          if (m && m !== menu) m.classList.add('hidden');
        });
        menu.classList.toggle('hidden');
      });
    }
  });

  document.addEventListener('click', (e) => {
    dropdownPairs.forEach(p => {
      const btn = document.getElementById(p.btn);
      const menu = document.getElementById(p.menu);
      if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('hidden');
      }
    });
  });

  // Modal Backdrop Click
  const modals = ['geminiKeyModal', 'siteVisitModal', 'crossSellModal', 'projectModal', 'imageLightboxModal', 'editSiteVisitModal', 'mergeProjectsModal', 'backupJsonModal', 'weeklySelectExportModal'];
  modals.forEach(mId => {
    const el = document.getElementById(mId);
    if (el) {
      el.addEventListener('click', (e) => {
        if (e.target.id === mId) {
          el.classList.add('hidden');
        }
      });
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSalesEngineApp);
} else {
  initializeSalesEngineApp();
}
