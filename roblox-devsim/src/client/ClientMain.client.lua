--========================================================================
--  СИМУЛЯТОР РАЗРАБОТЧИКА — КЛИЕНТ
--  Интерфейс, свет под каждую зону, колесо удачи, бонусы, коды.
--  Лежит в StarterPlayer > StarterPlayerScripts.
--========================================================================

local Players           = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local TweenService      = game:GetService("TweenService")
local UserInputService  = game:GetService("UserInputService")
local Lighting          = game:GetService("Lighting")
local Workspace         = game:GetService("Workspace")

local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")
if playerGui:FindFirstChild("DevSimUI") then return end

local DevSim = ReplicatedStorage:WaitForChild("DevSim")
local Config = require(DevSim:WaitForChild("Config"))
local Kit    = require(DevSim:WaitForChild("MapKit"))

local Remotes      = ReplicatedStorage:WaitForChild("Remotes")
local ClickCode    = Remotes:WaitForChild("ClickCode")
local SellCode     = Remotes:WaitForChild("SellCode")
local BuyUpgrade   = Remotes:WaitForChild("BuyUpgrade")
local Teleport     = Remotes:WaitForChild("Teleport")
local Toggle       = Remotes:WaitForChild("Toggle")
local BuyRobux     = Remotes:WaitForChild("BuyRobux")
local Notify       = Remotes:WaitForChild("Notify")
local AdminAction  = Remotes:WaitForChild("AdminAction")
local AdminOpen    = Remotes:WaitForChild("AdminOpen")
local AdminRequest = Remotes:WaitForChild("AdminRequest")
local OpenUI       = Remotes:WaitForChild("OpenUI")
local RedeemCode   = Remotes:WaitForChild("RedeemCode")
local ClaimDaily   = Remotes:WaitForChild("ClaimDaily")
local SpinWheel    = Remotes:WaitForChild("SpinWheel")
local WheelResult  = Remotes:WaitForChild("WheelResult")
local Announce     = Remotes:WaitForChild("Announce")

local stats    = player:WaitForChild("Stats")
local ls       = player:WaitForChild("leaderstats")
local moneyVal = ls:WaitForChild("Деньги")
local rebVal   = ls:WaitForChild("Ребёрты")
local function S(name) return stats:WaitForChild(name) end

--========================== ПАЛИТРА ====================================
local PANEL     = Color3.fromRGB(28, 30, 36)
local PANEL2    = Color3.fromRGB(38, 41, 50)
local ACCENT    = Color3.fromRGB(0, 229, 255)
local ROW_DARK  = Color3.fromRGB(77, 208, 225)
local ROW_LIGHT = Color3.fromRGB(224, 247, 250)
local GREEN     = Color3.fromRGB(70, 210, 90)
local BUY_TOP   = Color3.fromRGB(120, 220, 70)
local BUY_BOT   = Color3.fromRGB(70, 180, 40)
local GOLD      = Color3.fromRGB(255, 205, 70)
local WHITE     = Color3.fromRGB(255, 255, 255)
local BLACK     = Color3.fromRGB(0, 0, 0)
local FONT      = Enum.Font.FredokaOne

local function fmt(n)
    n = math.floor(tonumber(n) or 0)
    if n >= 1e12 then return string.format("%.2fT", n / 1e12) end
    if n >= 1e9  then return string.format("%.2fB", n / 1e9)  end
    if n >= 1e6  then return string.format("%.2fM", n / 1e6)  end
    if n >= 1e3  then return string.format("%.2fK", n / 1e3)  end
    return tostring(n)
end
local function timeStr(sec)
    sec = math.max(0, math.floor(sec))
    return string.format("%d:%02d", math.floor(sec / 60), sec % 60)
end
local function corner(p, r)
    local c = Instance.new("UICorner")
    c.CornerRadius = UDim.new(0, r or 12)
    c.Parent = p
end
local function stroke(p, col, th)
    local s = Instance.new("UIStroke")
    s.Color = col
    s.Thickness = th or 2
    s.Parent = p
    return s
end
local function tstroke(lbl, th)
    local s = Instance.new("UIStroke")
    s.Color = BLACK
    s.Thickness = th or 1.5
    s.Parent = lbl
    return s
end
local function vgrad(p, c1, c2, rot)
    local g = Instance.new("UIGradient")
    g.Color = ColorSequence.new(c1, c2)
    g.Rotation = rot or 0
    g.Parent = p
    return g
end

--========================== КОРНЕВОЙ GUI ===============================
local gui = Instance.new("ScreenGui")
gui.Name = "DevSimUI"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling
gui.Parent = playerGui

local uiScale = Instance.new("UIScale")
uiScale.Parent = gui
local cam = Workspace.CurrentCamera
local function fitScale()
    if not cam then return end
    local vp = cam.ViewportSize
    uiScale.Scale = math.clamp(math.min(vp.X / 1280, vp.Y / 720), 0.55, 1)
end
fitScale()
if cam then cam:GetPropertyChangedSignal("ViewportSize"):Connect(fitScale) end

--========================== ЗВУК =======================================
-- Работает, только если в Config.SOUNDS вписаны свои rbxassetid.
local soundCache = {}
local function playSound(key)
    local id = Config.SOUNDS and Config.SOUNDS[key]
    if not id or id == "" then return end
    local snd = soundCache[key]
    if not snd then
        snd = Instance.new("Sound")
        snd.SoundId = id
        snd.Volume = 0.5
        snd.Parent = gui
        soundCache[key] = snd
    end
    snd:Play()
end

do
    local musicId = Config.SOUNDS and Config.SOUNDS.music
    if musicId and musicId ~= "" then
        local music = Instance.new("Sound")
        music.SoundId = musicId
        music.Looped = true
        music.Volume = 0.28
        music.Parent = gui
        music:Play()
    end
end

--========================== HUD ========================================
local hud = Instance.new("Frame")
hud.Size = UDim2.new(0, 340, 0, 172)
hud.Position = UDim2.new(0, 16, 0, 16)
hud.BackgroundColor3 = PANEL
hud.Parent = gui
corner(hud, 20)
stroke(hud, ACCENT, 3)
local hpad = Instance.new("UIPadding")
hpad.PaddingTop = UDim.new(0, 10)
hpad.PaddingLeft = UDim.new(0, 12)
hpad.PaddingRight = UDim.new(0, 12)
hpad.Parent = hud

local function hudLabel(yoff, h, color)
    local t = Instance.new("TextLabel")
    t.BackgroundTransparency = 1
    t.Position = UDim2.new(0, 0, 0, yoff)
    t.Size = UDim2.new(1, 0, 0, h)
    t.Font = FONT
    t.TextScaled = true
    t.TextXAlignment = Enum.TextXAlignment.Left
    t.TextColor3 = color
    t.Parent = hud
    tstroke(t, 2)
    return t
end
local moneyLabel = hudLabel(0, 46, GREEN)
local rebLabel   = hudLabel(50, 24, WHITE)
local zoneLabel  = hudLabel(78, 24, ACCENT)
local boostLabel = hudLabel(106, 22, GOLD)
local timerLabel = hudLabel(130, 20, ROW_LIGHT)

