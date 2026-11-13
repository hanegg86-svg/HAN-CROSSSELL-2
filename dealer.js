/**
 * Dealer Actual Reconciliation & Charts (dealer.js)
 * จัดการข้อมูลยอดขายผ่านผู้แทนจำหน่าย (Dealer), จับคู่รหัสโครงการ, กราฟเปรียบเทียบ Ropp vs Dealer Actual
 * ปรับปรุง:
 * 1. ยอด Actual ดึงค่าปริมาณขายจากช่อง AL (Actual_RUNIT) แทนช่อง AB (Actual)
 * 2. ช่องหน่วย (Unit) ดึงจากช่อง AM (Report_Unit) / Sales_Unit
 * 3. คงค่าช่วงเวลาที่เลือกไว้ (ไม่ Reset) เมื่อสลับหน่วย และอัปเดตสรุป KPI
 * 4. รองรับการรวมยอด Dealer Actual เข้าโครงการหลัก (Main Project) ตามกฎการรวมโครงการ
 */

function handleDealerFile(file) {
  if (!file) return;
  readFileWithEncodingDetection(file, function(csvText) {
    Papa.parse(csvText, {
      header: true,
      skipEmptyLines: true,
      complete: function(results) {
        dealerRawRows = results.data;
        dbSave('cached_files', { fileType: 'dealer_data', data: dealerRawRows });
        processDealerCSV(dealerRawRows);
      }
    });
  });
}

