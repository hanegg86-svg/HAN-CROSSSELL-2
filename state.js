/**
 * Global State & Utilities (state.js)
 * รวมตัวแปร State กลาง, Master ราคาต่อหน่วย (ใช้เฉพาะจากไฟล์ที่อัปโหลด), กฎการรวมโครงการ (เฉพาะ Actual & Site Visit) และฟังก์ชันยูทิลิตี้พื้นฐาน
 */
let geminiApiKey = '';
let selectedMasterProject = 'all'; // ตัวกรองโครงการหลักจุดเดียวคุมทั้ง App
let selectedMasterStartMonthIdx = null; // ดัชนีเดือนเริ่มต้นของตัวกรองช่วงเวลาหลัก (null = 0)
let selectedMasterEndMonthIdx = null;   // ดัชนีเดือนสิ้นสุดของตัวกรองช่วงเวลาหลัก (null = เดือนสุดท้าย)
let projectMergeRules = []; // กฎการรวมโครงการ: [{ mainKey, mainId, mainName, sources: [{ key, id, name }] }]

// ตารางราคาต่อหน่วย (ไม่ฝังราคาในโค้ด ใช้เฉพาะข้อมูลจากไฟล์ราคาต่อหน่วยที่อัปโหลดเท่านั้น)
let unitPrices = {};

let displayMode = 'baht';
let forecastDisplayMode = 'baht'; // หน่วยแสดงผลแยกเฉพาะกราฟ Sales Forecast ('baht' | 'unit')
let matrixDisplayMode = 'baht';   // หน่วยแสดงผลแยกเฉพาะตาราง Matrix คาดการณ์ยอดขาย ('baht' | 'unit')
let forecastOnlyDealerActual = false; // ตัวกรองเฉพาะสินค้าที่เคยเกิด Actual ในไฟล์ Dealer
let dealerActualProductGroupsSet = new Set(); // รายชื่อกลุ่มสินค้าที่เคยมี Actual ในไฟล์ Dealer
let manualAddedForecastProducts = new Set(); // สินค้าที่ไม่มี Actual แต่ผู้ใช้กดเพิ่มเอง
let manualRemovedForecastProducts = new Set(); // สินค้าที่มี Actual แต่ผู้ใช้กดเอาออกเอง

let salesRawRows = null;
let dealerRawRows = null;
let validProjectIdsSet = new Set();
let matchedDealerList = [];
let projectList = [];
let inactiveList = [];
let crossSellProjectsList = [];
let projectsMapGlobal = {};
let currentModalProjectKey = null;
let missingPriceProducts = new Set();
let parsedDataRowsGlobal = [];
let allMonthHeadersGlobal = [];
let availableForecastMonths = [];
let allProjectListGlobal = [];
let allForecastProductGroups = [];
let allDealerCompProductGroups = []; // รวมกลุ่มสินค้าทั้งหมดสำหรับกราฟ Dealer (Col E + Material Name ที่ไม่มี App/Prd Group)
let dealerOnlyActualMaterialNamesSet = new Set(); // รายชื่อสินค้าจาก MATERIALNAME (ช่อง O) ที่แสดงเฉพาะ Actual (ไม่มี Opp)
let siteVisitLogsGlobal = [];

// Filter Sets สำหรับกลุ่มสินค้า
let selectedForecastProducts = new Set();
let selectedDealerCompProducts = new Set();

const globalProductColors = {};
const masterColorPalette = [
  '#f97316', '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899',
  '#8b5cf6', '#3b82f6', '#14b8a6', '#84cc16', '#eab308', '#d946ef',
  '#ef4444', '#0ea5e9', '#64748b', '#a855f7', '#fb923c', '#2dd4bf'
];
let nextColorIndex = 0;

function getProductColor(productName) {
  if (!productName) return '#94a3b8';
  if (!globalProductColors[productName]) {
    globalProductColors[productName] = masterColorPalette[nextColorIndex % masterColorPalette.length];
    nextColorIndex++;
  }
  return globalProductColors[productName];
}

let currentMatrixData = {
  projects: [],
  products: [],
  matrix: {},
  projectTotals: {},
  productTotals: {},
  grandTotal: 0
};

