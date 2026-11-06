/**
 * Site Visit & Photo Management (site-visit.js)
 * จัดการรูปถ่ายหน้างาน (อัปโหลดตรงทันที ไม่ต้องผ่าน AI), ระบบ AI Analysis (gemini-3.5-flash-lite),
 * แสดงภาพขนาดใหญ่, ลบรายการเฉพาะกล่อง, Lightbox และคัดลอกสรุปส่ง LINE
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
// Direct Photo Upload (ไม่ต้องวิเคราะห์ AI)
// ==========================================
async function handleDirectSitePhotoUpload(files) {
  if (!files || files.length === 0) return;

  // ดึงข้อมูลโครงการจาก Master Project Filter ปัจจุบัน
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

  let savedCount = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!file.type.startsWith('image/')) continue;

    try {
      const imgData = await fileToBase64(file);
      const siteLog = {
        projectId: targetProjId,
        projectName: targetProjName,
        contractor: 'บันทึกรูปถ่ายหน้างาน',
        visitDate: currentDateStr,
        siteProgress: `ภาพถ่ายความคืบหน้าหน้างาน (${file.name || 'รูปภาพ'})`,
        materialForecast: '-',
        issuesAndRisks: 'หน้างานปกติ',
        nextWeekActions: '-',
        riskLevel: 'Low',
        imageData: imgData.base64Data,
        mimeType: imgData.mimeType,
        createdAt: new Date().toISOString()
      };

      await dbSave('site_visits', siteLog);
      savedCount++;
    } catch (err) {
      console.error('Save photo error:', err);
    }
  }

  if (savedCount > 0) {
    await loadSiteVisitLogsFromDB();
  }
}

// ==========================================
// AI Analysis Modal & Execution (gemini-3.5-flash-lite)
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

/**
 * ลบรายการการ์ดรายงานหน้างานเฉพาะกล่องที่เลือก
 */
async function deleteSingleSiteVisit(id) {
  if (!confirm('ต้องการลบรายการรายงานหน้างานนี้ใช่หรือไม่?')) return;
  await dbDelete('site_visits', id);
  await loadSiteVisitLogsFromDB();
}

/**
 * Render รายการรายงานหน้างาน พร้อมขยายขนาดรูปภาพชัดเจน และปุ่มลบแยกกล่อง
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

      // แสดงภาพขนาดใหญ่ ชัดเจน ไม่ใช่แค่ Thumbnail เล็กๆ
      let photoBigHtml = '';
      if (item.imageData) {
        const jsBase64 = escapeJsString(item.imageData);
        const jsName = escapeJsString(item.projectName);
        photoBigHtml = `
          <div class="mt-3">
            <div class="text-[11px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
              <span>📸</span> ภาพถ่ายหน้างาน:
            </div>
            <div class="site-card-large-image rounded-xl overflow-hidden border border-slate-200 bg-slate-100 relative group cursor-pointer shadow-sm"
                 onclick="openImageLightbox('${jsBase64}', '${jsName}')">
              <img src="data:${item.mimeType || 'image/jpeg'};base64,${item.imageData}" alt="Site Photo"
                   class="w-full h-48 sm:h-56 object-cover group-hover:scale-105 transition-transform duration-200">
              <div class="absolute inset-0 bg-slate-900/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 text-white text-xs font-semibold backdrop-blur-[1px]">
                <span>🔍</span> คลิกเพื่อดูภาพขยายเต็มจอ
              </div>
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
                <!-- ปุ่มลบกล่องนี้ -->
                <button onclick="deleteSingleSiteVisit(${item.id})" title="ลบรายการนี้"
                        class="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </div>

            <!-- ภาพถ่ายขนาดใหญ่ -->
            ${photoBigHtml}

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

          <!-- ท้ายการ์ด: เวลาบันทึก + ปุ่มคัดลอก + ปุ่มลบ -->
          <div class="pt-2 border-t border-slate-100 flex justify-between items-center text-[11px] text-slate-400">
            <span>บันทึกเมื่อ: ${new Date(item.createdAt).toLocaleString('th-TH')}</span>
            <div class="flex items-center gap-3">
              <button onclick="copySingleProjectSummary(${item.id})" class="text-sky-600 hover:text-sky-800 hover:underline font-semibold flex items-center gap-1">
                <span>📋</span> คัดลอก
              </button>
              <button onclick="deleteSingleSiteVisit(${item.id})" class="text-rose-500 hover:text-rose-700 hover:underline font-semibold flex items-center gap-0.5">
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
    text += `\n[${idx + 1}] โครงการ: ${item.projectName} (${item.projectId || '-'})
`;
    text += `👤 ผรม.: ${item.contractor || '-'}
`;
    text += `📅 วันที่เข้าเยี่ยม: ${item.visitDate || '-'}
`;
    text += `🏗️ ความคืบหน้า: ${item.siteProgress || '-'}
`;
    text += `🚚 แผนเรียกสินค้า: ${item.materialForecast || '-'}
`;
    text += `⚠️ ปัญหา/ข้อกังวล: ${item.issuesAndRisks || '-'}
`;
    text += `📋 Action สัปดาห์หน้า: ${item.nextWeekActions || '-'}
`;
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

  let text = `📢 รายงานความคืบหน้าหน้างาน: ${item.projectName} (${item.projectId || '-'})
`;
  text += `👤 ผรม.: ${item.contractor || '-'}
`;
  text += `📅 วันที่เข้าเยี่ยม: ${item.visitDate || '-'}
`;
  text += `🏗️ ความคืบหน้า: ${item.siteProgress || '-'}
`;
  text += `🚚 แผนเรียกสินค้า: ${item.materialForecast || '-'}
`;
  text += `⚠️ ปัญหา/ข้อกังวล: ${item.issuesAndRisks || '-'}
`;
  text += `📋 Action สัปดาห์หน้า: ${item.nextWeekActions || '-'}
`;

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
