/**
 * Sales Forecast & Cross-tab Matrix (forecast.js)
 * จัดการโมดูลการคาดการณ์ยอดขายล่วงหน้า (Ropp) กราฟสินค้า/โครงการ และตาราง Matrix
 * ปรับปรุง:
 * 1. คงค่าเดือนที่เลือกไว้เดิมเมื่อสลับหน่วยแสดงผล (ไม่ Reset)
 * 2. แยกหน่วยแสดงผลกราฟ Forecast (forecastDisplayMode) และหน่วยแสดงผลตาราง Matrix (matrixDisplayMode) ออกจากกันอย่างอิสระ
 * 3. รองรับตัวกรอง "เฉพาะสินค้าที่เคยเกิด Actual (Dealer)" และสามารถกดติ๊กเพิ่ม/ลดสินค้าอื่นเองได้ใน Dropdown
 */

/**
 * คำนวณรายชื่อกลุ่มสินค้าที่เคยเกิด Actual ในไฟล์ Dealer ตามโครงการที่เลือก
 * และอัปเดตชุดสินค้าที่เลือก (selectedForecastProducts) เมื่อเปิดใช้งานตัวกรองเฉพาะสินค้าที่เคยเกิด Actual
 */
function refreshDealerActualForecastSelection(resetManualOverrides = false) {
  dealerActualProductGroupsSet.clear();

  const proj = selectedMasterProject !== 'all' ? projectsMapGlobal[selectedMasterProject] : null;

  if (Array.isArray(matchedDealerList)) {
    matchedDealerList.forEach(item => {
      if (!item) return;
      if (selectedMasterProject !== 'all') {
        const isMatch = item.projectId === selectedMasterProject ||
                        item.projectName === selectedMasterProject ||
                        (proj && (item.projectId === proj.id || item.projectName === proj.name));
        if (!isMatch) return;
      }

      if ((item.actual > 0 || item.netAmount > 0) && item.productGroup && item.productGroup !== '-') {
        dealerActualProductGroupsSet.add(item.productGroup.trim());
      }
    });
  }

  const badgeEl = document.getElementById('forecastDealerActualCountBadge');
  if (badgeEl) {
    badgeEl.textContent = String(dealerActualProductGroupsSet.size);
  }

  if (resetManualOverrides) {
    manualAddedForecastProducts.clear();
    manualRemovedForecastProducts.clear();
  }

  if (forecastOnlyDealerActual) {
    const nextSelected = new Set();
    allForecastProductGroups.forEach(p => {
      const hasActual = dealerActualProductGroupsSet.has(p);
      if (hasActual && !manualRemovedForecastProducts.has(p)) {
        nextSelected.add(p);
      } else if (!hasActual && manualAddedForecastProducts.has(p)) {
        nextSelected.add(p);
      }
    });
    selectedForecastProducts = nextSelected;
  }

  const hintEl = document.getElementById('forecastDropdownHintText');
  if (hintEl) {
    if (forecastOnlyDealerActual) {
      hintEl.textContent = 'กำลังกรองเฉพาะสินค้าที่มี Actual — สามารถติ๊กเพิ่มสินค้าที่ "ไม่มี Actual" เข้ามาเองได้';
      hintEl.className = 'text-[10px] text-emerald-800 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 font-medium';
    } else {
      hintEl.textContent = 'สามารถติ๊กเพิ่มหรือลดกลุ่มสินค้าที่ต้องการแสดงในกราฟและตารางได้อิสระ';
      hintEl.className = 'text-[10px] text-slate-500 bg-slate-50 px-2 py-1 rounded border border-slate-100';
    }
  }
}

/**
 * จัดการเมื่อผู้ใช้กดติ๊กเปิด/ปิดตัวกรอง "เฉพาะสินค้าที่เคยเกิด Actual (Dealer)"
 */