// Chart instances
let chartForecastProductInstance = null;
let chartForecastProjectInstance = null;
let chartDealerCompMonthlyInstance = null;
let chartDealerCompProjectInstance = null;
let chartDealerCompProductInstance = null;

let currentSort = { column: 'act', order: 'desc' };
let currentInactiveSort = { column: 'inactiveMonths', order: 'desc' };

// Selected Images for AI Upload Modal
let selectedSiteFiles = [];

// ==========================================
// Master Period Range Helpers (เชื่อมโยงช่วงเวลาหลักกับกราฟเปรียบเทียบ)
// ==========================================
function getEffectiveMasterMonthRange() {
  const total = Array.isArray(allMonthHeadersGlobal) ? allMonthHeadersGlobal.length : 0;
  if (total === 0) return { startIdx: 0, endIdx: -1, isFullRange: true };

  let s = (selectedMasterStartMonthIdx !== null && selectedMasterStartMonthIdx !== undefined)
    ? parseInt(selectedMasterStartMonthIdx, 10)
    : 0;
  let e = (selectedMasterEndMonthIdx !== null && selectedMasterEndMonthIdx !== undefined)
    ? parseInt(selectedMasterEndMonthIdx, 10)
    : (total - 1);

  if (isNaN(s) || s < 0) s = 0;
  if (s >= total) s = total - 1;
  if (isNaN(e) || e < 0 || e >= total) e = total - 1;
  if (s > e) {
    const tmp = s;
    s = e;
    e = tmp;
  }

  return {
    startIdx: s,
    endIdx: e,
    isFullRange: (s === 0 && e === total - 1)
  };
}

function isDealerItemInMasterMonthRange(item) {
  if (!allMonthHeadersGlobal || allMonthHeadersGlobal.length === 0) return true;
  const { startIdx, endIdx, isFullRange } = getEffectiveMasterMonthRange();
  if (isFullRange) return true;
  if (endIdx < startIdx) return false;

  const targetHeaders = allMonthHeadersGlobal.slice(startIdx, endIdx + 1);
  if (typeof getDealerItemMonthHeaderIndex === 'function') {
    return getDealerItemMonthHeaderIndex(item, targetHeaders) !== -1;
  }

  let mNum = parseInt(item.month, 10);
  if (isNaN(mNum)) {
    const thaiMonthNames = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const idx = thaiMonthNames.findIndex(name => String(item.month || '').includes(name.replace('.', '')));
    if (idx !== -1) mNum = idx + 1;
  }
  let yNum = parseInt(item.year, 10);
  if (!isNaN(yNum)) yNum = normalizeYear(yNum);
  if (isNaN(mNum) || isNaN(yNum)) return false;
  const mIdx0 = mNum - 1;

  return targetHeaders.some(h => h.parsedDate && h.parsedDate.year === yNum && h.parsedDate.month === mIdx0);
}

// ==========================================
// Project Merge Lookup Helpers (Actual & Site Visit Only)
// ==========================================
function getMergedTargetProjectInfo(projectId, projectName, projectKey = '') {
  if (!projectMergeRules || projectMergeRules.length === 0) return null;
  const pId = String(projectId || '').trim();
  const pName = String(projectName || '').trim();
  const pKey = String(projectKey || '').trim();

  for (const rule of projectMergeRules) {
    if (!rule || !Array.isArray(rule.sources)) continue;
    const isMatchedSource = rule.sources.some(src => {
      if (pKey && src.key && src.key === pKey) return true;
      if (pId && src.id && src.id === pId) return true;
      if (pName && src.name && src.name === pName) return true;
      return false;
    });
    if (isMatchedSource) {
      return {
        key: rule.mainKey,
        id: rule.mainId,
        name: rule.mainName
      };
    }
  }
  return null;
}

function getMergedTargetProjectKey(projectKey, projectId = '', projectName = '') {
  const target = getMergedTargetProjectInfo(projectId, projectName, projectKey);
  return target ? target.key : projectKey;
}

// ==========================================
// Utility Functions
// ==========================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function parseNum(val) {
  if (!val) return 0;
  const clean = String(val).replace(/,/g, '').trim();
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : num;
}

