# Gravity Duel: Skyline — 架構規劃（草案 v0.1）

> 工作名稱，可改。分支 `skyline`，遊戲放在 `games/skyline/`，可重用的部分放在 `engine/`。
> 這份文件是實作前的藍圖：先把層次、資料契約與里程碑定下來，數值都是起始值，之後靠測試與試玩調整。

## 1. 一句話

Gravity Duel 世界觀下的 3D 第三人稱機甲 1 對 1 對戰：在城市裡跑高速公路、跳上大樓、躲進巷弄；
火神砲直射、近戰鎖定衝刺、遠程武器切進第一人稱瞄準。

### 目標

- 瀏覽器執行，無需安裝（開發時用現有的 `lan-server.js` 或桌面版 launcher 提供服務）。
- 單人對電腦、區域網路 1 對 1。沿用現有的 LAN 伺服器、房間探索、桌面版打包。
- 引擎層（`engine/`）不含任何這款遊戲的規則，下一款遊戲只需提供資料與規則。
- 模擬層不碰 DOM、不碰 Three.js，可在 Node 跑測試，和現在的 `physics.js`/`combat.js` 一樣。

### 非目標（第一版）

- 同一台電腦雙人（3D 加滑鼠瞄準，一台電腦只有一隻滑鼠；分割畫面列為 M5 選項）。
- 外部 3D 模型檔。機體與城市全部程式化產生，和現在「音效用合成、畫面用方塊」的路線一致。
- 可破壞的建築、天氣、劇情。

## 2. 技術選型

| 項目 | 決定 | 理由 | 放棄的選項 |
|---|---|---|---|
| 3D 繪圖 | **Three.js**（ESM，固定版本複製到 `vendor/three/`） | 真 3D 相機、深度、後製都是現成的；自己寫 WebGL 引擎會吃掉所有時間 | 自寫 WebGL（太大）、Babylon（更重）、延用 2.5D Canvas（做不出跳樓頂與第一人稱） |
| 模組系統 | **ES modules + import map** | Three.js 只有 ESM；Node 22 測試可直接 import 同一份檔案 | 傳統 script（Three 已不提供 UMD） |
| 建置工具 | **沒有**。直接服務原始檔 | 和現在一樣零建置；需要單檔時再加 esbuild 一步 | 一開始就上 bundler |
| 供應方式 | **一定走 HTTP**（launcher、`node server/lan-server.js`、claude.ai artifact） | Chrome 不允許 file:// 載入 ES modules | 雙擊 index.html（原作可以，這款不行） |
| 瞄準輸入 | **Pointer Lock API** 優先，鍵盤方向鍵備援 | 第一人稱瞄準需要相對位移的滑鼠；沒有滑鼠或 iframe 不允許時用鍵盤 | 只用絕對座標的滑鼠 |
| 物理 | **自寫**：AABB 世界 + 膠囊／AABB 角色控制器 + 線段掃掠 | 城市是方塊組成，簡單碰撞就夠；確定性、可測試、快照小 | cannon-es / rapier（多一個依賴、快照複雜、非必要） |
| 測試 | Node 測模擬；Playwright headless Chromium 測畫面 | 這個環境的 headless Chromium 有 WebGL2（SwiftShader），可截圖比對 | 只靠人工試玩 |

Three.js 版本在 M0 用 npm 安裝時固定（目前 0.186），只複製 `build/three.module.min.js` 與用到的 `examples/jsm/` 檔案進 `vendor/`，區網對戰不需要外網。

## 3. 分層與資料夾

