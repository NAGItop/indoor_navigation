/**
 * 室内导航系统 v3.0 — 多楼层版
 * ─────────────────────────────────────────────
 * 架构：
 *   · 每层有独立的二维地图网格 (0=墙, 1=走廊, 2=教室, 3=楼梯, 4=卫生间, 5=办公室)
 *   · 楼梯节点 (type=3) 在多层中位置相同，作为层间传送点
 *   · 跨层寻路：本层找楼梯 → 换层 → 继续寻路到终点
 *   · 步进导航会提示上楼/下楼指令
 */

// ============================================
// 地图配置
// ============================================
const MAP_CONFIG = {
    cellSize: 22,
    colors: {
        0: null,            // 墙壁 = 背景色（不绘制）
        1: "#1a2744",       // 走廊
        2: "#1e3a5f",       // 教室
        3: "#2d4a1e",       // 楼梯间
        4: "#1a3320",       // 卫生间
        5: "#2d1a3a",       // 办公室
    },
    wallColor:      "#050a14",
    pathColor:      "#3b82f6",
    startColor:     "#10b981",
    endColor:       "#f97316",
    stairLinkColor: "#f59e0b",
};

// ============================================
// 地图生成辅助
// ============================================
function makeGrid(rows, cols) {
    return Array.from({ length: rows }, () => new Array(cols).fill(0));
}

function fill(grid, r1, c1, r2, c2, val) {
    for (let r = r1; r <= r2; r++)
        for (let c = c1; c <= c2; c++)
            grid[r][c] = val;
}

function hLine(grid, row, c1, c2, val = 1) { fill(grid, row, c1, row, c2, val); }
function vLine(grid, col, r1, r2, val = 1) { fill(grid, r1, col, r2, col, val); }

// ============================================
// 地图数据定义
// ============================================
/*
  每层地图尺寸：21行 × 27列
  布局（每层相同结构，房间功能不同）：

  行号  内容
  ───  ───────────────────────────────────────
   0   外墙
  1-4  北侧房间区（3个房间）
   5   北侧房门过道（与走廊相通）
  6-8  主横向走廊（贯穿左右）
   9   南侧房门过道
  10-13 南侧房间区（3个房间）
  14-15 中间分隔
  16-17 中央走廊区（连接出口/楼梯）
  18-19 楼梯/出口区
  20   外墙

  列号  内容
  ───  ───────────────────────────────────────
   0   外墙
  1-6  房间A
   7   竖向走廊（贯穿上下）
  8-15  房间B / 中央走廊
  16  竖向走廊
  17-22 房间C
  23  竖向走廊（主通道）
  24  外墙/隔离
  25-26 楼梯间（独立区域，不干扰主通道）

  楼梯间固定在：[2,25] 和 [18,25] —— 完全独立于走廊系统
  所有路径在列1-23的走廊网络中进行，绝不穿过房间或楼梯间
*/

const ROWS = 21, COLS = 27;

function buildFloor(roomDefs) {
    // roomDefs: [{r1,c1,r2,c2,type,doorR,doorC}, ...]
    const g = makeGrid(ROWS, COLS);

    // ═══════════════════════════════════════════════════════
    // 走廊系统（列1-23，完全独立于楼梯间）
    // ═══════════════════════════════════════════════════════

    // ── 主横向走廊（行6-8，列1-23）──────────────
    fill(g, 6, 1, 8, 23, 1);

    // ── 竖向走廊（精简为两条主要通道）───────────
    vLine(g,  1, 1, 13, 1);   // 最左（列1）— 连接西侧大门和南北过道
    vLine(g, 23, 5, 9,  1);   // 最右（列23）— 仅连接两个过道到楼梯入口

    // ── 北侧横向过道（行5，连接房间门）─────────
    hLine(g, 5, 1, 23, 1);

    // ── 南侧横向过道（行9，连接房间门）─────────
    hLine(g, 9, 1, 23, 1);

    // ═══════════════════════════════════════════════════════
    // 楼梯间系统（列25-26，完全隔离于主走廊）
    // ═══════════════════════════════════════════════════════

    // 楼梯间A（北侧）: 行1-4, 列25-26
    fill(g, 1, 25, 4, 26, 3);
    // 楼梯间B（南侧）: 行10-13, 列25-26 —— 北移到南过道附近
    fill(g, 10, 25, 13, 26, 3);

    // 楼梯入口（连接走廊与楼梯间的通道）
    // 北侧楼梯入口在北过道（行5）
    g[5][24]  = 1;
    // 南侧楼梯入口在南过道（行9）
    g[9][24] = 1;

    // ═══════════════════════════════════════════════════════
    // 房间填充
    // ═══════════════════════════════════════════════════════
    for (const rd of roomDefs) {
        fill(g, rd.r1, rd.c1, rd.r2, rd.c2, rd.type);
        // 房门（门洞打通到走廊）— 门必须在过道行（5或9）
        g[rd.doorR][rd.doorC] = 1;
    }

    return g;
}

// 在一楼地图的西侧打通入口（列0）
function addEntrance(floorMap, entranceDef) {
    // entranceDef: { doorR, doorC }
    // 在西墙（列0）打通入口，连接到主横向走廊（行6-8）
    const { doorR, doorC } = entranceDef;
    // 入口位置设为走廊
    floorMap[doorR][doorC] = 1;
    // 从入口向右连接到列1的竖向走廊
    if (doorC === 0) {
        // 横向打通到列1
        for (let c = 0; c <= 1; c++) {
            floorMap[doorR][c] = 1;
        }
    }
}

