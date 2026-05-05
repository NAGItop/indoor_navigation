/**
 * 安全出行助手 - 主应用逻辑
 * 专为视障人士优化的交互体验
 */

// ============================================
// 语音播报（外层页面）
// ============================================
const BAIDU_TTS = {
    appId: '7664376',
    apiKey: 'jZie8aJhPhjd4elJIpWrh41J',
    secretKey: 'TYSz5twRYNbKWF5DLYDZucdF9VlL1gyS',
    _token: '24.88341b6b0af1b86b69142fb92b927417.2592000.1779791566.282335-123010579',
    _expireAt: 0
};

// 获取百度 access_token（硬编码 token 优先，避免 CORS）
async function getBaiduToken() {
    if (BAIDU_TTS._token && Date.now() < BAIDU_TTS._expireAt) {
        return BAIDU_TTS._token;
    }
    // 硬编码 token（2026-04-26 获取，有效期30天）
    BAIDU_TTS._expireAt = Date.now() + 25 * 24 * 60 * 60 * 1000;
    return BAIDU_TTS._token;
}

// 判断移动端
function _isMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || (navigator.maxTouchPoints > 1);
}

// CORS 代理列表
const _CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
];

// 音频上下文
let _appAudioCtx = null;
function _ensureAudioCtx() {
    if (!_appAudioCtx) {
        try {
            _appAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {}
    }
    if (_appAudioCtx && _appAudioCtx.state === 'suspended') {
        _appAudioCtx.resume();
    }
}

// 用浏览器 speechSynthesis 播报（移动端首选，无需网络）
function _speakWithBrowser(text) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis || typeof window.speechSynthesis.speak !== 'function') {
            resolve(false);
            return;
        }
        try {
            window.speechSynthesis.cancel();
            const utt = new SpeechSynthesisUtterance(text);
            utt.lang = "zh-CN";
            utt.rate = 1.1;
            utt.pitch = 1;
            utt.volume = 1;
            utt.onend = () => resolve(true);
            utt.onerror = (e) => {
                resolve(e.error === 'interrupted' || e.error === 'canceled');
            };
            window.speechSynthesis.speak(utt);
            setTimeout(() => resolve(true), 15000);
        } catch (e) {
            resolve(false);
        }
    });
}

// 用 XHR + Web Audio API 播放百度 TTS
async function _tryWebAudio(url) {
    try {
        const arrayBuffer = await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'arraybuffer';
            xhr.timeout = 6000;
            xhr.onload = function() {
                if (xhr.status === 200 && xhr.response && xhr.response.byteLength > 0) resolve(xhr.response);
                else reject(new Error('status ' + xhr.status));
            };
            xhr.onerror = () => reject(new Error('network'));
            xhr.ontimeout = () => reject(new Error('timeout'));
            xhr.send();
        });
        const audioCtx = _appAudioCtx;
        if (!audioCtx) return false;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        const gain = audioCtx.createGain();
        gain.gain.value = 1.0;
        source.connect(gain);
        gain.connect(audioCtx.destination);
        source.start(0);
        await new Promise(r => { source.onended = r; });
        return true;
    } catch (e) {
        return false;
    }
}

// 用 <audio> 元素播放
function _playWithAudio(url) {
    return new Promise((resolve) => {
        try {
            const audio = new Audio();
            audio.preload = 'auto';
            const tid = setTimeout(() => { audio.pause(); audio.src = ''; resolve(false); }, 10000);
            audio.oncanplaythrough = () => { audio.play().catch(() => resolve(false)); };
            audio.onended = () => { clearTimeout(tid); resolve(true); };
            audio.onerror = () => { clearTimeout(tid); resolve(false); };
            audio.src = url;
        } catch (e) { resolve(false); }
    });
}

// 百度TTS（多级降级）
async function _speakWithBaidu(text) {
    _ensureAudioCtx();
    const token = await getBaiduToken();
    if (!token) return false;

    const params = new URLSearchParams({
        tex: encodeURIComponent(text),
        tok: token,
        cuid: BAIDU_TTS.appId,
        ctp: '1', lan: 'zh',
        spd: '5', pit: '5', vol: '15', per: '0', aue: '3'
    });
    const ttsUrl = `https://tsn.baidu.com/text2audio?${params.toString()}`;

    // 直连 → 代理+WebAudio → 代理+audio → 直连+audio
    let ok = await _tryWebAudio(ttsUrl);
    if (ok) return true;
    for (const proxy of _CORS_PROXIES) {
        ok = await _tryWebAudio(proxy + encodeURIComponent(ttsUrl));
        if (ok) return true;
    }
    for (const proxy of _CORS_PROXIES) {
        ok = await _playWithAudio(proxy + encodeURIComponent(ttsUrl));
        if (ok) return true;
    }
    ok = await _playWithAudio(ttsUrl);
    return ok;
}

// 主播报函数：移动端优先 speechSynthesis，电脑端优先百度TTS
async function speakText(text) {
    if (!text) return;
    _ensureAudioCtx();

    if (_isMobile()) {
        // 移动端直接用系统语音，零延迟
        const ok = await _speakWithBrowser(text);
        if (ok) return;
    }

    // 电脑端（或移动端降级）：百度TTS
    const ok = await _speakWithBaidu(text);
    if (ok) return;

    // 兜底
    await _speakWithBrowser(text);
}

