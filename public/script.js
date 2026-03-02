const API_URL = "/api/gifts";
const SEEN_GIFTS_URL = "/api/seen-gifts";
const UPLOAD_URL = "/api/upload";
const SESSIONS_URL = "/api/sessions";
const KEY_USAGE_URL = "/api/key-usage";

const giftForm = document.getElementById("giftForm");
const giftNameInput = document.getElementById("giftName");
const quantityInput = document.getElementById("quantity");
const giftSelect = document.getElementById("giftSelect");
const commandsInput = document.getElementById("commands");
const descriptionInput = document.getElementById("description");
const rewardImageInput = document.getElementById("rewardImage");
const imagePreview = document.getElementById("imagePreview");
const saveBtn = document.getElementById("saveBtn");
const cancelBtn = document.getElementById("cancelBtn");
const giftList = document.getElementById("giftList");
const giftCount = document.getElementById("giftCount");

let isEditing = false;
let originalName = "";
let currentImageUrl = "";
let globalSeenGifts = {};

// ========== INIT ==========
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const [seenGiftsResponse, giftsResponse] = await Promise.all([
      fetch(SEEN_GIFTS_URL),
      fetch(API_URL),
    ]);

    const seenGifts = await seenGiftsResponse.json();
    const gifts = await giftsResponse.json();

    globalSeenGifts = seenGifts;
    populateCustomDropdown(seenGifts);
    renderGifts(gifts);

    // Load sessions
    fetchSessions();

    // Load key usage
    fetchKeyUsage();

    console.log("✅ Data loaded");
  } catch (error) {
    console.error("❌ Error loading initial data:", error);
  }
});

// ========== KEY USAGE ==========
const keyUsageListEl = document.getElementById("keyUsageList");
const refreshKeyUsageBtn = document.getElementById("refreshKeyUsage");

async function fetchKeyUsage() {
  try {
    const response = await fetch(KEY_USAGE_URL);
    const data = await response.json();
    renderKeyUsage(data);
  } catch (error) {
    console.error("Error fetching key usage:", error);
    keyUsageListEl.innerHTML = `<div class="key-usage-loading">❌ ไม่สามารถโหลดข้อมูลได้</div>`;
  }
}

function renderKeyUsage(keys) {
  if (!keys || keys.length === 0) {
    keyUsageListEl.innerHTML = `<div class="key-usage-loading">ไม่พบ API Key</div>`;
    return;
  }

  keyUsageListEl.innerHTML = keys
    .map((k) => {
      if (k.status === "error") {
        return `
          <div class="key-usage-card error">
            <div class="key-usage-title">🔑 Key #${k.index} <span class="key-preview">${k.keyPreview}</span></div>
            <div class="key-usage-error">❌ ${k.error}</div>
          </div>`;
      }

      // Build limit bars for daily, hourly, minute
      const limits = [];
      if (k.day) limits.push({ label: "รายวัน", ...k.day });
      if (k.hour) limits.push({ label: "รายชั่วโมง", ...k.hour });
      if (k.minute) limits.push({ label: "รายนาที", ...k.minute });

      const barsHtml = limits
        .map((l) => {
          const max = l.max || 0;
          const remaining = l.remaining ?? max;
          const used = max - remaining;
          const pct = max > 0 ? Math.round((used / max) * 100) : 0;
          const barColor =
            pct >= 90 ? "#ef4444" : pct >= 60 ? "#f59e0b" : "#10b981";

          return `
            <div class="key-usage-limit">
              <div class="key-usage-limit-label">
                <span>${l.label}</span>
                <span class="key-usage-limit-nums">${used} / ${max} ใช้แล้ว (เหลือ ${remaining})</span>
              </div>
              <div class="key-usage-bar-bg">
                <div class="key-usage-bar-fill" style="width:${pct}%; background:${barColor}"></div>
              </div>
            </div>`;
        })
        .join("");

      return `
        <div class="key-usage-card">
          <div class="key-usage-title">🔑 Key #${k.index} <span class="key-preview">${k.keyPreview}</span></div>
          ${barsHtml}
        </div>`;
    })
    .join("");
}