function handleForecastOnlyDealerActualChange(isChecked) {
  if (isChecked && (!Array.isArray(matchedDealerList) || matchedDealerList.length === 0)) {
    alert('ยังไม่มีข้อมูลยอดขายจากไฟล์ Dealer CSV (กรุณาอัปโหลดไฟล์ Dealer CSV ก่อนใช้งานตัวกรองนี้)');
    const cb = document.getElementById('forecastOnlyDealerActualCheckbox');
    if (cb) cb.checked = false;
    forecastOnlyDealerActual = false;
    return;
  }

  forecastOnlyDealerActual = Boolean(isChecked);
  manualAddedForecastProducts.clear();
  manualRemovedForecastProducts.clear();

  if (forecastOnlyDealerActual) {
    refreshDealerActualForecastSelection(true);
  } else {
    selectedForecastProducts = new Set(allForecastProductGroups);
    refreshDealerActualForecastSelection(true);
  }

  renderForecastProductCheckboxes();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
}

function initForecastControls() {
  if (!availableForecastMonths || availableForecastMonths.length === 0) return;
  const monthOptionsHtml = availableForecastMonths.map((m, idx) => `<option value="${idx}">${escapeHtml(m.monthYear)}</option>`).join('');

  const fStart = document.getElementById('forecastStartSelect');
  const fEnd = document.getElementById('forecastEndSelect');
  const fSingle = document.getElementById('forecastProjectSingleMonthSelect');
  const mMonth = document.getElementById('matrixMonthSelect');
  const fUnitSelect = document.getElementById('forecastUnitDisplayModeSelect');
  const mUnitSelect = document.getElementById('matrixUnitDisplayModeSelect');
  const fOnlyActualCb = document.getElementById('forecastOnlyDealerActualCheckbox');

  if (fUnitSelect) {
    fUnitSelect.value = forecastDisplayMode;
  }
  if (mUnitSelect) {
    mUnitSelect.value = matrixDisplayMode;
  }
  if (fOnlyActualCb) {
    fOnlyActualCb.checked = Boolean(forecastOnlyDealerActual);
  }

  const curFStart = fStart ? fStart.value : null;
  const curFEnd = fEnd ? fEnd.value : null;
  const curFSingle = fSingle ? fSingle.value : null;
  const curMMonth = mMonth ? mMonth.value : null;

  if (fStart) fStart.innerHTML = monthOptionsHtml;
  if (fEnd) fEnd.innerHTML = monthOptionsHtml;
  if (fSingle) fSingle.innerHTML = monthOptionsHtml;
  if (mMonth) mMonth.innerHTML = monthOptionsHtml;

  if (fStart && curFStart !== null && curFStart !== '' && fStart.querySelector(`option[value="${curFStart}"]`)) {
    fStart.value = curFStart;
  } else if (fStart) {
    fStart.value = "0";
  }

  if (fEnd && curFEnd !== null && curFEnd !== '' && fEnd.querySelector(`option[value="${curFEnd}"]`)) {
    fEnd.value = curFEnd;
  } else if (fEnd) {
    const initialEndIdx = Math.min(availableForecastMonths.length - 1, 2);
    fEnd.value = String(initialEndIdx);
  }

  if (fSingle && curFSingle !== null && curFSingle !== '' && fSingle.querySelector(`option[value="${curFSingle}"]`)) {
    fSingle.value = curFSingle;
  } else if (fSingle) {
    fSingle.value = "0";
  }

  if (mMonth && curMMonth !== null && curMMonth !== '' && mMonth.querySelector(`option[value="${curMMonth}"]`)) {
    mMonth.value = curMMonth;
  } else if (mMonth) {
    mMonth.value = "0";
  }

  refreshDealerActualForecastSelection(false);
  renderForecastProductCheckboxes();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
}