```
engine/                     可重用，不知道「Skyline」是什麼
  core/      loop.js        固定 60 Hz 步進 + 畫面插值（沿用現在 main.js 的做法）
             rng.js         有種子的亂數（沿用 world.rnd）
             math.js        vec3 / 角度工具，純函式，不依賴 Three
             events.js      模擬 → 表現層的事件佇列（命中、爆炸、開火…）
  input/     intent.js      Intent 結構與按鍵邊緣鎖存
             keyboard.js  mouse.js（pointer lock）  gamepad.js  touch.js
             bindings.js    按鍵表由遊戲提供資料
  sim/       aabb.js        AABB 相交、線段 vs AABB（slab）
             statics.js     靜態碰撞體 + 空間雜湊（格 50 m）
             controller.js  角色控制器：分軸移動與推回、踏階、貼地、斜坡
             sweep.js       投射物／視線用的線段與球體掃掠
  render/    app.js         Renderer、尺寸、像素比、畫質等級
             rigs.js        第三人稱（鎖定／自由）、第一人稱瞄準、兩者間的過場
             hud.js         世界座標 → 螢幕投影、頭頂血條、準星、鎖定框
             mech-builder.js 由「零件樹」資料組出機體，含命名節點與程序動畫
             world-builder.js 由 Stage 資料組出城市視覺（InstancedMesh）
             fx.js  post.js 粒子、光束、噴射火焰；bloom 等後製（可關）
  audio/     synth.js       從 src/audio.js 抽出，事件名稱由遊戲提供
  net/       net.js         從 src/net.js 抽出的 Net 類別（連線、房間、位址）
             sync.js        Intent 編碼、快照緩衝與插值；序列化由遊戲提供
  ui/        screens.js     畫面堆疊、雙方「準備」邏輯（沿用 screens.js 的模式）
games/skyline/
  index.html  main.js       把 engine 與遊戲接起來
  config.js                 機體、武器、防具、場景參數、按鍵、手感數值。調平衡只改這裡
  rules/      world.js  fighter.js  weapons.js  damage.js   規則，不碰 DOM
  stages/     city.js       城市產生器（輸入種子與參數，輸出 Stage 資料）
  mechs/      *.js          機體外觀的零件樹資料
  ai/         brain.js  nav.js  perception.js
  screens/    title / loadout / cpu / lan / pause / ko / help 的內容
  tests/
server/  app/  installer/  tools/     共用，不動（launcher 之後開一個列出兩款遊戲的入口頁）
vendor/three/                         固定版本的 Three.js
src/  index.html                      原作，這個分支不動；之後要不要搬到 games/gravity-duel/ 另議
```

### 依賴規則（用測試守住）

1. `engine/sim`、`engine/core`、`games/*/rules`、`games/*/ai`、`games/*/stages` 不得 import Three 或碰 `window`/`document`。
2. `engine/render` 只讀模擬狀態，不改它；要影響模擬只能透過 Intent。
3. `engine/*` 不得 import `games/*`。遊戲把資料與回呼交給引擎。
4. 事件（聲音、特效）由模擬放進 `events` 佇列，表現層消費；區網時主機把事件附在快照裡送出（同現在的做法）。

## 4. 核心資料契約

一款新遊戲只需要提供這幾樣東西，引擎的其餘部分照用。

### Intent（每 tick 一份，鍵盤／滑鼠／手把／觸控／AI／遠端都產生同一種）

```js
{
  move: { x, z },        // 世界座標方向，長度 0..1。客戶端用自己的鏡頭 yaw 轉好再送，主機不需要知道鏡頭
  aim:  { yaw, pitch },  // 絕對角度（弧度）。第一人稱瞄準與遠程開火用
  held: { boost, attack, guard },           // 持續按住
  pressed: { attack, sub, switch, dash, lock, jump }  // 邊緣觸發，0.15 s 緩衝（沿用現有輸入緩衝）
}
```

遠端送出時編成 4 個 float + 1 個 byte；一開始先用 JSON，LAN 頻寬夠。

### World（模擬狀態，純資料，可整份 JSON 化）

```js
{
  tick, dt, rnd, winner,
  stage: { id, gravity, bounds, statics: [AABB...], ramps: [...], spawns: [...] },
  fighters: [ { id, pos, vel, yaw, aim, onGround, fuel, heat, hp, armor, weaponClass,
                active: 'melee'|'vulcan'|'ranged', phase, timers, lock, stun, guard, ... }, ... ],
  projectiles: [ { id, kind, owner, pos, vel, gravityScale, ttl } ],
  events: [ { t: 'hit', x, y, z, ... } ]   // 每 tick 清空
}
```

### Stage 資料（產生器輸出，模擬與表現層共用）