// 每层房间定义
// 北侧房间（行1-4）: 3个
// 南侧房间（行10-13）: 3个
const FLOOR_DEFS = {
    1: { // 一楼：入口大厅、登记处、服务台
        rooms: [
            // 北侧
            { r1:1, c1:1,  r2:4, c2:6,  type:2, doorR:5,  doorC:3,  id:"r1_101", name:"📚 101教室", desc:"一楼大教室，可容纳80人" },
            { r1:1, c1:8,  r2:4, c2:15, type:5, doorR:5,  doorC:11, id:"r1_off1",name:"🏢 一楼办公室",desc:"教务办公室，负责选课事务" },
            { r1:1, c1:17, r2:4, c2:22, type:2, doorR:5,  doorC:19, id:"r1_102", name:"📚 102教室", desc:"一楼小教室，可容纳40人" },
            // 南侧
            { r1:10, c1:1,  r2:13, c2:6,  type:4, doorR:9, doorC:3,  id:"r1_wc",  name:"🚻 卫生间",  desc:"无障碍卫生间，设有扶手" },
            { r1:10, c1:8,  r2:13, c2:15, type:2, doorR:9, doorC:11, id:"r1_103", name:"📚 103教室", desc:"一楼多媒体教室" },
            { r1:10, c1:17, r2:13, c2:22, type:2, doorR:9, doorC:19, id:"r1_104", name:"📚 104教室", desc:"一楼实验教室" },
        ],
        entrance: { id:"r1_entrance", name:"🚪 一楼大门", doorR:7, doorC:0, desc:"教学楼西侧正门入口，设有无障碍坡道" }
    },
    2: { // 二楼：普通教室
        rooms: [
            { r1:1, c1:1,  r2:4, c2:6,  type:2, doorR:5,  doorC:3,  id:"r2_201", name:"📚 201教室", desc:"二楼大教室，可容纳80人" },
            { r1:1, c1:8,  r2:4, c2:15, type:2, doorR:5,  doorC:11, id:"r2_202", name:"📚 202教室", desc:"二楼中教室，可容纳60人" },
            { r1:1, c1:17, r2:4, c2:22, type:2, doorR:5,  doorC:19, id:"r2_203", name:"📚 203教室", desc:"二楼小教室，可容纳40人" },
            { r1:10, c1:1,  r2:13, c2:6,  type:2, doorR:9, doorC:3,  id:"r2_204", name:"📚 204教室", desc:"二楼东侧教室" },
            { r1:10, c1:8,  r2:13, c2:15, type:5, doorR:9, doorC:11, id:"r2_off1",name:"🏢 二楼办公室",desc:"系所办公室，负责学籍管理" },
            { r1:10, c1:17, r2:13, c2:22, type:4, doorR:9, doorC:19, id:"r2_wc",  name:"🚻 卫生间",  desc:"二楼无障碍卫生间" },
        ],
        entrance: null
    },
    3: { // 三楼：实验室、计算机室
        rooms: [
            { r1:1, c1:1,  r2:4, c2:6,  type:2, doorR:5,  doorC:3,  id:"r3_301", name:"🔬 实验室",  desc:"理化实验室，进入须穿防护服" },
            { r1:1, c1:8,  r2:4, c2:15, type:2, doorR:5,  doorC:11, id:"r3_302", name:"💻 计算机室", desc:"配备60台电脑" },
            { r1:1, c1:17, r2:4, c2:22, type:2, doorR:5,  doorC:19, id:"r3_303", name:"📚 303教室", desc:"三楼小教室，可容纳40人" },
            { r1:10, c1:1,  r2:13, c2:6,  type:5, doorR:9, doorC:3,  id:"r3_off1",name:"🏢 三楼办公室",desc:"研究生导师办公室" },
            { r1:10, c1:8,  r2:13, c2:15, type:2, doorR:9, doorC:11, id:"r3_304", name:"📚 304教室", desc:"三楼多媒体教室" },
            { r1:10, c1:17, r2:13, c2:22, type:4, doorR:9, doorC:19, id:"r3_wc",  name:"🚻 卫生间",  desc:"三楼无障碍卫生间" },
        ],
        entrance: null
    }
};

// 构建三层地图
const FLOOR_MAPS = {};
const FLOOR_ROOMS = {};   // floor -> room[]
const STAIR_NODES = {     // 楼梯节点固定坐标（在走廊侧的入口点）
    // 注意：楼梯间本身在列25-26，但导航到"楼梯"是指到达楼梯入口（列24）
    // 北侧入口在北过道（行5），南侧入口在南过道（行9）
    // 这样上楼后直接在过道里，可以立即转向目标房间
    stairA: { r: 5, c: 24, name: "🪜 北侧楼梯间", actualStairC: 25 },
    stairB: { r: 9, c: 24, name: "🪜 南侧楼梯间", actualStairC: 25 },
};