-- баннер серверного буста
local banner = Instance.new("TextLabel")
banner.Size = UDim2.new(0, 540, 0, 42)
banner.Position = UDim2.new(0.5, -270, 0, 12)
banner.BackgroundColor3 = Color3.fromRGB(255, 120, 40)
banner.Font = FONT
banner.TextScaled = true
banner.TextColor3 = WHITE
banner.Text = ""
banner.Visible = false
banner.Parent = gui
corner(banner, 14)
stroke(banner, GOLD, 3)
tstroke(banner, 2)

--========================== ПОЛОСА РЮКЗАКА =============================
local bp = Instance.new("Frame")
bp.Size = UDim2.new(0, 470, 0, 38)
bp.Position = UDim2.new(0.5, -235, 1, -196)
bp.BackgroundColor3 = PANEL
bp.Parent = gui
corner(bp, 18)
stroke(bp, ACCENT, 2.5)
local bpFill = Instance.new("Frame")
bpFill.Size = UDim2.new(0, 0, 1, 0)
bpFill.BackgroundColor3 = WHITE
bpFill.BorderSizePixel = 0
bpFill.Parent = bp
corner(bpFill, 18)
vgrad(bpFill, ROW_DARK, ROW_LIGHT, 0)
local bpText = Instance.new("TextLabel")
bpText.Size = UDim2.fromScale(1, 1)
bpText.BackgroundTransparency = 1
bpText.Font = FONT
bpText.TextScaled = true
bpText.TextColor3 = WHITE
bpText.Text = "Code 0 / 25"
bpText.ZIndex = 2
bpText.Parent = bp
tstroke(bpText, 1.5)

--========================== КНОПКА КЛИКА ===============================
local CW, CH = 310, 88
local clickBtn = Instance.new("TextButton")
clickBtn.Size = UDim2.new(0, CW, 0, CH)
clickBtn.Position = UDim2.new(0.5, -CW / 2, 1, -152)
clickBtn.BackgroundColor3 = WHITE
clickBtn.Font = FONT
clickBtn.TextScaled = true
clickBtn.TextColor3 = WHITE
clickBtn.Text = "</>  ПИСАТЬ КОД"
clickBtn.Parent = gui
corner(clickBtn, 18)
stroke(clickBtn, Color3.fromRGB(40, 120, 20), 3)
tstroke(clickBtn, 2)
vgrad(clickBtn, BUY_TOP, BUY_BOT, 90)

local hint = Instance.new("TextLabel")
hint.BackgroundTransparency = 1
hint.Position = UDim2.new(0, 16, 0, 194)
hint.Size = UDim2.new(0, 340, 0, 20)
hint.Font = FONT
hint.TextScaled = true
hint.TextXAlignment = Enum.TextXAlignment.Left
hint.TextColor3 = ROW_LIGHT
hint.Text = "E — писать код • F — стенды рядом • клик по ПК тоже работает"
hint.Parent = gui
tstroke(hint, 1.5)

--========================== БОКОВЫЕ КНОПКИ =============================
local function sideBar(side)
    local f = Instance.new("Frame")
    f.Size = UDim2.new(0, 178, 0, 330)
    if side == "left" then
        f.Position = UDim2.new(0, 16, 0.5, -165)
    else
        f.Position = UDim2.new(1, -194, 0.5, -165)
    end
    f.BackgroundTransparency = 1
    f.Parent = gui
    local lay = Instance.new("UIListLayout")
    lay.FillDirection = Enum.FillDirection.Vertical
    lay.HorizontalAlignment = Enum.HorizontalAlignment.Center
    lay.VerticalAlignment = Enum.VerticalAlignment.Center
    lay.Padding = UDim.new(0, 8)
    lay.Parent = f
    return f
end
local leftBar  = sideBar("left")
local rightBar = sideBar("right")

local function sideButton(parent, text, color, order)
    local b = Instance.new("TextButton")
    b.Size = UDim2.new(0, 178, 0, 50)
    b.LayoutOrder = order
    b.BackgroundColor3 = color
    b.Font = FONT
    b.TextScaled = true
    b.TextColor3 = WHITE
    b.Text = text
    b.Parent = parent
    corner(b, 12)
    stroke(b, BLACK, 2)
    tstroke(b, 1.5)
    return b
end

local shopBtn    = sideButton(leftBar,  "🛒 МАГАЗИН",  Color3.fromRGB(0, 180, 230), 1)
local donateBtn  = sideButton(leftBar,  "💎 ДОНАТ",    Color3.fromRGB(45, 150, 235), 2)
local tpBtn      = sideButton(leftBar,  "🚀 ТЕЛЕПОРТ", Color3.fromRGB(120, 110, 230), 3)
local bonusBtn   = sideButton(leftBar,  "🎁 БОНУСЫ",   Color3.fromRGB(235, 150, 50), 4)
local sellBtn    = sideButton(rightBar, "💰 ПРОДАТЬ",  Color3.fromRGB(60, 200, 80), 1)
local rebirthBtn = sideButton(rightBar, "🌟 РЕБЁРТ",   Color3.fromRGB(170, 90, 220), 2)
local wheelBtn   = sideButton(rightBar, "🎰 КОЛЕСО",   Color3.fromRGB(230, 90, 150), 3)
local autoClkBtn = sideButton(rightBar, "🤖 А-КЛИК",   Color3.fromRGB(110, 115, 135), 4)
local autoSelBtn = sideButton(rightBar, "📤 А-ПРОД",   Color3.fromRGB(110, 115, 135), 5)

--========================== ТОСТ И ВСПЛЫВАШКИ ==========================
local toast = Instance.new("TextLabel")
toast.Size = UDim2.new(0, 540, 0, 50)
toast.Position = UDim2.new(0.5, -270, 0, 200)
toast.BackgroundColor3 = PANEL
toast.Font = FONT
toast.TextScaled = true
toast.TextColor3 = Color3.fromRGB(255, 235, 150)
toast.Text = ""
toast.Visible = false
toast.Parent = gui
corner(toast, 14)
stroke(toast, ACCENT, 2.5)
tstroke(toast, 1.5)

local toastThread
local function showToast(msg)
    toast.Text = msg
    toast.Visible = true
    toast.TextTransparency = 0
    toast.BackgroundTransparency = 0
    if toastThread then task.cancel(toastThread) end
    toastThread = task.delay(2.6, function()
        TweenService:Create(toast, TweenInfo.new(0.5), {TextTransparency = 1, BackgroundTransparency = 1}):Play()
        task.wait(0.55)
        toast.Visible = false
    end)
end
Notify.OnClientEvent:Connect(showToast)

local function floatGain(amount)
    local f = Instance.new("TextLabel")
    f.Size = UDim2.new(0, 240, 0, 58)
    f.Position = UDim2.new(0.5, -120, 1, -252)
    f.BackgroundTransparency = 1
    f.Font = FONT
    f.TextScaled = true
    f.TextColor3 = GREEN
    f.Text = "+" .. fmt(amount) .. " кода"
    f.Parent = gui
    tstroke(f, 2)
    TweenService:Create(f, TweenInfo.new(0.7, Enum.EasingStyle.Quad), {
        Position = UDim2.new(0.5, -120, 1, -332),
        TextTransparency = 1,
    }):Play()
    task.delay(0.75, function() f:Destroy() end)
end

--========================== БАЗА ПАНЕЛЕЙ ===============================
local openPanels = {}