```js
{
  id: 'city', seed, gravity, bounds: { minX, maxX, minZ, maxZ, ceiling },
  statics: [ { min: [x,y,z], max: [x,y,z], tag: 'building'|'deck'|'rail'|'ground' } ],
  ramps:   [ { min, max, axis: 'x'|'z', from: y0, to: y1 } ],   // 斜坡：足跡 AABB + 線性高度
  spawns:  [ { pos, yaw }, { pos, yaw } ],
  visual:  { blocks: [...], roads: [...], highway: [...], palette }  // 只給 world-builder 用
}
```

### Mech 外觀資料（零件樹）

```js
{ id: 'ax01', palette: { armor, trim, glow }, root: {
    name: 'torso', shape: 'box', size: [8, 7, 5], pos: [0, 11, 0], mat: 'armor',
    children: [ { name: 'head', shape: 'box', ... , children: [ { name: 'visor', mat: 'glow', ... } ] },
                { name: 'armL', ... }, { name: 'thrusterL', shape: 'cone', mat: 'glow', ... } ] } }
```

`mech-builder` 依名稱找到 torso / head / armR / legs / thrusters / muzzle 等節點做程序動畫（跑步、噴射火焰、舉槍、揮砍），所以不同設計只要節點名稱一致就能共用動畫。

### Game 介面（遊戲交給引擎的東西）

```js
{
  config, bindings, screens,
  createWorld(options, seed), step(world, intents, dt),
  serialize(world) / apply(world, snapshot),        // 區網快照
  cameraTarget(world, playerId), hudModel(world, playerId),   // 引擎據此擺鏡頭、畫 HUD
  mechDesign(fighter), stageVisual(world.stage),
  createAI(level, seed), aiIntent(ai, world, playerId, dt)
}
```

## 5. 遊戲系統設計

### 5.1 單位與尺度

公尺、Y 朝上（Three.js 慣例）。機體高 18 m。城市 8×8 個街區、間距 100 m（70 m 建物 + 30 m 街道），
競技場 800 m 見方，外圍是能量圍欄。建物高 25–130 m；高架道路甲板高 16 m、寬 36 m，繞內圈 4×4 街區一圈，四個角落有上下匝道。

重力用「手感重力」：地球 32 m/s²（18 m 的機體用真實 1 g 會飄）。重力是場景參數，沿用世界觀：之後的月面城市會用 1/6，跳得高、彈道平。

### 5.2 移動與碰撞

- 角色是 10×18×10 的 AABB（之後視手感換膠囊）。移動分三軸：先 x 再 z 再 y，每軸碰到就推回。簡單、穩定、確定。
- 踏階 2 m（路緣、欄杆）；貼地讓斜坡與匝道不會「跳格」。
- 跑 28 m/s；衝刺 60 m/s 持續 0.3 s、冷卻 1.2 s，衝刺有短暫無敵。
- 噴射（按住 boost）：向上 45 m/s²，燃料 3 s，落地回充；落地有 0.15 s 硬直，從高處落下不扣血。要在 2 s 內上得了 60 m 的樓頂。
- 投射物：每 tick 用線段掃掠對靜態 AABB 與機體 AABB。視線（LOS）同一個函式。
- 鏡頭碰撞：從機體胸口往鏡頭位置做球體掃掠，有建物就縮短吊臂。

### 5.3 鏡頭

三個鏡頭都在表現層，是各客戶端自己的事；模擬只拿到 Intent。

| 模式 | 進入 | 行為 |
|---|---|---|
| 第三人稱・鎖定（預設） | 戰鬥開始、按 lock | 機體面向對手（轉速有限制），移動變成環繞／橫移；鏡頭站在「對手 → 我」延長線後方 42 m、高 14 m，兩台機體都在畫面裡。FOV 55 |
| 第三人稱・自由 | 再按 lock、或對手失去視線超過 3 s | 滑鼠／右搖桿／方向鍵環繞鏡頭；機體面向移動方向 |
| 第一人稱・瞄準 | **按住瞄準鍵**（右鍵／K） | 鏡頭在頭部，yaw/pitch 直接就是 `aim`；畫面中央準星；FOV 40（長槍 30）；移動速度 ×0.6；身體隱藏只留槍管。放開瞄準鍵就回到第三人稱 |