// 首次用户交互时解锁音频（在绑定事件之前设置）
(function setupAudioUnlock() {
    const unlock = () => {
        _ensureAudioCtx();
        // 同时预热百度 token
        getBaiduToken();
        document.removeEventListener('click', unlock);
        document.removeEventListener('touchstart', unlock);
    };
    document.addEventListener('click', unlock);
    document.addEventListener('touchstart', unlock);
})();

// ============================================
// 配置与常量
// ============================================
const STORAGE_KEYS = {
    users: "safe-route-users",
    session: "safe-route-session",
    temporarySession: "safe-route-temp-session",
    settings: "safe-route-settings"
};

const CONFIG = {
    demoUsername: "demo",
    demoPassword: "123456",
    minPasswordLength: 6,
    maxUsernameLength: 18,
    mapTimeout: 10000,
    geolocationTimeout: 10000,
    // ✏️ 紧急联系电话 —— 修改这里即可更换号码
    emergencyPhone: "13379989076",
    emergencyPhoneLabel: "联系人"
};

// ============================================
// 状态管理
// ============================================
const state = {
    users: [],
    session: null,
    currentView: "auth",
    map: {
        instance: null,
        driving: null,
        ready: false,
        loading: false
    }
};

// ============================================
// 工具函数
// ============================================

/**
 * 密码哈希 - 使用 SHA-256
 */
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 生成唯一ID
 */
function generateId() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 格式化日期
 */
function formatDate(dateString) {
    if (!dateString) return "--";
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(date);
}

/**
 * 更新时钟
 */
function updateClock() {
    const clockEl = document.getElementById("clockValue");
    if (clockEl) {
        clockEl.textContent = new Intl.DateTimeFormat("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(new Date());
    }
}

/**
 * 显示状态消息 - 带语音朗读支持
 */
function showStatus(message, type = "info") {
    const statusEl = document.getElementById("statusMessage");
    if (!statusEl) return;
    
    statusEl.textContent = message;
    statusEl.className = `status-toast is-${type}`;
    
    // 语音朗读（百度 TTS 优先，兼容微信 WebView）
    if (state.settings?.voiceEnabled) {
        speakText(message);
    }
    
    // 3秒后自动清除
    setTimeout(() => {
        statusEl.textContent = "";
        statusEl.className = "status-toast";
    }, 5000);
}

/**
 * 触觉反馈 - 支持无障碍
 */
function hapticFeedback(type = "light") {
    if (navigator.vibrate) {
        const patterns = {
            light: [10],
            medium: [20],
            heavy: [30, 50, 30],
            success: [10, 50, 10],
            error: [50, 100, 50]
        };
        navigator.vibrate(patterns[type] || patterns.light);
    }
}

// ============================================
// 存储操作
// ============================================
function loadUsers() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.users);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function loadSession() {
    try {
        const persistent = localStorage.getItem(STORAGE_KEYS.session);
        const temporary = sessionStorage.getItem(STORAGE_KEYS.temporarySession);
        return JSON.parse(persistent || temporary || "null");
    } catch {
        return null;
    }
}

function saveUsers() {
    localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(state.users));
}

function saveSession() {
    if (!state.session) {
        localStorage.removeItem(STORAGE_KEYS.session);
        sessionStorage.removeItem(STORAGE_KEYS.temporarySession);
        return;
    }
    
    const data = JSON.stringify(state.session);
    if (state.session.rememberMe) {
        localStorage.setItem(STORAGE_KEYS.session, data);
        sessionStorage.removeItem(STORAGE_KEYS.temporarySession);
    } else {
        sessionStorage.setItem(STORAGE_KEYS.temporarySession, data);
        localStorage.removeItem(STORAGE_KEYS.session);
    }
}

function loadSettings() {
    try {
        const data = localStorage.getItem(STORAGE_KEYS.settings);
        return data ? JSON.parse(data) : { voiceEnabled: true, highContrast: false };
    } catch {
        return { voiceEnabled: true, highContrast: false };
    }
}

// ============================================
// 用户管理
// ============================================
async function initDemoUser() {
    const hashedPassword = await hashPassword(CONFIG.demoPassword);
    const existingIndex = state.users.findIndex(u => u.username === CONFIG.demoUsername);
    
    if (existingIndex >= 0) {
        state.users[existingIndex].password = hashedPassword;
    } else {
        state.users.push({
            id: generateId(),
            username: CONFIG.demoUsername,
            password: hashedPassword,
            displayName: "演示用户",
            avatar: "👤",
            route: { start: "", end: "", status: "暂未开始导航" },
            createdAt: new Date().toISOString()
        });
    }
    saveUsers();
}

function getCurrentUser() {
    if (!state.session?.userId) return null;
    return state.users.find(u => u.id === state.session.userId) || null;
}

// ============================================
// 视图管理
// ============================================
function switchTab(tabName) {
    const tabs = document.querySelectorAll(".tab-btn");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    
    tabs.forEach(tab => {
        const isActive = tab.dataset.tab === tabName;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", isActive);
    });
    
    if (loginForm) loginForm.classList.toggle("is-hidden", tabName !== "login");
    if (registerForm) registerForm.classList.toggle("is-hidden", tabName !== "register");
    
    // 清除状态消息
    const statusEl = document.getElementById("statusMessage");
    if (statusEl) {
        statusEl.textContent = "";
        statusEl.className = "status-toast";
    }
    
    hapticFeedback("light");
}