refreshKeyUsageBtn.addEventListener("click", () => fetchKeyUsage());

// Auto-refresh every 60 seconds
setInterval(fetchKeyUsage, 60000);

// ========== SESSION MANAGEMENT ==========
const sessionTiktokInput = document.getElementById("sessionTiktok");
const sessionPlayerInput = document.getElementById("sessionPlayer");
const addSessionBtn = document.getElementById("addSessionBtn");
const sessionListEl = document.getElementById("sessionList");

async function fetchSessions() {
  try {
    const response = await fetch(SESSIONS_URL);
    const sessions = await response.json();
    renderSessions(sessions);
  } catch (error) {
    console.error("Error fetching sessions:", error);
  }
}

function renderSessions(sessions) {
  if (sessions.length === 0) {
    sessionListEl.innerHTML = `
            <div class="session-empty">
                <p>ยังไม่มี Session — เพิ่ม TikTok username + Minecraft player เพื่อเริ่มต้น</p>
            </div>
        `;
    return;
  }

  sessionListEl.innerHTML = sessions
    .map(
      (s) => `
        <div class="session-card ${s.active ? "active" : ""}">
            <div class="session-info">
                <div class="session-status-dot ${s.active ? "online" : "offline"}"></div>
                <div class="session-details">
                    <span class="session-tiktok">🎵 ${s.tiktokUsername}</span>
                    <span class="session-arrow">→</span>
                    <span class="session-player">⛏️ ${s.playerName}</span>
                </div>
            </div>
            <div class="session-actions">
                <button class="btn ${s.active ? "danger" : "primary"} small" onclick="toggleSession('${s.id}')">
                    ${s.active ? "⏹ หยุด" : "▶ เริ่ม"}
                </button>
                <button class="btn secondary small" onclick="deleteSession('${s.id}', '${s.tiktokUsername}')">🗑️</button>
            </div>
        </div>
    `,
    )
    .join("");
}

addSessionBtn.addEventListener("click", async () => {
  const tiktokUsername = sessionTiktokInput.value.trim();
  const playerName = sessionPlayerInput.value.trim();

  if (!tiktokUsername || !playerName) {
    alert("กรุณากรอก TikTok Username และ Minecraft Player");
    return;
  }

  try {
    const response = await fetch(SESSIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tiktokUsername, playerName }),
    });

    if (response.ok) {
      sessionTiktokInput.value = "";
      sessionPlayerInput.value = "";
      fetchSessions();
    } else {
      const err = await response.json();
      alert(err.error || "เกิดข้อผิดพลาด");
    }
  } catch (error) {
    console.error("Error adding session:", error);
    alert("ไม่สามารถเพิ่ม session ได้");
  }
});

window.toggleSession = async (id) => {
  try {
    const response = await fetch(`${SESSIONS_URL}/${id}/toggle`, {
      method: "POST",
    });

    if (response.ok) {
      fetchSessions();
    } else {
      alert("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ");
    }
  } catch (error) {
    console.error("Error toggling session:", error);
    alert("ไม่สามารถเปลี่ยนสถานะได้");
  }
};

window.deleteSession = async (id, name) => {
  if (!confirm(`ลบ session "${name}" ใช่หรือไม่?`)) return;

  try {
    const response = await fetch(`${SESSIONS_URL}/${id}`, {
      method: "DELETE",
    });

    if (response.ok) {
      fetchSessions();
    } else {
      alert("เกิดข้อผิดพลาดในการลบ");
    }
  } catch (error) {
    console.error("Error deleting session:", error);
    alert("ไม่สามารถลบ session ได้");
  }
};