模式切換用 0.25 s 的位置與 FOV 內插。第一人稱時看不到側後方，是遠程的代價。瞄準鍵對任何武器都有效（可以用來看遠方），但只有遠程武器能在瞄準中開火。

### 5.4 操作

| 動作 | 鍵盤＋滑鼠 | 純鍵盤（備援） | 手把 |
|---|---|---|---|
| 移動 | WASD | WASD | 左搖桿 |
| 鏡頭／準星 | 滑鼠（pointer lock） | 方向鍵（固定角速度） | 右搖桿 |
| 噴射（按住） | Space | Space | A |
| 攻擊（目前武器） | 滑鼠左鍵 / J | J | RT |
| 瞄準（按住，第一人稱） | 滑鼠右鍵 / K | K | LT |
| 切換武器 | 滾輪、1 / 2 / 3 | 1 / 2 / 3 | Y |
| 衝刺 | Shift / L | L | B |
| 防禦 | Ctrl / ; | ; | LB |
| 鎖定切換 | F | F | RB |
| 暫停 | Esc（同時解除 pointer lock） | Esc | Start |

按鍵表是資料（`config.js` 的 `BINDINGS`），引擎不寫死。觸控沿用現在 `touch.js` 的做法：左虛擬搖桿、右半邊拖曳當鏡頭、按鈕一排。純鍵盤瞄準可開「輕微吸附」：準星靠近目標時角速度變慢（滑鼠預設關）。

### 5.5 武器與防具

開局選 **武器類型**（普通／遠程／近戰）與 **防具**（普通／防遠程／防近戰）。火神砲人人都有。戰鬥中在 近戰／火神砲／遠程 間切換：拔出 0.3 s、冷卻 2.5 s（沿用）。

| 武器類型 | 遠程（第一人稱瞄準） | 近戰（鎖定衝刺） | 火神砲 |
|---|---|---|---|
| 普通 | 光束步槍：70、0.8 s/發、無彈道下墜、能量 30 | 光劍：三連 120/120/180，距離 45 m 內衝 30 m | 共用 |
| 遠程 | 長距離步槍：150、2 s/發、2× 變焦、瞄準時移動 ×0.4、後座 | 短刀：90，衝 20 m，快但弱 | 共用 |
| 近戰 | 手砲：40、0.5 s/發、實彈受重力（gravityScale 0.5） | 巨劍：320 單發，起手 0.35 s 有霸體，衝 40 m | 共用 |

- **火神砲**：沿身體正前方水平直射，錐形散佈 2.5°、射程 150 m、6/發、15 發/秒、過熱 3 s。不能抬頭：對方站在 30 m 的樓頂就打不到。這讓「跳上建築」直接成為對策。
- **遠程**：只有在按住瞄準鍵、處於第一人稱時才能開火。準星用滑鼠或方向鍵，開火沿 `aim` 方向。
- **近戰**：有鎖定且在距離內，攻擊鍵先衝刺再揮砍；沒鎖定就原地揮。
- **防禦**：傷害 ×0.5，巨劍可破防；防禦中不能移動。

| 防具 | 遠程傷害 | 火神砲（輕彈） | 近戰傷害 | 速度 |
|---|---|---|---|---|
| 普通 | ×1.0 | ×1.0 | ×1.0 | ×1.0 |
| 防遠程 | ×0.65 | ×0.55 | ×1.2 | ×0.95 |
| 防近戰 | ×1.2 | ×1.2 | ×0.6 | ×0.95 |

HP 1000。平衡目標沿用原作：9 種組合兩兩對戰（AI、固定種子），每種組合的平均勝率落在 40–60%，測試不過就擋 commit。

### 5.6 城市場景

`stages/city.js` 吃種子與參數，輸出第 4 節的 Stage 資料，同一個種子永遠產生同一座城市（區網只傳種子）。