function switchView(viewName) {
    const authView = document.getElementById("authView");
    const dashboardView = document.getElementById("dashboardView");
    
    if (viewName === "dashboard") {
        authView?.classList.add("is-hidden");
        dashboardView?.classList.remove("is-hidden");
        state.currentView = "dashboard";
        updateDashboard();
    } else {
        authView?.classList.remove("is-hidden");
        dashboardView?.classList.add("is-hidden");
        state.currentView = "auth";
    }
}

function switchDashboardPage(pageName) {
    const navPage = document.getElementById("navPage");
    const profilePage = document.getElementById("profilePage");
    const navItems = document.querySelectorAll(".nav-item");
    
    const isNav = pageName === "nav";
    
    if (navPage) navPage.classList.toggle("is-hidden", !isNav);
    if (profilePage) profilePage.classList.toggle("is-hidden", isNav);
    
    navItems.forEach(item => {
        const isActive = item.dataset.view === pageName;
        item.classList.toggle("is-active", isActive);
        if (isActive) {
            item.setAttribute("aria-current", "page");
        } else {
            item.removeAttribute("aria-current");
        }
    });
    
    hapticFeedback("light");
}

// ============================================
// 表单处理
// ============================================
async function handleLogin(e) {
    e.preventDefault();
    
    const username = document.getElementById("loginUsername")?.value.trim();
    const password = document.getElementById("loginPassword")?.value;
    const rememberMe = document.getElementById("rememberMe")?.checked;
    
    if (!username || !password) {
        showStatus("请填写用户名和密码", "error");
        hapticFeedback("error");
        return;
    }
    
    const hashedPassword = await hashPassword(password);
    
    // 尝试匹配哈希密码
    let user = state.users.find(
        u => u.username.toLowerCase() === username.toLowerCase() && 
             u.password === hashedPassword
    );
    
    // 兼容旧明文密码
    if (!user) {
        const plainUser = state.users.find(
            u => u.username.toLowerCase() === username.toLowerCase() && 
                 u.password === password
        );
        if (plainUser) {
            plainUser.password = hashedPassword;
            saveUsers();
            user = plainUser;
        }
    }
    
    if (!user) {
        showStatus("用户名或密码错误", "error");
        hapticFeedback("error");
        return;
    }
    
    state.session = {
        userId: user.id,
        rememberMe,
        loggedInAt: new Date().toISOString()
    };
    
    saveSession();
    showStatus(`欢迎回来，${user.displayName}！`, "success");
    hapticFeedback("success");
    
    // 重置表单
    e.target.reset();
    
    // 切换到控制台
    setTimeout(() => switchView("dashboard"), 300);
}

async function handleRegister(e) {
    e.preventDefault();
    
    const displayName = document.getElementById("registerDisplayName")?.value.trim();
    const username = document.getElementById("registerUsername")?.value.trim();
    const password = document.getElementById("registerPassword")?.value;
    const confirmPassword = document.getElementById("confirmPassword")?.value;
    
    // 验证
    if (!/^[a-zA-Z0-9]{3,18}$/.test(username)) {
        showStatus("用户名需为3-18位字母或数字", "error");
        hapticFeedback("error");
        return;
    }
    
    if (password.length < CONFIG.minPasswordLength) {
        showStatus(`密码至少需要${CONFIG.minPasswordLength}位`, "error");
        hapticFeedback("error");
        return;
    }
    
    if (password !== confirmPassword) {
        showStatus("两次输入的密码不一致", "error");
        hapticFeedback("error");
        return;
    }
    
    if (state.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
        showStatus("该用户名已被注册", "error");
        hapticFeedback("error");
        return;
    }
    
    // 创建用户
    const hashedPassword = await hashPassword(password);
    const newUser = {
        id: generateId(),
        username,
        password: hashedPassword,
        displayName: displayName || username,
        avatar: "👤",
        route: { start: "", end: "", status: "暂未开始导航" },
        createdAt: new Date().toISOString()
    };
    
    state.users.push(newUser);
    saveUsers();
    
    showStatus("注册成功！请登录", "success");
    hapticFeedback("success");
    
    // 切换到登录页并填充用户名
    e.target.reset();
    switchTab("login");
    const loginUsername = document.getElementById("loginUsername");
    if (loginUsername) loginUsername.value = username;
}

function handleProfileSave(e) {
    e.preventDefault();
    
    const user = getCurrentUser();
    if (!user) return;
    
    const newName = document.getElementById("profileDisplayName")?.value.trim();
    if (!newName) {
        showStatus("请输入昵称", "error");
        return;
    }
    
    user.displayName = newName;
    saveUsers();
    
    showStatus("资料已保存", "success");
    hapticFeedback("success");
    updateDashboard();
}

function handleLogout() {
    state.session = null;
    saveSession();
    switchView("auth");
    switchTab("login");
    showStatus("已安全退出", "success");
    hapticFeedback("light");
}

// ============================================
// 地图与导航
// ============================================
function initMap() {
    const appConfig = window.APP_CONFIG || {};
    
    if (!appConfig.amapKey) {
        renderMapPlaceholder("请先配置高德地图 Key");
        return;
    }
    
    loadAMapScript(appConfig)
        .then(() => createMapInstance(appConfig))
        .catch(error => {
            console.error("地图加载失败:", error);
            renderMapPlaceholder("地图加载失败，请检查网络连接");
        });
}