for (const [floorStr, def] of Object.entries(FLOOR_DEFS)) {
    const floor = Number(floorStr);
    FLOOR_MAPS[floor] = buildFloor(def.rooms);

    const rooms = def.rooms.map(rd => ({
        id:    rd.id,
        name:  rd.name,
        floor,
        door:  [rd.doorR, rd.doorC],
        desc:  rd.desc,
        type:  rd.type,
    }));

    // 楼梯节点（每层都有，作为层间连接点）
    for (const [sid, sn] of Object.entries(STAIR_NODES)) {
        rooms.push({
            id:    `${sid}_f${floor}`,
            name:  sn.name,
            floor,
            door:  [sn.r, sn.c],
            desc:  `${sn.name}，可到达第${floor > 1 ? floor-1 : ''}${floor < 3 ? '、'+(floor+1) : ''}层`,
            type:  3,
            isStair: true,
            stairId: sid,
        });
    }

    // 入口（仅一楼）
    if (def.entrance) {
        const e = def.entrance;
        // 打通入口到走廊
        addEntrance(FLOOR_MAPS[floor], { doorR: e.doorR, doorC: e.doorC });
        rooms.push({
            id:    e.id,
            name:  e.name,
            floor,
            door:  [e.doorR, e.doorC],
            desc:  e.desc,
            type:  1,
        });
    }

    // 确保楼梯入口在地图中可行（列24是走廊，列25-26是楼梯间）
    FLOOR_MAPS[floor][STAIR_NODES.stairA.r][STAIR_NODES.stairA.c] = 1;  // 入口是走廊
    FLOOR_MAPS[floor][STAIR_NODES.stairB.r][STAIR_NODES.stairB.c] = 1;  // 入口是走廊
    // 楼梯间本身（列25-26）保持为3（楼梯类型），不参与寻路

    // 修补门洞（确保所有门在地图中可行）
    for (const rd of def.rooms) {
        FLOOR_MAPS[floor][rd.doorR][rd.doorC] = 1;
    }
    if (def.entrance) {
        FLOOR_MAPS[floor][def.entrance.doorR][def.entrance.doorC] = 1;
    }

    FLOOR_ROOMS[floor] = rooms;
}

// 平铺所有房间（用于选择器），排除纯楼梯节点
const ALL_ROOMS = Object.values(FLOOR_ROOMS).flat().filter(r => !r.isStair);

// ============================================
// 状态管理
// ============================================
const state = {
    canvas: null,
    ctx: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    lastX: 0,
    lastY: 0,

    viewFloor: 1,           // 当前显示的楼层
    startRoomId: null,
    endRoomId: null,
    pathSegments: [],       // [{floor, path:[...]}]
    currentStep: 0,
    pathSteps: [],
    voiceEnabled: true,  // 默认开启语音
    animOffset: 0,
    animFrame: null,
};

// ============================================
// A* 单层寻路
// ============================================
function astar(floorMap, start, end) {
    const rows = floorMap.length;
    const cols = floorMap[0].length;
    const key  = (r, c) => `${r},${c}`;

    const open   = new Map();
    const closed = new Set();
    const gScore = {};
    const parent = {};

    const sk = key(start[0], start[1]);
    gScore[sk] = 0;
    open.set(sk, { pos: start, f: Math.abs(start[0]-end[0]) + Math.abs(start[1]-end[1]) });

    const dirs = [[0,1],[0,-1],[1,0],[-1,0]];

    while (open.size > 0) {
        let cur = null, curKey = null, minF = Infinity;
        for (const [k, v] of open) {
            if (v.f < minF) { minF = v.f; cur = v.pos; curKey = k; }
        }

        if (cur[0] === end[0] && cur[1] === end[1]) {
            const path = [];
            let k = curKey;
            while (k) { path.unshift(k.split(",").map(Number)); k = parent[k]; }
            return path;
        }

        open.delete(curKey);
        closed.add(curKey);

        for (const [dr, dc] of dirs) {
            const nr = cur[0] + dr, nc = cur[1] + dc;
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
            if (floorMap[nr][nc] === 0) continue;   // 墙壁不可通行
            const nk = key(nr, nc);
            if (closed.has(nk)) continue;
            const g = (gScore[curKey] || 0) + 1;
            if (g < (gScore[nk] ?? Infinity)) {
                gScore[nk] = g;
                parent[nk] = curKey;
                open.set(nk, {
                    pos: [nr, nc],
                    f: g + Math.abs(nr-end[0]) + Math.abs(nc-end[1])
                });
            }
        }
    }
    return null;
}

// ============================================
// 跨楼层寻路
// ============================================
/**
 * 返回 pathSegments:
 * [
 *   { floor: 1, path: [[r,c],...], stairTaken: "stairA"|null },
 *   { floor: 2, path: [[r,c],...], stairTaken: null },
 *   ...
 * ]
 */
function planMultiFloorRoute(startRoom, endRoom) {
    // 同楼层
    if (startRoom.floor === endRoom.floor) {
        const path = astar(FLOOR_MAPS[startRoom.floor], startRoom.door, endRoom.door);
        if (!path) return null;
        return [{ floor: startRoom.floor, path, stairTaken: null }];
    }

    const segments = [];
    let currentFloor  = startRoom.floor;
    let currentPos    = startRoom.door;
    const targetFloor = endRoom.floor;
    const direction   = targetFloor > currentFloor ? 1 : -1;

    while (currentFloor !== targetFloor) {
        const floorMap = FLOOR_MAPS[currentFloor];

        // 找最近的可达楼梯
        let bestStairId   = null;
        let bestStairPath = null;
        let bestLen       = Infinity;

        for (const [sid, sn] of Object.entries(STAIR_NODES)) {
            const stairPos  = [sn.r, sn.c];
            const pathToStair = astar(floorMap, currentPos, stairPos);
            if (pathToStair && pathToStair.length < bestLen) {
                bestLen       = pathToStair.length;
                bestStairId   = sid;
                bestStairPath = pathToStair;
            }
        }

        if (!bestStairPath) return null;   // 找不到楼梯

        segments.push({ floor: currentFloor, path: bestStairPath, stairTaken: bestStairId });
        currentFloor += direction;
        currentPos    = STAIR_NODES[bestStairId];  // 新楼层起点 = 同位置楼梯口
        currentPos    = [currentPos.r, currentPos.c];
    }

    // 最后一段：当前楼层 → 终点
    const lastPath = astar(FLOOR_MAPS[currentFloor], currentPos, endRoom.door);
    if (!lastPath) return null;
    segments.push({ floor: currentFloor, path: lastPath, stairTaken: null });

    return segments;
}