- 街區：每格隨機 1–3 棟建物，高度依「離中心距離」分布（中心高、邊緣低），保證每個街區至少一個 25–45 m 的「可上樓頂」跳板，讓高樓可以分段爬。
- 高速公路：繞內圈的矩形環，甲板 AABB、兩側 1.5 m 欄杆（踏階上得去、擋彈）、四個匝道（ramps）。跑在上面最快，但毫無掩蔽。
- 街道：30 m 寬，能擋火神砲與視線的巷弄。路口有少量矮物件（高架柱、廣告塔）當掩體。
- 圍欄：`bounds` 四面與 300 m 天花板；榴彈類之後碰到就炸（沿用 wallBurst）。
- 視覺：建物 InstancedMesh（一次 draw），窗戶用程式畫的 emissive 貼圖，夜城配色（深藍底、暖窗光、霓虹 trim）；地面 blob 陰影永遠開（跳躍判斷高度靠它），真陰影是選項。

### 5.7 HUD

DOM 覆蓋層，不用 Three 畫文字。

- 自己：HP、燃料、過熱、能量／彈藥、目前武器與切換冷卻、衝刺冷卻。
- **對手頭頂血條**：每幀把頭部世界座標投影到螢幕；**只有在有視線時顯示**（掃掠一次），沒視線時淡出，改顯示畫面邊緣一個指向「最後看到的位置」的箭頭。躲進建築間就真的躲得掉。
- 鎖定框、第一人稱準星（命中時變色）、受擊方向指示、KO 橫幅。

### 5.8 機體外觀

全部程式化，但要「華麗」：多層裝甲板、肩部大型鰭翼、背後像披風的噴射翼、關節與裝甲縫發光（bloom）、頭部多叉冠飾與單一條狀面罩。
噴射時翼展開、火焰拉長；揮砍留光帶；受擊時 trim 閃白。

IP 防線：不用 V 字天線、不用紅藍白黃三色配置、不做「嘴部散熱口 + 雙眼」的臉。四台機體沿用原作的 AX-01 VANGUARD 等名稱與性格（這些是我們自己的設定）。

### 5.9 音效

`engine/audio/synth.js` 從 `src/audio.js` 抽出：事件名稱 → 合成配方由遊戲註冊。新增 3D 定位（以鏡頭為聽者，用 PannerNode）。

## 6. AI

- **感知**：只知道有視線時的對手位置；失去視線後記住最後位置並前往搜索（否則躲藏對電腦無效）。簡單難度看得慢、反應慢。
- **導航**：由 Stage 資料建 5 m 網格，標記可站立高度；街道格 → 樓頂格之間加「跳躍連結」（高度差 ≤ 噴射可達）。A* 找路，局部用掃掠避牆。高速公路匝道自然在網格裡。
- **戰術**（依配置）：遠程型拉距離、搶樓頂、對方接近就跳開；近戰型沿巷弄接近、在火神砲打不到的高度差切入；普通型看血量決定。
- **難度旋鈕**沿用現在的做法：反應時間、瞄準誤差、決策頻率、是否會用衝刺無敵與防禦。

## 7. 區域網路

主機權威，沿用整套基礎設施：`server/lan-server.js` 原封不動（它只轉送文字與廣播房間），大廳、房間探索、`/api/*` 照用。

- 來賓每 tick 送 Intent（含 `aim`，因為主機要知道他往哪開槍）；主機 60 Hz 模擬，20 Hz 送快照（`serialize(world)`，含事件）。
- 來賓畫面在最近兩份快照間插值（延遲約 100 ms），自己的鏡頭仍即時反應，所以瞄準不會有延遲感。
- 來賓自身移動的預測列為 M4 之後的選項；LAN 延遲通常 < 5 ms，先不做。
- 選單同步（雙方準備、主機選場景）沿用現在的 `goShared`。

## 8. 測試與效能

**Node（ESM）**：AABB 與線段相交、控制器（踏階、斜坡、落在樓頂、不穿牆）、投射物命中與視線、傷害矩陣、切換冷卻、KO、城市產生器同種子同輸出、導航網格與 A*、AI 會打人、9×9 配置平衡回合賽（固定種子）。