function loadAMapScript(config) {
    if (window.AMap) return Promise.resolve();
    if (state.map.loading) {
        return new Promise((resolve, reject) => {
            const checkInterval = setInterval(() => {
                if (window.AMap) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
            setTimeout(() => {
                clearInterval(checkInterval);
                reject(new Error("地图加载超时"));
            }, CONFIG.mapTimeout);
        });
    }
    
    state.map.loading = true;
    
    // 配置安全密钥
    if (config.amapSecurityJsCode) {
        window._AMapSecurityConfig = { securityJsCode: config.amapSecurityJsCode };
    }
    
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        const plugins = ["AMap.Driving", "AMap.Geocoder"].join(",");
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapKey)}&plugin=${encodeURIComponent(plugins)}`;
        script.async = true;
        script.onload = () => {
            state.map.loading = false;
            resolve();
        };
        script.onerror = () => {
            state.map.loading = false;
            reject(new Error("地图脚本加载失败"));
        };
        document.head.appendChild(script);
    });
}

function createMapInstance(config) {
    if (!window.AMap || state.map.instance) return;
    
    const container = document.getElementById("mapContainer");
    if (!container) return;
    
    container.innerHTML = "";
    container.classList.remove("is-placeholder");
    
    try {
        state.map.instance = new window.AMap.Map("mapContainer", {
            zoom: 12,
            resizeEnable: true,
            city: config.amapCity || "北京",
            viewMode: "2D"
        });
        
        // 添加控件
        window.AMap.plugin(["AMap.Scale", "AMap.ToolBar"], () => {
            state.map.instance.addControl(new window.AMap.Scale());
            state.map.instance.addControl(new window.AMap.ToolBar({
                position: "RB"
            }));
        });
        
        state.map.ready = true;
        updateMapStatus("ready");
        
        // 恢复之前的路线
        const user = getCurrentUser();
        if (user?.route?.start && user?.route?.end) {
            setTimeout(() => planRoute(user.route.start, user.route.end), 500);
        }
    } catch (error) {
        console.error("地图初始化失败:", error);
        renderMapPlaceholder("地图初始化失败");
    }
}

function renderMapPlaceholder(message) {
    const container = document.getElementById("mapContainer");
    if (!container) return;
    
    container.classList.add("is-placeholder");
    container.innerHTML = `
        <div class="map-placeholder">
            <span class="placeholder-icon">🗺️</span>
            <p>${message}</p>
        </div>
    `;
    updateMapStatus("error");
}

function updateMapStatus(status) {
    const statusEl = document.getElementById("mapStatus");
    if (!statusEl) return;
    
    const statusMap = {
        ready: { text: "准备就绪", class: "status-ready" },
        loading: { text: "加载中...", class: "status-loading" },
        error: { text: "加载失败", class: "status-error" },
        planning: { text: "规划中...", class: "status-loading" }
    };
    
    const info = statusMap[status] || statusMap.ready;
    statusEl.textContent = info.text;
    statusEl.className = `status-badge ${info.class}`;
}

async function handleRouteSubmit(e) {
    e.preventDefault();
    
    const start = document.getElementById("startPoint")?.value.trim();
    const end = document.getElementById("endPoint")?.value.trim();
    
    if (!start || !end) {
        showStatus("请填写起点和终点", "error");
        return;
    }
    
    // 保存到用户数据
    const user = getCurrentUser();
    if (user) {
        user.route = { start, end, status: "导航中" };
        saveUsers();
    }
    
    updateRouteStatus("导航中", `${start} → ${end}`);
    planRoute(start, end);
    hapticFeedback("medium");
}

function planRoute(start, end) {
    if (!state.map.ready || !window.AMap) {
        updateRouteStatus("地图未就绪", "请先配置地图 API Key");
        return;
    }
    
    updateMapStatus("planning");
    
    window.AMap.plugin("AMap.Driving", () => {
        if (state.map.driving) {
            state.map.driving.clear();
        }
        
        state.map.driving = new window.AMap.Driving({
            policy: window.AMap.DrivingPolicy.LEAST_TIME,
            map: state.map.instance,
            panel: "routePanel",
            autoFitView: true
        });
        
        const points = [
            { keyword: start, city: window.APP_CONFIG?.amapCity || "北京" },
            { keyword: end, city: window.APP_CONFIG?.amapCity || "北京" }
        ];
        
        state.map.driving.search(points, (status, result) => {
            if (status === "complete" && result.routes?.length > 0) {
                const route = result.routes[0];
                const distance = route.distance ? `${(route.distance / 1000).toFixed(1)} 公里` : "未知";
                const duration = route.time ? `${Math.ceil(route.time / 60)} 分钟` : "未知";
                
                updateRouteStatus("路线已生成", `${start} → ${end}，约 ${distance}，预计 ${duration}`);
                updateMapStatus("ready");
                showStatus(`路线规划完成，全程约 ${distance}`, "success");
                hapticFeedback("success");
                // 语音播报路线结果
                speakText(`路线规划完成，从${start}出发，前往${end}，全程约${distance}，预计用时${duration}，请注意沿途指引。`);
            } else {
                updateRouteStatus("规划失败", "无法找到可行路线，请检查地址");
                updateMapStatus("error");
                showStatus("路线规划失败，请检查地址是否正确", "error");
                hapticFeedback("error");
                speakText("路线规划失败，请检查起点和终点地址是否正确。");
            }
        });
    });
}

function updateRouteStatus(status, meta = "") {
    const statusEl = document.getElementById("routeStatus");
    const metaEl = document.getElementById("routeMeta");
    
    if (statusEl) statusEl.textContent = status;
    if (metaEl) metaEl.textContent = meta;
}

async function handleLocate() {
    const btn = document.getElementById("locateBtn");
    const input = document.getElementById("startPoint");
    
    if (!navigator.geolocation) {
        showStatus("您的设备不支持定位功能", "error");
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = `<span aria-hidden="true">⏳</span> 定位中...`;
    
    try {
        const position = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: CONFIG.geolocationTimeout,
                maximumAge: 60000
            });
        });
        
        const { latitude, longitude } = position.coords;
        
        // 尝试反向地理编码
        if (window.AMap && window.APP_CONFIG?.amapKey) {
            const address = await reverseGeocode(latitude, longitude);
            input.value = address || `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        } else {
            input.value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        }
        
        showStatus("定位成功", "success");
        hapticFeedback("success");
    } catch (error) {
        let message = "定位失败";
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = "请允许使用定位权限";
                break;
            case error.POSITION_UNAVAILABLE:
                message = "无法获取位置信息";
                break;
            case error.TIMEOUT:
                message = "定位超时，请重试";
                break;
        }
        showStatus(message, "error");
        hapticFeedback("error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<span aria-hidden="true">📍</span> 定位`;
    }
}