function processDealerCSV(rows) {
  if (!rows || rows.length === 0) return;
  matchedDealerList = [];
  const yearOptionsSet = new Set();
  const monthOptionsSet = new Set();

  rows.forEach(r => {
    const rawProjectSiteId = String(r['BP_PROJECT_SITE'] || r['bp_project_site'] || '').trim();
    if (!rawProjectSiteId) return;
    if (validProjectIdsSet.size > 0 && !validProjectIdsSet.has(rawProjectSiteId)) {
      return;
    }
    const dealerName = (r['Dealer_Name'] || r['dealer_name'] || '-').trim();
    const dealerId = (r['Dealer_ID'] || r['dealer_id'] || '-').trim();
    const rawProjectName = (r['BP_PROJECT_SITE_NAME'] || r['bp_project_site_name'] || '-').trim();

    // ตรวจสอบกฎการรวมโครงการ (ย้ายเฉพาะยอด Actual เข้าโครงการหลัก)
    const mergedTarget = getMergedTargetProjectInfo(rawProjectSiteId, rawProjectName);
    const projectSiteId = mergedTarget ? (mergedTarget.id || rawProjectSiteId) : rawProjectSiteId;
    const projectName = mergedTarget ? (mergedTarget.name || rawProjectName) : rawProjectName;

    const prodGroupName = (r['PRD_GROUP_NAME'] || r['prd_group_name'] || r['MATERIALNAME'] || '-').trim();
    const monthVal = String(r['Months'] || r['months'] || '-').trim();
    const yearVal = String(r['Years'] || r['years'] || '-').trim();

    // ดึงค่ายอด Actual จากช่อง AL (Actual_RUNIT) แทนช่อง AB (Actual)
    const rawActualRUNIT = r['Actual_RUNIT'] !== undefined ? r['Actual_RUNIT'] : (r['actual_runit'] !== undefined ? r['actual_runit'] : r['ACTUAL_RUNIT']);
    let actualVal = 0;
    if (rawActualRUNIT !== undefined && rawActualRUNIT !== null && String(rawActualRUNIT).trim() !== '') {
      actualVal = parseNum(rawActualRUNIT);
    } else {
      actualVal = parseNum(r['Actual'] || r['actual']);
    }

    // ดึงชื่อหน่วยจากช่อง AM (Report_Unit) หรือ Sales_Unit
    const runitVal = (
      r['Report_Unit'] || 
      r['report_unit'] || 
      r['REPORT_UNIT'] || 
      r['Sales_Unit'] || 
      r['sales_unit'] || 
      r['Actual_RUNIT_NAME'] || 
      '-'
    ).trim();

    const netAmountVal = parseNum(r['NetAmount'] || r['netamount']);
    const periodStr = `${monthVal}/${yearVal}`;

    matchedDealerList.push({
      dealerId: dealerId,
      dealerName: dealerName,
      projectId: projectSiteId,
      projectName: projectName,
      origProjectId: rawProjectSiteId,
      origProjectName: rawProjectName,
      productGroup: prodGroupName,
      period: periodStr,
      month: monthVal,
      year: yearVal,
      actual: actualVal,
      runit: runitVal,
      netAmount: netAmountVal
    });

    if (yearVal !== '-' && yearVal !== '') {
      yearOptionsSet.add(yearVal);
    }
    if (monthVal !== '-' && monthVal !== '') {
      monthOptionsSet.add(monthVal);
    }
  });

  const dealerYearSelect = document.getElementById('dealerYearFilter');
  if (dealerYearSelect) {
    let yrOptions = '<option value="all">ปีทั้งหมด</option>';
    Array.from(yearOptionsSet).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).forEach(y => {
      yrOptions += `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`;
    });
    dealerYearSelect.innerHTML = yrOptions;
  }

  const thaiMonthNames = [
    'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
    'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'
  ];
  function getMonthOrder(m) {
    const num = parseInt(m, 10);
    if (!isNaN(num)) return num;
    const idx = thaiMonthNames.findIndex(name => m.includes(name.replace('.', '')));
    return idx !== -1 ? idx + 1 : 99;
  }

  const dealerMonthSelect = document.getElementById('dealerMonthFilter');
  if (dealerMonthSelect) {
    let moOptions = '<option value="all">เดือนทั้งหมด</option>';
    Array.from(monthOptionsSet).sort((a, b) => getMonthOrder(a) - getMonthOrder(b)).forEach(m => {
      const mNum = parseInt(m, 10);
      const label = (!isNaN(mNum) && mNum >= 1 && mNum <= 12) ? `${thaiMonthNames[mNum - 1]} (${m})` : m;
      moOptions += `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
    });
    dealerMonthSelect.innerHTML = moOptions;
  }

  const elMatchSummary = document.getElementById('dealerMatchSummary');
  if (elMatchSummary) {
    elMatchSummary.textContent = `จับคู่ตรงกับไฟล์ยอดขายได้ ${matchedDealerList.length.toLocaleString()} แถว (ตัดรายการที่ไม่ตรงออกเรียบร้อยแล้ว)`;
  }
  renderDealerTable();
  initDealerComparisonControls();

  if (typeof updateKpiSummary === 'function') {
    updateKpiSummary();
  }
}

function renderDealerTable() {
  const tbody = document.getElementById('dealerTableBody');
  if (!tbody) return;
  const searchTerm = (document.getElementById('dealerSearchInput')?.value || '').toLowerCase().trim();
  const selectedYear = document.getElementById('dealerYearFilter')?.value || 'all';
  const selectedMonth = document.getElementById('dealerMonthFilter')?.value || 'all';

  const filtered = matchedDealerList.filter(item => {
    if (selectedMasterProject !== 'all') {
      const matchProj = item.projectId === selectedMasterProject || item.projectName === selectedMasterProject;
      if (!matchProj) return false;
    }
    if (selectedYear !== 'all' && item.year !== selectedYear) return false;
    if (selectedMonth !== 'all' && item.month !== selectedMonth) return false;
    if (searchTerm) {
      const match = item.dealerName.toLowerCase().includes(searchTerm) ||
                    item.dealerId.toLowerCase().includes(searchTerm) ||
                    item.projectId.toLowerCase().includes(searchTerm) ||
                    item.projectName.toLowerCase().includes(searchTerm) ||
                    item.productGroup.toLowerCase().includes(searchTerm);
      if (!match) return false;
    }
    return true;
  });

  let sumActual = 0;
  let sumNetAmount = 0;
  filtered.forEach(it => {
    sumActual += it.actual;
    sumNetAmount += it.netAmount;
  });

  const elMatchedCount = document.getElementById('dealerMatchedCount');
  if (elMatchedCount) elMatchedCount.textContent = `${filtered.length.toLocaleString()} รายการ`;
  const elTotalActualQty = document.getElementById('dealerTotalActualQty');
  if (elTotalActualQty) elTotalActualQty.textContent = formatNumber(sumActual);
  const elTotalNetAmount = document.getElementById('dealerTotalNetAmount');
  if (elTotalNetAmount) elTotalNetAmount.textContent = `${formatNumber(sumNetAmount)} บาท`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-slate-400">ไม่พบรายการยอดขาย Dealer ตามเงื่อนไขและตัวกรองที่เลือก</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(item => `
    <tr class="hover:bg-emerald-50/40 transition-colors">
      <td class="py-2.5 px-3">
        <div class="font-semibold text-slate-800">${escapeHtml(item.dealerName)}</div>
        <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(item.dealerId)}</div>
      </td>
      <td class="py-2.5 px-3 font-mono font-bold text-indigo-700">${escapeHtml(item.projectId)}</td>
      <td class="py-2.5 px-3 font-medium text-slate-800 max-w-xs truncate" title="${escapeHtml(item.projectName)}">${escapeHtml(item.projectName)}</td>
      <td class="py-2.5 px-3 text-slate-600">${escapeHtml(item.productGroup)}</td>
      <td class="py-2.5 px-2 text-center font-mono text-slate-500">${escapeHtml(item.period)}</td>
      <td class="py-2.5 px-3 text-right font-mono text-slate-700 font-medium">${formatNumber(item.actual)}</td>
      <td class="py-2.5 px-3 text-center font-mono text-slate-500 bg-slate-50/60 rounded">${escapeHtml(item.runit)}</td>
      <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">${formatNumber(item.netAmount)}</td>
    </tr>
  `).join('');
}

function exportDealerToExcel() {
  const selectedYear = document.getElementById('dealerYearFilter')?.value || 'all';
  const selectedMonth = document.getElementById('dealerMonthFilter')?.value || 'all';
  const searchTerm = (document.getElementById('dealerSearchInput')?.value || '').toLowerCase().trim();

  const filtered = matchedDealerList.filter(item => {
    if (selectedMasterProject !== 'all') {
      const matchProj = item.projectId === selectedMasterProject || item.projectName === selectedMasterProject;
      if (!matchProj) return false;
    }
    if (selectedYear !== 'all' && item.year !== selectedYear) return false;
    if (selectedMonth !== 'all' && item.month !== selectedMonth) return false;
    if (searchTerm) {
      const match = item.dealerName.toLowerCase().includes(searchTerm) ||
                    item.dealerId.toLowerCase().includes(searchTerm) ||
                    item.projectId.toLowerCase().includes(searchTerm) ||
                    item.projectName.toLowerCase().includes(searchTerm) ||
                    item.productGroup.toLowerCase().includes(searchTerm);
      if (!match) return false;
    }
    return true;
  });

  if (!filtered || filtered.length === 0) {
    alert('ไม่มีข้อมูล Dealer ตามเงื่อนไขสำหรับ Export');
    return;
  }

  const data = filtered.map(item => ({
    "Dealer ID": item.dealerId,
    "Dealer Name": item.dealerName,
    "BP_PROJECT_SITE (ตรงกับไฟล์แรก)": item.projectId,
    "ชื่อโครงการ": item.projectName,
    "กลุ่มสินค้า": item.productGroup,
    "งวด (เดือน/ปี)": item.period,
    "ปริมาณขายจริง (Actual)": item.actual,
    "หน่วย (Report_Unit)": item.runit,
    "ยอดขายสุทธิ (NetAmount บาท)": item.netAmount
  }));
  downloadExcel(data, 'Dealer_Actual_Sales_Matched_Only', 'Dealer_Sales');
}

function initDealerComparisonControls() {
  if (selectedDealerCompProducts.size === 0) {
    selectedDealerCompProducts = new Set(allForecastProductGroups);
  }

  const sMonth = document.getElementById('dealerCompStartMonthSelect');
  const eMonth = document.getElementById('dealerCompEndMonthSelect');
  if (sMonth && eMonth && allMonthHeadersGlobal.length > 0) {
    const currentStartVal = sMonth.value;
    const currentEndVal = eMonth.value;

    const opts = allMonthHeadersGlobal.map((m, idx) => `<option value="${idx}">${escapeHtml(m.monthYear)}</option>`).join('');
    sMonth.innerHTML = opts;
    eMonth.innerHTML = opts;

    if (currentStartVal !== '' && sMonth.querySelector(`option[value="${currentStartVal}"]`)) {
      sMonth.value = currentStartVal;
    } else {
      sMonth.value = "0";
    }

    if (currentEndVal !== '' && eMonth.querySelector(`option[value="${currentEndVal}"]`)) {
      eMonth.value = currentEndVal;
    } else {
      eMonth.value = String(allMonthHeadersGlobal.length - 1);
    }
  }

  renderDealerCompProductCheckboxes();
  updateDealerComparisonCharts();
}

function handleDealerCompMonthRangeChange(e) {
  const sMonth = document.getElementById('dealerCompStartMonthSelect');
  const eMonth = document.getElementById('dealerCompEndMonthSelect');
  if (!sMonth || !eMonth) return;
  let startIdx = parseInt(sMonth.value, 10);
  let endIdx = parseInt(eMonth.value, 10);
  if (startIdx > endIdx) {
    if (e.target.id === 'dealerCompStartMonthSelect') {
      endIdx = startIdx;
      eMonth.value = String(endIdx);
    } else {
      startIdx = endIdx;
      sMonth.value = String(startIdx);
    }
  }
  updateDealerComparisonCharts();
}

function renderDealerCompProductCheckboxes() {
  const elList = document.getElementById('dealerCompProductCheckboxList');
  if (!elList) return;
  if (!allForecastProductGroups || allForecastProductGroups.length === 0) {
    elList.innerHTML = `<div class="text-slate-400 py-1 text-center">ไม่พบกลุ่มสินค้า</div>`;
    return;
  }
  elList.innerHTML = allForecastProductGroups.map(p => {
    const isChecked = selectedDealerCompProducts.has(p);
    const jsVal = escapeJsString(p);
    return `
      <label class="flex items-center gap-2 hover:bg-slate-50 p-1 rounded cursor-pointer transition-colors">
        <input type="checkbox" value="${escapeHtml(p)}" ${isChecked ? 'checked' : ''} onchange="toggleDealerCompProduct('${jsVal}')"
               class="rounded text-emerald-600 focus:ring-emerald-500 w-3.5 h-3.5">
        <span class="truncate flex-1" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
      </label>
    `;
  }).join('');
  updateDealerCompProductDropdownLabel();
}

function toggleDealerCompProduct(prodName) {
  if (selectedDealerCompProducts.has(prodName)) {
    selectedDealerCompProducts.delete(prodName);
  } else {
    selectedDealerCompProducts.add(prodName);
  }
  updateDealerCompProductDropdownLabel();
  updateDealerComparisonCharts();
}

function selectAllDealerCompProducts(shouldSelectAll) {
  if (shouldSelectAll) {
    selectedDealerCompProducts = new Set(allForecastProductGroups);
  } else {
    selectedDealerCompProducts.clear();
  }
  renderDealerCompProductCheckboxes();
  updateDealerComparisonCharts();
}

function updateDealerCompProductDropdownLabel() {
  const label = document.getElementById('dealerCompProductDropdownLabel');
  if (!label) return;
  const count = selectedDealerCompProducts.size;
  const total = allForecastProductGroups.length;
  if (count === total) {
    label.textContent = 'เลือกกลุ่มสินค้าทั้งหมด';
  } else if (count === 0) {
    label.textContent = 'ไม่ได้เลือกกลุ่มสินค้า (0)';
  } else {
    label.textContent = `เลือก ${count} จาก ${total} สินค้า`;
  }
}

function getDealerItemMonthHeaderIndex(item, targetMonthHeaders) {
  let mNum = parseInt(item.month, 10);
  if (isNaN(mNum)) {
    const thaiMonthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const idx = thaiMonthNames.findIndex(name => item.month.includes(name.replace('.', '')));
    if (idx !== -1) mNum = idx + 1;
  }
  let yNum = parseInt(item.year, 10);
  if (!isNaN(yNum)) {
    yNum = normalizeYear(yNum);
  }
  if (isNaN(mNum) || isNaN(yNum)) return -1;
  const mIdx0 = mNum - 1;

  return targetMonthHeaders.findIndex(h => h.parsedDate && h.parsedDate.year === yNum && h.parsedDate.month === mIdx0);
}

function updateDealerComparisonCharts() {
  if (!parsedDataRowsGlobal || parsedDataRowsGlobal.length === 0) return;
  const unitSuffix = getUnitSuffix();

  const sMonth = document.getElementById('dealerCompStartMonthSelect');
  const eMonth = document.getElementById('dealerCompEndMonthSelect');
  let startIdx = 0;
  let endIdx = allMonthHeadersGlobal.length - 1;

  if (sMonth && eMonth) {
    startIdx = parseInt(sMonth.value, 10) || 0;
    endIdx = parseInt(eMonth.value, 10) || (allMonthHeadersGlobal.length - 1);
  }

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

    if (selectedMasterProject !== 'all') {
      if (projectKey !== selectedMasterProject && projectCode !== selectedMasterProject && projectName !== selectedMasterProject) return;
    }
    if (!selectedDealerCompProducts.has(productGroup)) return;

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

  matchedDealerList.forEach(item => {
    const projectKey = item.projectId;
    const productGroup = item.productGroup;

    if (selectedMasterProject !== 'all') {
      if (item.projectId !== selectedMasterProject && item.projectName !== selectedMasterProject) return;
    }
    if (!selectedDealerCompProducts.has(productGroup)) return;

    const matchedMIdx = getDealerItemMonthHeaderIndex(item, selectedMonthHeaders);
    if (matchedMIdx === -1) return;

    const actVal = displayMode === 'baht' ? item.netAmount : item.actual;

    monthlyDealerActArr[matchedMIdx] += actVal;
    projectDealerActMap[projectKey] = (projectDealerActMap[projectKey] || 0) + actVal;
    productDealerActMap[productGroup] = (productDealerActMap[productGroup] || 0) + actVal;
  });

  // กราฟ 1: Ropp vs Dealer Actual แต่ละเดือน
  const canvasMonthlyComp = document.getElementById('dealerCompMonthlyChart');
  if (canvasMonthlyComp) {
    const ctxMonthlyComp = canvasMonthlyComp.getContext('2d');
    if (chartDealerCompMonthlyInstance) chartDealerCompMonthlyInstance.destroy();
    chartDealerCompMonthlyInstance = new Chart(ctxMonthlyComp, {
      type: 'bar',
      data: {
        labels: selectedMonthHeaders.map(m => m.monthYear),
        datasets: [
          {
            label: `โอกาส (Ropp - ${unitSuffix})`,
            data: monthlyRoppArr,
            backgroundColor: '#60a5fa',
            borderRadius: 4
          },
          {
            label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`,
            data: monthlyDealerActArr,
            backgroundColor: '#059669',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Prompt' } } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} ${unitSuffix}`
            }
          }
        },
        scales: {
          x: { stacked: false, ticks: { font: { family: 'Prompt', size: 11 } } },
          y: { stacked: false, ticks: { font: { family: 'Prompt' }, callback: (v) => v.toLocaleString() } }
        }
      }
    });
  }

  // กราฟ 2: Top โครงการ
  const allCompProjectKeys = new Set([...Object.keys(projectRoppMap), ...Object.keys(projectDealerActMap)]);
  const projectCompList = Array.from(allCompProjectKeys).map(key => {
    const roppData = projectRoppMap[key] || { name: key, code: key, ropp: 0 };
    const dealerAct = projectDealerActMap[key] || 0;
    return {
      key: key,
      name: roppData.name || key,
      code: roppData.code || key,
      ropp: roppData.ropp,
      dealerAct: dealerAct,
      total: roppData.ropp + dealerAct
    };
  }).sort((a, b) => b.total - a.total).slice(0, 10);

  const canvasProjComp = document.getElementById('dealerCompProjectChart');
  if (canvasProjComp) {
    const ctxProjComp = canvasProjComp.getContext('2d');
    if (chartDealerCompProjectInstance) chartDealerCompProjectInstance.destroy();
    chartDealerCompProjectInstance = new Chart(ctxProjComp, {
      type: 'bar',
      data: {
        labels: projectCompList.map(p => p.name.length > 15 ? p.name.slice(0, 15) + '...' : p.name),
        datasets: [
          {
            label: `โอกาส (Ropp - ${unitSuffix})`,
            data: projectCompList.map(p => p.ropp),
            backgroundColor: '#60a5fa',
            borderRadius: 4
          },
          {
            label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`,
            data: projectCompList.map(p => p.dealerAct),
            backgroundColor: '#059669',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Prompt' } } },
          tooltip: {
            callbacks: {
              title: (items) => projectCompList[items[0].dataIndex].name,
              label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} ${unitSuffix}`
            }
          }
        },
        scales: {
          x: { stacked: false, ticks: { font: { family: 'Prompt', size: 10 } } },
          y: { stacked: false, ticks: { font: { family: 'Prompt' }, callback: (v) => v.toLocaleString() } }
        }
      }
    });
  }

  // กราฟ 3: Top กลุ่มสินค้า
  const allCompProductNames = new Set([...Object.keys(productRoppMap), ...Object.keys(productDealerActMap)]);
  const productCompList = Array.from(allCompProductNames).map(prod => {
    const ropp = productRoppMap[prod] || 0;
    const dealerAct = productDealerActMap[prod] || 0;
    return {
      name: prod,
      ropp: ropp,
      dealerAct: dealerAct,
      total: ropp + dealerAct
    };
  }).sort((a, b) => b.total - a.total).slice(0, 10);

  const canvasProdComp = document.getElementById('dealerCompProductChart');
  if (canvasProdComp) {
    const ctxProdComp = canvasProdComp.getContext('2d');
    if (chartDealerCompProductInstance) chartDealerCompProductInstance.destroy();
    chartDealerCompProductInstance = new Chart(ctxProdComp, {
      type: 'bar',
      data: {
        labels: productCompList.map(p => p.name),
        datasets: [
          {
            label: `โอกาส (Ropp - ${unitSuffix})`,
            data: productCompList.map(p => p.ropp),
            backgroundColor: '#60a5fa',
            borderRadius: 4
          },
          {
            label: `ยอดขายจริง Dealer (Actual - ${unitSuffix})`,
            data: productCompList.map(p => p.dealerAct),
            backgroundColor: '#059669',
            borderRadius: 4
          }
        ]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { boxWidth: 12, font: { family: 'Prompt' } } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} ${unitSuffix}`
            }
          }
        },
        scales: {
          x: { stacked: false, ticks: { font: { family: 'Prompt' }, callback: (v) => v.toLocaleString() } },
          y: { stacked: false, ticks: { font: { family: 'Prompt', size: 10 } } }
        }
      }
    });
  }
}