function renderForecastProductCheckboxes() {
  const elList = document.getElementById('forecastProductCheckboxList');
  if (!elList) return;
  if (!allForecastProductGroups || allForecastProductGroups.length === 0) {
    elList.innerHTML = `<div class="text-slate-400 py-1">ไม่พบกลุ่มสินค้า</div>`;
    return;
  }

  const hasDealerData = Array.isArray(matchedDealerList) && matchedDealerList.length > 0;

  elList.innerHTML = allForecastProductGroups.map(p => {
    const isChecked = selectedForecastProducts.has(p);
    const hasActual = dealerActualProductGroupsSet.has(p);
    const isManualAdded = forecastOnlyDealerActual && !hasActual && isChecked;
    const jsVal = escapeJsString(p);

    let statusBadgeHtml = '';
    if (isManualAdded) {
      statusBadgeHtml = `<span class="text-[10px] px-1.5 py-0.2 rounded bg-purple-100 text-purple-700 font-semibold shrink-0">เพิ่มเอง</span>`;
    } else if (hasActual) {
      statusBadgeHtml = `<span class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-semibold shrink-0">มี Actual</span>`;
    } else if (hasDealerData) {
      statusBadgeHtml = `<span class="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-400 shrink-0">ไม่มี Actual</span>`;
    }

    return `
      <label class="flex items-center gap-2 hover:bg-slate-50 p-1 rounded cursor-pointer transition-colors">
        <input type="checkbox" value="${escapeHtml(p)}" ${isChecked ? 'checked' : ''} onchange="toggleForecastProduct('${jsVal}')"
               class="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 shrink-0">
        <span class="truncate flex-1 ${isChecked ? 'font-medium text-slate-800' : 'text-slate-500'}" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
        ${statusBadgeHtml}
      </label>
    `;
  }).join('');
  updateForecastProductDropdownLabel();
}

function toggleForecastProduct(prodName) {
  const hasActual = dealerActualProductGroupsSet.has(prodName);

  if (selectedForecastProducts.has(prodName)) {
    selectedForecastProducts.delete(prodName);
    if (forecastOnlyDealerActual) {
      if (hasActual) {
        manualRemovedForecastProducts.add(prodName);
      } else {
        manualAddedForecastProducts.delete(prodName);
      }
    }
  } else {
    selectedForecastProducts.add(prodName);
    if (forecastOnlyDealerActual) {
      if (hasActual) {
        manualRemovedForecastProducts.delete(prodName);
      } else {
        manualAddedForecastProducts.add(prodName);
      }
    }
  }

  renderForecastProductCheckboxes();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
}

function selectAllForecastProducts(shouldSelectAll) {
  if (shouldSelectAll) {
    selectedForecastProducts = new Set(allForecastProductGroups);
    if (forecastOnlyDealerActual) {
      manualRemovedForecastProducts.clear();
      allForecastProductGroups.forEach(p => {
        if (!dealerActualProductGroupsSet.has(p)) {
          manualAddedForecastProducts.add(p);
        }
      });
    }
  } else {
    selectedForecastProducts.clear();
    if (forecastOnlyDealerActual) {
      manualAddedForecastProducts.clear();
      allForecastProductGroups.forEach(p => {
        if (dealerActualProductGroupsSet.has(p)) {
          manualRemovedForecastProducts.add(p);
        }
      });
    }
  }
  renderForecastProductCheckboxes();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
}

function updateForecastProductDropdownLabel() {
  const label = document.getElementById('forecastProductDropdownLabel');
  if (!label) return;
  const count = selectedForecastProducts.size;
  const total = allForecastProductGroups.length;

  if (forecastOnlyDealerActual) {
    const manualAddedCount = Array.from(selectedForecastProducts).filter(p => !dealerActualProductGroupsSet.has(p)).length;
    if (count === 0) {
      label.textContent = 'ไม่ได้เลือกกลุ่มสินค้า (0)';
    } else if (manualAddedCount > 0) {
      label.textContent = `Actual + เพิ่มเอง (${count}/${total})`;
    } else {
      label.textContent = `เฉพาะที่มี Actual (${count}/${total})`;
    }
    return;
  }

  if (count === total) {
    label.textContent = 'เลือกกลุ่มสินค้าทั้งหมด';
  } else if (count === 0) {
    label.textContent = 'ไม่ได้เลือกกลุ่มสินค้า (0)';
  } else {
    label.textContent = `เลือก ${count} จาก ${total} สินค้า`;
  }
}

function handleForecastProductRangeChange(e) {
  const fStart = document.getElementById('forecastStartSelect');
  const fEnd = document.getElementById('forecastEndSelect');
  if (!fStart || !fEnd) return;
  let startIdx = parseInt(fStart.value, 10);
  let endIdx = parseInt(fEnd.value, 10);
  if (e.target.id === 'forecastStartSelect') {
    if (endIdx < startIdx) endIdx = startIdx;
    if (endIdx - startIdx >= 4) endIdx = startIdx + 3;
  } else {
    if (endIdx < startIdx) startIdx = endIdx;
    if (endIdx - startIdx >= 4) startIdx = endIdx - 3;
  }
  fStart.value = String(startIdx);
  fEnd.value = String(endIdx);
  updateForecastProductChart();
}

