/**
 * PowerPoint Export Module (pptx-export.js)
 * สร้างไฟล์ PowerPoint (.pptx) ด้วย PptxGenJS แบบ Widescreen 16:9
 * รองรับการส่งออกแยกส่วนระหว่าง "Site Report (รายงานหน้างานและรูปถ่าย)" และ "กราฟวิเคราะห์และ KPI อื่นๆ"
 */

function openPptxExportModal() {
  const modal = document.getElementById('pptxExportModal');
  if (!modal) return;
  updatePptxExportPreviewStats();
  modal.classList.remove('hidden');
}

function closePptxExportModal() {
  const modal = document.getElementById('pptxExportModal');
  if (modal) modal.classList.add('hidden');
}

/**
 * ตรวจสอบจำนวนข้อมูลและกราฟที่พร้อมส่งออกในขณะนั้นเพื่อแสดงใน Modal
 */
async function updatePptxExportPreviewStats() {
  const scopeLabelEl = document.getElementById('pptxScopeProjectLabel');
  const siteCountEl = document.getElementById('pptxPreviewSiteCount');
  const chartCountEl = document.getElementById('pptxPreviewChartCount');

  let projectDisplay = 'โครงการทั้งหมด (All Projects)';
  if (selectedMasterProject !== 'all') {
    const p = projectsMapGlobal[selectedMasterProject];
    projectDisplay = p ? `${p.name} (${p.id || '-'})` : selectedMasterProject;
  }
  if (scopeLabelEl) scopeLabelEl.textContent = projectDisplay;

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
 * ดึงรายการ Site Visit ตาม Master Project Filter และตัวกรองเดือนที่เลือกไว้
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

  if (selectedMasterProject !== 'all') {
    const proj = projectsMapGlobal[selectedMasterProject];
    list = list.filter(item =>
      item.projectId === selectedMasterProject ||
      item.projectName === selectedMasterProject ||
      (proj && (item.projectId === proj.id || item.projectName === proj.name))
    );
  }

  return [...list].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

/**
 * รวบรวมกราฟ Chart.js ทั้งหมดที่มีข้อมูลบนหน้าจอ
 */
function collectAvailableChartConfigs() {
  const unitText = getUnitSuffix();
  const candidates = [
    {
      id: 'dealerCompMonthlyChart',
      instance: typeof chartDealerCompMonthlyInstance !== 'undefined' ? chartDealerCompMonthlyInstance : null,
      title: `Ropp vs Dealer Actual รายเดือน (${unitText})`,
      subtitle: 'เปรียบเทียบยอดโอกาส (Ropp) กับยอดขายจริงผ่านผู้แทนจำหน่าย (Dealer Actual) แยกรายเดือน',
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProjectChart',
      instance: typeof chartDealerCompProjectInstance !== 'undefined' ? chartDealerCompProjectInstance : null,
      title: `Ropp vs Dealer Actual ใน Top โครงการ (${unitText})`,
      subtitle: 'เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer รายโครงการสูงสุด 10 อันดับ',
      category: 'Dealer Analytics'
    },
    {
      id: 'dealerCompProductChart',
      instance: typeof chartDealerCompProductInstance !== 'undefined' ? chartDealerCompProductInstance : null,
      title: `Ropp vs Dealer Actual รายกลุ่มสินค้า (${unitText})`,
      subtitle: 'เปรียบเทียบโอกาสและยอดขายจริงผ่าน Dealer แยกตามกลุ่มสินค้าหลัก',
      category: 'Dealer Analytics'
    },
    {
      id: 'forecastProductChart',
      instance: typeof chartForecastProductInstance !== 'undefined' ? chartForecastProductInstance : null,
      title: `คาดการณ์ยอดขายล่วงหน้า รายกลุ่มสินค้า (${unitText})`,
      subtitle: 'แผนโอกาสขายล่วงหน้า (Sales Forecast - Ropp) แยกตามกลุ่มสินค้า',
      category: 'Sales Forecast'
    },
    {
      id: 'forecastProjectChart',
      instance: typeof chartForecastProjectInstance !== 'undefined' ? chartForecastProjectInstance : null,
      title: `คาดการณ์ยอดขายล่วงหน้า รายโครงการ (${unitText})`,
      subtitle: 'Stacked Bar แสดงสัดส่วนกลุ่มสินค้าที่คาดการณ์ล่วงหน้าในแต่ละโครงการ',
      category: 'Sales Forecast'
    }
  ];

  return candidates.filter(cfg => {
    const canvas = (cfg.instance && cfg.instance.canvas) || document.getElementById(cfg.id);
    if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
    if (cfg.instance && cfg.instance.data && Array.isArray(cfg.instance.data.datasets)) {
      return cfg.instance.data.datasets.length > 0;
    }
    return false;
  });
}

/**
 * แปลง Canvas ของ Chart.js เป็นภาพ PNG พื้นหลังสีขาวคมชัดสำหรับวางในสไลด์
 */
function captureChartCanvasAsWhitePng(chartCfg) {
  const srcCanvas = (chartCfg.instance && chartCfg.instance.canvas) || document.getElementById(chartCfg.id);
  if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) return null;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = srcCanvas.width;
  exportCanvas.height = srcCanvas.height;
  const ctx = exportCanvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  ctx.drawImage(srcCanvas, 0, 0);

  return {
    dataUrl: exportCanvas.toDataURL('image/png'),
    aspectRatio: srcCanvas.width / srcCanvas.height
  };
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
      alert('ไม่พบข้อมูล Site Report ตามตัวกรองที่เลือกสำหรับ Export');
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
    const projSlug = selectedMasterProject !== 'all'
      ? `_${String(selectedMasterProject).replace(/[^a-zA-Z0-9ก-๙_-]/g, '_').slice(0, 25)}`
      : '_All_Projects';

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
  let projLabel = 'โครงการทั้งหมด (All Projects)';
  if (selectedMasterProject !== 'all') {
    const p = projectsMapGlobal[selectedMasterProject];
    projLabel = p ? `${p.name} (${p.id || '-'})` : selectedMasterProject;
  }
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

  // พื้นหลังสีเข้มโทน Indigo / Slate
  slide.background = { color: '1E1B4B' };

  // แถบตกแต่งด้านซ้ายและด้านบน
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.28, h: 7.5,
    fill: { color: '4F46E5' }
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.28, y: 0, w: 0.1, h: 7.5,
    fill: { color: '0EA5E9' }
  });

  // Badge หัวข้อระบบ
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.9, y: 1.1, w: 4.4, h: 0.42,
    fill: { color: '312E81' },
    line: { color: '6366F1', width: 1 }
  });
  slide.addText('SALES & CROSS-SELL ANALYTICS DASHBOARD', {
    x: 0.9, y: 1.1, w: 4.4, h: 0.42,
    fontFace: 'Tahoma', fontSize: 10, bold: true, color: 'A5B4FC', align: 'center', valign: 'middle'
  });

  // ชื่อรายงานหลัก
  slide.addText(mainTitle, {
    x: 0.9, y: 1.85, w: 11.4, h: 1.4,
    fontFace: 'Tahoma', fontSize: 30, bold: true, color: 'FFFFFF', valign: 'top'
  });

  // คำอธิบายรอง
  slide.addText(subTitle, {
    x: 0.9, y: 3.35, w: 11.0, h: 0.7,
    fontFace: 'Tahoma', fontSize: 15, color: 'CBD5E1', valign: 'top'
  });

  // กล่องข้อมูลตัวกรองและวันที่ออกรายงาน
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
// ส่วนที่ 1: สไลด์ KPI และกราฟวิเคราะห์อื่นๆ
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

  // 1. สไลด์สรุป Executive KPI + Top โครงการ
  addKpiSummarySlide(pptx);

  // 2. สไลด์กราฟแต่ละรายการ (1 กราฟต่อ 1 สไลด์ เพื่อความคมชัดสูงสุด)
  charts.forEach(chartCfg => {
    const captured = captureChartCanvasAsWhitePng(chartCfg);
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

    // กรอบสีขาววางกราฟ
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

function addKpiSummarySlide(pptx) {
  const slide = pptx.addSlide();
  const meta = getCurrentFilterMetadataText();
  const unitText = getUnitSuffix();

  addSlideHeaderBar(
    slide,
    pptx,
    'KPI OVERVIEW',
    '4F46E5',
    `สรุปตัวชี้วัดยอดขายและโอกาสทางธุรกิจ (${meta.projLabel})`,
    `ข้อมูล ณ วันที่ ${meta.dateLabel} | หน่วยแสดงผล: ${meta.unitLabel}`
  );

  const kpiRopp = document.getElementById('kpiTotalRopp')?.textContent || '0.00';
  const kpiAct = document.getElementById('kpiTotalAct')?.textContent || '0.00';
  const kpiRate = document.getElementById('kpiRealizeRate')?.textContent || '0%';
  const kpiCross = document.getElementById('kpiCrossSellCount')?.textContent || '0';
  const kpiInactive = document.getElementById('kpiInactiveCount')?.textContent || '0 รายการ';
  const kpiInactiveSub = document.getElementById('kpiInactiveRevenue')?.textContent || '';

  const cards = [
    { label: `มูลค่าโอกาสรวม (${unitText})`, value: kpiRopp, sub: 'Total Ropp', accent: '2563EB', bg: 'EFF6FF' },
    { label: `ยอดขายจริงรวม (${unitText})`, value: kpiAct, sub: 'Dealer Actual', accent: '059669', bg: 'ECFDF5' },
    { label: 'อัตราความสำเร็จ', value: kpiRate, sub: 'Realized Rate', accent: '4F46E5', bg: 'EEF2FF' },
    { label: 'โครงการ Cross-sell', value: `${kpiCross} โครงการ`, sub: 'ซื้อ > 1 กลุ่มสินค้า', accent: 'D97706', bg: 'FFFBEB' },
    { label: 'Actual หาย > 2 เดือน', value: kpiInactive, sub: kpiInactiveSub, accent: 'E11D48', bg: 'FFF1F2' }
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

  // ตาราง Top 8 โครงการตามยอดโอกาส / ยอดขายจริง
  let filteredProjects = (projectList || []).filter(p => {
    if (selectedMasterProject === 'all') return true;
    return p.id === selectedMasterProject || p.name === selectedMasterProject || p.key === selectedMasterProject;
  });

  filteredProjects = [...filteredProjects]
    .sort((a, b) => (b.totalAct - a.totalAct) || (b.totalRopp - a.totalRopp))
    .slice(0, 8);

  slide.addText('สรุปโครงการสำคัญ (Top Projects by Actual & Opportunity)', {
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

  if (filteredProjects.length === 0) {
    tableRows.push([
      { text: '-', options: { align: 'center', color: '64748B' } },
      { text: 'ยังไม่มีข้อมูลโครงการในระบบ', options: { color: '64748B' } },
      { text: '-', options: { color: '64748B' } },
      { text: '0.00', options: { align: 'right', color: '64748B' } },
      { text: '0.00', options: { align: 'right', color: '64748B' } },
      { text: '0.0%', options: { align: 'center', color: '64748B' } }
    ]);
  } else {
    filteredProjects.forEach((p, idx) => {
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

    // ป้ายแสดงระดับความเสี่ยงมุมขวาบน
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

    // ดึงรายการรูปภาพในกล่องรายงานนี้
    const imagesList = (item.images && item.images.length > 0)
      ? item.images
      : (item.imageData ? [{ base64Data: item.imageData, mimeType: item.mimeType || 'image/jpeg' }] : []);

    const hasPhotos = imagesList.length > 0;
    const leftPanelW = hasPhotos ? 6.45 : 12.43;

    // กล่องข้อมูล 4 ส่วนด้านซ้าย (หรือเต็มความกว้างหากไม่มีรูปถ่าย)
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

    // โซนรูปถ่ายหน้างานด้านขวา (สูงสุด 4 รูปต่อสไลด์ เพื่อขนาดที่ชัดเจน)
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
window.executePptxExport = executePptxExport;