function reverseGeocode(lat, lng) {
    return new Promise((resolve) => {
        window.AMap.plugin("AMap.Geocoder", () => {
            const geocoder = new window.AMap.Geocoder({ radius: 1000 });
            geocoder.getAddress([lng, lat], (status, result) => {
                if (status === "complete" && result.regeocode) {
                    resolve(result.regeocode.formattedAddress);
                } else {
                    resolve(null);
                }
            });
        });
    });
}

// ============================================
// 紧急呼叫
// ============================================
function showEmergencyModal() {
    const modal = document.getElementById("emergencyModal");
    if (modal) {
        modal.hidden = false;
        hapticFeedback("heavy");
    }
}

function hideEmergencyModal() {
    const modal = document.getElementById("emergencyModal");
    if (modal) modal.hidden = true;
}

function handleEmergency() {
    const user = getCurrentUser();
    const endPoint = document.getElementById("endPoint")?.value;
    
    // 记录紧急呼叫信息
    console.log("紧急呼叫:", {
        user: user?.username,
        location: endPoint || "未设置",
        time: new Date().toISOString()
    });
    
    updateRouteStatus("已发起紧急呼叫", `正在联系 ${CONFIG.emergencyPhoneLabel}，请保持冷静`);
    hideEmergencyModal();

    // 实际拨打电话（号码从 CONFIG.emergencyPhone 读取）
    window.location.href = `tel:${CONFIG.emergencyPhone}`;
}

// ============================================
// 更新界面
// ============================================
function updateDashboard() {
    const user = getCurrentUser();
    if (!user) return;
    
    // 更新欢迎信息
    const welcomeTitle = document.getElementById("welcomeTitle");
    const welcomeMeta = document.getElementById("welcomeMeta");
    const userAvatar = document.getElementById("userAvatar");
    
    if (welcomeTitle) welcomeTitle.textContent = `你好，${user.displayName}`;
    if (welcomeMeta) welcomeMeta.textContent = `${user.username} · 注册于 ${formatDate(user.createdAt)}`;
    if (userAvatar) userAvatar.textContent = user.avatar;
    
    // 更新个人资料表单
    const profileDisplayName = document.getElementById("profileDisplayName");
    const profileUsername = document.getElementById("profileUsername");
    const profileCreatedAt = document.getElementById("profileCreatedAt");
    const profileAvatarEmoji = document.getElementById("profileAvatarEmoji");
    const sessionStatus = document.getElementById("sessionStatus");
    
    if (profileDisplayName) profileDisplayName.value = user.displayName;
    if (profileUsername) profileUsername.value = user.username;
    if (profileCreatedAt) profileCreatedAt.value = formatDate(user.createdAt);
    if (profileAvatarEmoji) profileAvatarEmoji.textContent = user.avatar;
    if (sessionStatus) {
        sessionStatus.textContent = state.session?.rememberMe ? "已登录（记住我）" : "已登录（仅本次）";
    }
    
    // 恢复路线信息
    const startPoint = document.getElementById("startPoint");
    const endPoint = document.getElementById("endPoint");
    
    if (startPoint && user.route?.start) startPoint.value = user.route.start;
    if (endPoint && user.route?.end) endPoint.value = user.route.end;
    if (user.route?.status) updateRouteStatus(user.route.status);
}