// ============================================
// 步进导航生成（相对转向版）
// ============================================
// 方向：N=北(上), S=南(下), E=东(右), W=西(左)
const DIR_DELTA = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };

function getDir(r1, c1, r2, c2) {
    if (r2 < r1) return "N";
    if (r2 > r1) return "S";
    if (c2 > c1) return "E";
    if (c2 < c1) return "W";
    return null;
}

// 根据当前朝向和目标方向，返回相对转向
function getRelativeTurn(currentFacing, targetDir) {
    // currentFacing: 当前面朝方向
    // targetDir: 想要去的方向
    // 返回: "直行", "左转", "右转", "掉头"
    if (currentFacing === targetDir) return "直行";
    const order = ["N", "E", "S", "W"];
    const fromIdx = order.indexOf(currentFacing);
    const toIdx = order.indexOf(targetDir);
    const diff = (toIdx - fromIdx + 4) % 4;
    if (diff === 1) return "右转";
    if (diff === 3) return "左转";
    if (diff === 2) return "掉头";
    return "直行";
}

// 根据转向动作，更新朝向
function updateFacing(currentFacing, turnAction) {
    const order = ["N", "E", "S", "W"];
    const idx = order.indexOf(currentFacing);
    if (turnAction === "右转") return order[(idx + 1) % 4];
    if (turnAction === "左转") return order[(idx + 3) % 4];
    if (turnAction === "掉头") return order[(idx + 2) % 4];
    return currentFacing; // 直行不改变朝向
}

// 推断用户从房间出来时的初始朝向（面向走廊内侧）
function getInitialFacing(roomDoorR, roomDoorC, floor) {
    // 检查门在哪个过道
    if (roomDoorR === 5) return "S"; // 北过道，门朝南（从房间出来面向南）
    if (roomDoorR === 9) return "N"; // 南过道，门朝北
    if (roomDoorC === 0) return "E"; // 西侧入口，面向东
    if (roomDoorC === 24) return "W"; // 东侧楼梯入口，面向西
    return "E"; // 默认朝东
}

function generateSteps(segments, startRoom, endRoom) {
    state.pathSteps   = [];
    state.currentStep = 0;

    // 推断初始朝向
    let facing = getInitialFacing(startRoom.door[0], startRoom.door[1], startRoom.floor);

    // 出发
    state.pathSteps.push({
        icon: "🚪",
        instruction: `从 ${startRoom.name} 出发`,
        hint: startRoom.desc,
        floor: startRoom.floor,
    });

    for (let si = 0; si < segments.length; si++) {
        const seg = segments[si];
        const path = seg.path;
        const isLastSeg = si === segments.length - 1;

        // 分析路径，生成相对转向步骤
        let lastDir  = null;
        let runDist  = 0;

        for (let i = 1; i < path.length; i++) {
            const [r1,c1] = path[i-1];
            const [r2,c2] = path[i];
            const dir = getDir(r1,c1,r2,c2);

            if (dir === lastDir) {
                runDist++;
            } else {
                if (lastDir !== null) {
                    // 先转向（如果需要）
                    const turn = getRelativeTurn(facing, dir);
                    if (turn !== "直行") {
                        state.pathSteps.push({
                            icon: turn === "右转" ? "↪️" : turn === "左转" ? "↩️" : "🔄",
                            instruction: `${turn}`,
                            hint: "注意前方转角",
                            floor: seg.floor,
                        });
                        facing = updateFacing(facing, turn);
                    }
                    // 再直行
                    state.pathSteps.push({
                        icon: "⬆️",
                        instruction: `直行 ${((runDist+1)*0.5).toFixed(1)} 米`,
                        hint: getNearbyHint(r1, c1, seg.floor),
                        floor: seg.floor,
                    });
                }
                runDist = 0;
                lastDir = dir;
            }
        }
        // 最后一段（到达前）
        if (lastDir !== null) {
            const [lr, lc] = path[path.length - 1];
            // 最后转向到达目的地
            const finalTurn = getRelativeTurn(facing, lastDir);
            if (finalTurn !== "直行") {
                state.pathSteps.push({
                    icon: finalTurn === "右转" ? "↪️" : finalTurn === "左转" ? "↩️" : "🔄",
                    instruction: `${finalTurn}`,
                    hint: isLastSeg ? "即将到达目的地" : "前方即是楼梯间",
                    floor: seg.floor,
                });
                facing = updateFacing(facing, finalTurn);
            }
            state.pathSteps.push({
                icon: "⬆️",
                instruction: `直行 ${((runDist+1)*0.5).toFixed(1)} 米`,
                hint: isLastSeg ? "即将到达目的地" : "前方即是楼梯间",
                floor: seg.floor,
            });
        }

        // 换层提示（上楼/下楼时更新朝向）
        if (seg.stairTaken) {
            const nextFloor = segments[si+1]?.floor;
            const stairName = STAIR_NODES[seg.stairTaken]?.name || "楼梯间";
            const upOrDown  = nextFloor > seg.floor ? "上楼" : "下楼";
            state.pathSteps.push({
                icon: nextFloor > seg.floor ? "⬆️🪜" : "⬇️🪜",
                instruction: `${upOrDown}至 ${nextFloor} 楼`,
                hint: `经过 ${stairName}，${upOrDown}到第 ${nextFloor} 层，注意扶手`,
                floor: seg.floor,
                isFloorChange: true,
                fromFloor: seg.floor,
                toFloor: nextFloor,
            });
            // 上楼后，假设用户面向与楼梯入口相反的方向（进入走廊）
            // 楼梯入口在列24，面向西（W），上楼后应该面向西继续走
            facing = "W";
        }
    }

    // 到达（最后一步：进入房间）
    state.pathSteps.push({
        icon: "🎯",
        instruction: `到达 ${endRoom.name}`,
        hint: endRoom.desc,
        floor: endRoom.floor,
    });

    renderSteps();
}