// ========== GIFT DROPDOWN ==========
function populateCustomDropdown(seenGifts) {
  try {
    const seenGiftsArray = Object.values(seenGifts);
    seenGiftsArray.sort((a, b) => a.diamondCount - b.diamondCount);

    console.log("✅ Seen gifts loaded for dropdown:", seenGiftsArray.length);

    const customOptions = document.querySelector(".custom-options");
    customOptions.innerHTML = "";

    const defaultOption = document.createElement("div");
    defaultOption.className = "custom-option";
    defaultOption.dataset.value = "";
    defaultOption.innerHTML = `<span>-- เลือกของขวัญ --</span>`;
    defaultOption.addEventListener("click", () =>
      selectGiftOption(defaultOption),
    );
    customOptions.appendChild(defaultOption);

    seenGiftsArray.forEach((gift) => {
      const option = document.createElement("div");
      option.className = "custom-option";
      option.dataset.value = gift.name;

      let iconHtml = "";
      if (gift.icon) {
        iconHtml = `<img src="${gift.icon}" alt="${gift.name}">`;
      }

      option.innerHTML = `${iconHtml}<span>${gift.name} (💎${gift.diamondCount})</span>`;
      option.addEventListener("click", () => selectGiftOption(option));
      customOptions.appendChild(option);
    });

    setupCustomSelect();
  } catch (error) {
    console.error("Error populating dropdown:", error);
  }
}

async function fetchSeenGifts() {
  try {
    const response = await fetch(SEEN_GIFTS_URL);
    const seenGifts = await response.json();
    globalSeenGifts = seenGifts;
    populateCustomDropdown(seenGifts);
  } catch (error) {
    console.error("Error fetching seen gifts:", error);
  }
}

function setupCustomSelect() {
  const wrapper = document.querySelector(".custom-select-wrapper");
  const select = document.querySelector(".custom-select");
  const trigger = document.querySelector(".custom-select__trigger");

  const newTrigger = trigger.cloneNode(true);
  trigger.parentNode.replaceChild(newTrigger, trigger);

  newTrigger.addEventListener("click", () => {
    select.classList.toggle("open");
  });
}

document.addEventListener("click", (e) => {
  const wrapper = document.querySelector(".custom-select-wrapper");
  const select = document.querySelector(".custom-select");
  if (wrapper && !wrapper.contains(e.target)) {
    select.classList.remove("open");
  }
});

function selectGiftOption(option) {
  const select = document.querySelector(".custom-select");
  const trigger = document.querySelector(".custom-select__trigger span");
  const hiddenSelect = document.getElementById("giftSelect");

  select.classList.remove("open");
  document
    .querySelectorAll(".custom-option")
    .forEach((opt) => opt.classList.remove("selected"));
  option.classList.add("selected");

  trigger.innerHTML = option.innerHTML;

  const value = option.dataset.value;
  hiddenSelect.value = value;

  if (value) {
    const gift =
      globalSeenGifts[value] ||
      Object.values(globalSeenGifts).find((g) => g.name === value);
    if (gift) {
      giftNameInput.value = gift.name;
      if (!commandsInput.value) {
        commandsInput.value = `say §b🎁 {sender} ส่ง ${gift.name} ให้ {player}!\nexecute at {player} run summon firework_rocket ~ ~ ~`;
      }
    }
  }
}

// ========== GIFT LIST ==========
async function fetchGifts() {
  try {
    const response = await fetch(API_URL);
    const gifts = await response.json();
    renderGifts(gifts);
  } catch (error) {
    console.error("Error fetching gifts:", error);
    alert("ไม่สามารถโหลดข้อมูลของขวัญได้");
  }
}

