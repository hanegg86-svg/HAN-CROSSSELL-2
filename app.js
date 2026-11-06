/**
 * Sales & Cross-sell Analytics Dashboard - app.js
 * จัดการข้อมูล Ropp vs Act, ผู้แทนจำหน่าย (Dealer), Forecast Matrix,
 * Master Project Filter คุมทุกส่วนในจุดเดียว,
 * กราฟเปรียบเทียบ Ropp vs Dealer Actual แต่ละเดือน,
 * ฐานข้อมูล IndexedDB และระบบ AI Weekly Site Visit (gemini-3.5-flash-lite)
 */

// ==========================================
// 1. IndexedDB Manager (SalesAnalyticsDB)
// ==========================================
const DB_NAME = 'SalesAnalyticsDB';
const DB_VERSION = 1;
let db = null;

function initIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains('settings')) {
        dbInstance.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!dbInstance.objectStoreNames.contains('cached_files')) {
        dbInstance.createObjectStore('cached_files', { keyPath: 'fileType' });
      }
      if (!dbInstance.objectStoreNames.contains('site_visits')) {
        const visitStore = dbInstance.createObjectStore('site_visits', { keyPath: 'id', autoIncrement: true });
        visitStore.createIndex('projectId', 'projectId', { unique: false });
        visitStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => {
      console.error('IndexedDB open error:', e.target.error);
      reject(e.target.error);
    };
  });
}