local function panelBase(titleText, w, h)
    local f = Instance.new("Frame")
    f.Size = UDim2.new(0, w, 0, h)
    f.Position = UDim2.new(0.5, -w / 2, 0.5, -h / 2)
    f.BackgroundColor3 = PANEL
    f.Visible = false
    f.Parent = gui
    corner(f, 22)
    stroke(f, ACCENT, 3)

    local pad = Instance.new("UIPadding")
    pad.PaddingTop = UDim.new(0, 14)
    pad.PaddingBottom = UDim.new(0, 14)
    pad.PaddingLeft = UDim.new(0, 14)
    pad.PaddingRight = UDim.new(0, 14)
    pad.Parent = f

    local title = Instance.new("TextLabel")
    title.BackgroundTransparency = 1
    title.Size = UDim2.new(1, -48, 0, 40)
    title.Font = FONT
    title.Text = titleText
    title.TextColor3 = ACCENT
    title.TextScaled = true
    title.TextXAlignment = Enum.TextXAlignment.Left
    title.Parent = f
    tstroke(title, 2)

    local closeB = Instance.new("TextButton")
    closeB.AnchorPoint = Vector2.new(1, 0)
    closeB.Position = UDim2.new(1, 0, 0, 0)
    closeB.Size = UDim2.new(0, 40, 0, 40)
    closeB.BackgroundTransparency = 1
    closeB.Font = FONT
    closeB.Text = "✕"
    closeB.TextColor3 = ACCENT
    closeB.TextScaled = true
    closeB.Parent = f
    closeB.MouseButton1Click:Connect(function() f.Visible = false end)

    local content = Instance.new("Frame")
    content.BackgroundTransparency = 1
    content.Position = UDim2.new(0, 0, 0, 50)
    content.Size = UDim2.new(1, 0, 1, -50)
    content.Parent = f

    table.insert(openPanels, f)
    return f, content
end

local shopPanel,   shopContent   = panelBase("🛒 Магазин", 480, 340)
local donatePanel, donateContent = panelBase("💎 Донат за Robux", 520, 470)
local tpPanel,     tpContent     = panelBase("🚀 Телепорт", 450, 430)
local bonusPanel,  bonusContent  = panelBase("🎁 Бонусы и коды", 500, 430)

local refresh

local function openPanel(target)
    local willShow = not target.Visible
    for _, p in ipairs(openPanels) do p.Visible = false end
    target.Visible = willShow
    if willShow then refresh() end
end

--========================== МАГАЗИН ====================================
local upgLayout = Instance.new("UIListLayout")
upgLayout.Padding = UDim.new(0, 10)
upgLayout.SortOrder = Enum.SortOrder.LayoutOrder
upgLayout.Parent = shopContent

local function upgradeRow(order, icon, name, iconKey)
    local row = Instance.new("Frame")
    row.Size = UDim2.new(1, 0, 0, 76)
    row.BackgroundColor3 = WHITE
    row.LayoutOrder = order
    row.Parent = shopContent
    corner(row, 14)
    vgrad(row, ROW_DARK, ROW_LIGHT, 0)

    local iconBg = Instance.new("Frame")
    iconBg.Size = UDim2.new(0, 56, 0, 56)
    iconBg.AnchorPoint = Vector2.new(0, 0.5)
    iconBg.Position = UDim2.new(0, 8, 0.5, 0)
    iconBg.BackgroundColor3 = WHITE
    iconBg.BackgroundTransparency = 0.45
    iconBg.Parent = row
    corner(iconBg, 12)

    -- если в Config.ICONS вписан assetId — показываем картинку, иначе эмодзи
    local imageId = iconKey and Config.ICONS and Config.ICONS[iconKey] or ""
    if imageId ~= "" then
        local im = Instance.new("ImageLabel")
        im.BackgroundTransparency = 1
        im.Size = UDim2.new(1, -6, 1, -6)
        im.Position = UDim2.new(0, 3, 0, 3)
        im.Image = imageId
        im.ScaleType = Enum.ScaleType.Fit
        im.Parent = iconBg
    else
        local ic = Instance.new("TextLabel")
        ic.BackgroundTransparency = 1
        ic.Size = UDim2.new(1, -6, 1, -6)
        ic.Position = UDim2.new(0, 3, 0, 3)
        ic.Text = icon
        ic.TextScaled = true
        ic.Font = FONT
        ic.Parent = iconBg
    end

    local nameLbl = Instance.new("TextLabel")
    nameLbl.BackgroundTransparency = 1
    nameLbl.Position = UDim2.new(0, 74, 0, 6)
    nameLbl.Size = UDim2.new(0, 240, 0, 26)
    nameLbl.Text = name
    nameLbl.TextColor3 = WHITE
    nameLbl.Font = FONT
    nameLbl.TextScaled = true
    nameLbl.TextXAlignment = Enum.TextXAlignment.Left
    nameLbl.Parent = row
    tstroke(nameLbl, 1.5)

    local infoLbl = Instance.new("TextLabel")
    infoLbl.BackgroundTransparency = 1
    infoLbl.Position = UDim2.new(0, 74, 0, 38)
    infoLbl.Size = UDim2.new(0, 250, 0, 28)
    infoLbl.Text = ""
    infoLbl.TextColor3 = Color3.fromRGB(30, 70, 40)
    infoLbl.Font = FONT
    infoLbl.TextScaled = true
    infoLbl.TextXAlignment = Enum.TextXAlignment.Left
    infoLbl.Parent = row

    local buy = Instance.new("TextButton")
    buy.AnchorPoint = Vector2.new(1, 0.5)
    buy.Position = UDim2.new(1, -10, 0.5, 0)
    buy.Size = UDim2.new(0, 106, 0, 50)
    buy.BackgroundColor3 = WHITE
    buy.Text = "Buy"
    buy.TextColor3 = WHITE
    buy.Font = FONT
    buy.TextScaled = true
    buy.Parent = row
    corner(buy, 12)
    stroke(buy, Color3.fromRGB(40, 120, 20), 2)
    tstroke(buy, 1.5)
    vgrad(buy, BUY_TOP, BUY_BOT, 90)

    return infoLbl, buy
end

local bpInfo, bpBuy     = upgradeRow(1, "🎒", "Рюкзак", "Backpack")
local gearInfo, gearBuy = upgradeRow(2, "💻", "Компьютер", "Laptop")
local sellInfo, sellBuy = upgradeRow(3, "📈", "Цена продажи", "Money")

--========================== ДОНАТ ======================================
local donScroll = Instance.new("ScrollingFrame")
donScroll.Size = UDim2.fromScale(1, 1)
donScroll.BackgroundTransparency = 1
donScroll.BorderSizePixel = 0
donScroll.ScrollBarThickness = 6
donScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
donScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
donScroll.Parent = donateContent
local donLayout = Instance.new("UIListLayout")
donLayout.Padding = UDim.new(0, 8)
donLayout.SortOrder = Enum.SortOrder.LayoutOrder
donLayout.Parent = donScroll

