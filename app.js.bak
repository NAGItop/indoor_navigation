/**
 * 安全出行助手 - 主应用逻辑
 * 专为视障人士优化的交互体验
 */

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
    
    // 语音朗读（如果启用）
    if (window.speechSynthesis && state.settings?.voiceEnabled) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = "zh-CN";
        utterance.rate = 1.2;
        window.speechSynthesis.speak(utterance);
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
            } else {
                updateRouteStatus("规划失败", "无法找到可行路线，请检查地址");
                updateMapStatus("error");
                showStatus("路线规划失败，请检查地址是否正确", "error");
                hapticFeedback("error");
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