function formatNumber(num) {
  return (num || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getUnitSuffix() {
  return displayMode === 'baht' ? 'บาท' : 'Unit';
}

function getForecastUnitSuffix() {
  return forecastDisplayMode === 'baht' ? 'บาท' : 'Unit';
}

function getMatrixUnitSuffix() {
  return matrixDisplayMode === 'baht' ? 'บาท' : 'Unit';
}

function readFileWithEncodingDetection(file, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const buffer = e.target.result;
    const bytes = new Uint8Array(buffer);
    let text = '';
    if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
      text = new TextDecoder('utf-8').decode(buffer);
    } else {
      try {
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        text = utf8Decoder.decode(buffer);
      } catch (err) {
        try {
          const thaiDecoder = new TextDecoder('windows-874');
          text = thaiDecoder.decode(buffer);
        } catch (thaiErr) {
          try {
            const tisDecoder = new TextDecoder('tis-620');
            text = tisDecoder.decode(buffer);
          } catch (finalErr) {
            text = new TextDecoder('utf-8').decode(buffer);
          }
        }
      }
    }
    callback(text);
  };
  reader.readAsArrayBuffer(file);
}

function getUnitPrice(productGroup) {
  if (!productGroup) return 0;
  const name = productGroup.trim();
  if (unitPrices[name] !== undefined) return unitPrices[name];

  const cleanName = name.replace(/[\(\)\[\]\-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  for (const [key, price] of Object.entries(unitPrices)) {
    const cleanKey = key.replace(/[\(\)\[\]\-]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (cleanName === cleanKey) return price;
  }
  for (const [key, price] of Object.entries(unitPrices)) {
    const cleanKey = key.toLowerCase();
    if (cleanName.includes(cleanKey) || cleanKey.includes(cleanName)) {
      return price;
    }
  }
  return 0;
}

function normalizeYear(yNum, isThaiMonth = false) {
  if (yNum < 100) {
    if (isThaiMonth || yNum >= 50) {
      yNum = (2500 + yNum) - 543;
    } else {
      yNum = 2000 + yNum;
    }
  } else if (yNum > 2400) {
    yNum -= 543;
  }
  return yNum;
}

function parseMonthYearDate(str) {
  if (!str) return null;
  const clean = str.trim();
  const monthNames = {
    'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
    'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11,
    'ม.ค': 0, 'ก.พ': 1, 'มี.ค': 2, 'เม.ย': 3, 'พ.ค': 4, 'มิ.ย': 5,
    'ก.ค': 6, 'ส.ค': 7, 'ก.ย': 8, 'ต.ค': 9, 'พ.ย': 10, 'ธ.ค': 11
  };

  const matchText = clean.match(/([a-zA-Z]+|ม\.ค|ก\.พ|มี\.ค|เม\.ย|พ\.ค|มิ\.ย|ก\.ค|ส\.ค|ก\.ย|ต\.ค|พ\.ย|ธ\.ค)[.\s\-_/]*(\d{2,4})/i);
  if (matchText) {
    let rawStr = matchText[1];
    let mStr = rawStr.toLowerCase().slice(0, 3);
    let yNum = parseInt(matchText[2], 10);
    let isThai = /[\u0E00-\u0E7F]/.test(rawStr);
    let mIdx = monthNames[mStr] !== undefined ? monthNames[mStr] : monthNames[rawStr];
    if (mIdx !== undefined) {
      yNum = normalizeYear(yNum, isThai);
      return { year: yNum, month: mIdx, dateObj: new Date(yNum, mIdx, 1) };
    }
  }

  const matchNum1 = clean.match(/(\d{4})[-\s/_](\d{1,2})/);
  if (matchNum1) {
    let yNum = normalizeYear(parseInt(matchNum1[1], 10));
    let mIdx = parseInt(matchNum1[2], 10) - 1;
    return { year: yNum, month: mIdx, dateObj: new Date(yNum, mIdx, 1) };
  }

  const matchNum2 = clean.match(/(\d{1,2})[-\s/_](\d{2,4})/);
  if (matchNum2) {
    let mIdx = parseInt(matchNum2[1], 10) - 1;
    let yNum = normalizeYear(parseInt(matchNum2[2], 10));
    return { year: yNum, month: mIdx, dateObj: new Date(yNum, mIdx, 1) };
  }
  return null;
}

function isDateOrMonthStr(str) {
  return parseMonthYearDate(str) !== null;
}

function downloadExcel(data, fileName, sheetName) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function updateUIUnitLabels() {
  const isBaht = displayMode === 'baht';
  const unitText = isBaht ? 'บาท' : 'Unit';

  const elKpiRopp = document.getElementById('kpiLabelRopp');
  if (elKpiRopp) elKpiRopp.textContent = `มูลค่าโอกาสรวม (${unitText})`;
  const elKpiAct = document.getElementById('kpiLabelAct');
  if (elKpiAct) elKpiAct.textContent = `ยอดขายจริงรวม (${unitText})`;
  const elSubRopp = document.getElementById('kpiSubRopp');
  if (elSubRopp) elSubRopp.textContent = `Total Ropp (${isBaht ? 'แปลงเป็นบาทแล้ว' : 'หน่วยสินค้า'})`;
  const elSubAct = document.getElementById('kpiSubAct');
  if (elSubAct) elSubAct.textContent = `Total Act (${isBaht ? 'แปลงเป็นบาทแล้ว' : 'หน่วยสินค้า'})`;

  const elForecastSubtitle = document.getElementById('forecastSubtitle');
  if (elForecastSubtitle) {
    elForecastSubtitle.textContent = forecastDisplayMode === 'baht'
      ? 'คำนวณจากแผนโอกาสขายล่วงหน้า (Ropp) คูณราคาต่อหน่วย'
      : 'คำนวณจากแผนโอกาสขายล่วงหน้า (Ropp) เป็นปริมาณหน่วยสินค้า';
  }

  const elDealerMonthlyTitle = document.getElementById('chartDealerCompMonthlyTitle');
  if (elDealerMonthlyTitle) elDealerMonthlyTitle.innerHTML = `<span>📈</span> Ropp vs Dealer Actual แต่ละเดือน (${unitText})`;
  const elDealerProjTitle = document.getElementById('chartDealerCompProjectTitle');
  if (elDealerProjTitle) elDealerProjTitle.innerHTML = `<span>🏗️</span> Ropp vs Dealer Actual ใน Top โครงการ (${unitText})`;
  const elDealerProdTitle = document.getElementById('chartDealerCompProductTitle');
  if (elDealerProdTitle) elDealerProdTitle.innerHTML = `<span>📦</span> Ropp vs Dealer Actual รายกลุ่มสินค้า (${unitText})`;

  const elThTopOpp = document.getElementById('thTopOpp');
  if (elThTopOpp) elThTopOpp.textContent = `สินค้าที่มี Opp สูงสุด 3 อันดับ (${unitText})`;
  const elThRopp = document.getElementById('thRopp');
  if (elThRopp) elThRopp.innerHTML = `ยอดโอกาส (${unitText}) <span id="sort-ropp" class="text-slate-400 font-normal">⇅</span>`;
  const elThAct = document.getElementById('thAct');
  if (elThAct) elThAct.innerHTML = `ยอดจริง (${unitText}) <span id="sort-act" class="text-slate-400 font-normal">⇅</span>`;

  const elInactiveLastAct = document.getElementById('inactiveLastActHead');
  if (elInactiveLastAct) elInactiveLastAct.innerHTML = `ยอดซื้อล่าสุด (${unitText}) <span id="sort-inactive-lastActVal" class="text-slate-400 font-normal">⇅</span>`;
  const elInactiveAvgPast = document.getElementById('inactiveAvgPastHead');
  if (elInactiveAvgPast) elInactiveAvgPast.innerHTML = `ยอดเฉลี่ยในอดีต (${unitText}/ด.) <span id="sort-inactive-avgPastAct" class="text-slate-400 font-normal">⇅</span>`;

  const elModalRopp = document.getElementById('modalRoppLabel');
  if (elModalRopp) elModalRopp.textContent = `ยอดโอกาสรวม (Ropp - ${unitText})`;
  const elModalAct = document.getElementById('modalActLabel');
  if (elModalAct) elModalAct.textContent = `ยอดขายจริงรวม (Act - ${unitText})`;
}