local rbxRows = {}
for idx, key in ipairs(Config.SHOP_ORDER) do
    local row = Instance.new("Frame")
    row.Size = UDim2.new(1, -8, 0, 58)
    row.BackgroundColor3 = WHITE
    row.LayoutOrder = idx
    row.Parent = donScroll
    corner(row, 12)
    vgrad(row, ROW_DARK, ROW_LIGHT, 0)

    local nm = Instance.new("TextLabel")
    nm.BackgroundTransparency = 1
    nm.Position = UDim2.new(0, 12, 0, 4)
    nm.Size = UDim2.new(1, -140, 0, 30)
    nm.Text = Config.NAMES[key] or key
    nm.TextColor3 = WHITE
    nm.Font = FONT
    nm.TextScaled = true
    nm.TextXAlignment = Enum.TextXAlignment.Left
    nm.Parent = row
    tstroke(nm, 1.5)

    local price = Instance.new("TextLabel")
    price.BackgroundTransparency = 1
    price.Position = UDim2.new(0, 12, 0, 32)
    price.Size = UDim2.new(1, -140, 0, 20)
    price.Text = "R$ " .. tostring(Config.PRICES[key] or "?")
    price.TextColor3 = Color3.fromRGB(28, 60, 40)
    price.Font = FONT
    price.TextScaled = true
    price.TextXAlignment = Enum.TextXAlignment.Left
    price.Parent = row

    local buy = Instance.new("TextButton")
    buy.AnchorPoint = Vector2.new(1, 0.5)
    buy.Position = UDim2.new(1, -10, 0.5, 0)
    buy.Size = UDim2.new(0, 116, 0, 42)
    buy.BackgroundColor3 = WHITE
    buy.Font = FONT
    buy.TextScaled = true
    buy.TextColor3 = WHITE
    buy.Text = "R$"
    buy.Parent = row
    corner(buy, 10)
    stroke(buy, Color3.fromRGB(40, 120, 20), 2)
    tstroke(buy, 1.5)
    vgrad(buy, BUY_TOP, BUY_BOT, 90)
    buy.MouseButton1Click:Connect(function() BuyRobux:FireServer(key) end)

    rbxRows[idx] = {key = key, btn = buy, row = row}
end

--========================== ТЕЛЕПОРТ ===================================
local tpScroll = Instance.new("ScrollingFrame")
tpScroll.Size = UDim2.fromScale(1, 1)
tpScroll.BackgroundTransparency = 1
tpScroll.BorderSizePixel = 0
tpScroll.ScrollBarThickness = 6
tpScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
tpScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
tpScroll.Parent = tpContent
local tpLayout = Instance.new("UIListLayout")
tpLayout.Padding = UDim.new(0, 8)
tpLayout.SortOrder = Enum.SortOrder.LayoutOrder
tpLayout.Parent = tpScroll

--========================== БОНУСЫ И КОДЫ ==============================
local dailyRow = Instance.new("Frame")
dailyRow.Size = UDim2.new(1, 0, 0, 92)
dailyRow.BackgroundColor3 = WHITE
dailyRow.Parent = bonusContent
corner(dailyRow, 14)
vgrad(dailyRow, Color3.fromRGB(255, 190, 90), Color3.fromRGB(255, 232, 170), 0)

local dailyTitle = Instance.new("TextLabel")
dailyTitle.BackgroundTransparency = 1
dailyTitle.Position = UDim2.new(0, 14, 0, 8)
dailyTitle.Size = UDim2.new(1, -160, 0, 30)
dailyTitle.Font = FONT
dailyTitle.TextScaled = true
dailyTitle.TextXAlignment = Enum.TextXAlignment.Left
dailyTitle.TextColor3 = WHITE
dailyTitle.Text = "🎁 Ежедневная награда"
dailyTitle.Parent = dailyRow
tstroke(dailyTitle, 1.6)

local dailyInfo = Instance.new("TextLabel")
dailyInfo.BackgroundTransparency = 1
dailyInfo.Position = UDim2.new(0, 14, 0, 42)
dailyInfo.Size = UDim2.new(1, -160, 0, 40)
dailyInfo.Font = FONT
dailyInfo.TextScaled = true
dailyInfo.TextXAlignment = Enum.TextXAlignment.Left
dailyInfo.TextYAlignment = Enum.TextYAlignment.Top
dailyInfo.TextColor3 = Color3.fromRGB(60, 40, 10)
dailyInfo.Text = ""
dailyInfo.Parent = dailyRow

local dailyBtn = Instance.new("TextButton")
dailyBtn.AnchorPoint = Vector2.new(1, 0.5)
dailyBtn.Position = UDim2.new(1, -12, 0.5, 0)
dailyBtn.Size = UDim2.new(0, 128, 0, 54)
dailyBtn.BackgroundColor3 = WHITE
dailyBtn.Font = FONT
dailyBtn.TextScaled = true
dailyBtn.TextColor3 = WHITE
dailyBtn.Text = "ЗАБРАТЬ"
dailyBtn.Parent = dailyRow
corner(dailyBtn, 12)
stroke(dailyBtn, Color3.fromRGB(40, 120, 20), 2)
tstroke(dailyBtn, 1.5)
vgrad(dailyBtn, BUY_TOP, BUY_BOT, 90)
dailyBtn.MouseButton1Click:Connect(function() ClaimDaily:FireServer() end)

local chestLabel = Instance.new("TextLabel")
chestLabel.BackgroundTransparency = 1
chestLabel.Position = UDim2.new(0, 4, 0, 100)
chestLabel.Size = UDim2.new(1, -8, 0, 30)
chestLabel.Font = FONT
chestLabel.TextScaled = true
chestLabel.TextXAlignment = Enum.TextXAlignment.Left
chestLabel.TextColor3 = ROW_LIGHT
chestLabel.Text = ""
chestLabel.Parent = bonusContent
tstroke(chestLabel, 1.4)

local codeTitle = Instance.new("TextLabel")
codeTitle.BackgroundTransparency = 1
codeTitle.Position = UDim2.new(0, 4, 0, 136)
codeTitle.Size = UDim2.new(1, -8, 0, 28)
codeTitle.Font = FONT
codeTitle.TextScaled = true
codeTitle.TextXAlignment = Enum.TextXAlignment.Left
codeTitle.TextColor3 = ACCENT
codeTitle.Text = "🎟 Ввести код"
codeTitle.Parent = bonusContent
tstroke(codeTitle, 1.4)

local codeBox = Instance.new("TextBox")
codeBox.Position = UDim2.new(0, 4, 0, 168)
codeBox.Size = UDim2.new(1, -150, 0, 46)
codeBox.BackgroundColor3 = PANEL2
codeBox.Font = FONT
codeBox.TextScaled = true
codeBox.TextColor3 = WHITE
codeBox.PlaceholderText = "Например: СТАРТ"
codeBox.Text = ""
codeBox.ClearTextOnFocus = false
codeBox.Parent = bonusContent
corner(codeBox, 10)
stroke(codeBox, ACCENT, 2)

local codeBtn = Instance.new("TextButton")
codeBtn.AnchorPoint = Vector2.new(1, 0)
codeBtn.Position = UDim2.new(1, -4, 0, 168)
codeBtn.Size = UDim2.new(0, 134, 0, 46)
codeBtn.BackgroundColor3 = WHITE
codeBtn.Font = FONT
codeBtn.TextScaled = true
codeBtn.TextColor3 = WHITE
codeBtn.Text = "ПРИМЕНИТЬ"
codeBtn.Parent = bonusContent
corner(codeBtn, 10)
stroke(codeBtn, Color3.fromRGB(40, 120, 20), 2)
tstroke(codeBtn, 1.5)
vgrad(codeBtn, BUY_TOP, BUY_BOT, 90)
local function sendCode()
    if codeBox.Text ~= "" then
        RedeemCode:FireServer(codeBox.Text)
        codeBox.Text = ""
    end
