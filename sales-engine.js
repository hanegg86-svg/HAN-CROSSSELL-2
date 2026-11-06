/**
 * Sales Engine & Master Filters (sales-engine.js)
 * จัดการข้อมูลไฟล์ยอดขายหลัก Ropp vs Act, Master Filter, KPI, ตารางโครงการ, Inactive และ Cross-sell
 */

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

    if (!projectsMap[projectKey]) {
      projectsMap[projectKey] = {
        id: projectCode,
        name: projectName,
        key: projectKey,
        totalRopp: 0,
        totalAct: 0,
        productsAct: {},
        productsRopp: {},
        productDetails: {}
      };
    }

    const unitPrice = getUnitPrice(p);
    let rowRoppSum = 0;
    let rowActSum = 0;
    let rowRoppUnitSum = 0;
    let rowActUnitSum = 0;

    monthHeaders.forEach(m => {
      const rUnit = parseNum(r[m.roppCol]);
      const aUnit = parseNum(r[m.actCol]);
      rowRoppUnitSum += rUnit;
      rowActUnitSum += aUnit;

      const rVal = displayMode === 'baht' ? (rUnit * unitPrice) : rUnit;
      const aVal = displayMode === 'baht' ? (aUnit * unitPrice) : aUnit;

      rowRoppSum += rVal;
      rowActSum += aVal;
    });

    projectsMap[projectKey].totalRopp += rowRoppSum;
    projectsMap[projectKey].totalAct += rowActSum;

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
    projectsMap[projectKey].productDetails[p].actUnit += rowActUnitSum;
    projectsMap[projectKey].productDetails[p].roppBaht += (rowRoppUnitSum * unitPrice);
    projectsMap[projectKey].productDetails[p].actBaht += (rowActUnitSum * unitPrice);

    if (rowActSum > 0) {
      projectsMap[projectKey].productsAct[p] = (projectsMap[projectKey].productsAct[p] || 0) + rowActSum;
    }
    if (rowRoppSum > 0) {
      projectsMap[projectKey].productsRopp[p] = (projectsMap[projectKey].productsRopp[p] || 0) + rowRoppSum;
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
    const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const productGroup = (row[4] || 'อื่นๆ').trim();

    const unitPrice = getUnitPrice(productGroup);
    if (unitPrice === 0) {
      missingPriceProducts.add(productGroup);
    }

    let hasPastSales = false;
    let lastActiveMonthYear = '-';
    let lastActiveDateObj = null;
    let lastActiveActVal = 0;
    let totalPastAct = 0;
    let pastMonthsCountWithSales = 0;

    monthHeaders.forEach(m => {
      const aUnit = parseNum(row[m.actCol]);
      const aVal = displayMode === 'baht' ? (aUnit * unitPrice) : aUnit;

      let isNotFuture = true;
      if (m.parsedDate) {
        if (m.parsedDate.year > currentYear || (m.parsedDate.year === currentYear && m.parsedDate.month > currentMonth)) {
          isNotFuture = false;
        }
      }

      if (isNotFuture && aVal > 0) {
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
          projectName: projectName,
          projectCode: projectCode,
          productGroup: productGroup,
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
  renderWeeklySiteVisitDashboard();
  renderDealerTable();
  updateDealerComparisonCharts();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
  renderInactiveTable();
  renderProjectTable();
}

function updateKpiSummary() {
  let filteredRopp = 0;
  let filteredAct = 0;
  let filteredInactiveCount = 0;
  let filteredInactiveRev = 0;
  let filteredCrossSell = 0;

  if (selectedMasterProject === 'all') {
    projectList.forEach(p => {
      filteredRopp += p.totalRopp;
      filteredAct += p.totalAct;
      if (p.boughtProducts.length > 1) filteredCrossSell++;
    });
    filteredInactiveCount = inactiveList.length;
    filteredInactiveRev = inactiveList.reduce((acc, curr) => acc + curr.totalPastAct, 0);
  } else {
    const proj = projectsMapGlobal[selectedMasterProject];
    if (proj) {
      filteredRopp = proj.totalRopp;
      filteredAct = proj.totalAct;
      if (Object.keys(proj.productsAct).length > 1) filteredCrossSell = 1;
    }
    const projInactive = inactiveList.filter(it => 
      it.projectCode === selectedMasterProject || 
      it.projectName === selectedMasterProject ||
      (proj && (it.projectCode === proj.id || it.projectName === proj.name))
    );
    filteredInactiveCount = projInactive.length;
    filteredInactiveRev = projInactive.reduce((acc, curr) => acc + curr.totalPastAct, 0);
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
            <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(p.id || '-')}</div>
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
// Initialization & Global Event Listeners
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initIndexedDB();
    const savedKey = await dbGet('settings', 'gemini_api_key');
    if (savedKey) {
      geminiApiKey = savedKey;
      updateApiKeyStatusUI();
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

    await loadSiteVisitLogsFromDB();
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

  // Modal Backdrop Click (รวมถึง editSiteVisitModal)
  const modals = ['geminiKeyModal', 'siteVisitModal', 'crossSellModal', 'projectModal', 'imageLightboxModal', 'editSiteVisitModal'];
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
});