function getNearbyHint(r, c, floor) {
    const floorRooms = FLOOR_ROOMS[floor] || [];
    const nearby = floorRooms.find(room => {
        const [dr, dc] = room.door;
        return Math.abs(dr - r) + Math.abs(dc - c) <= 2;
    });
    if (nearby) return `经过 ${nearby.name} 门口`;
    const val = FLOOR_MAPS[floor]?.[r]?.[c];
    if (val === 3) return "经过楼梯间，注意安全";
    if (val === 4) return "经过卫生间";
    return "沿走廊前行";
}

// ============================================
// Canvas 渲染
// ============================================
function initCanvas() {
    state.canvas = document.getElementById("mapCanvas");
    if (!state.canvas) return;
    state.ctx    = state.canvas.getContext("2d");
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    bindCanvasEvents();
    startLoop();
}

function resizeCanvas() {
    const cont = state.canvas.parentElement;
    state.canvas.width  = cont.clientWidth;
    state.canvas.height = cont.clientHeight;
    fitView();
}

function fitView() {
    const mapW = COLS * MAP_CONFIG.cellSize;
    const mapH = ROWS * MAP_CONFIG.cellSize;
    const sx = state.canvas.width  / mapW;
    const sy = state.canvas.height / mapH;
    state.scale   = Math.min(sx, sy) * 0.92;
    state.offsetX = (state.canvas.width  - mapW * state.scale) / 2;
    state.offsetY = (state.canvas.height - mapH * state.scale) / 2;
}

function startLoop() {
    const tick = () => {
        state.animOffset = (state.animOffset + 0.4) % 20;
        render();
        state.animFrame = requestAnimationFrame(tick);
    };
    state.animFrame = requestAnimationFrame(tick);
}

// ── 交互事件 ──────────────────────────────────
function bindCanvasEvents() {
    state.canvas.addEventListener("mousedown",  e => { e.preventDefault(); state.isDragging=true; const p=getPoint(e); state.lastX=p.x; state.lastY=p.y; });
    state.canvas.addEventListener("touchstart", e => { e.preventDefault(); state.isDragging=true; const p=getPoint(e); state.lastX=p.x; state.lastY=p.y; }, { passive:false });
    window.addEventListener("mousemove",  e => { if(!state.isDragging) return; const p=getPoint(e); state.offsetX+=p.x-state.lastX; state.offsetY+=p.y-state.lastY; state.lastX=p.x; state.lastY=p.y; });
    window.addEventListener("touchmove",  e => { if(!state.isDragging) return; e.preventDefault(); const p=getPoint(e); state.offsetX+=p.x-state.lastX; state.offsetY+=p.y-state.lastY; state.lastX=p.x; state.lastY=p.y; }, { passive:false });
    window.addEventListener("mouseup",    () => state.isDragging=false);
    window.addEventListener("touchend",   () => state.isDragging=false);
    state.canvas.addEventListener("wheel", e => {
        e.preventDefault();
        const d = e.deltaY > 0 ? 0.9 : 1.1;
        const ns = Math.max(0.4, Math.min(5, state.scale * d));
        const rect = state.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        state.offsetX = mx - (mx - state.offsetX) * (ns / state.scale);
        state.offsetY = my - (my - state.offsetY) * (ns / state.scale);
        state.scale   = ns;
    }, { passive:false });
}

function getPoint(e) {
    if (e.touches?.length > 0) return { x:e.touches[0].clientX, y:e.touches[0].clientY };
    return { x:e.clientX, y:e.clientY };
}

// ── 主渲染 ────────────────────────────────────
function render() {
    const ctx  = state.ctx;
    if (!ctx) return;
    const cell = MAP_CONFIG.cellSize * state.scale;
    const floor = state.viewFloor;
    const floorMap = FLOOR_MAPS[floor];

    // 背景（墙色）
    ctx.fillStyle = MAP_CONFIG.wallColor;
    ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);

    // 绘制格子
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const val = floorMap[r][c];
            if (val === 0) continue;
            const color = MAP_CONFIG.colors[val];
            if (!color) continue;
            ctx.fillStyle = color;
            const x = state.offsetX + c * cell;
            const y = state.offsetY + r * cell;
            ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        }
    }

    // 绘制当前楼层的路径段
    const seg = state.pathSegments.find(s => s.floor === floor);
    if (seg) drawPath(ctx, cell, seg.path);

    // 绘制楼梯标记（换层点高亮）
    for (const [sid, sn] of Object.entries(STAIR_NODES)) {
        const isUsed = state.pathSegments.some(s => s.stairTaken === sid);
        drawStairMark(ctx, cell, sn, isUsed);
    }

    // 起终点标记（如果在当前楼层）
    const startRoom = ALL_ROOMS.find(r => r.id === state.startRoomId);
    const endRoom   = ALL_ROOMS.find(r => r.id === state.endRoomId);
    if (startRoom?.floor === floor) drawMarker(ctx, cell, startRoom.door, MAP_CONFIG.startColor, "S");
    if (endRoom?.floor   === floor) drawMarker(ctx, cell, endRoom.door,   MAP_CONFIG.endColor,   "E");

    // 房间标签
    drawRoomLabels(ctx, cell, floor);

    // 楼层指示
    drawFloorIndicator(ctx, floor);
}