// ============================================
// 事件绑定
// ============================================
function bindEvents() {
    // 标签页切换
    document.querySelectorAll(".tab-btn").forEach(btn => {
        btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    
    // 密码显示切换
    document.querySelectorAll(".toggle-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const target = document.getElementById(btn.dataset.target);
            if (target) {
                const isVisible = target.type === "text";
                target.type = isVisible ? "password" : "text";
                btn.querySelector(".toggle-icon").textContent = isVisible ? "👁️" : "🙈";
                btn.setAttribute("aria-label", isVisible ? "显示密码" : "隐藏密码");
            }
        });
    });
    
    // 表单提交
    document.getElementById("loginForm")?.addEventListener("submit", handleLogin);
    document.getElementById("registerForm")?.addEventListener("submit", handleRegister);
    document.getElementById("profileForm")?.addEventListener("submit", handleProfileSave);
    document.getElementById("routeForm")?.addEventListener("submit", handleRouteSubmit);
    
    // 演示账号
    document.getElementById("fillDemoBtn")?.addEventListener("click", () => {
        const username = document.getElementById("loginUsername");
        const password = document.getElementById("loginPassword");
        if (username) username.value = CONFIG.demoUsername;
        if (password) password.value = CONFIG.demoPassword;
        showStatus("已填入演示账号", "success");
        hapticFeedback("light");
    });
    
    // 退出登录
    document.getElementById("logoutBtn")?.addEventListener("click", handleLogout);
    
    // 定位
    document.getElementById("locateBtn")?.addEventListener("click", handleLocate);
    
    // 紧急呼叫
    document.getElementById("emergencyBtn")?.addEventListener("click", showEmergencyModal);
    document.querySelector(".modal-confirm")?.addEventListener("click", handleEmergency);
    document.querySelector(".modal-cancel")?.addEventListener("click", hideEmergencyModal);
    document.querySelector(".modal-close")?.addEventListener("click", hideEmergencyModal);
    document.querySelector(".modal-overlay")?.addEventListener("click", hideEmergencyModal);
    
    // 底部导航
    document.querySelectorAll(".nav-item").forEach(item => {
        item.addEventListener("click", () => switchDashboardPage(item.dataset.view));
    });
    
    // 键盘快捷键
    document.addEventListener("keydown", (e) => {
        // ESC 关闭弹窗
        if (e.key === "Escape") {
            hideEmergencyModal();
        }
        
        // Ctrl/Cmd + E 紧急呼叫
        if ((e.ctrlKey || e.metaKey) && e.key === "e") {
            e.preventDefault();
            showEmergencyModal();
        }
    });
}

// ============================================
// 室外语音输入模块
// ============================================
const _OV = {
    THRESHOLD: 8,        // 音量触发阈值
    SILENCE: 2000,       // 静音多久停录（ms）
    MAX_REC: 10000,      // 最长单次录音（ms）
    COOLDOWN: 2500,      // 两次识别最小间隔（ms）
    MIN_REC: 300,        // 最短录音（ms）
    RATE: 16000,         // 采样率
    CUID: '7664376',     // 百度ASR CUID
    PROXY: 'https://fragrant-salad-45ab.t0lloyd0t.workers.dev',
};

let _ovListening = false, _ovRecording = false;
let _ovMediaRec = null, _ovChunks = [];
let _ovStream = null, _ovAnalyser = null;
let _ovSilTimer = null, _ovRecTimer = null;
let _ovCooldown = false, _ovInited = false;
const _ovHistory = [];   // AI 多轮对话历史

// 检查浏览器支持
function _ovSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// ── 启动持续监听 ──
async function initOutdoorVoice() {
    if (_ovInited || !_ovSupported()) return;
    _ovInited = true;
    try {
        _ovStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: _OV.RATE, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        _ensureAudioCtx();
        const src = _appAudioCtx.createMediaStreamSource(_ovStream);
        _ovAnalyser = _appAudioCtx.createAnalyser();
        _ovAnalyser.fftSize = 512;
        _ovAnalyser.smoothingTimeConstant = 0.5;
        src.connect(_ovAnalyser);
        _ovListening = true;
        _ovUpdateStatus('listening');
        _ovMonitor();
        console.log('[室外语音] 持续监听已启动');
    } catch (e) {
        _ovInited = false;
        if (e.name === 'NotAllowedError') showStatus('请允许麦克风权限以使用语音控制', 'error');
        else console.log('[室外语音] 初始化失败:', e.message);
    }
}

// ── 音量检测循环 ──
function _ovMonitor() {
    if (!_ovListening || !_ovAnalyser) return;
    const buf = new Uint8Array(_ovAnalyser.frequencyBinCount);
    _ovAnalyser.getByteFrequencyData(buf);
    const vol = buf.reduce((s, v) => s + v, 0) / buf.length;

    if (_ovRecording) {
        if (vol < _OV.THRESHOLD) {
            if (!_ovSilTimer) _ovSilTimer = setTimeout(_ovStopRec, _OV.SILENCE);
        } else {
            if (_ovSilTimer) { clearTimeout(_ovSilTimer); _ovSilTimer = null; }
        }
    } else if (!_ovCooldown && vol > _OV.THRESHOLD) {
        _ovStartRec();
    }
    requestAnimationFrame(_ovMonitor);
}

// ── 开始录音 ──
async function _ovStartRec() {
    if (_ovRecording || _ovCooldown) return;
    _ovRecording = true;
    _ovChunks = [];
    _ovUpdateStatus('recording');
    _ovBeep();
    const t0 = Date.now();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: _OV.RATE, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        let mime = 'audio/webm;codecs=pcm';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mime)) mime = 'audio/mp4';
        if (!MediaRecorder.isTypeSupported(mime)) mime = '';

        _ovMediaRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        const _recMimeType = _ovMediaRec.mimeType || mime || 'audio/webm'; // 闭包保存，防止被清空后读取
        _ovMediaRec.ondataavailable = e => { if (e.data.size > 0) _ovChunks.push(e.data); };
        _ovMediaRec.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            const dur = Date.now() - t0;
            if (dur < _OV.MIN_REC || !_ovChunks.length) {
                _ovRecording = false; _ovUpdateStatus('listening'); return;
            }
            _ovUpdateStatus('processing');
            try {
                const blob = new Blob(_ovChunks, { type: _recMimeType });
                const text = await _ovRecognize(blob);
                console.log('[室外语音识别]', text);
                if (text) await _ovProcessCmd(text);
            } catch (e) {
                console.log('[室外语音] 识别失败:', e.message);
            }
            _ovRecording = false;
            _ovCooldown = true;
            _ovUpdateStatus('listening');
            setTimeout(() => { _ovCooldown = false; }, _OV.COOLDOWN);
        };
        _ovMediaRec.onerror = () => { stream.getTracks().forEach(t => t.stop()); _ovRecording = false; _ovUpdateStatus('listening'); };
        _ovRecTimer = setTimeout(_ovStopRec, _OV.MAX_REC);
        _ovMediaRec.start(200);
    } catch (e) {
        _ovRecording = false; _ovUpdateStatus('listening');
    }
}

