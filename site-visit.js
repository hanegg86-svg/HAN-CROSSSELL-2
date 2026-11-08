/**
 * Site Visit & Photo Management (site-visit.js)
 * จัดการรูปถ่ายหน้างาน (อัปโหลดตรงทันที ไม่ต้องผ่าน AI),
 * รวมภาพชุดวิเคราะห์ AI ด้วยโมเดล gemini-3.5-flash-lite เป็น 1 รายงานเดียว (ไม่แสดงภาพสแกนเอกสาร),
 * ระบบจัดการรูปภาพประจำแต่ละกล่อง (อัปโหลดรูปหน้างาน, เพิ่มรูป, ลบเฉพาะรูป),
 * ระบบแก้ไขข้อความรายงาน (Edit Modal), ลบรายการเฉพาะกล่อง, Lightbox,
 * คัดลอกส่ง LINE และ Export ข้อมูลรายงานหน้างานออกเป็น Excel (.xlsx)
 */

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
// Direct Photo Upload จากแถบด้านบน (ไม่ผ่าน AI)
// ==========================================
async function handleDirectSitePhotoUpload(files) {
  if (!files || files.length === 0) return;

  let targetProjId = '';
  let targetProjName = 'รูปถ่ายหน้างานทั่วไป';

  if (selectedMasterProject !== 'all') {
    const p = projectsMapGlobal[selectedMasterProject];
    if (p) {
      targetProjId = p.id || '';
      targetProjName = p.name || 'ไม่ระบุชื่อโครงการ';
    } else {
      targetProjId = selectedMasterProject;
      targetProjName = selectedMasterProject;
    }
  }

  const currentDateStr = new Date().toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });

  const imgObjs = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      try {
        const imgData = await fileToBase64(file);
        imgObjs.push(imgData);
      } catch (err) {
        console.error('File to base64 error:', err);
      }
    }
  }

  if (imgObjs.length === 0) return;

  const siteLog = {
    projectId: targetProjId,
    projectName: targetProjName,
    contractor: 'บันทึกรูปถ่ายหน้างาน',
    visitDate: currentDateStr,
    siteProgress: `บันทึกรูปถ่ายความคืบหน้าหน้างานจำนวน ${imgObjs.length} ภาพ`,
    materialForecast: '-',
    issuesAndRisks: 'หน้างานดำเนินไปตามแผนงานปกติ',
    nextWeekActions: '-',
    riskLevel: 'Low',
    images: imgObjs.map(img => ({ base64Data: img.base64Data, mimeType: img.mimeType })),
    imageData: imgObjs[0].base64Data,
    mimeType: imgObjs[0].mimeType,
    createdAt: new Date().toISOString()
  };

  await dbSave('site_visits', siteLog);
  await loadSiteVisitLogsFromDB();
}

// ==========================================
// การจัดการรูปภาพประจำแต่ละกล่อง (เพิ่ม / ลบรูป)
// ==========================================

/**
 * เรียกหน้าต่างเลือกไฟล์เพื่ออัปโหลดรูปเข้ากล่องที่กำหนด
 */
function triggerBoxPhotoUpload(visitId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleBoxPhotoUpload(visitId, e.target.files);
    }
  };
  input.click();
}

/**
 * บันทึกรูปภาพที่เลือกลงในการ์ดใบนั้นๆ
 */
async function handleBoxPhotoUpload(visitId, files) {
  const item = siteVisitLogsGlobal.find(i => i.id === visitId);
  if (!item) return;

  if (!item.images) {
    item.images = [];
  }
  if (item.imageData && item.images.length === 0) {
    item.images.push({ base64Data: item.imageData, mimeType: item.mimeType || 'image/jpeg' });
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (file.type.startsWith('image/')) {
      try {
        const imgData = await fileToBase64(file);
        item.images.push({ base64Data: imgData.base64Data, mimeType: imgData.mimeType });
      } catch (err) {
        console.error('Box photo upload error:', err);
      }
    }
  }

  if (item.images.length > 0) {
    item.imageData = item.images[0].base64Data;
    item.mimeType = item.images[0].mimeType;
  }

  await dbSave('site_visits', item);
  await loadSiteVisitLogsFromDB();
}

/**
 * ลบรูปภาพเฉพาะภาพที่เลือกออกจากกล่อง
 */