function drawPath(ctx, cell, path) {
    if (!path || path.length < 2) return;
    ctx.save();
    // 光晕
    ctx.shadowColor = "rgba(59,130,246,0.6)";
    ctx.shadowBlur  = 14;
    ctx.strokeStyle = "rgba(59,130,246,0.3)";
    ctx.lineWidth   = Math.max(5, cell * 0.4);
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    path.forEach(([r,c],i) => {
        const x = state.offsetX + c * cell + cell/2;
        const y = state.offsetY + r * cell + cell/2;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
    // 主线（流动虚线）
    ctx.shadowBlur  = 0;
    ctx.strokeStyle = MAP_CONFIG.pathColor;
    ctx.lineWidth   = Math.max(2.5, cell * 0.18);
    ctx.setLineDash([cell*0.5, cell*0.35]);
    ctx.lineDashOffset = -state.animOffset * (cell/12);
    ctx.beginPath();
    path.forEach(([r,c],i) => {
        const x = state.offsetX + c * cell + cell/2;
        const y = state.offsetY + r * cell + cell/2;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
}

function drawMarker(ctx, cell, [r,c], color, label) {
    const x = state.offsetX + c * cell + cell/2;
    const y = state.offsetY + r * cell + cell/2;
    const radius = Math.max(8, cell * 0.48);
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(x, y, radius*0.42, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `bold ${radius*0.85}px Arial`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillText(label, x, y);
    ctx.restore();
}

function drawStairMark(ctx, cell, stairNode, highlighted) {
    const x = state.offsetX + stairNode.c * cell + cell/2;
    const y = state.offsetY + stairNode.r * cell + cell/2;
    const r = Math.max(6, cell * 0.38);
    ctx.save();
    ctx.fillStyle = highlighted ? MAP_CONFIG.stairLinkColor : "rgba(245,158,11,0.4)";
    if (highlighted) { ctx.shadowColor = MAP_CONFIG.stairLinkColor; ctx.shadowBlur = 12; }
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${r}px Arial`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;
    ctx.fillText("🪜", x, y);
    ctx.restore();
}

function drawRoomLabels(ctx, cell, floor) {
    if (cell < 7) return;
    ctx.save();
    ctx.font = `bold ${Math.max(7, cell * 0.5)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    const def = FLOOR_DEFS[floor];
    if (!def) { ctx.restore(); return; }
    for (const rd of def.rooms) {
        // 房间中心 = 两端格子中点
        const cr = (rd.r1 + rd.r2) / 2;
        const cc = (rd.c1 + rd.c2) / 2;
        const x  = state.offsetX + cc * cell + cell/2;
        const y  = state.offsetY + cr * cell + cell/2;
        // 获取房间名（去除emoji）
        const room = FLOOR_ROOMS[floor]?.find(r => r.id === rd.id);
        const shortName = (room?.name || rd.id).replace(/[\u{1F000}-\u{1FFFF}]|[\u2600-\u27FF]/gu,"").trim();
        ctx.fillText(shortName, x, y);
    }
    ctx.restore();
}

function drawFloorIndicator(ctx, floor) {
    ctx.save();
    ctx.font = "bold 14px 'Microsoft YaHei', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.textAlign  = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`当前显示：第 ${floor} 层`, state.canvas.width - 12, 12);
    ctx.restore();
}

// ============================================
// 路线规划主逻辑
// ============================================
function initSelectors() {
    const startSel = document.getElementById("startSelect");
    const endSel   = document.getElementById("endSelect");
    if (!startSel || !endSel) return;

    // 按楼层分组
    for (let f = 1; f <= 3; f++) {
        const gStart = document.createElement("optgroup");
        const gEnd   = document.createElement("optgroup");
        gStart.label = gEnd.label = `第 ${f} 层`;
        for (const room of ALL_ROOMS.filter(r => r.floor === f)) {
            gStart.appendChild(new Option(room.name, room.id));
            gEnd.appendChild(new Option(room.name, room.id));
        }
        startSel.appendChild(gStart);
        endSel.appendChild(gEnd);
    }

    // 默认值
    startSel.value = "r1_entrance";
    endSel.value   = "r1_101";
}

function planRoute() {
    // 移动端：首次点击时初始化音频（用户交互后才能播放声音）
    if (state.voiceEnabled) {
        initAudio();
    }
    
    const startId = document.getElementById("startSelect")?.value;
    const endId   = document.getElementById("endSelect")?.value;

    if (!startId || !endId) { showResult("请选择起点和终点", "error"); return; }
    if (startId === endId)  { showResult("起点和终点不能相同", "error"); return; }

    const startRoom = ALL_ROOMS.find(r => r.id === startId);
    const endRoom   = ALL_ROOMS.find(r => r.id === endId);
    if (!startRoom || !endRoom) { showResult("位置信息无效", "error"); return; }

    // 验证门坐标
    const [sr,sc] = startRoom.door;
    const [er,ec] = endRoom.door;
    if (FLOOR_MAPS[startRoom.floor]?.[sr]?.[sc] === 0) {
        showResult(`起点"${startRoom.name}"的出口被墙壁阻挡，请重新选择`, "error"); return;
    }
    if (FLOOR_MAPS[endRoom.floor]?.[er]?.[ec] === 0) {
        showResult(`终点"${endRoom.name}"的出口被墙壁阻挡，请重新选择`, "error"); return;
    }

    const segments = planMultiFloorRoute(startRoom, endRoom);
    state.startRoomId = startId;
    state.endRoomId   = endId;

    if (!segments || segments.length === 0) {
        state.pathSegments = [];
        showResult("未找到可行路线，请检查起终点选择", "error");
        speak("未找到可行路线，请重新选择");
        return;
    }

    state.pathSegments = segments;

    // 切换地图到起点楼层
    switchToFloor(startRoom.floor);

    // 统计总步数和距离
    const totalSteps = segments.reduce((s, seg) => s + seg.path.length, 0);
    const floorChanges = segments.length - 1;
    const distance = (totalSteps * 0.5).toFixed(1);

    const floorInfo = floorChanges > 0
        ? `<span class="route-info-detail">🪜 途经 ${floorChanges} 次换层</span>`
        : `<span class="route-info-detail">📐 单层路线</span>`;

    showResult(`
        <div class="route-info">
            <div class="route-info-header"><span>✅</span>路线已规划</div>
            <div class="route-info-details">
                <span class="route-info-detail">📍 ${startRoom.name}（${startRoom.floor}层）</span>
                <span>→</span>
                <span class="route-info-detail">🎯 ${endRoom.name}（${endRoom.floor}层）</span>
                <span class="route-info-detail">📏 约 ${distance} 米</span>
                ${floorInfo}
            </div>
        </div>
    `, "success");

    generateSteps(segments, startRoom, endRoom);
    speak(`路线已规划，从${startRoom.name}出发，${floorChanges > 0 ? `途经${floorChanges}次换层，` : ""}前往${endRoom.name}，全程约${distance}米。`);
    playSuccessSound(); // 播放成功提示音
    showStepPanel();
    hapticFeedback("success");
}

function clearRoute() {
    state.pathSegments = [];
    state.startRoomId  = null;
    state.endRoomId    = null;
    state.pathSteps    = [];
    state.currentStep  = 0;
    document.getElementById("startSelect").value = "";
    document.getElementById("endSelect").value   = "";
    showResult(`<div class="result-placeholder"><span class="placeholder-icon">🗺️</span><p>选择起点和终点后点击"开始规划路线"</p></div>`);
    hideStepPanel();
    speak("路线已清除");
}

function showResult(html, type = "info") {
    const box = document.getElementById("routeResult");
    if (box) { box.innerHTML = html; box.className = `route-result is-${type}`; }
}

function swapLocations() {
    const s = document.getElementById("startSelect");
    const e = document.getElementById("endSelect");
    if (!s || !e) return;
    [s.value, e.value] = [e.value, s.value];
    hapticFeedback("light");
}

// ============================================
// 楼层切换
// ============================================
function switchToFloor(floor) {
    state.viewFloor = floor;
    // 更新楼层选择器高亮
    document.querySelectorAll(".floor-btn").forEach(btn => {
        btn.classList.toggle("is-active", Number(btn.dataset.floor) === floor);
    });
    // 通知屏幕阅读器
    const liveRegion = document.getElementById("floorAnnounce");
    if (liveRegion) liveRegion.textContent = `正在查看第 ${floor} 层平面图`;
}

function initFloorButtons() {
    document.querySelectorAll(".floor-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const f = Number(btn.dataset.floor);
            switchToFloor(f);
            hapticFeedback("light");
        });
    });
    // 默认显示一楼
    switchToFloor(1);
}

// ============================================
// 步进面板
// ============================================
function renderSteps() {
    const stepList = document.getElementById("stepList");
    if (!stepList) return;

    stepList.innerHTML = state.pathSteps.map((step, idx) => {
        const isActive = idx === state.currentStep;
        const floorTag = step.isFloorChange
            ? `<span class="step-floor-tag is-change">换层 → ${step.toFloor}楼</span>`
            : `<span class="step-floor-tag">${step.floor}楼</span>`;
        return `
            <div class="step-item ${isActive ? "is-active" : ""}" data-index="${idx}">
                <span class="step-number">${idx + 1}</span>
                <div class="step-content">
                    <div class="step-instruction">${step.icon} ${step.instruction}</div>
                    <div class="step-hint">${step.hint}</div>
                </div>
                ${floorTag}
            </div>
        `;
    }).join("");

    updateStepCounter();

    // 滚动到当前步骤
    stepList.querySelector(".is-active")?.scrollIntoView({ behavior:"smooth", block:"center" });

    // 如果是换层步骤，自动切换地图
    const cur = state.pathSteps[state.currentStep];
    if (cur?.isFloorChange && cur.toFloor) {
        switchToFloor(cur.toFloor);
    } else if (cur?.floor) {
        switchToFloor(cur.floor);
    }
}

function showStepPanel()  { document.getElementById("stepPanel")?.classList.remove("is-hidden"); }
function hideStepPanel()  { document.getElementById("stepPanel")?.classList.add("is-hidden"); }

function nextStep() {
    if (state.currentStep < state.pathSteps.length - 1) {
        state.currentStep++;
        renderSteps();
        speakCurrentStep();
    }
}

function prevStep() {
    if (state.currentStep > 0) {
        state.currentStep--;
        renderSteps();
        speakCurrentStep();
    }
}

function updateStepCounter() {
    const counter = document.getElementById("stepCounter");
    const prevBtn = document.getElementById("prevStep");
    const nextBtn = document.getElementById("nextStep");
    if (counter) counter.textContent = `${state.currentStep+1} / ${state.pathSteps.length}`;
    if (prevBtn) prevBtn.disabled = state.currentStep === 0;
    if (nextBtn) nextBtn.disabled = state.currentStep === state.pathSteps.length - 1;
}

// ============================================
// 语音 & 触觉
// ============================================
function toggleVoice() {
    state.voiceEnabled = !state.voiceEnabled;
    const btn  = document.getElementById("voiceToggle");
    const icon = btn?.querySelector(".voice-icon");
    if (btn)  btn.setAttribute("aria-pressed", state.voiceEnabled);
    if (icon) icon.textContent = state.voiceEnabled ? "🔊" : "🔇";
    if (state.voiceEnabled) {
        // 立即初始化并播放（必须在用户点击事件里同步执行）
        initAudio();
        playSuccessSound();
    }
    hapticFeedback("light");
}

// 创建简单的提示音（使用 Web Audio API，但简化实现）
let audioCtx = null;

// 初始化音频（在用户交互时调用）
function initAudio() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.log('音频不支持');
        }
    }
    return audioCtx;
}

