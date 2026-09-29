# WebNBA

3D 網頁籃球遊戲（Three.js + TypeScript），目標是 5v5 完整規則與即時連線對戰。

## 開發

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # shared/ 規則與模擬測試
npm run typecheck
```

## 結構

- `shared/` 遊戲模擬（固定 30Hz tick、可重現亂數），單機與伺服器共用
- `client/` Three.js 畫面、輸入、HUD、音效
- `server/`（第 4 階段）權威伺服器
- `tools/`（第 6 階段）名單更新工具

## 操作（目前）

WASD／方向鍵移動、Shift 加速、J 按住放開投籃（在綠色區放開＝完美出手）、空白鍵跳、R 重置球、H 隱藏說明。支援手把。

## 進度

- [x] 第 1 階段：球場、移動、運球、投籃
- [ ] 第 2 階段：5v5 AI＋基本規則
- [ ] 第 3 階段：完整規則
- [ ] 第 4 階段：連線對戰
- [ ] 第 5 階段：手機觸控
- [ ] 第 6 階段：名單更新工具＋部署

非官方粉絲作品，與 NBA 無關。