// ── 停止录音 ──
function _ovStopRec() {
    if (_ovSilTimer) { clearTimeout(_ovSilTimer); _ovSilTimer = null; }
    if (_ovRecTimer) { clearTimeout(_ovRecTimer); _ovRecTimer = null; }
    if (_ovMediaRec && _ovMediaRec.state !== 'inactive') try { _ovMediaRec.stop(); } catch (e) {}
    _ovMediaRec = null;
}

// ── 更新语音状态面板 ──
function _ovUpdateStatus(status) {
    const panel = document.getElementById('outdoorVoicePanel');
    const text = document.getElementById('outdoorVoiceText');
    if (!panel) return;
    panel.className = 'outdoor-voice-panel voice-' + status;
    if (text) {
        const msgs = {
            idle: '点击页面任意位置启用语音控制',
            listening: '🟢 语音监听中，直接说话即可',
            recording: '🔴 正在聆听您说的话...',
            processing: '🔵 正在识别语音...',
        };
        text.textContent = msgs[status] || msgs.listening;
    }
}

// ── 百度ASR识别（通过 Worker 代理，无 CORS 问题） ──
async function _ovRecognize(blob) {
    // 将 blob 转 PCM 再转 base64
    const pcm = await _ovBlobToPCM(blob);
    if (pcm.byteLength < 100) throw new Error('音频太短');
    const b64 = _ovBuf2Base64(pcm);

    const WORKER_URL = 'https://fragrant-salad-45ab.t0lloyd0t.workers.dev/baidu-asr';

    const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            speech: b64,
            len: pcm.byteLength,
        }),
    });

    const data = await res.json();
    if (data.err_no === 0 && data.result?.length) return data.result[0];
    throw new Error('百度ASR错误: ' + (data.err_msg || data.err_no));
}

// ── Blob 转 16kHz 单声道 PCM ──
async function _ovBlobToPCM(blob) {
    const ab = await blob.arrayBuffer();
    _ensureAudioCtx();
    const decoded = await _appAudioCtx.decodeAudioData(ab);
    const len = Math.round(decoded.duration * _OV.RATE);
    const offCtx = new OfflineAudioContext(1, len, _OV.RATE);
    const src = offCtx.createBufferSource();
    src.buffer = decoded; src.connect(offCtx.destination); src.start(0);
    const rendered = await offCtx.startRendering();
    const ch = rendered.getChannelData(0);
    const pcm = new Int16Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return pcm.buffer;
}

// ── ArrayBuffer 转 Base64 ──
function _ovBuf2Base64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
    }
    return btoa(bin);
}

// ── 处理语音指令（AI 优先，关键词降级） ──
async function _ovProcessCmd(text) {
    // 显示识别结果到面板
    const resultEl = document.getElementById('outdoorVoiceResult');
    if (resultEl) { resultEl.textContent = text || '（未识别到内容）'; resultEl.style.display = 'inline'; }
    speakText('正在理解');

    // AI 意图理解
    const aiReply = await _ovCallAI(text);
    if (aiReply) {
        const parsed = _ovParseAI(aiReply);
        if (parsed) {
            _ovExecIntent(parsed);
            if (parsed.reply) speakText(parsed.reply);
            return;
        }
    }

    // 降级：关键词匹配
    const startEl = document.getElementById('startPoint');
    const endEl   = document.getElementById('endPoint');

    if (/开始|规划|导航/.test(text)) {
        const form = document.getElementById('routeForm');
        if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        speakText('开始规划路线');
        return;
    }
    if (/定位|我在哪/.test(text)) {
        document.getElementById('locateBtn')?.click();
        speakText('正在定位当前位置');
        return;
    }
    if (/清除|重新|取消/.test(text)) {
        if (startEl) startEl.value = '';
        if (endEl) endEl.value = '';
        speakText('已清除起点和终点');
        return;
    }
    if (/紧急|救命|帮我|求救/.test(text)) {
        showEmergencyModal();
        speakText('已打开紧急呼叫，请确认后拨打');
        return;
    }

    // 尝试当作地点
    const hasSrc = /从|出发|起点/.test(text);
    if (hasSrc) {
        // 提取地名（去掉前缀关键词）
        const loc = text.replace(/从|出发|起点|我在/g, '').trim() || text;
        if (startEl) { startEl.value = loc; showStatus(`起点：${loc}`, 'success'); speakText(`已设置起点：${loc}`); }
    } else {
        const loc = text.replace(/去|到|前往|导航到|终点/g, '').trim() || text;
        if (endEl) { endEl.value = loc; showStatus(`终点：${loc}`, 'success'); speakText(`已设置目的地：${loc}`); }
    }
}