// 播放提示音
function playBeep() {
    if (!state.voiceEnabled) return;
    
    const ctx = initAudio();
    if (!ctx) return;
    
    // 恢复音频上下文（移动端必需）
    if (ctx.state === 'suspended') {
        ctx.resume();
    }
    
    try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'sine';
        osc.frequency.value = 600; // 降低频率，声音更柔和
        
        gain.gain.setValueAtTime(0.2, ctx.currentTime); // 降低音量
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1); // 缩短时长
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
        // 忽略错误
    }
}

// 播放成功提示音
function playSuccessSound() {
    if (!state.voiceEnabled) return;
    playBeep();
    setTimeout(() => playBeep(), 120);
}

// 播放步骤提示音
function playStepSound() {
    playBeep();
}

function speak(text) {
    const el = document.querySelector(".voice-text");
    if (el) el.textContent = text;
    
    // 播放提示音作为替代
    if (state.voiceEnabled) {
        playBeep(800, 0.1, 'sine');
    }
    
    // 尝试使用语音合成（可能不支持）
    if (!state.voiceEnabled || !window.speechSynthesis) return;
    
    // 检查是否是移动设备，移动设备上 speechSynthesis 经常有问题
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isMobile) {
        // 移动设备只播放提示音，不使用语音合成
        return;
    }
    
    try {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = "zh-CN"; utt.rate = 1.05; utt.pitch = 1;
        window.speechSynthesis.speak(utt);
    } catch (e) {
        // 语音合成失败，静默处理（已经播放了提示音）
    }
}

