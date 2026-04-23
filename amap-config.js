/**
 * 高德地图配置
 * 
 * 配置步骤：
 * 1. 访问 https://lbs.amap.com/ 注册/登录高德开放平台账号
 * 2. 进入「控制台」→「应用管理」→「我的应用」
 * 3. 点击「创建新应用」，选择「Web端(JS API)」
 * 4. 获取 Key 和 安全密钥 (jscode)
 * 5. 将下方配置填入你的真实信息
 * 
 * 注意：安全密钥(jscode)用于防止Key被盗用，强烈建议配置
 */
window.APP_CONFIG = {
    // 必填：高德地图 Key
    amapKey: "be2fff270951b5d607a5f8bb0fff1dfe",
    
    // 可选但强烈建议：安全密钥 jscode
    amapSecurityJsCode: "860166616b8473b90436f39647f95a69",
    
    // 默认城市，影响地点搜索和路线规划
    amapCity: "海口"
};