end
codeBtn.MouseButton1Click:Connect(sendCode)
codeBox.FocusLost:Connect(function(enter) if enter then sendCode() end end)

local codeHint = Instance.new("TextLabel")
codeHint.BackgroundTransparency = 1
codeHint.Position = UDim2.new(0, 4, 0, 222)
codeHint.Size = UDim2.new(1, -8, 0, 110)
codeHint.Font = FONT
codeHint.TextScaled = true
codeHint.TextWrapped = true
codeHint.TextXAlignment = Enum.TextXAlignment.Left
codeHint.TextYAlignment = Enum.TextYAlignment.Top
codeHint.TextColor3 = ROW_LIGHT
codeHint.Text = "Коды раздаются в описании игры и в группе.\nЗаходи каждый день — награда за серию растёт!"
codeHint.Parent = bonusContent

--========================== КОЛЕСО УДАЧИ ===============================
local wheelOverlay = Instance.new("Frame")
wheelOverlay.Size = UDim2.fromScale(1, 1)
wheelOverlay.BackgroundColor3 = BLACK
wheelOverlay.BackgroundTransparency = 0.45
wheelOverlay.Visible = false
wheelOverlay.ZIndex = 40
wheelOverlay.Parent = gui

local wheelBox = Instance.new("Frame")
wheelBox.Size = UDim2.new(0, 460, 0, 260)
wheelBox.Position = UDim2.new(0.5, -230, 0.5, -130)
wheelBox.BackgroundColor3 = PANEL
wheelBox.ZIndex = 41
wheelBox.Parent = wheelOverlay
corner(wheelBox, 22)
stroke(wheelBox, Color3.fromRGB(255, 150, 200), 3)

local wheelTitle = Instance.new("TextLabel")
wheelTitle.BackgroundTransparency = 1
wheelTitle.Position = UDim2.new(0, 0, 0, 14)
wheelTitle.Size = UDim2.new(1, 0, 0, 40)
wheelTitle.Font = FONT
wheelTitle.TextScaled = true
wheelTitle.TextColor3 = Color3.fromRGB(255, 150, 200)
wheelTitle.Text = "🎰 КОЛЕСО УДАЧИ"
wheelTitle.ZIndex = 42
wheelTitle.Parent = wheelBox
tstroke(wheelTitle, 2)

local wheelPrize = Instance.new("TextLabel")
wheelPrize.BackgroundColor3 = PANEL2
wheelPrize.AnchorPoint = Vector2.new(0.5, 0)
wheelPrize.Position = UDim2.new(0.5, 0, 0, 76)
wheelPrize.Size = UDim2.new(0, 380, 0, 90)
wheelPrize.Font = FONT
wheelPrize.TextScaled = true
wheelPrize.TextColor3 = WHITE
wheelPrize.Text = "..."
wheelPrize.ZIndex = 42
wheelPrize.Parent = wheelBox
corner(wheelPrize, 16)
stroke(wheelPrize, GOLD, 2.5)
tstroke(wheelPrize, 2)

local wheelClose = Instance.new("TextButton")
wheelClose.AnchorPoint = Vector2.new(0.5, 1)
wheelClose.Position = UDim2.new(0.5, 0, 1, -16)
wheelClose.Size = UDim2.new(0, 200, 0, 48)
wheelClose.BackgroundColor3 = WHITE
wheelClose.Font = FONT
wheelClose.TextScaled = true
wheelClose.TextColor3 = WHITE
wheelClose.Text = "ЗАБРАТЬ"
wheelClose.ZIndex = 42
wheelClose.Visible = false
wheelClose.Parent = wheelBox
corner(wheelClose, 12)
stroke(wheelClose, Color3.fromRGB(40, 120, 20), 2)
tstroke(wheelClose, 1.5)
vgrad(wheelClose, BUY_TOP, BUY_BOT, 90)
wheelClose.MouseButton1Click:Connect(function() wheelOverlay.Visible = false end)