// ── 调用智谱AI（室外版提示词） ──
async function _ovCallAI(userText) {
    try {
        const startVal = document.getElementById('startPoint')?.value || '未设置';
        const endVal   = document.getElementById('endPoint')?.value || '未设置';
        const system = `你是室外导航语音助手，帮助视障人士设置城市出行路线。
当前起点:${startVal}，终点:${endVal}。
理解用户指令，严格返回JSON（不含其他内容）：
{"intent":"navigate|control|emergency|chat","action":"set_start|set_end|plan|clear|locate|emergency|reply","location":"地点名称(仅navigate意图填写)","reply":"简短语音回复，一句话"}
规则：
1. "去X/到X/前往X" → intent=navigate, action=set_end, location=X
2. "从X出发/起点是X" → intent=navigate, action=set_start, location=X
3. "开始/规划/导航" → action=plan
4. "定位/我在哪" → action=locate
5. "清除/重新" → action=clear
6. "紧急/救命" → action=emergency
7. reply必须简洁，会被语音播报`;

        const messages = [
            { role: 'system', content: system },
            ..._ovHistory,
            { role: 'user', content: userText }
        ];

        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch(_OV.PROXY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages, temperature: 0.2, max_tokens: 200 }),
            signal: ctrl.signal
        });
        clearTimeout(tid);

        if (!res.ok) return null;
        const data = await res.json();
        if (!data.success || !data.reply) return null;

        _ovHistory.push({ role: 'user', content: userText }, { role: 'assistant', content: data.reply });
        while (_ovHistory.length > 12) _ovHistory.shift();
        return data.reply;
    } catch (e) {
        return null;
    }
}

// ── 解析AI回复 ──
function _ovParseAI(txt) {
    try {
        let s = txt.trim();
        const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (m) s = m[1].trim();
        const f = s.indexOf('{'), l = s.lastIndexOf('}');
        if (f !== -1 && l > f) s = s.slice(f, l + 1);
        const r = JSON.parse(s);
        return { intent: r.intent || 'none', action: r.action || 'none', location: r.location || null, reply: r.reply || '' };
    } catch (e) {
        return null;
    }
}

// ── 执行AI意图 ──
function _ovExecIntent(p) {
    const startEl = document.getElementById('startPoint');
    const endEl   = document.getElementById('endPoint');
    switch (p.action) {
        case 'set_start':
            if (startEl && p.location) { startEl.value = p.location; showStatus(`起点：${p.location}`, 'success'); hapticFeedback('success'); }
            break;
        case 'set_end':
            if (endEl && p.location) { endEl.value = p.location; showStatus(`终点：${p.location}`, 'success'); hapticFeedback('success'); }
            if (startEl?.value && endEl?.value) {
                // 起终点都有了，1.5秒后自动规划
                setTimeout(() => {
                    const form = document.getElementById('routeForm');
                    if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                }, 1500);
            }
            break;
        case 'plan':
            document.getElementById('routeForm')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            break;
        case 'clear':
            if (startEl) startEl.value = '';
            if (endEl) endEl.value = '';
            break;
        case 'locate':
            document.getElementById('locateBtn')?.click();
            break;
        case 'emergency':
            showEmergencyModal();
            break;
    }
}

// ── 提示音（轻柔版） ──
function _ovBeep() {
    _ensureAudioCtx();
    if (!_appAudioCtx) return;
    if (_appAudioCtx.state === 'suspended') { _appAudioCtx.resume(); return; }
    try {
        const osc = _appAudioCtx.createOscillator();
        const gain = _appAudioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.12, _appAudioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, _appAudioCtx.currentTime + 0.08);
        osc.connect(gain); gain.connect(_appAudioCtx.destination);
        osc.start(); osc.stop(_appAudioCtx.currentTime + 0.08);
    } catch (e) {}
}

// ============================================
// 初始化
// ============================================
async function init() {
    // 加载数据
    state.users    = loadUsers();
    state.session  = loadSession();
    state.settings = loadSettings();

    // 动态更新紧急呼叫号码显示
    const subLabel    = document.getElementById("emergencySubLabel");
    const modalText   = document.getElementById("emergencyModalText");
    const callLink    = document.getElementById("emergencyCallLink");
    if (subLabel)  subLabel.textContent  = `一键求助 ${CONFIG.emergencyPhoneLabel}`;
    if (modalText) modalText.textContent = `确定要拨打 ${CONFIG.emergencyPhoneLabel} 吗？`;
    if (callLink)  callLink.href         = `tel:${CONFIG.emergencyPhone}`;

    // 初始化演示用户
    await initDemoUser();
    
    // 绑定事件
    bindEvents();
    
    // 检查登录状态
    if (state.session?.userId) {
        const user = getCurrentUser();
        if (user) {
            switchView("dashboard");
        } else {
            // 用户不存在，清除会话
            state.session = null;
            saveSession();
        }
    }
    
    // 启动时钟
    updateClock();
    setInterval(updateClock, 1000);
    
    // 初始化地图
    initMap();
    
    // 首次用户交互后启动语音监听
    const _unlockVoice = () => {
        _ensureAudioCtx();
        getBaiduToken();
        if (!_ovInited) {
            initOutdoorVoice().then(() => {
                speakText('语音导航已就绪，您可以直接说出目的地');
            });
        }
        document.removeEventListener('click', _unlockVoice);
        document.removeEventListener('touchstart', _unlockVoice);
        document.removeEventListener('keydown', _unlockVoice);
    };
    document.addEventListener('click', _unlockVoice);
    document.addEventListener('touchstart', _unlockVoice);
    document.addEventListener('keydown', _unlockVoice);
    
    // 隐藏加载屏幕
    const loadingScreen = document.getElementById("loadingScreen");
    if (loadingScreen) {
        setTimeout(() => {
            loadingScreen.classList.add("is-hidden");
        }, 500);
    }
    
    console.log("🚀 安全出行助手已启动");
}

// 启动应用
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