async function deleteSinglePhotoFromBox(visitId, photoIdx) {
  if (!confirm('ต้องการลบรูปภาพนี้ออกจากกล่องรายงานใช่หรือไม่?')) return;
  const item = siteVisitLogsGlobal.find(i => i.id === visitId);
  if (!item || !item.images) return;

  item.images.splice(photoIdx, 1);
  if (item.images.length > 0) {
    item.imageData = item.images[0].base64Data;
    item.mimeType = item.images[0].mimeType;
  } else {
    item.imageData = '';
    item.mimeType = '';
  }

  await dbSave('site_visits', item);
  await loadSiteVisitLogsFromDB();
}

// ==========================================
// AI Analysis Modal & Execution (gemini-3.5-flash-lite)
// สแกนข้อความหลายภาพรวมเป็น 1 กล่อง (ไม่เก็บรูปเอกสารที่สแกน)
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

/**
 * วิเคราะห์ภาพทั้งหมดพร้อมกันใน 1 คำขอ แล้วบันทึกเป็น 1 กล่องสรุป (ไม่เก็บรูปเอกสารสแกน)
 */
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

  try {
    if (statusText) statusText.textContent = `กำลังแปลงไฟล์รูปภาพ ${selectedSiteFiles.length} รูป...`;
    if (fillBar) fillBar.style.width = '30%';
    if (percentText) percentText.textContent = '30%';

    const imgObjs = [];
    for (let i = 0; i < selectedSiteFiles.length; i++) {
      const imgData = await fileToBase64(selectedSiteFiles[i]);
      imgObjs.push(imgData);
    }

    if (statusText) statusText.textContent = `กำลังวิเคราะห์และสังเคราะห์ข้อมูลด้วย gemini-3.5-flash-lite...`;
    if (fillBar) fillBar.style.width = '65%';
    if (percentText) percentText.textContent = '65%';

    const aiResult = await callGeminiFlashLiteVision(imgObjs, targetProjectObj);

    const currentDateStr = new Date().toLocaleDateString('th-TH', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    const siteLog = {
      projectId: aiResult.projectId || (targetProjectObj ? targetProjectObj.id : '') || 'Unknown',
      projectName: aiResult.projectName || (targetProjectObj ? targetProjectObj.name : 'ไม่ระบุชื่อโครงการ'),
      contractor: aiResult.contractor || '-',
      visitDate: aiResult.visitDate || currentDateStr,
      siteProgress: aiResult.siteProgress || '-',
      materialForecast: aiResult.materialForecast || '-',
      issuesAndRisks: aiResult.issuesAndRisks || '-',
      nextWeekActions: aiResult.nextWeekActions || '-',
      riskLevel: aiResult.riskLevel || 'Low',
      images: [],
      imageData: '',
      mimeType: '',
      createdAt: new Date().toISOString()
    };

    await dbSave('site_visits', siteLog);

    if (fillBar) fillBar.style.width = '100%';
    if (percentText) percentText.textContent = '100%';
    if (statusText) statusText.textContent = 'วิเคราะห์และรวมข้อมูลสรุปเรียบร้อยแล้ว!';

    await loadSiteVisitLogsFromDB();

    setTimeout(() => {
      if (progressBar) progressBar.classList.add('hidden');
      if (startBtn) startBtn.disabled = false;
      clearSelectedSiteImages();
      closeSiteVisitModal();
    }, 600);
  } catch (err) {
    console.error('AI analysis failed:', err);
    alert('เกิดข้อผิดพลาดในการวิเคราะห์ AI: ' + err.message);
    if (progressBar) progressBar.classList.add('hidden');
    if (startBtn) startBtn.disabled = false;
  }
}

/**
 * เรียกใช้ Gemini API โดยระบุ Model เป็น gemini-3.5-flash-lite รองรับ Multi-Image
 */
async function callGeminiFlashLiteVision(imgObjs, targetProjectObj) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${geminiApiKey}`;

  const promptText = `
คุณเป็นผู้ช่วยวิศวกรและผู้จัดการฝ่ายขาย สรุปข้อมูลรายงานประวัติการเข้าเยี่ยมหน้างาน (Site Visit) จากภาพที่แนบมาทั้งหมดนี้ (มีจำนวน ${imgObjs.length} ภาพ อาจประกอบด้วยภาพสภาพหน้างาน ภาพเอกสาร หรือป้ายโครงการ ให้เชื่อมโยงและสังเคราะห์ข้อมูลทั้งหมดเข้าด้วยกันเป็นรายงานเดียว)
โครงการเป้าหมายเบื้องต้น: ${targetProjectObj ? `${targetProjectObj.name} (รหัส: ${targetProjectObj.id})` : 'ระบุจากข้อมูลในภาพ'}