function dbSave(storeName, data) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(data);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value || req.result : null);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve([]);
    try {
      const tx = db.transaction([storeName], 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

function dbClearStore(storeName) {
  return new Promise((resolve, reject) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction([storeName], 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(e.target.error);
    } catch (err) {
      reject(err);
    }
  });
}

// ==========================================
// 2. Global State & Price Master
// ==========================================
let geminiApiKey = '';
let selectedMasterProject = 'all'; // ตัวกรองโครงการหลักจุดเดียวคุมทั้ง App

let unitPrices = {
  "คอนกรีตผสมเสร็จ (CPAC &FC)": 1859,
  "คอนกรีตผสมเสร็จ": 1859,
  "หลังคา CPAC": 88,
  "SOLUTION-ROOF TRUSS (SCG)": 400,
  "ฝ้า - SMB (<=6mm)": 57,
  "โครงคร่าว - ยิปซั่ม (ตราช้าง)": 12,
  "ฝ-ใน ยิปซั่ม": 48,
  "ฝ-ใน โครงคร่าว": 12,
  "กระเบื้องคอนกรีตปูพื้น - Floor": 316,
  "รั้วสำเร็จรูป - FENCE (Landscape)": 7083,
  "ประตูห้องน้ำ": 1,
  "ครอบ CPAC MONIER": 30,
  "ประตูภายนอก": 1171,
  "ไม้พื้นไวนิล": 1171,
  "ปูนมอร์ตาร์ เทปรับระดับ": 892,
  "ปูนสกิมโค้ด (เสือ)": 4577,
  "Paint (NIPPON)": 2244,
  "DOOR CATEGORY": 1119,
  "อุปกรณ์ประตู (UNIX)": 1352,
  "สีทาภายใน (หน่วยถัง : 5 แกลลอน)": 1,
  "สีรองพื้น (หน่วยถัง : 5 แกลลอน)": 1,
  "กาวซิเมนต์ (SCG)": 3466,
  "DRY TECH": 2962,
  "POST-TENSIONED": 295,
  "ROOF ACCESSORIES": 1318,
  "WIRE MESH": 32000,
  "เสาเข็ม-คาน (CPAC)": 1960,
  "เหล็กเส้นก่อสร้าง": 25000,
  "เหล็กรูปพรรณ SYS": 26400,
  "แป (หลังคา)": 115,
  "แผ่นพื้นสำเร็จรูป (CPAC)": 384,
  "ผนัง - พื้น SMB (>6mm)": 108,
  "ผนังอิฐมวลเบา (Q-CON)": 126,
  "ฝ้า - ยิปซั่ม (ตราช้าง)": 41,
  "ลวดผูกเหล็ก (TOPSTEEL)": 100,
  "หลังคา PRESTIGE": 184,
  "อุปกรณ์ประปา": 21500,
  "ปูนปอร์ตแลนด์ (SCG)": 1881,
  "หลังคา EXCELLA เกล็ดปลา": 125,
  "Paint (BEGER)": 1370,
  "หลังคา NEUSTILE": 391,
  "ครอบ NEUSTILE": 74,
  "ไม้ฝา": 187,
  "ไม้ระแนง (SCG)": 155,
  "ไม้พื้น Smartwood": 626,
  "กระเบื้องโปร่งแสง (SFG)": 299,
  "Solution-ระบบเก็บน้ำใต้ดิน": 20000,
  "ระบบถังเก็บน้ำภายนอก": 20000,
  "METAL SHEET (SCG)": 300,
  "Solution-METAL SHEET (SCG)": 128,
  "หลังคา PROLON": 65,
  "SOLUTION : ROOF INSTALLATION": 800,
  "Lintel (Q-Con)": 652,
  "ปูน Admixed ตราแรด": 2841,
  "WALL PANEL (Q-CON)": 415,
  "แผ่นสะท้อนความร้อนหลังคา (SCG)": 44,
  "ไม้เชิงชาย": 300,
  "ไม้แบบ (Unix)": 919,
  "ครอบ EXCELLA": 157,
  "ครอบ PRESTIGE": 57,
  "ไม้รั้ว (SCG)": 258,
  "ไม้บัว": 290,
  "ไม้มอบ": 241,
  "ไม้ปิดกันนก": 121,
  "ไม้บังตา": 201,
  "ปูนมอร์ตาร์ อื่นๆ": 1389,
  "บล็อกปูถนน": 60,
  "ปูนก่อและฉาบ Q-CON": 250,
  "WOOD ACCESSORIES": 567,
  "White Cement (SCG)": 7657
};

let displayMode = 'baht';
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

// Selected Images for AI Upload
let selectedSiteFiles = [];

// ==========================================
// 3. Utility Functions
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
    elForecastSubtitle.textContent = isBaht
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

// ==========================================
// 4. File Processing & Sales Engine
// ==========================================
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
  applyMasterProjectFilter(); // คำนวณและอัปเดตทุกระบบพร้อมกัน
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
    const projectSiteId = String(r['BP_PROJECT_SITE'] || r['bp_project_site'] || '').trim();
    if (!projectSiteId) return;
    if (validProjectIdsSet.size > 0 && !validProjectIdsSet.has(projectSiteId)) {
      return;
    }
    const dealerName = (r['Dealer_Name'] || r['dealer_name'] || '-').trim();
    const dealerId = (r['Dealer_ID'] || r['dealer_id'] || '-').trim();
    const projectName = (r['BP_PROJECT_SITE_NAME'] || r['bp_project_site_name'] || '-').trim();
    const prodGroupName = (r['PRD_GROUP_NAME'] || r['prd_group_name'] || r['MATERIALNAME'] || '-').trim();
    const monthVal = String(r['Months'] || r['months'] || '-').trim();
    const yearVal = String(r['Years'] || r['years'] || '-').trim();
    const actualVal = parseNum(r['Actual'] || r['actual']);
    const runitVal = (r['Actual_RUNIT'] || r['ACTUAL_RUNIT'] || r['actual_runit'] || r['RUNIT'] || r['runit'] || '-').trim();
    const netAmountVal = parseNum(r['NetAmount'] || r['netamount']);
    const periodStr = `${monthVal}/${yearVal}`;

    matchedDealerList.push({
      dealerId: dealerId,
      dealerName: dealerName,
      projectId: projectSiteId,
      projectName: projectName,
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
}

// ==========================================
// 5. Master Project Filter: All-in-One Link
// ==========================================
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

/**
 * ฟังก์ชันกลาง: เมื่อเลือกโครงการหลักด้านบน จะกระจายคำสั่งอัปเดตทุกโมดูลในคลิกเดียว
 */
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

// ==========================================
// 6. Dealer Table & Excel Export
// ==========================================
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
    "หน่วย (Actual_RUNIT)": item.runit,
    "ยอดขายสุทธิ (NetAmount บาท)": item.netAmount
  }));
  downloadExcel(data, 'Dealer_Actual_Sales_Matched_Only', 'Dealer_Sales');
}