**Playwright**：載入遊戲頁、等第一幀、檢查 console 無錯誤、截圖存檔供人工看；進入戰鬥並送假輸入 3 秒確認沒有例外。這個環境的 headless Chromium 有 WebGL2，可以跑。

**效能預算**（1080p、內顯 60 fps）：draw call < 150（建物與窗戶 instancing）、三角形 < 300k、bloom 半解析度、模擬每 tick < 1 ms。畫質等級：低（無後製、無真陰影）／中／高。

## 9. 里程碑

每個里程碑結束：測試全過、commit、push、artifact 更新（artifact 用 import map 從 CDN 載 Three）。

| | 內容 | 驗收 |
|---|---|---|
| **M0 骨架** | 分支、資料夾、Three.js vendored、固定步進迴圈、AABB 碰撞、角色控制器、第三人稱自由鏡頭（滑鼠＋方向鍵）、一個方塊街區 | 能在街區跑、跳上矮樓、鏡頭不穿牆；控制器與碰撞的 Node 測試；Playwright 截圖 |
| **M1 城市與移動** | 城市產生器、高速公路與匝道、噴射燃料、衝刺、圍欄、blob 陰影、鏡頭碰撞 | 2 s 內上得了 60 m 樓頂、能跑完高架一圈；產生器同種子同輸出 |
| **M2 機體與戰鬥** | 機體零件樹與兩台華麗設計、鎖定、火神砲、近戰連段與衝刺、遠程第一人稱瞄準（滑鼠／鍵盤）、傷害矩陣、防禦、頭頂血條（含視線）、KO 與再戰 | 本機用假對手打完整場；命中、視線、矩陣、切換冷卻的測試 |
| **M3 對手與流程** | AI（感知、導航、戰術、三段難度）、選單（標題／配置／難度／暫停／KO／說明）、音效、平衡測試 | 單人模式完整；9 種配置勝率 40–60% |
| **M4 區網** | `engine/net` 同步層、快照插值、大廳接上、兩台機器實測、launcher 入口頁列出兩款遊戲、打包納入 `vendor/` | Windows／Mac 版互連對戰一場 |
| **M5 打磨** | bloom 與畫質等級、手把、觸控、第二場景（月面城市，低重力）、分割畫面雙人（選項） | 依試玩回饋 |

## 10. 決定（2026-10-09 確認）

1. **名稱與路徑**：`Gravity Duel: Skyline`、分支 `skyline`、`games/skyline/`。建議就這樣，名字之後可改。
2. **Three.js 依賴**：引入一個外部函式庫，代價是必須走 HTTP、不能雙擊 index.html。建議接受；桌面版與 artifact 本來就走 HTTP。
3. **第一版模式**：單人 + 區網；同機雙人（分割畫面）放 M5。建議接受。
4. **遠程瞄準方式**：已決定「按住瞄準鍵才進第一人稱，放開就回第三人稱」，像射擊遊戲的 ADS。
5. **躲藏規則**：對手血條只在有視線時顯示，沒視線改顯示最後位置的箭頭（建議）。另一種是血條永遠顯示，躲藏就只剩擋子彈。
6. **原作不動**：這個分支不改 `src/`；之後要不要把原作搬到 `games/gravity-duel/` 並改用 `engine/`，等 Skyline 的引擎穩定再決定。

## 11. 下一款遊戲怎麼用這個基礎

新遊戲 = 一個 `games/<name>/` 資料夾，提供第 4 節的 Game 介面：

1. `config.js`：單位、按鍵、數值。
2. `rules/`：`createWorld`、`step`、`serialize/apply`。只要是「純資料進、純資料出」，引擎的迴圈、區網、測試工具都直接可用。
3. `stages/`：輸出 Stage 資料。有 `statics`/`ramps` 就有碰撞、視線、導航網格；有 `visual` 就有畫面。
4. `mechs/`：零件樹。節點名稱一致就有動畫。
5. `screens/`：選單內容。畫面堆疊與雙方準備邏輯在引擎。
6. `ai/`：產生 Intent 的函式。

不想要 3D 的遊戲也能只用 `core`、`input`、`net`、`ui`、`audio`：原作就是這種形狀。