function renderGifts(gifts) {
  giftList.innerHTML = "";
  let giftNames = Object.keys(gifts);
  giftCount.textContent = giftNames.length;

  giftNames.sort((a, b) => {
    const giftA =
      globalSeenGifts[a] ||
      globalSeenGifts[
        Object.keys(globalSeenGifts).find(
          (k) => k.toLowerCase() === a.toLowerCase(),
        )
      ];
    const giftB =
      globalSeenGifts[b] ||
      globalSeenGifts[
        Object.keys(globalSeenGifts).find(
          (k) => k.toLowerCase() === b.toLowerCase(),
        )
      ];

    const diamondsA = giftA ? giftA.diamondCount || 0 : 0;
    const diamondsB = giftB ? giftB.diamondCount || 0 : 0;

    return diamondsA - diamondsB;
  });

  giftNames.forEach((name) => {
    const giftData = gifts[name];
    const commands = Array.isArray(giftData) ? giftData : giftData.commands;
    const description = !Array.isArray(giftData) ? giftData.description : "";
    const imageUrl = !Array.isArray(giftData) ? giftData.rewardImage : "";

    let tiktokIcon = "";
    let diamondCount = 0;
    const seen =
      globalSeenGifts[name] ||
      globalSeenGifts[
        Object.keys(globalSeenGifts).find(
          (k) => k.toLowerCase() === name.toLowerCase(),
        )
      ];
    if (seen) {
      if (seen.icon) tiktokIcon = seen.icon;
      if (seen.diamondCount) diamondCount = seen.diamondCount;
    }

    const card = document.createElement("div");
    card.className = "gift-card";

    let mediaHtml = "";
    if (imageUrl) {
      mediaHtml += `<img src="${imageUrl}" title="Reward Image" style="width: 48px; height: 48px; border-radius: 8px; object-fit: cover; border: 2px solid #10b981;">`;
    }
    if (tiktokIcon) {
      mediaHtml += `<img src="${tiktokIcon}" title="TikTok Gift" class="gift-icon" style="width: 32px; height: 32px; object-fit: contain;">`;
    }

    const escapedName = name.replace(/'/g, "\\'");

    card.innerHTML = `
            <div class="gift-header">
                <div class="gift-media">
                    ${mediaHtml}
                </div>
                <div class="gift-info">
                    <div class="gift-name">
                        ${name}
                        ${diamondCount > 0 ? `<span class="gift-diamonds" style="color: #0ea5e9; font-size: 0.9em; margin-left: 8px;">💎${diamondCount}</span>` : ""}
                        ${!Array.isArray(giftData) && giftData.quantity > 1 ? `<span class="gift-quantity" style="color: #f59e0b; font-size: 0.9em; margin-left: 8px;">x${giftData.quantity}</span>` : ""}
                    </div>
                    ${description ? `<div class="gift-desc">${description}</div>` : ""}
                </div>
            </div>
            <div class="gift-commands">
                ${commands.map((cmd) => `<div class="command-line">${cmd}</div>`).join("")}
            </div>
            <div class="gift-actions">
                <button class="btn test" onclick="testGift('${escapedName}')">ทดสอบ</button>
                <button class="btn edit" onclick="editGift('${escapedName}')">แก้ไข</button>
                <button class="btn danger" onclick="deleteGift('${escapedName}')">ลบ</button>
            </div>
        `;
    giftList.appendChild(card);
  });
}

// ========== TEST GIFT ==========
window.testGift = async (name) => {
  const sender = prompt(
    "ระบุชื่อผู้ส่ง (ปล่อยว่างเพื่อใช้ 'TestUser'):",
    "TestUser",
  );
  if (sender === null) return;

  const player = prompt(
    "ระบุชื่อ Minecraft Player เป้าหมาย (ปล่อยว่างเพื่อใช้ '@p'):",
    "@p",
  );
  if (player === null) return;

  try {
    const response = await fetch("/api/test-gift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, sender, player }),
    });

    if (response.ok) {
      alert(`ส่งคำสั่งของขวัญ "${name}" ให้ player "${player}" แล้ว!`);
    } else {
      alert("เกิดข้อผิดพลาดในการทดสอบ");
    }
  } catch (error) {
    console.error("Error testing gift:", error);
    alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
  }
};

// ========== IMAGE UPLOAD ==========
rewardImageInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) {
    const formData = new FormData();
    formData.append("image", file);

    try {
      const response = await fetch(UPLOAD_URL, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (data.url) {
        currentImageUrl = data.url;
        imagePreview.innerHTML = `<img src="${currentImageUrl}" alt="Preview">`;
      }
    } catch (error) {
      console.error("Error uploading image:", error);
      alert(`อัปโหลดรูปภาพไม่สำเร็จ: ${error.message}`);
    }
  }
});