// ==========================================
// 7. Dealer Comparison Controls & Charts
// ==========================================
function initDealerComparisonControls() {
  if (selectedDealerCompProducts.size === 0) {
    selectedDealerCompProducts = new Set(allForecastProductGroups);
  }

  const sMonth = document.getElementById('dealerCompStartMonthSelect');
  const eMonth = document.getElementById('dealerCompEndMonthSelect');
  if (sMonth && eMonth && allMonthHeadersGlobal.length > 0) {
    const opts = allMonthHeadersGlobal.map((m, idx) => `<option value="${idx}">${escapeHtml(m.monthYear)}</option>`).join('');
    sMonth.innerHTML = opts;
    eMonth.innerHTML = opts;
    if (!sMonth.value) sMonth.value = "0";
    if (!eMonth.value) eMonth.value = String(allMonthHeadersGlobal.length - 1);
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

// ==========================================
// 8. Forecast Controls & Matrix Logic
// ==========================================
function initForecastControls() {
  if (!availableForecastMonths || availableForecastMonths.length === 0) return;
  const monthOptionsHtml = availableForecastMonths.map((m, idx) => `<option value="${idx}">${escapeHtml(m.monthYear)}</option>`).join('');

  const fStart = document.getElementById('forecastStartSelect');
  const fEnd = document.getElementById('forecastEndSelect');
  const fSingle = document.getElementById('forecastProjectSingleMonthSelect');
  const mMonth = document.getElementById('matrixMonthSelect');

  if (fStart) fStart.innerHTML = monthOptionsHtml;
  if (fEnd) fEnd.innerHTML = monthOptionsHtml;
  if (fSingle) fSingle.innerHTML = monthOptionsHtml;
  if (mMonth) mMonth.innerHTML = monthOptionsHtml;

  if (fStart) fStart.value = "0";
  const initialEndIdx = Math.min(availableForecastMonths.length - 1, 2);
  if (fEnd) fEnd.value = String(initialEndIdx);
  if (fSingle) fSingle.value = "0";
  if (mMonth) mMonth.value = "0";

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
  elList.innerHTML = allForecastProductGroups.map(p => {
    const isChecked = selectedForecastProducts.has(p);
    const jsVal = escapeJsString(p);
    return `
      <label class="flex items-center gap-2 hover:bg-slate-50 p-1 rounded cursor-pointer transition-colors">
        <input type="checkbox" value="${escapeHtml(p)}" ${isChecked ? 'checked' : ''} onchange="toggleForecastProduct('${jsVal}')"
               class="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5">
        <span class="truncate flex-1" title="${escapeHtml(p)}">${escapeHtml(p)}</span>
      </label>
    `;
  }).join('');
  updateForecastProductDropdownLabel();
}

function toggleForecastProduct(prodName) {
  if (selectedForecastProducts.has(prodName)) {
    selectedForecastProducts.delete(prodName);
  } else {
    selectedForecastProducts.add(prodName);
  }
  updateForecastProductDropdownLabel();
  updateForecastProductChart();
  updateForecastProjectChart();
  updateForecastMatrix();
}

function selectAllForecastProducts(shouldSelectAll) {
  if (shouldSelectAll) {
    selectedForecastProducts = new Set(allForecastProductGroups);
  } else {
    selectedForecastProducts.clear();
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
      const fVal = displayMode === 'baht' ? (fUnit * unitPrice) : fUnit;
      forecastProducts[productGroup][fIdx] += fVal;
    });
  });

  const topForecastProducts = Object.entries(forecastProducts)
    .map(([name, vals]) => ({ name, vals, total: vals.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  const unitSuffix = getUnitSuffix();
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
    const fVal = displayMode === 'baht' ? (fUnit * unitPrice) : fUnit;

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

  const unitSuffix = getUnitSuffix();
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
    const fVal = displayMode === 'baht' ? (fUnit * unitPrice) : fUnit;

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
  const unitSuffix = getUnitSuffix();

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
  const unitSuffix = getUnitSuffix();
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
  downloadExcel(excelData, `Forecast_Matrix_${monthName || 'Month'}_${displayMode}`, 'Matrix');
}

// ==========================================
// 9. Inactive & Project Analysis Tables
// ==========================================
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

// ==========================================
// 10. Modals (Cross-sell, Details, Key, AI, Lightbox)
// ==========================================
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

function openImageLightbox(base64Data, caption) {
  const modal = document.getElementById('imageLightboxModal');
  const img = document.getElementById('lightboxImage');
  const cap = document.getElementById('lightboxCaption');
  if (modal && img) {
    img.src = `data:image/jpeg;base64,${base64Data}`;
    if (cap) cap.textContent = caption || 'รูปถ่ายหน้างาน';
    modal.classList.remove('hidden');
  }
}

function closeImageLightbox() {
  const modal = document.getElementById('imageLightboxModal');
  if (modal) modal.classList.add('hidden');
}

// ==========================================
// 11. Gemini API Key Management
// ==========================================
function openGeminiKeyModal() {
  const modal = document.getElementById('geminiKeyModal');
  const input = document.getElementById('geminiApiKeyInput');
  if (input) input.value = geminiApiKey || '';
  updateApiKeyStatusUI();
  if (modal) modal.classList.remove('hidden');
}

function closeGeminiKeyModal() {
  const modal = document.getElementById('geminiKeyModal');
  if (modal) modal.classList.add('hidden');
}

async function saveGeminiApiKey() {
  const input = document.getElementById('geminiApiKeyInput');
  const val = (input?.value || '').trim();
  if (!val) {
    alert('กรุณากรอก API Key');
    return;
  }
  geminiApiKey = val;
  await dbSave('settings', { key: 'gemini_api_key', value: val });
  updateApiKeyStatusUI();
  closeGeminiKeyModal();
  alert('บันทึก Gemini API Key เรียบร้อยแล้ว');
}

async function deleteGeminiApiKey() {
  if (!confirm('ต้องการลบ Gemini API Key ที่บันทึกไว้ออกจากอุปกรณ์นี้ใช่หรือไม่?')) return;
  geminiApiKey = '';
  await dbDelete('settings', 'gemini_api_key');
  const input = document.getElementById('geminiApiKeyInput');
  if (input) input.value = '';
  updateApiKeyStatusUI();
  alert('ลบ Key เรียบร้อยแล้ว');
}

function updateApiKeyStatusUI() {
  const btnLabel = document.getElementById('apiKeyBtnLabel');
  const statusText = document.getElementById('keyStatusText');
  const hasKey = Boolean(geminiApiKey && geminiApiKey.length > 5);

  if (btnLabel) {
    btnLabel.textContent = hasKey ? '🔑 จัดการ Gemini Key' : '🔑 ตั้งค่า Gemini Key';
  }
  if (statusText) {
    if (hasKey) {
      statusText.textContent = `พร้อมใช้งาน (ลงท้ายด้วย ...${geminiApiKey.slice(-4)})`;
      statusText.className = 'font-bold text-emerald-600';
    } else {
      statusText.textContent = 'ยังไม่ได้ระบุ';
      statusText.className = 'font-bold text-amber-600';
    }
  }
}

// ==========================================
// 12. AI Weekly Site Visit Logic
// ==========================================
function openSiteVisitModal() {
  if (!geminiApiKey) {
    alert('กรุณาตั้งค่า Gemini API Key ก่อนใช้งานระบบอ่านรูปภาพ AI');
    openGeminiKeyModal();
    return;
  }
  populateMasterProjectSelect();
  const modal = document.getElementById('siteVisitModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSiteVisitModal() {
  const modal = document.getElementById('siteVisitModal');
  if (modal) modal.classList.add('hidden');
}

function handleSiteVisitFilesSelected(files) {
  if (!files || files.length === 0) return;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.type.startsWith('image/')) {
      selectedSiteFiles.push(f);
    }
  }
  renderSiteImagesThumbnails();
}

function renderSiteImagesThumbnails() {
  const container = document.getElementById('selectedImagesPreviewContainer');
  const grid = document.getElementById('siteImagesThumbnailGrid');
  const countEl = document.getElementById('selectedImagesCount');
  if (!container || !grid) return;

  if (selectedSiteFiles.length === 0) {
    container.classList.add('hidden');
    grid.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  if (countEl) countEl.textContent = selectedSiteFiles.length;

  grid.innerHTML = selectedSiteFiles.map((f, idx) => {
    const url = URL.createObjectURL(f);
    return `
      <div class="thumbnail-preview">
        <img src="${url}" alt="preview">
        <button type="button" class="remove-btn" onclick="removeSelectedSiteImage(${idx})">×</button>
      </div>
    `;
  }).join('');
}

function removeSelectedSiteImage(idx) {
  selectedSiteFiles.splice(idx, 1);
  renderSiteImagesThumbnails();
}

function clearSelectedSiteImages() {
  selectedSiteFiles = [];
  renderSiteImagesThumbnails();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      const base64Data = res.split(',')[1];
      resolve({
        mimeType: file.type || 'image/jpeg',
        base64Data: base64Data
      });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

async function processSiteVisitImagesWithAI() {
  if (!geminiApiKey) {
    alert('กรุณาตั้งค่า Gemini API Key ก่อน');
    openGeminiKeyModal();
    return;
  }

  if (selectedSiteFiles.length === 0) {
    alert('กรุณาเลือกรูปภาพอย่างน้อย 1 ภาพ');
    return;
  }

  const selectedTargetKey = document.getElementById('modalSiteProjectSelect')?.value || 'auto';
  const targetProjectObj = allProjectListGlobal.find(p => p.key === selectedTargetKey);

  const progressBar = document.getElementById('aiProcessProgressBar');
  const statusText = document.getElementById('aiProcessStatusText');
  const percentText = document.getElementById('aiProcessPercent');
  const fillBar = document.getElementById('aiProcessProgressFill');
  const startBtn = document.getElementById('startAiAnalysisBtn');

  if (progressBar) progressBar.classList.remove('hidden');
  if (startBtn) startBtn.disabled = true;

  let completedCount = 0;
  const totalCount = selectedSiteFiles.length;

  for (let i = 0; i < selectedSiteFiles.length; i++) {
    const file = selectedSiteFiles[i];
    const currentNum = i + 1;
    if (statusText) statusText.innerHTML = `กำลังอ่านรูปภาพ ${currentNum}/${totalCount} ด้วย gemini-3.5-flash-lite...`;

    try {
      const imgData = await fileToBase64(file);
      const aiResult = await callGeminiFlashLiteVision(imgData, targetProjectObj);
      
      const siteLog = {
        projectId: aiResult.projectId || (targetProjectObj ? targetProjectObj.id : '') || 'Unknown',
        projectName: aiResult.projectName || (targetProjectObj ? targetProjectObj.name : 'ไม่ระบุชื่อโครงการ'),
        contractor: aiResult.contractor || '-',
        visitDate: aiResult.visitDate || new Date().toISOString().slice(0, 10),
        siteProgress: aiResult.siteProgress || '-',
        materialForecast: aiResult.materialForecast || '-',
        issuesAndRisks: aiResult.issuesAndRisks || '-',
        nextWeekActions: aiResult.nextWeekActions || '-',
        riskLevel: aiResult.riskLevel || 'Low',
        imageData: imgData.base64Data,
        mimeType: imgData.mimeType,
        createdAt: new Date().toISOString()
      };

      await dbSave('site_visits', siteLog);
    } catch (err) {
      console.error(`AI analysis failed for image ${currentNum}:`, err);
    }

    completedCount++;
    const pct = Math.round((completedCount / totalCount) * 100);
    if (percentText) percentText.textContent = `${pct}%`;
    if (fillBar) fillBar.style.width = `${pct}%`;
  }

  if (statusText) statusText.textContent = 'วิเคราะห์เสร็จสิ้นครบทุกภาพแล้ว!';
  await loadSiteVisitLogsFromDB();

  setTimeout(() => {
    if (progressBar) progressBar.classList.add('hidden');
    if (startBtn) startBtn.disabled = false;
    clearSelectedSiteImages();
    closeSiteVisitModal();
  }, 600);
}

async function handleDirectSiteVisitUpload(files) {
  if (!files || files.length === 0) return;
  if (!geminiApiKey) {
    alert('กรุณาตั้งค่า Gemini API Key ก่อนใช้งานระบบอ่านรูปภาพ AI');
    openGeminiKeyModal();
    return;
  }
  selectedSiteFiles = [];
  handleSiteVisitFilesSelected(files);
  openSiteVisitModal();
}

/**
 * เรียกใช้ Gemini API โดยระบุ Model เป็น gemini-3.5-flash-lite
 */
async function callGeminiFlashLiteVision(imgObj, targetProjectObj) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiApiKey}`;

  const promptText = `
คุณเป็นผู้ช่วยวิศวกรและผู้จัดการฝ่ายขาย สรุปข้อมูลรายงานประวัติการเข้าเยี่ยมหน้างาน (Site Visit) จากภาพที่แนบมานี้
โครงการเป้าหมายเบื้องต้น: ${targetProjectObj ? `${targetProjectObj.name} (รหัส: ${targetProjectObj.id})` : 'ระบุจากข้อมูลในภาพ'}

โปรดอ่านข้อความ ปริมาณสินค้า วันที่ และความคืบหน้า แล้วตอบกลับเป็นรูปแบบ JSON บริสุทธิ์ (Pure JSON) เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "projectId": "รหัสโครงการ เช่น P000422560 (ถ้าอ่านได้ ให้ดึงมา ถ้าไม่มีให้ใส่ว่าง)",
  "projectName": "ชื่อโครงการ (เช่น Bangna Mall KM8 หรือ New Chemical Factory Chang-MKS)",
  "contractor": "ชื่อบริษัทผู้รับเหมา (เช่น บ.ซี.อี.เอส. จก.)",
  "visitDate": "วันที่และเวลาเข้าเยี่ยม เช่น 05/11/2026",
  "siteProgress": "สรุปแผนงานและความคืบหน้าหน้างาน และการใช้งานสินค้าปัจจุบันอย่างกระชับ",
  "materialForecast": "สินค้าที่มีแผนเรียกเข้า / แผน Material Forecast สัปดาห์หน้า",
  "issuesAndRisks": "ปัญหาหน้างาน สภาพอากาศ หรือข้อกังวลจากลูกค้า (หากไม่มีให้ระบุว่า หน้างานดำเนินไปตามแผนงานปกติ)",
  "nextWeekActions": "การประสานงานแก้ไข หรือสิ่งที่ต้องติดตามต่อในสัปดาห์หน้า",
  "riskLevel": "Low หรือ Medium หรือ High"
}
ห้ามใส่ข้อความเกริ่นนำหรือคำลงท้ายใดๆ ส่งกลับเฉพาะ JSON String เท่านั้น
`;

  const payload = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: imgObj.mimeType,
              data: imgObj.base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errBody}`);
  }

  const resData = await response.json();
  const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  
  try {
    const cleanJsonStr = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJsonStr);
  } catch (parseErr) {
    console.error('Failed to parse AI JSON:', rawText);
    return {
      projectId: targetProjectObj ? targetProjectObj.id : '',
      projectName: targetProjectObj ? targetProjectObj.name : 'รายงานหน้างาน',
      siteProgress: rawText.slice(0, 200),
      riskLevel: 'Low'
    };
  }
}