WheelResult.OnClientEvent:Connect(function(index, text)
    wheelOverlay.Visible = true
    wheelClose.Visible = false
    local names = {}
    for _, prize in ipairs(Config.WHEEL) do table.insert(names, prize.text) end
    task.spawn(function()
        local t = 0
        local step = 0.05
        while t < 2.4 do
            wheelPrize.Text = names[math.random(1, #names)]
            wheelPrize.TextColor3 = Color3.fromHSV(math.random(), 0.6, 1)
            task.wait(step)
            t = t + step
            step = step * 1.14
        end
        local prize = Config.WHEEL[index]
        wheelPrize.Text = "🎉 " .. (text or (prize and prize.text) or "Приз!")
        wheelPrize.TextColor3 = (prize and prize.color) or GOLD
        wheelClose.Visible = true
        local pop = TweenInfo.new(0.2, Enum.EasingStyle.Back, Enum.EasingDirection.Out)
        wheelPrize.Size = UDim2.new(0, 320, 0, 70)
        TweenService:Create(wheelPrize, pop, {Size = UDim2.new(0, 380, 0, 90)}):Play()
        playSound("reward")
    end)
end)

--========================== ОБНОВЛЕНИЕ =================================
local function ownsVIP() return S("OwnVIP").Value end

local function availableSet()
    local set = {}
    for _, key in ipairs(string.split(S("Available").Value, ",")) do
        if key ~= "" then set[key] = true end
    end
    return set
end

local lastTeleportSignature = nil

local function rebuildTeleport()
    local signature = S("ZonesInfo").Value .. "|" .. tostring(S("OwnVIP").Value)
    if signature == lastTeleportSignature then return end
    lastTeleportSignature = signature

    for _, ch in ipairs(tpScroll:GetChildren()) do
        if ch:IsA("TextButton") then ch:Destroy() end
    end
    local info = S("ZonesInfo").Value
    if info == "" then return end
    for _, line in ipairs(string.split(info, "\n")) do
        local p = string.split(line, "|")
        local zname = p[1]
        local unlocked = (p[2] == "1")
        local zindex = tonumber(p[3]) or 1
        local zmult = p[4] or "1"

        local b = Instance.new("TextButton")
        b.Size = UDim2.new(1, -8, 0, 52)
        b.LayoutOrder = zindex
        b.Font = FONT
        b.TextScaled = true
        b.TextColor3 = WHITE
        b.Parent = tpScroll
        corner(b, 12)
        tstroke(b, 1.5)

        if unlocked then
            b.BackgroundColor3 = WHITE
            vgrad(b, ROW_DARK, ROW_LIGHT, 0)
            b.Text = zname .. "  (x" .. zmult .. ")" .. (ownsVIP() and "" or "  🔒VIP")
            b.MouseButton1Click:Connect(function()
                if ownsVIP() then
                    Teleport:FireServer(zindex)
                else
                    BuyRobux:FireServer("VIPTeleport")
                end
            end)
        else
            b.BackgroundColor3 = Color3.fromRGB(70, 72, 80)
            b.Text = "🔒 " .. zname .. "  (закрыта)"
        end
    end
end

refresh = function()
    local cap  = S("Capacity").Value
    local code = S("Code").Value

    moneyLabel.Text = "💵 $" .. fmt(moneyVal.Value)
    rebLabel.Text   = "🌟 Ребёрты: " .. rebVal.Value
    zoneLabel.Text  = "📍 " .. S("ZoneName").Value
    boostLabel.Text = "⚡ " .. S("Boosts").Value

    local chestIn = S("ChestIn").Value
    local wheelIn = S("WheelIn").Value
    timerLabel.Text = "📦 " .. ((chestIn > 0) and timeStr(chestIn) or "готов!") ..
        "   🎰 " .. ((wheelIn > 0) and timeStr(wheelIn) or "готово!")

    bpText.Text = "Code " .. fmt(code) .. " / " .. fmt(cap)
    local ratio = (cap > 0) and math.clamp(code / cap, 0, 1) or 0
    TweenService:Create(bpFill, TweenInfo.new(0.2), {Size = UDim2.new(ratio, 0, 1, 0)}):Play()

    local bc = S("BackpackCost").Value
    bpInfo.Text = S("BackpackInfo").Value
    bpBuy.Text  = (bc < 0) and "МАКС" or ("$" .. fmt(bc))
    local gc = S("GearCost").Value
    gearInfo.Text = S("GearInfo").Value
    gearBuy.Text  = (gc < 0) and "МАКС" or ("$" .. fmt(gc))
    local sc = S("SellCost").Value
    sellInfo.Text = S("SellInfo").Value
    sellBuy.Text  = (sc < 0) and "МАКС" or ("$" .. fmt(sc))

    rebirthBtn.Text = "🌟 РЕБЁРТ\n$" .. fmt(S("RebirthCost").Value)

    if S("OwnAutoClick").Value then
        local on = S("AutoClickOn").Value
        autoClkBtn.Text = on and "🤖 КЛИК ВКЛ" or "🤖 КЛИК ВЫКЛ"
        autoClkBtn.BackgroundColor3 = on and Color3.fromRGB(60, 190, 90) or Color3.fromRGB(110, 115, 135)
    else
        autoClkBtn.Text = "🤖 А-КЛИК"
        autoClkBtn.BackgroundColor3 = Color3.fromRGB(110, 115, 135)
    end
    if S("OwnAutoSell").Value then
        local on = S("AutoSellOn").Value
        autoSelBtn.Text = on and "📤 ПРОД ВКЛ" or "📤 ПРОД ВЫКЛ"
        autoSelBtn.BackgroundColor3 = on and Color3.fromRGB(60, 190, 90) or Color3.fromRGB(110, 115, 135)
    else
        autoSelBtn.Text = "📤 А-ПРОД"
        autoSelBtn.BackgroundColor3 = Color3.fromRGB(110, 115, 135)
    end

    wheelBtn.Text = (wheelIn > 0) and ("🎰 " .. timeStr(wheelIn)) or "🎰 КОЛЕСО"

    -- донат-меню
    local avail = availableSet()
    for _, rw in ipairs(rbxRows) do
        local ownFlag = Config.OWNED_FLAG[rw.key]
        if ownFlag and S(ownFlag).Value then
            rw.btn.Text = "Есть ✓"
        elseif not avail[rw.key] then
            rw.btn.Text = "СКОРО"
        else
            rw.btn.Text = "R$ " .. tostring(Config.PRICES[rw.key] or "")
        end
    end

    -- бонусы
    local day = S("DailyDay").Value
    local reward = Config.DAILY[math.clamp(day, 1, #Config.DAILY)]
    dailyInfo.Text = "День " .. day .. " из " .. #Config.DAILY .. ": " .. ((reward and reward.text) or "")
    if S("DailyReady").Value then
        dailyBtn.Text = "ЗАБРАТЬ"
        dailyBtn.BackgroundTransparency = 0
    else
        dailyBtn.Text = "ЗАВТРА"
    end
    chestLabel.Text = "📦 Сундук за игру: " .. ((chestIn > 0) and ("через " .. timeStr(chestIn)) or "выдаётся!")

    -- баннер серверного буста
    local sb = S("ServerBoost").Value
    banner.Visible = (sb ~= "")
    banner.Text = sb

    rebuildTeleport()
end

--========================== ДЕЙСТВИЯ ===================================
local function doClick()
    ClickCode:FireServer()
    playSound("click")
    local code = S("Code").Value
    local cap  = S("Capacity").Value
    if code >= cap then
        showToast("Рюкзак полон! Жми 💰 ПРОДАТЬ")
    else
        floatGain(S("PerClick").Value)
    end
    TweenService:Create(clickBtn, TweenInfo.new(0.07), {Size = UDim2.new(0, CW - 14, 0, CH - 7)}):Play()
    task.delay(0.08, function()
        TweenService:Create(clickBtn, TweenInfo.new(0.07), {Size = UDim2.new(0, CW, 0, CH)}):Play()
    end)
end

clickBtn.MouseButton1Click:Connect(doClick)
sellBtn.MouseButton1Click:Connect(function()
    SellCode:FireServer()
    playSound("sell")
end)
shopBtn.MouseButton1Click:Connect(function() openPanel(shopPanel) end)
donateBtn.MouseButton1Click:Connect(function() openPanel(donatePanel) end)
tpBtn.MouseButton1Click:Connect(function() openPanel(tpPanel) end)
bonusBtn.MouseButton1Click:Connect(function() openPanel(bonusPanel) end)
wheelBtn.MouseButton1Click:Connect(function() SpinWheel:FireServer() end)
bpBuy.MouseButton1Click:Connect(function() BuyUpgrade:FireServer("backpack") end)
gearBuy.MouseButton1Click:Connect(function() BuyUpgrade:FireServer("gear") end)
sellBuy.MouseButton1Click:Connect(function() BuyUpgrade:FireServer("sell") end)
rebirthBtn.MouseButton1Click:Connect(function() BuyUpgrade:FireServer("rebirth") end)
autoClkBtn.MouseButton1Click:Connect(function()
    if S("OwnAutoClick").Value then
        Toggle:FireServer("autoclick", not S("AutoClickOn").Value)
    else
        BuyRobux:FireServer("AutoClick")
    end
end)
autoSelBtn.MouseButton1Click:Connect(function()
    if S("OwnAutoSell").Value then
        Toggle:FireServer("autosell", not S("AutoSellOn").Value)
    else
        BuyRobux:FireServer("AutoSell")
    end
end)

UserInputService.InputBegan:Connect(function(input, gpe)
    if gpe then return end
    if input.KeyCode == Enum.KeyCode.E then doClick() end
end)

-- сервер просит открыть окно (нажатие F у стенда на карте)
OpenUI.OnClientEvent:Connect(function(which)
    if which == "shop" then openPanel(shopPanel)
    elseif which == "donate" then openPanel(donatePanel)
    elseif which == "codes" then openPanel(bonusPanel)
    elseif which == "rebirth" then
        openPanel(shopPanel)
        showToast("🌟 Ребёрт — кнопка справа")
    end
end)

-- сервер подсказывает купить геймпасс
BuyRobux.OnClientEvent:Connect(function()
    openPanel(donatePanel)
end)

Announce.OnClientEvent:Connect(function(text)
    showToast(text)
end)

--========================== СВЕТ ПОД ЗОНУ ==============================
-- Каждая эпоха — своё время суток и настроение. Меняется локально,
-- поэтому у каждого игрока свой свет и сервер не нагружается.
local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere")
local grade = Lighting:FindFirstChild("ZoneGrade")
local sky = Lighting:FindFirstChildOfClass("Sky")
local currentZoneLook = 0

local function applyZoneLook(index)
    local zone = Config.ZONES[index]
    if not zone or not zone.sky then return end
    if currentZoneLook == index then return end
    currentZoneLook = index
    local look = zone.sky
    local info = TweenInfo.new(1.6, Enum.EasingStyle.Sine, Enum.EasingDirection.Out)

    TweenService:Create(Lighting, info, {
        ClockTime = look.clock,
        Brightness = look.brightness,
        Ambient = look.ambient,
        OutdoorAmbient = look.outdoor,
        FogColor = look.fog,
    }):Play()

    if atmosphere then
        TweenService:Create(atmosphere, info, {
            Density = look.density,
            Color = look.fog,
            Decay = look.ambient,
        }):Play()
    end
    if grade then
        TweenService:Create(grade, info, {
            TintColor = look.tint,
            Saturation = look.saturation,
        }):Play()
    end
    if sky then
        sky.StarCount = look.stars or 0
    end
end

--========================== ВОРОТА ЗОН =================================
-- Открытые зоны перестают перекрываться силовым полем — локально,
-- поэтому чужой прогресс не ломается.
local function refreshGates()
    local unlocked = S("UnlockedZone").Value
    local worldFolder = Workspace:FindFirstChild("DevWorld")
    if not worldFolder then return end
    for _, inst in ipairs(worldFolder:GetDescendants()) do
        if inst:IsA("BasePart") and inst:GetAttribute("ZoneIndex") and inst.Name:sub(1, 5) == "Gate_" then
            local idx = inst:GetAttribute("ZoneIndex")
            local open = (idx <= unlocked)
            inst.CanCollide = not open
            inst.Transparency = open and 1 or 0.35
        end
    end
end

--========================== ПОДПИСКИ ===================================
local function hook(v) v.Changed:Connect(refresh) end
for _, n in ipairs({
    "Code", "Capacity", "PerClick", "BackpackCost", "GearCost", "SellCost", "RebirthCost",
    "ZoneName", "BackpackInfo", "GearInfo", "SellInfo", "Boosts", "ZonesInfo", "Donated",
    "OwnAutoClick", "OwnAutoSell", "Own2xMoney", "Own2xClicks", "OwnVIP", "OwnLucky", "OwnTurbo",
    "AutoClickOn", "AutoSellOn", "DailyReady", "DailyDay", "ChestIn", "WheelIn",
    "Available", "ServerBoost",
}) do
    hook(S(n))
end
moneyVal.Changed:Connect(refresh)
rebVal.Changed:Connect(refresh)

S("Zone").Changed:Connect(function(v) applyZoneLook(v) end)
S("UnlockedZone").Changed:Connect(function()
    refreshGates()
    refresh()
end)

refresh()
applyZoneLook(S("Zone").Value)
Kit.runClientAnimations()

task.spawn(function()
    -- карта строится сервером при старте: дожидаемся её и открываем ворота
    if Workspace:WaitForChild("DevWorld", 60) then
        refreshGates()
    end
end)

--========================== ТУТОРИАЛ ===================================
local tutBg = Instance.new("Frame")
tutBg.Size = UDim2.fromScale(1, 1)
tutBg.BackgroundColor3 = BLACK
tutBg.BackgroundTransparency = 0.45
tutBg.ZIndex = 50
tutBg.Parent = gui

local tut = Instance.new("Frame")
tut.Size = UDim2.new(0, 480, 0, 380)
tut.Position = UDim2.new(0.5, -240, 0.5, -190)
tut.BackgroundColor3 = PANEL
tut.ZIndex = 51
tut.Parent = tutBg
corner(tut, 22)
stroke(tut, ACCENT, 3)

local tutTitle = Instance.new("TextLabel")
tutTitle.BackgroundTransparency = 1
tutTitle.Position = UDim2.new(0, 16, 0, 12)
tutTitle.Size = UDim2.new(1, -32, 0, 40)
tutTitle.Font = FONT
tutTitle.TextScaled = true
tutTitle.TextColor3 = ACCENT
tutTitle.Text = "От гаража до космоса 🚀"
tutTitle.ZIndex = 52
tutTitle.Parent = tut
tstroke(tutTitle, 2)

local tutBody = Instance.new("TextLabel")
tutBody.BackgroundTransparency = 1
tutBody.Position = UDim2.new(0, 18, 0, 58)
tutBody.Size = UDim2.new(1, -36, 1, -128)
tutBody.Font = FONT
tutBody.TextScaled = true
tutBody.TextColor3 = WHITE
tutBody.TextXAlignment = Enum.TextXAlignment.Left
tutBody.TextYAlignment = Enum.TextYAlignment.Top
tutBody.ZIndex = 52
tutBody.Parent = tut
tutBody.Text = "1)  Жми </> ПИСАТЬ КОД (или E) — копится код.\n\n"
    .. "2)  Рюкзак полон — беги на зелёный пад 💰 и продавай.\n\n"
    .. "3)  Стенды на карте: F — магазин, ребёрт, колесо, сундук.\n\n"
    .. "4)  По мосту — в следующую эпоху. Ворота открывает ребёрт.\n\n"
    .. "5)  🎁 БОНУСЫ — ежедневная награда и коды."
tstroke(tutBody, 1.2)

local tutBtn = Instance.new("TextButton")
tutBtn.AnchorPoint = Vector2.new(0.5, 1)
tutBtn.Position = UDim2.new(0.5, 0, 1, -14)
tutBtn.Size = UDim2.new(0, 210, 0, 50)
tutBtn.BackgroundColor3 = WHITE
tutBtn.Font = FONT
tutBtn.TextScaled = true
tutBtn.TextColor3 = WHITE
tutBtn.Text = "Понятно!"
tutBtn.ZIndex = 52
tutBtn.Parent = tut
corner(tutBtn, 12)
stroke(tutBtn, Color3.fromRGB(40, 120, 20), 2)
tstroke(tutBtn, 1.5)
vgrad(tutBtn, BUY_TOP, BUY_BOT, 90)
tutBtn.MouseButton1Click:Connect(function() tutBg:Destroy() end)

showToast("Удачной игры! 🚀")

--========================== АДМИН-ПАНЕЛЬ ===============================
local adminBuilt, adminUnlocked, adminFrame, adminTarget, adminAmount = false, false, nil, nil, nil

local function buildAdmin()
    if adminBuilt then return end
    adminBuilt = true

    adminFrame = Instance.new("Frame")
    adminFrame.Name = "AdminPanel"
    adminFrame.Size = UDim2.new(0, 480, 0, 460)
    adminFrame.Position = UDim2.new(0.5, -240, 0.5, -230)
    adminFrame.BackgroundColor3 = PANEL
    adminFrame.Visible = false
    adminFrame.ZIndex = 60
    adminFrame.Parent = gui
    corner(adminFrame, 22)
    stroke(adminFrame, Color3.fromRGB(255, 80, 80), 3)

    local title = Instance.new("TextLabel")
    title.BackgroundTransparency = 1
    title.Position = UDim2.new(0, 16, 0, 10)
    title.Size = UDim2.new(1, -64, 0, 40)
    title.Font = FONT
    title.TextScaled = true
    title.TextXAlignment = Enum.TextXAlignment.Left
    title.TextColor3 = Color3.fromRGB(255, 90, 90)
    title.Text = "🔧 АДМИН-ПАНЕЛЬ"
    title.ZIndex = 61
    title.Parent = adminFrame
    tstroke(title, 2)

    local closeA = Instance.new("TextButton")
    closeA.AnchorPoint = Vector2.new(1, 0)
    closeA.Position = UDim2.new(1, -12, 0, 10)
    closeA.Size = UDim2.new(0, 40, 0, 40)
    closeA.BackgroundTransparency = 1
    closeA.Font = FONT
    closeA.Text = "✕"
    closeA.TextColor3 = Color3.fromRGB(255, 90, 90)
    closeA.TextScaled = true
    closeA.ZIndex = 61
    closeA.Parent = adminFrame
    closeA.MouseButton1Click:Connect(function() adminFrame.Visible = false end)

    local function field(labelText, default, yoff)
        local lab = Instance.new("TextLabel")
        lab.BackgroundTransparency = 1
        lab.Position = UDim2.new(0, 16, 0, yoff)
        lab.Size = UDim2.new(0, 92, 0, 34)
        lab.Font = FONT
        lab.TextScaled = true
        lab.TextXAlignment = Enum.TextXAlignment.Left
        lab.TextColor3 = WHITE
        lab.Text = labelText
        lab.ZIndex = 61
        lab.Parent = adminFrame
        tstroke(lab, 1.5)

        local box = Instance.new("TextBox")
        box.Position = UDim2.new(0, 112, 0, yoff)
        box.Size = UDim2.new(1, -128, 0, 34)
        box.BackgroundColor3 = Color3.fromRGB(48, 44, 52)
        box.Font = FONT
        box.TextScaled = true
        box.TextColor3 = WHITE
        box.Text = default
        box.ClearTextOnFocus = false
        box.ZIndex = 61
        box.Parent = adminFrame
        corner(box, 8)
        stroke(box, Color3.fromRGB(120, 80, 80), 1.5)
        return box
    end

    adminTarget = field("Кому:", "СЕБЕ", 56)
    adminAmount = field("Сумма:", "100000", 96)

    local pickIdx = 0
    local pickBtn = Instance.new("TextButton")
    pickBtn.Position = UDim2.new(0, 16, 0, 138)
    pickBtn.Size = UDim2.new(1, -32, 0, 34)
    pickBtn.BackgroundColor3 = Color3.fromRGB(48, 44, 52)
    pickBtn.Font = FONT
    pickBtn.TextScaled = true
    pickBtn.TextColor3 = WHITE
    pickBtn.Text = "🎯 Цель: СЕБЕ (нажми — выбрать игрока)"
    pickBtn.ZIndex = 61
    pickBtn.Parent = adminFrame
    corner(pickBtn, 8)
    stroke(pickBtn, Color3.fromRGB(120, 80, 80), 1.5)
    pickBtn.MouseButton1Click:Connect(function()
        local names = {"СЕБЕ"}
        for _, pl in ipairs(Players:GetPlayers()) do table.insert(names, pl.Name) end
        pickIdx = (pickIdx % #names) + 1
        adminTarget.Text = names[pickIdx]
        pickBtn.Text = "🎯 Цель: " .. names[pickIdx]
    end)

    local scroll = Instance.new("ScrollingFrame")
    scroll.Position = UDim2.new(0, 16, 0, 182)
    scroll.Size = UDim2.new(1, -32, 1, -194)
    scroll.BackgroundTransparency = 1
    scroll.BorderSizePixel = 0
    scroll.ScrollBarThickness = 6
    scroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
    scroll.CanvasSize = UDim2.new(0, 0, 0, 0)
    scroll.ZIndex = 61
    scroll.Parent = adminFrame

    local grid = Instance.new("UIGridLayout")
    grid.CellSize = UDim2.new(0, 214, 0, 40)
    grid.CellPadding = UDim2.new(0, 8, 0, 8)
    grid.Parent = scroll

    local actions = {
        {"+ Деньги", "addMoney", Color3.fromRGB(45, 170, 95)},
        {"Установить деньги", "setMoney", Color3.fromRGB(45, 160, 115)},
        {"+ Ребёрт", "addRebirth", Color3.fromRGB(160, 90, 210)},
        {"Макс апгрейды", "maxUpgrades", Color3.fromRGB(60, 120, 210)},
        {"Открыть все зоны", "unlockZones", Color3.fromRGB(60, 140, 190)},
        {"Заполнить рюкзак", "fillCode", Color3.fromRGB(85, 130, 170)},
        {"Выдать x2 Деньги", "give2xMoney", Color3.fromRGB(190, 150, 45)},
        {"Выдать x2 Клики", "give2xClicks", Color3.fromRGB(190, 130, 45)},
        {"Выдать Авто-клик", "giveAutoClick", Color3.fromRGB(95, 105, 140)},
        {"Выдать Авто-прод.", "giveAutoSell", Color3.fromRGB(95, 105, 140)},
        {"Выдать VIP", "giveVIP", Color3.fromRGB(160, 130, 65)},
        {"Выдать Удачу x2", "giveLucky", Color3.fromRGB(120, 160, 90)},
        {"Выдать Турбо", "giveTurbo", Color3.fromRGB(120, 140, 200)},
        {"Сбросить ежедневку", "resetDaily", Color3.fromRGB(150, 120, 90)},
        {"Колесо бесплатно", "freeWheel", Color3.fromRGB(200, 110, 160)},
        {"Буст всему серверу", "serverBoost", Color3.fromRGB(230, 120, 60)},
        {"Деньги ВСЕМ игрокам", "giveAllMoney", Color3.fromRGB(200, 95, 65)},
        {"Сброс прогресса", "wipe", Color3.fromRGB(185, 65, 65)},
    }
    for idx, a in ipairs(actions) do
        local b = Instance.new("TextButton")
        b.LayoutOrder = idx
        b.BackgroundColor3 = a[3]
        b.Font = FONT
        b.TextScaled = true
        b.TextColor3 = WHITE
        b.Text = a[1]
        b.ZIndex = 61
        b.Parent = scroll
        corner(b, 9)
        tstroke(b, 1.5)
        local act = a[2]
        b.MouseButton1Click:Connect(function()
            AdminAction:FireServer(act, adminTarget.Text, adminAmount.Text)
        end)
    end
end

AdminOpen.OnClientEvent:Connect(function(show)
    adminUnlocked = true
    buildAdmin()
    if show then
        adminFrame.Visible = true
        showToast("🔧 Админ-панель: RightShift — скрыть/показать")
    end
end)

UserInputService.InputBegan:Connect(function(input, gpe)
    if input.KeyCode == Enum.KeyCode.K and UserInputService:IsKeyDown(Enum.KeyCode.LeftControl) then
        AdminRequest:FireServer()
    elseif input.KeyCode == Enum.KeyCode.RightShift and not gpe and adminUnlocked and adminFrame then
        adminFrame.Visible = not adminFrame.Visible
    end
end)