// ========== GIFT FORM ==========
giftForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const name = giftNameInput.value.trim();
  const commands = commandsInput.value
    .trim()
    .split("\n")
    .filter((cmd) => cmd.trim() !== "");

  if (!name || commands.length === 0) {
    alert("กรุณากรอกชื่อและคำสั่งอย่างน้อย 1 คำสั่ง");
    return;
  }

  const payload = {
    name: name,
    commands: commands,
    description: descriptionInput.value.trim(),
    quantity: parseInt(quantityInput.value) || 1,
    type: document.querySelector('input[name="giftType"]:checked').value,
    rewardImage: currentImageUrl,
    originalName: isEditing ? originalName : null,
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      resetForm();
      fetchGifts();
    } else {
      alert("เกิดข้อผิดพลาดในการบันทึก");
    }
  } catch (error) {
    console.error("Error saving gift:", error);
    alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
  }
});

window.editGift = async (name) => {
  try {
    const response = await fetch(API_URL);
    const gifts = await response.json();
    const giftData = gifts[name];

    const commands = Array.isArray(giftData) ? giftData : giftData.commands;
    const description = !Array.isArray(giftData) ? giftData.description : "";
    const imageUrl = !Array.isArray(giftData) ? giftData.rewardImage : "";
    const type =
      !Array.isArray(giftData) && giftData.type ? giftData.type : "help";
    const quantity =
      !Array.isArray(giftData) && giftData.quantity ? giftData.quantity : 1;

    if (commands) {
      giftNameInput.value = name;
      giftSelect.value = "";
      commandsInput.value = commands.join("\n");
      descriptionInput.value = description || "";
      quantityInput.value = quantity || 1;
      currentImageUrl = imageUrl || "";

      const radio = document.querySelector(
        `input[name="giftType"][value="${type}"]`,
      );
      if (radio) radio.checked = true;

      if (currentImageUrl) {
        imagePreview.innerHTML = `<img src="${currentImageUrl}" alt="Preview">`;
      } else {
        imagePreview.innerHTML = "";
      }

      isEditing = true;
      originalName = name;
      saveBtn.textContent = "อัปเดต";
      cancelBtn.style.display = "inline-block";

      document
        .querySelector(".add-gift-section")
        .scrollIntoView({ behavior: "smooth" });

      const customOptions = document.querySelectorAll(".custom-option");
      const trigger = document.querySelector(".custom-select__trigger span");
      const select = document.querySelector(".custom-select");

      customOptions.forEach((opt) => opt.classList.remove("selected"));
      trigger.textContent = "-- เลือกของขวัญ --";

      let matchedOption = null;
      customOptions.forEach((opt) => {
        if (opt.dataset.value === name) {
          matchedOption = opt;
        }
      });

      if (matchedOption) {
        matchedOption.classList.add("selected");
        trigger.innerHTML = matchedOption.innerHTML;
        giftSelect.value = name;
      } else {
        giftSelect.value = "";
      }
    }
  } catch (error) {
    console.error("Error fetching gift details:", error);
  }
};

window.deleteGift = async (name) => {
  if (!confirm(`คุณต้องการลบของขวัญ "${name}" ใช่หรือไม่?`)) return;

  try {
    const response = await fetch(`${API_URL}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });

    if (response.ok) {
      fetchGifts();
    } else {
      alert("เกิดข้อผิดพลาดในการลบ");
    }
  } catch (error) {
    console.error("Error deleting gift:", error);
    alert("เกิดข้อผิดพลาดในการเชื่อมต่อ");
  }
};

cancelBtn.addEventListener("click", resetForm);

function resetForm() {
  giftForm.reset();
  imagePreview.innerHTML = "";
  currentImageUrl = "";
  isEditing = false;
  originalName = "";
  saveBtn.textContent = "บันทึก";
  cancelBtn.style.display = "none";

  const helpRadio = document.querySelector(
    'input[name="giftType"][value="help"]',
  );
  if (helpRadio) helpRadio.checked = true;

  if (quantityInput) quantityInput.value = 1;

  const trigger = document.querySelector(".custom-select__trigger span");
  const customOptions = document.querySelectorAll(".custom-option");

  if (trigger) trigger.textContent = "-- เลือกของขวัญ --";
  if (customOptions)
    customOptions.forEach((opt) => opt.classList.remove("selected"));
  if (giftSelect) giftSelect.value = "";
}