function speakCurrentStep() {
    const step = state.pathSteps[state.currentStep];
    if (step) {
        speak(`第${state.currentStep+1}步：${step.instruction}。${step.hint}`);
        playStepSound();
    }
}

function hapticFeedback(type = "light") {
    if (!navigator.vibrate) return;
    const p = { light:[10], medium:[20], heavy:[30,50,30], success:[10,50,10], error:[50,100,50] };
    navigator.vibrate(p[type] || p.light);
}

// ============================================
// 地图控制
// ============================================
function zoomIn()  { state.scale = Math.min(5, state.scale * 1.2); }
function zoomOut() { state.scale = Math.max(0.4, state.scale / 1.2); }
function resetView() { fitView(); }

// ============================================
// 事件绑定
// ============================================
function bindEvents() {
    document.getElementById("planBtn")?.addEventListener("click", planRoute);
    document.getElementById("clearBtn")?.addEventListener("click", clearRoute);
    document.getElementById("quickSwap")?.addEventListener("click", swapLocations);
    document.getElementById("voiceToggle")?.addEventListener("click", toggleVoice);
    document.getElementById("zoomIn")?.addEventListener("click", zoomIn);
    document.getElementById("zoomOut")?.addEventListener("click", zoomOut);
    document.getElementById("resetView")?.addEventListener("click", resetView);
    document.getElementById("closeStep")?.addEventListener("click", hideStepPanel);
    document.getElementById("nextStep")?.addEventListener("click", nextStep);
    document.getElementById("prevStep")?.addEventListener("click", prevStep);

    document.addEventListener("keydown", e => {
        if (e.key === "Escape")                             hideStepPanel();
        if (e.key === "ArrowRight" || e.key === " ")        { e.preventDefault(); nextStep(); }
        if (e.key === "ArrowLeft")                          { e.preventDefault(); prevStep(); }
        if (e.key === "v" && (e.ctrlKey||e.metaKey))        { e.preventDefault(); toggleVoice(); }
        if (e.key === "1") switchToFloor(1);
        if (e.key === "2") switchToFloor(2);
        if (e.key === "3") switchToFloor(3);
    });
}

// ============================================
// 初始化
// ============================================
function init() {
    initCanvas();
    initSelectors();
    initFloorButtons();
    bindEvents();
    console.log("🏫 室内导航系统 v3.0（多楼层）已启动");
    console.log(`楼层数：3，每层地图：${ROWS}×${COLS}，楼梯节点：${Object.keys(STAIR_NODES).length}处`);
}

document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", init)
    : init();