โปรดอ่านข้อความ ปริมาณสินค้า วันที่ และความคืบหน้า แล้วตอบกลับเป็นรูปแบบ JSON บริสุทธิ์ (Pure JSON) เท่านั้น โดยมีโครงสร้างดังนี้:
{
  "projectId": "รหัสโครงการ เช่น P000422560 (ถ้าอ่านได้ให้ดึงมา ถ้าไม่มีให้ใส่ว่าง)",
  "projectName": "ชื่อโครงการ (เช่น Bangna Mall KM8 หรือ New Chemical Factory Chang-MKS)",
  "contractor": "ชื่อบริษัทผู้รับเหมา (เช่น บ.ซี.อี.เอส. จก.)",
  "visitDate": "วันที่และเวลาเข้าเยี่ยม เช่น 05/11/2026",
  "siteProgress": "สรุปแผนงานและความคืบหน้าหน้างาน และการใช้งานสินค้าปัจจุบันอย่างกระชับ สังเคราะห์จากทุกภาพรวมกัน",
  "materialForecast": "สินค้าที่มีแผนเรียกเข้า / แผน Material Forecast สัปดาห์หน้า",
  "issuesAndRisks": "ปัญหาหน้างาน สภาพอากาศ หรือข้อกังวลจากลูกค้า (หากไม่มีให้ระบุว่า หน้างานดำเนินไปตามแผนงานปกติ)",
  "nextWeekActions": "การประสานงานแก้ไข หรือสิ่งที่ต้องติดตามต่อในสัปดาห์หน้า",
  "riskLevel": "Low หรือ Medium หรือ High"
}
ห้ามใส่ข้อความเกริ่นนำหรือคำลงท้ายใดๆ ส่งกลับเฉพาะ JSON String เท่านั้น
`;

  const parts = [{ text: promptText }];
  imgObjs.forEach(img => {
    parts.push({
      inline_data: {
        mime_type: img.mimeType,
        data: img.base64Data
      }
    });
  });

  const payload = {
    contents: [{ parts: parts }],
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

/**
 * ลบรายการการ์ดรายงานหน้างานทั้งกล่อง
 */
async function deleteSingleSiteVisit(id) {
  if (!confirm('ต้องการลบรายการรายงานหน้างานนี้ใช่หรือไม่?')) return;
  await dbDelete('site_visits', id);
  await loadSiteVisitLogsFromDB();
}

// ==========================================
// ระบบแก้ไขข้อความรายงาน (Edit Summary Modal)
// ==========================================
function openEditSiteVisitModal(id) {
  const item = siteVisitLogsGlobal.find(i => i.id === id);
  if (!item) return;

  document.getElementById('editVisitId').value = item.id;
  document.getElementById('editProjectName').value = item.projectName || '';
  document.getElementById('editProjectId').value = item.projectId || '';
  document.getElementById('editContractor').value = item.contractor || '';
  document.getElementById('editVisitDate').value = item.visitDate || '';
  document.getElementById('editRiskLevel').value = item.riskLevel || 'Low';
  document.getElementById('editSiteProgress').value = item.siteProgress || '';
  document.getElementById('editMaterialForecast').value = item.materialForecast || '';
  document.getElementById('editIssuesAndRisks').value = item.issuesAndRisks || '';
  document.getElementById('editNextWeekActions').value = item.nextWeekActions || '';

  const modal = document.getElementById('editSiteVisitModal');
  if (modal) modal.classList.remove('hidden');
}

function closeEditSiteVisitModal() {
  const modal = document.getElementById('editSiteVisitModal');
  if (modal) modal.classList.add('hidden');
}

async function saveEditSiteVisit() {
  const id = parseInt(document.getElementById('editVisitId').value, 10);
  const item = siteVisitLogsGlobal.find(i => i.id === id);
  if (!item) return;

  item.projectName = document.getElementById('editProjectName').value.trim();
  item.projectId = document.getElementById('editProjectId').value.trim();
  item.contractor = document.getElementById('editContractor').value.trim();
  item.visitDate = document.getElementById('editVisitDate').value.trim();
  item.riskLevel = document.getElementById('editRiskLevel').value;
  item.siteProgress = document.getElementById('editSiteProgress').value.trim();
  item.materialForecast = document.getElementById('editMaterialForecast').value.trim();
  item.issuesAndRisks = document.getElementById('editIssuesAndRisks').value.trim();
  item.nextWeekActions = document.getElementById('editNextWeekActions').value.trim();

  await dbSave('site_visits', item);
  await loadSiteVisitLogsFromDB();
  closeEditSiteVisitModal();
}

/**
 * ส่งออกรายงานประวัติการตรวจหน้างาน (Site Visit) เป็นไฟล์ Excel (.xlsx)
 * โดยจะกรองข้อมูลตาม Master Project Filter ปัจจุบันอัตโนมัติ
 */
function exportSiteVisitsToExcel() {
  if (!siteVisitLogsGlobal || siteVisitLogsGlobal.length === 0) {
    alert('ไม่มีข้อมูลรายงานหน้างานสำหรับ Export');
    return;
  }

  let list = siteVisitLogsGlobal;
  if (selectedMasterProject !== 'all') {
    list = siteVisitLogsGlobal.filter(item => {
      return item.projectId === selectedMasterProject || item.projectName === selectedMasterProject;
    });
  }

  if (list.length === 0) {
    alert('ไม่พบข้อมูลรายงานหน้างานสำหรับโครงการที่เลือก');
    return;
  }

  const excelData = list.map(item => {
    const imgCount = (item.images && item.images.length > 0)
      ? item.images.length
      : (item.imageData ? 1 : 0);

    let riskLabel = 'ปกติ (Low Risk)';
    if (item.riskLevel === 'High') riskLabel = 'วิกฤต (High Risk)';
    else if (item.riskLevel === 'Medium') riskLabel = 'เฝ้าระวัง (Medium Risk)';

    return {
      "รหัสโครงการ": item.projectId || '-',
      "ชื่อโครงการ": item.projectName || '-',
      "ผู้รับเหมา": item.contractor || '-',
      "วันที่เข้าตรวจ": item.visitDate || '-',
      "ระดับความเสี่ยง": riskLabel,
      "ความคืบหน้า & การใช้งานสินค้า": item.siteProgress || '-',
      "แผนเรียกสินค้า (Material Forecast)": item.materialForecast || '-',
      "ปัญหา / ความเสี่ยง": item.issuesAndRisks || '-',
      "สิ่งที่ต้องติดตามสัปดาห์หน้า": item.nextWeekActions || '-',
      "จำนวนรูปภาพที่แนบ": imgCount,
      "วันที่บันทึกระบบ": item.createdAt ? new Date(item.createdAt).toLocaleString('th-TH') : '-'
    };
  });

  const projSuffix = selectedMasterProject !== 'all' ? `_${selectedMasterProject}` : '_All_Projects';
  downloadExcel(excelData, `Weekly_Site_Visits${projSuffix}`, 'Site_Visits');
}

/**
 * Render รายการรายงานหน้างาน พร้อมปุ่มอัปโหลดรูปประจำกล่อง และปุ่มลบเฉพาะรูป
 */
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

      // ดึงรูปภาพหน้างานทั้งหมดของกล่องนี้
      const imagesList = (item.images && item.images.length > 0)
        ? item.images
        : (item.imageData ? [{ base64Data: item.imageData, mimeType: item.mimeType || 'image/jpeg' }] : []);

      let photoHtml = '';
      const jsName = escapeJsString(item.projectName);

      if (imagesList.length === 0) {
        // เมื่อยังไม่มีรูปหน้างานในกล่อง แสดงปุ่มให้อัปโหลดเพิ่มรูปได้ทันที
        photoHtml = `
          <div class="mt-3">
            <div class="p-3.5 rounded-xl border border-dashed border-sky-300 hover:border-sky-500 bg-sky-50/30 hover:bg-sky-50/70 flex items-center justify-between cursor-pointer transition-all"
                 onclick="triggerBoxPhotoUpload(${item.id})">
              <div class="flex items-center gap-2">
                <span class="text-xl">📷</span>
                <div>
                  <div class="text-xs font-semibold text-sky-900">ยังไม่มีรูปถ่ายหน้างานในกล่องนี้</div>
                  <div class="text-[10px] text-slate-400">คลิกเพื่ออัปโหลดรูปภาพไซต์งาน (เพิ่มได้หลายรูป)</div>
                </div>
              </div>
              <button type="button" class="text-xs bg-sky-600 hover:bg-sky-700 text-white font-semibold px-2.5 py-1 rounded-lg shadow-sm">
                + เพิ่มรูป
              </button>
            </div>
          </div>
        `;
      } else {
        // แสดงรูปภาพแบบ Grid พร้อมปุ่มลบรูป (×) และปุ่มเพิ่มรูป
        const gridColsClass = imagesList.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
        const imgHeightClass = imagesList.length === 1 ? 'h-52 sm:h-60' : 'h-36 sm:h-44';

        photoHtml = `
          <div class="mt-3 space-y-2">
            <div class="flex justify-between items-center text-[11px] font-semibold text-slate-600">
              <span class="flex items-center gap-1">📸 รูปถ่ายหน้างาน (${imagesList.length} รูป):</span>
              <button type="button" onclick="triggerBoxPhotoUpload(${item.id})"
                      class="inline-flex items-center gap-1 text-[11px] text-sky-600 hover:text-sky-800 font-semibold bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2 py-0.5 rounded-md transition-colors">
                <span>➕</span> เพิ่มรูปในกล่องนี้
              </button>
            </div>
            <div class="grid ${gridColsClass} gap-2">
              ${imagesList.map((imgObj, pIdx) => {
                const jsBase64 = escapeJsString(imgObj.base64Data);
                return `
                  <div class="rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative group cursor-pointer shadow-sm"
                       onclick="openImageLightbox('${jsBase64}', '${jsName} (รูปที่ ${pIdx + 1})')">
                    <img src="data:${imgObj.mimeType || 'image/jpeg'};base64,${imgObj.base64Data}" alt="Site Photo"
                         class="w-full ${imgHeightClass} object-cover group-hover:scale-105 transition-transform duration-200">
                    <div class="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 text-white text-[11px] font-semibold backdrop-blur-[1px]">
                      <span>🔍 ซูมภาพ</span>
                    </div>
                    <!-- ปุ่มลบเฉพาะรูปนี้ -->
                    <button type="button"
                            onclick="event.stopPropagation(); deleteSinglePhotoFromBox(${item.id}, ${pIdx})"
                            title="ลบรูปนี้ออกจากกล่อง"
                            class="absolute top-2 right-2 bg-rose-600/90 hover:bg-rose-700 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shadow-md transition-all z-10">
                      ×
                    </button>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }

      return `
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4 hover:border-sky-300 transition-colors">
          <div>
            <!-- Header การ์ด พร้อมปุ่มลบกล่องนี้ -->
            <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <div class="flex items-center gap-1.5">
                  <span class="text-base font-bold text-slate-900">${escapeHtml(item.projectName)}</span>
                  ${item.projectId && item.projectId !== '-' ? `<span class="bg-sky-50 text-sky-700 text-[10px] font-mono px-2 py-0.5 rounded font-semibold">${escapeHtml(item.projectId)}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">
                  ผู้รับเหมา: <span class="font-medium text-slate-700">${escapeHtml(item.contractor || '-')}</span> | วันที่: <span class="font-medium text-slate-700">${escapeHtml(item.visitDate || '-')}</span>
                </div>
              </div>
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${riskBadgeClass} whitespace-nowrap">
                  ${riskText}
                </span>
                <button onclick="deleteSingleSiteVisit(${item.id})" title="ลบรายการนี้ทั้งกล่อง"
                        class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>

            <!-- โซนรูปถ่ายหน้างานประจำกล่อง -->
            ${photoHtml}

            <!-- ข้อมูลสรุปความคืบหน้า -->
            <div class="mt-3 space-y-2 text-xs">
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
                    <span>📋</span> สิ่งที่ต้องติดตาม:
                  </div>
                  <p class="text-emerald-950 leading-relaxed whitespace-pre-line">${escapeHtml(item.nextWeekActions || '-')}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- ท้ายการ์ด: เวลาบันทึก + ปุ่มแก้ไข + ปุ่มคัดลอก + ปุ่มลบ -->
          <div class="pt-2 border-t border-slate-100 flex flex-wrap justify-between items-center gap-2 text-[11px] text-slate-400">
            <span>บันทึกเมื่อ: ${new Date(item.createdAt).toLocaleString('th-TH')}</span>
            <div class="flex items-center gap-2.5">
              <button onclick="openEditSiteVisitModal(${item.id})" class="text-amber-600 hover:text-amber-800 font-semibold flex items-center gap-1 hover:underline">
                <span>✏️</span> แก้ไข
              </button>
              <button onclick="copySingleProjectSummary(${item.id})" class="text-sky-600 hover:text-sky-800 font-semibold flex items-center gap-1 hover:underline">
                <span>📋</span> คัดลอก
              </button>
              <button onclick="deleteSingleSiteVisit(${item.id})" class="text-rose-500 hover:text-rose-700 font-semibold flex items-center gap-0.5 hover:underline">
                <span>🗑️</span> ลบ
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
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