async function loadSiteVisitLogsFromDB() {
  siteVisitLogsGlobal = await dbGetAll('site_visits');
  renderWeeklySiteVisitDashboard();
}

function renderWeeklySiteVisitDashboard() {
  const emptyState = document.getElementById('weeklyEmptyState');
  const cardsGrid = document.getElementById('weeklyCardsGrid');

  if (!siteVisitLogsGlobal || siteVisitLogsGlobal.length === 0) {
    if (emptyState) emptyState.classList.remove('hidden');
    if (cardsGrid) cardsGrid.classList.add('hidden');
    return;
  }

  let list = siteVisitLogsGlobal;
  if (selectedMasterProject !== 'all') {
    list = siteVisitLogsGlobal.filter(item => {
      return item.projectId === selectedMasterProject || item.projectName === selectedMasterProject;
    });
  }

  if (list.length === 0) {
    if (emptyState) {
      emptyState.classList.remove('hidden');
      emptyState.innerHTML = `
        <span class="text-3xl">🔍</span>
        <p class="text-sm font-semibold text-slate-700 mt-2">ไม่พบประวัติการเข้าเยี่ยมสำหรับโครงการนี้</p>
        <p class="text-xs text-slate-400 mt-0.5">โปรดเลือกโครงการอื่น หรือเพิ่มรูปภาพรายงานใหม่</p>
      `;
    }
    if (cardsGrid) cardsGrid.classList.add('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');
  if (cardsGrid) {
    cardsGrid.classList.remove('hidden');
    list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    cardsGrid.innerHTML = list.map(item => {
      let riskBadgeClass = 'risk-badge-low';
      let riskText = 'ปกติ (Low Risk)';
      if (item.riskLevel === 'High') {
        riskBadgeClass = 'risk-badge-high';
        riskText = 'วิกฤต (High Risk)';
      } else if (item.riskLevel === 'Medium') {
        riskBadgeClass = 'risk-badge-medium';
        riskText = 'เฝ้าระวัง (Medium Risk)';
      }

      let photoStripHtml = '';
      if (item.imageData) {
        const jsBase64 = escapeJsString(item.imageData);
        const jsName = escapeJsString(item.projectName);
        photoStripHtml = `
          <div class="mt-2.5 pt-2 border-t border-slate-100">
            <div class="text-[11px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <span>📸</span> ภาพรายงานหน้างาน:
            </div>
            <div class="site-photo-strip">
              <div class="site-photo-thumb" onclick="openImageLightbox('${jsBase64}', '${jsName}')">
                <img src="data:${item.mimeType || 'image/jpeg'};base64,${item.imageData}" alt="Site Photo">
                <span class="zoom-icon">🔍 ซูม</span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4 hover:border-sky-300 transition-colors">
          <div>
            <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="text-base font-bold text-slate-900">${escapeHtml(item.projectName)}</span>
                  ${item.projectId && item.projectId !== '-' ? `<span class="bg-sky-50 text-sky-700 text-[10px] font-mono px-2 py-0.5 rounded font-semibold">${escapeHtml(item.projectId)}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">
                  ผู้รับเหมา: <span class="font-medium text-slate-700">${escapeHtml(item.contractor || '-')}</span> | เข้าเยี่ยม: <span class="font-medium text-slate-700">${escapeHtml(item.visitDate || '-')}</span>
                </div>
              </div>
              <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${riskBadgeClass} whitespace-nowrap">
                ${riskText}
              </span>
            </div>

            <div class="mt-3 space-y-2.5 text-xs">
              <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                <div class="font-bold text-slate-700 flex items-center gap-1.5 mb-1">
                  <span>🏗️</span> ความคืบหน้า & การใช้งานสินค้า:
                </div>
                <p class="text-slate-600 leading-relaxed whitespace-pre-line">${escapeHtml(item.siteProgress || '-')}</p>
              </div>

              <div class="bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-100/60">
                <div class="font-bold text-indigo-900 flex items-center gap-1.5 mb-1">
                  <span>🚚</span> แผนเรียกสินค้า (Material Forecast):
                </div>
                <p class="text-indigo-950 leading-relaxed whitespace-pre-line">${escapeHtml(item.materialForecast || '-')}</p>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div class="bg-rose-50/40 p-2.5 rounded-lg border border-rose-100">
                  <div class="font-bold text-rose-800 flex items-center gap-1.5 mb-1">
                    <span>⚠️</span> ปัญหา/ความเสี่ยง:
                  </div>
                  <p class="text-rose-900 leading-relaxed whitespace-pre-line">${escapeHtml(item.issuesAndRisks || '-')}</p>
                </div>

                <div class="bg-emerald-50/40 p-2.5 rounded-lg border border-emerald-100">
                  <div class="font-bold text-emerald-800 flex items-center gap-1.5 mb-1">
                    <span>📋</span> สิ่งที่ต้องติดตามสัปดาห์หน้า:
                  </div>
                  <p class="text-emerald-950 leading-relaxed whitespace-pre-line">${escapeHtml(item.nextWeekActions || '-')}</p>
                </div>
              </div>

              ${photoStripHtml}
            </div>
          </div>

          <div class="pt-2 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-400">
            <span>บันทึกเมื่อ: ${new Date(item.createdAt).toLocaleString('th-TH')}</span>
            <button onclick="copySingleProjectSummary(${item.id})" class="text-sky-600 hover:text-sky-800 hover:underline font-semibold flex items-center gap-1">
              <span>📋</span> คัดลอกโครงการนี้
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
}

function copyWeeklySummaryText() {
  if (!siteVisitLogsGlobal || siteVisitLogsGlobal.length === 0) {
    alert('ไม่มีข้อมูลสรุปหน้างานสำหรับคัดลอก');
    return;
  }

  let list = siteVisitLogsGlobal;
  if (selectedMasterProject !== 'all') {
    list = siteVisitLogsGlobal.filter(i => i.projectId === selectedMasterProject || i.projectName === selectedMasterProject);
  }

  let text = `📢 สรุปรายงานหน้างานและแผนสินค้าประจำสัปดาห์\n---------------------------------------\n`;
  list.forEach((item, idx) => {
    text += `\n[${idx + 1}] โครงการ: ${item.projectName} (${item.projectId || '-'})\n`;
    text += `👤 ผรม.: ${item.contractor || '-'}\n`;
    text += `📅 วันที่เข้าเยี่ยม: ${item.visitDate || '-'}\n`;
    text += `🏗️ ความคืบหน้า: ${item.siteProgress || '-'}\n`;
    text += `🚚 แผนเรียกสินค้า: ${item.materialForecast || '-'}\n`;
    text += `⚠️ ปัญหา/ข้อกังวล: ${item.issuesAndRisks || '-'}\n`;
    text += `📋 Action สัปดาห์หน้า: ${item.nextWeekActions || '-'}\n`;
    text += `---------------------------------------\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    alert('คัดลอกข้อความสรุปรายสัปดาห์เรียบร้อยแล้ว สามารถนำไปวางใน LINE หรืออีเมลได้ทันที');
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}

function copySingleProjectSummary(id) {
  const item = siteVisitLogsGlobal.find(i => i.id === id);
  if (!item) return;

  let text = `📢 รายงานความคืบหน้าหน้างาน: ${item.projectName} (${item.projectId || '-'})\n`;
  text += `👤 ผรม.: ${item.contractor || '-'}\n`;
  text += `📅 วันที่เข้าเยี่ยม: ${item.visitDate || '-'}\n`;
  text += `🏗️ ความคืบหน้า: ${item.siteProgress || '-'}\n`;
  text += `🚚 แผนเรียกสินค้า: ${item.materialForecast || '-'}\n`;
  text += `⚠️ ปัญหา/ข้อกังวล: ${item.issuesAndRisks || '-'}\n`;
  text += `📋 Action สัปดาห์หน้า: ${item.nextWeekActions || '-'}\n`;

  navigator.clipboard.writeText(text).then(() => {
    alert(`คัดลอกข้อความสรุปโครงการ ${item.projectName} เรียบร้อยแล้ว`);
  });
}

async function clearSiteVisitData() {
  if (!confirm('ต้องการล้างข้อมูลประวัติรายงานหน้างานทั้งหมดใช่หรือไม่?')) return;
  await dbClearStore('site_visits');
  siteVisitLogsGlobal = [];
  renderWeeklySiteVisitDashboard();
  alert('ล้างข้อมูลเรียบร้อยแล้ว');
}

// ==========================================
// 13. Excel Export Helpers
// ==========================================
function downloadExcel(data, fileName, sheetName) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Data');
  XLSX.writeFile(wb, `${fileName}_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
// 14. App Initialization & Event Listeners
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
      handleDirectSiteVisitUpload(e.target.files);
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
      handleDirectSiteVisitUpload(e.dataTransfer.files);
    });
  }

  // Site Visit Drop Zone in Modal
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
  const modals = ['geminiKeyModal', 'siteVisitModal', 'crossSellModal', 'projectModal', 'imageLightboxModal'];
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