function updateForecastProductChart() {
  const fStart = document.getElementById('forecastStartSelect');
  const fEnd = document.getElementById('forecastEndSelect');
  if (!fStart || !fEnd || !availableForecastMonths.length) return;
  const startIdx = parseInt(fStart.value, 10);
  const endIdx = parseInt(fEnd.value, 10);
  const selectedMonths = availableForecastMonths.slice(startIdx, endIdx + 1);
  const monthLabels = selectedMonths.map(m => m.monthYear);

  const forecastProducts = {};

  parsedDataRowsGlobal.forEach(row => {
    const projectCode = (row[0] || '').trim();
    const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const projectKey = projectCode || projectName;

    if (selectedMasterProject !== 'all') {
      if (projectKey !== selectedMasterProject && projectCode !== selectedMasterProject && projectName !== selectedMasterProject) return;
    }

    const productGroup = (row[4] || 'อื่นๆ').trim();
    if (!selectedForecastProducts.has(productGroup)) return;

    const unitPrice = getUnitPrice(productGroup);

    if (!forecastProducts[productGroup]) {
      forecastProducts[productGroup] = new Array(selectedMonths.length).fill(0);
    }

    selectedMonths.forEach((fm, fIdx) => {
      const fUnit = parseNum(row[fm.roppCol]);
      const fVal = forecastDisplayMode === 'baht' ? (fUnit * unitPrice) : fUnit;
      forecastProducts[productGroup][fIdx] += fVal;
    });
  });

  const topForecastProducts = Object.entries(forecastProducts)
    .map(([name, vals]) => ({ name, vals, total: vals.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const unitSuffix = getForecastUnitSuffix();
  const productDatasets = topForecastProducts.map(p => ({
    label: p.name,
    data: p.vals,
    backgroundColor: getProductColor(p.name),
    borderRadius: 4
  }));

  const canvasForecastProd = document.getElementById('forecastProductChart');
  if (canvasForecastProd) {
    const ctxForecastProd = canvasForecastProd.getContext('2d');
    if (chartForecastProductInstance) chartForecastProductInstance.destroy();
    chartForecastProductInstance = new Chart(ctxForecastProd, {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: productDatasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Prompt', size: 10 } } },
          tooltip: {
            callbacks: {
              label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} ${unitSuffix}`
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Prompt' } } },
          y: { stacked: true, ticks: { font: { family: 'Prompt', size: 10 }, callback: (v) => v.toLocaleString() } }
        }
      }
    });
  }
}

function updateForecastProjectChart() {
  const fSingle = document.getElementById('forecastProjectSingleMonthSelect');
  if (!fSingle || !availableForecastMonths.length) return;
  const selectedMonthIdx = parseInt(fSingle.value, 10);
  const targetMonth = availableForecastMonths[selectedMonthIdx];
  if (!targetMonth) return;

  const projectTotals = {};
  const projectProductMap = {};
  const allProductGroups = new Set();

  parsedDataRowsGlobal.forEach(row => {
    const projectCode = (row[0] || '').trim();
    const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const projectKey = projectCode || projectName;

    if (selectedMasterProject !== 'all') {
      if (projectKey !== selectedMasterProject && projectCode !== selectedMasterProject && projectName !== selectedMasterProject) return;
    }

    const productGroup = (row[4] || 'อื่นๆ').trim();
    if (!selectedForecastProducts.has(productGroup)) return;

    const unitPrice = getUnitPrice(productGroup);
    const fUnit = parseNum(row[targetMonth.roppCol]);
    const fVal = forecastDisplayMode === 'baht' ? (fUnit * unitPrice) : fUnit;

    if (fVal > 0) {
      projectTotals[projectName] = (projectTotals[projectName] || 0) + fVal;
      if (!projectProductMap[projectName]) projectProductMap[projectName] = {};
      projectProductMap[projectName][productGroup] = (projectProductMap[projectName][productGroup] || 0) + fVal;
      allProductGroups.add(productGroup);
    }
  });

  const topProjects = Object.entries(projectTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(entry => entry[0]);

  const unitSuffix = getForecastUnitSuffix();
  const productList = Array.from(allProductGroups);
  const datasets = productList.map(prod => {
    return {
      label: prod,
      data: topProjects.map(proj => (projectProductMap[proj] && projectProductMap[proj][prod]) || 0),
      backgroundColor: getProductColor(prod),
      borderRadius: 2
    };
  }).filter(ds => ds.data.some(val => val > 0));

  const canvasForecastProj = document.getElementById('forecastProjectChart');
  if (canvasForecastProj) {
    const ctxForecastProj = canvasForecastProj.getContext('2d');
    if (chartForecastProjectInstance) chartForecastProjectInstance.destroy();
    chartForecastProjectInstance = new Chart(ctxForecastProj, {
      type: 'bar',
      data: {
        labels: topProjects.map(p => p.length > 15 ? p.slice(0, 15) + '...' : p),
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { family: 'Prompt', size: 9 } } },
          tooltip: {
            callbacks: {
              title: (items) => topProjects[items[0].dataIndex],
              label: (context) => `${context.dataset.label}: ${formatNumber(context.raw)} ${unitSuffix}`
            }
          }
        },
        scales: {
          x: { stacked: true, ticks: { font: { family: 'Prompt', size: 10 } } },
          y: { stacked: true, ticks: { font: { family: 'Prompt', size: 10 }, callback: (v) => v.toLocaleString() } }
        }
      }
    });
  }
}

function updateForecastMatrix() {
  const mMonth = document.getElementById('matrixMonthSelect');
  if (!mMonth || !availableForecastMonths.length) return;
  const selectedMonthIdx = parseInt(mMonth.value, 10);
  const targetMonth = availableForecastMonths[selectedMonthIdx];
  if (!targetMonth) return;

  const matrix = {};
  const projectTotals = {};
  const productTotals = {};
  const projectMeta = {};
  let grandTotal = 0;

  parsedDataRowsGlobal.forEach(row => {
    const projectCode = (row[0] || '').trim();
    const projectName = (row[1] || row[2] || projectCode || 'ไม่ระบุชื่อโครงการ').trim();
    const projectKey = projectCode || projectName;

    if (selectedMasterProject !== 'all') {
      if (projectKey !== selectedMasterProject && projectCode !== selectedMasterProject && projectName !== selectedMasterProject) return;
    }

    const productGroup = (row[4] || 'อื่นๆ').trim();
    if (!selectedForecastProducts.has(productGroup)) return;

    const unitPrice = getUnitPrice(productGroup);
    const fUnit = parseNum(row[targetMonth.roppCol]);
    // ใช้หน่วยแสดงผลแยกเฉพาะตาราง Matrix (matrixDisplayMode)
    const fVal = matrixDisplayMode === 'baht' ? (fUnit * unitPrice) : fUnit;

    if (!matrix[projectName]) {
      matrix[projectName] = {};
      projectTotals[projectName] = 0;
      projectMeta[projectName] = projectCode;
    }

    if (fVal > 0) {
      matrix[projectName][productGroup] = (matrix[projectName][productGroup] || 0) + fVal;
      projectTotals[projectName] += fVal;
      productTotals[productGroup] = (productTotals[productGroup] || 0) + fVal;
      grandTotal += fVal;
    }
  });

  const activeProducts = Object.entries(productTotals)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);

  const activeProjects = Object.entries(projectTotals)
    .filter(e => e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(e => ({ name: e[0], code: projectMeta[e[0]], total: e[1] }));

  currentMatrixData = {
    monthName: targetMonth.monthYear,
    projects: activeProjects,
    products: activeProducts,
    matrix: matrix,
    projectTotals: projectTotals,
    productTotals: productTotals,
    grandTotal: grandTotal
  };

  renderForecastMatrixTable();
}

function renderForecastMatrixTable() {
  const thead = document.getElementById('matrixTableHead');
  const tbody = document.getElementById('matrixTableBody');
  if (!thead || !tbody) return;
  const searchTerm = (document.getElementById('matrixSearchInput')?.value || '').toLowerCase().trim();

  const { projects, products, matrix, productTotals, grandTotal } = currentMatrixData;
  const unitSuffix = getMatrixUnitSuffix();

  if (!projects || projects.length === 0 || products.length === 0) {
    thead.innerHTML = `<tr><th class="py-3 px-4">โครงการ / สินค้า</th></tr>`;
    tbody.innerHTML = `<tr><td class="py-6 text-center text-slate-400">ไม่พบข้อมูล Forecast ตามโครงการและกลุ่มสินค้าที่เลือกในเดือนนี้</td></tr>`;
    return;
  }

  const filteredProjects = projects.filter(p =>
    p.name.toLowerCase().includes(searchTerm) || (p.code && p.code.toLowerCase().includes(searchTerm))
  );

  thead.innerHTML = `
    <tr>
      <th class="py-3 px-4 bg-slate-100 font-bold sticky left-0 z-20 border-r border-slate-200">ชื่อโครงการ / รหัส</th>
      <th class="py-3 px-3 text-right bg-indigo-50 font-bold text-indigo-950 border-r border-slate-200">ยอดรวม (${unitSuffix})</th>
      ${products.map(prod => `<th class="py-3 px-3 text-right bg-slate-100 font-semibold whitespace-nowrap min-w-[120px]">${escapeHtml(prod)}</th>`).join('')}
    </tr>
  `;

  if (filteredProjects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${products.length + 2}" class="py-6 text-center text-slate-400">ไม่พบข้อมูลโครงการตามคำค้นหา</td></tr>`;
    return;
  }

  let rowsHtml = filteredProjects.map(p => {
    const rowCells = products.map(prod => {
      const val = (matrix[p.name] && matrix[p.name][prod]) || 0;
      return `<td class="py-2.5 px-3 text-right ${val > 0 ? 'font-medium text-slate-800' : 'text-slate-300'}">${val > 0 ? formatNumber(val) : '-'}</td>`;
    }).join('');

    return `
      <tr class="hover:bg-indigo-50/30 transition-colors">
        <td class="py-2.5 px-4 sticky left-0 bg-white hover:bg-indigo-50/30 font-medium text-slate-900 border-r border-slate-100">
          <div>${escapeHtml(p.name)}</div>
          <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(p.code || '-')}</div>
        </td>
        <td class="py-2.5 px-3 text-right font-bold text-indigo-600 bg-indigo-50/20 border-r border-slate-100">
          ${formatNumber(p.total)}
        </td>
        ${rowCells}
      </tr>
    `;
  }).join('');

  const footerCells = products.map(prod => {
    const sumVal = productTotals[prod] || 0;
    return `<td class="py-3 px-3 text-right font-bold text-slate-900">${formatNumber(sumVal)}</td>`;
  }).join('');

  const footerHtml = `
    <tr class="bg-slate-100 font-bold border-t-2 border-slate-300">
      <td class="py-3 px-4 sticky left-0 bg-slate-100 border-r border-slate-300 text-slate-900">รวมทั้งสิ้น</td>
      <td class="py-3 px-3 text-right font-bold text-indigo-700 bg-indigo-100/50 border-r border-slate-300">${formatNumber(grandTotal)}</td>
      ${footerCells}
    </tr>
  `;

  tbody.innerHTML = rowsHtml + footerHtml;
}

function exportForecastMatrixToExcel() {
  const { monthName, projects, products, matrix } = currentMatrixData;
  if (!projects || projects.length === 0) {
    alert('ไม่มีข้อมูลสำหรับ Export');
    return;
  }
  const unitSuffix = getMatrixUnitSuffix();
  const excelData = projects.map(p => {
    const row = {
      "รหัสโครงการ": p.code || '-',
      "ชื่อโครงการ": p.name,
      [`ยอดรวมเดือนนี้ (${unitSuffix})`]: p.total
    };
    products.forEach(prod => {
      row[prod] = (matrix[p.name] && matrix[p.name][prod]) || 0;
    });
    return row;
  });
  downloadExcel(excelData, `Forecast_Matrix_${monthName || 'Month'}_${matrixDisplayMode}`, 'Matrix');
}

window.refreshDealerActualForecastSelection = refreshDealerActualForecastSelection;
window.handleForecastOnlyDealerActualChange = handleForecastOnlyDealerActualChange;
