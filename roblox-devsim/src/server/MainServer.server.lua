--========================================================================
--  СИМУЛЯТОР РАЗРАБОТЧИКА — СЕРВЕР
--  Логика игры, монетизация, награды, лидерборды, админка.
--  Карту строит ReplicatedStorage > DevSim > MapBuilder.
--  Все настройки — в ReplicatedStorage > DevSim > Config.
--  Лежит в ServerScriptService.
--========================================================================

local Players            = game:GetService("Players")
local ReplicatedStorage  = game:GetService("ReplicatedStorage")
local DataStoreService   = game:GetService("DataStoreService")
local MarketplaceService = game:GetService("MarketplaceService")
local RunService         = game:GetService("RunService")
local Lighting           = game:GetService("Lighting")
local Workspace          = game:GetService("Workspace")

local DevSim     = ReplicatedStorage:WaitForChild("DevSim")
local Config     = require(DevSim:WaitForChild("Config"))
local MapBuilder = require(DevSim:WaitForChild("MapBuilder"))

Players.CharacterAutoLoads = false
Players.RespawnTime = 2

local ZONES = Config.ZONES
local GEAR  = Config.GEAR

--========================================================================
--  ХРАНИЛИЩА
--========================================================================
local STORE_KEY = "DevSim_v2"
local dataStore, topStore, donateStore, receiptStore
pcall(function() dataStore    = DataStoreService:GetDataStore(STORE_KEY) end)
pcall(function() topStore     = DataStoreService:GetOrderedDataStore(STORE_KEY .. "_top") end)
pcall(function() donateStore  = DataStoreService:GetOrderedDataStore(STORE_KEY .. "_don") end)
pcall(function() receiptStore = DataStoreService:GetDataStore(STORE_KEY .. "_receipts") end)

--========================================================================
--  РЕМОУТЫ
--========================================================================
local Remotes = ReplicatedStorage:FindFirstChild("Remotes")
if not Remotes then
    Remotes = Instance.new("Folder")
    Remotes.Name = "Remotes"
    Remotes.Parent = ReplicatedStorage
end
local function makeRemote(name)
    local r = Remotes:FindFirstChild(name)
    if not r then
        r = Instance.new("RemoteEvent")
        r.Name = name
        r.Parent = Remotes
    end
    return r
end

local ClickCode    = makeRemote("ClickCode")
local SellCode     = makeRemote("SellCode")
local BuyUpgrade   = makeRemote("BuyUpgrade")
local Teleport     = makeRemote("Teleport")
local Toggle       = makeRemote("Toggle")
local BuyRobux     = makeRemote("BuyRobux")
local Notify       = makeRemote("Notify")
local AdminAction  = makeRemote("AdminAction")
local AdminOpen    = makeRemote("AdminOpen")
local AdminRequest = makeRemote("AdminRequest")
local OpenUI       = makeRemote("OpenUI")
local RedeemCode   = makeRemote("RedeemCode")
local ClaimDaily   = makeRemote("ClaimDaily")
local ClaimChest   = makeRemote("ClaimChest")
local SpinWheel    = makeRemote("SpinWheel")
local WheelResult  = makeRemote("WheelResult")
local Announce     = makeRemote("Announce")

--========================================================================
--  СОСТОЯНИЕ
--========================================================================
local data = {}
local clickBucket = {}
local lastFire = {}
local world = nil

local serverBoost = {mult = 1, expires = 0, by = ""}

local function throttle(plr, key, gap)
    local t = lastFire[plr]
    if not t then
        t = {}
        lastFire[plr] = t
    end
    local now = os.clock()
    if t[key] and now - t[key] < gap then return false end
    t[key] = now
    return true
end

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

local function notify(player, text)
    Notify:FireClient(player, text)
end

local function announce(text)
    Announce:FireAllClients(text)
end

local function defaultData()
    return {
        money = 0, rebirths = 0, donated = 0,
        gearLevel = 1, backpackLevel = 0, sellLevel = 0,
        code = 0, zone = 1, unlockedZone = 1,
        ownAutoClick = false, ownAutoSell = false, own2xMoney = false,
        own2xClicks = false, ownVIP = false, ownLucky = false, ownTurbo = false,
        autoClickOn = true, autoSellOn = true,
        boosts = {},                -- {kind = "money"/"code", mult = 2, expires = os.time() + N}
        dailyDay = 0, dailyStreak = 0,
        chestCount = 0, nextChest = 0,
        nextWheel = 0,
        codes = {},
        boughtStarter = false,
        groupRewarded = false,
    }
end

--========================================================================
--  МНОЖИТЕЛИ И БУСТЫ
--========================================================================
local function cleanBoosts(d)
    local now = os.time()
    local i = 1
    while i <= #d.boosts do
        if (d.boosts[i].expires or 0) <= now then
            table.remove(d.boosts, i)
        else
            i = i + 1
        end
    end
end

local function boostMult(d, kind)
    local now = os.time()
    local m = 1
    for _, b in ipairs(d.boosts) do
        if b.kind == kind and (b.expires or 0) > now then
            m = m * (b.mult or 1)
        end
    end
    return m
end

local function serverBoostActive()
    return serverBoost.expires > os.time()
end

local function moneyMult(d)
    local m = Config.rebirthMoneyMult(d.rebirths)
    if d.own2xMoney then m = m * 2 end
    m = m * boostMult(d, "money")
    if serverBoostActive() then m = m * serverBoost.mult end
    return m
end

local function clickMult(d)
    local m = Config.rebirthClickMult(d.rebirths)
    if d.own2xClicks then m = m * 2 end
    m = m * boostMult(d, "code")
    return m
end

local function luckyMult(d)
    return d.ownLucky and 2 or 1
end

local function addBoost(player, kind, mult, seconds, quiet)
    local d = data[player]
    if not d then return end
    table.insert(d.boosts, {kind = kind, mult = mult, expires = os.time() + seconds})
    if not quiet then
        local word = (kind == "money") and "деньги" or "код"
        notify(player, "⚡ x" .. mult .. " " .. word .. " на " .. timeStr(seconds) .. "!")
    end
end

--========================================================================
--  ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
--========================================================================
local function robuxAvailable()
    local keys = {}
    for key, id in pairs(Config.GAMEPASSES) do
        if id and id > 0 then table.insert(keys, key) end
    end
    for key, id in pairs(Config.PRODUCTS) do
        if id and id > 0 then table.insert(keys, key) end
    end
    return table.concat(keys, ",")
end
local AVAILABLE_KEYS = robuxAvailable()

local function updateStats(player)
    local d = data[player]
    if not d then return end
    local st = player:FindFirstChild("Stats")
    if not st then return end
    local ls = player:FindFirstChild("leaderstats")
    local zoneInfo = ZONES[d.zone] or ZONES[1]

    cleanBoosts(d)

    local perClick = math.max(1, math.floor(GEAR[d.gearLevel].perClick * clickMult(d)))
    st.Capacity.Value     = Config.backpackCapacity(d.backpackLevel)
    st.PerClick.Value     = perClick
    st.Code.Value         = d.code
    st.Zone.Value         = d.zone
    st.UnlockedZone.Value = d.unlockedZone
    st.ZoneName.Value     = zoneInfo.name .. "  (x" .. tostring(zoneInfo.mult) .. ")"

    local capGear = math.min(#GEAR, zoneInfo.maxGear)
    local capBp   = math.min(Config.BACKPACK_MAX, zoneInfo.maxBackpack)
    local capSell = math.min(Config.SELL_MAX, zoneInfo.maxSell)

    if d.backpackLevel >= capBp then
        st.BackpackCost.Value = -1
        st.BackpackInfo.Value = "Вмещает " .. Config.backpackCapacity(d.backpackLevel) .. " — потолок зоны"
    else
        st.BackpackCost.Value = Config.backpackCost(d.backpackLevel)
        st.BackpackInfo.Value = "Вмещает " .. Config.backpackCapacity(d.backpackLevel) .. " кода"
    end

    local nextGear = GEAR[d.gearLevel + 1]
    if not nextGear or d.gearLevel >= capGear then
        st.GearCost.Value = -1
        st.GearInfo.Value = GEAR[d.gearLevel].name .. (nextGear and "  (потолок зоны)" or "  (МАКС)")
    else
        st.GearCost.Value = nextGear.cost
        st.GearInfo.Value = GEAR[d.gearLevel].name .. " -> " .. nextGear.name .. "  (+" .. nextGear.perClick .. "/клик)"
    end

    if d.sellLevel >= capSell then
        st.SellCost.Value = -1
    else
        st.SellCost.Value = Config.sellCost(d.sellLevel)
    end
    local perUnit = Config.sellValue(d.sellLevel) * zoneInfo.mult * moneyMult(d)
    st.SellInfo.Value = "1 код = $" .. string.format("%.1f", perUnit)

    st.RebirthCost.Value = math.floor(math.min(Config.rebirthRequirement(d.rebirths), 9e15))
    st.RebirthInfo.Value = "Сброс прогресса, +50% денег навсегда"

    -- строка бустов
    local parts = {}
    if d.own2xMoney then table.insert(parts, "x2$") end
    if d.own2xClicks then table.insert(parts, "x2 код") end
    if d.ownLucky then table.insert(parts, "Удача x2") end
    if d.ownTurbo then table.insert(parts, "Турбо") end
    local now = os.time()
    for _, b in ipairs(d.boosts) do
        local left = (b.expires or 0) - now
        if left > 0 then
            table.insert(parts, "x" .. b.mult .. " " .. ((b.kind == "money") and "$" or "код") .. " " .. timeStr(left))
        end
    end
    if serverBoostActive() then
        table.insert(parts, "СЕРВЕР x" .. serverBoost.mult .. " " .. timeStr(serverBoost.expires - now))
    end
    st.Boosts.Value = (#parts > 0) and table.concat(parts, " | ") or "нет"

    local zlines = {}
    for i, z in ipairs(ZONES) do
        local unlocked = (i <= d.unlockedZone) and 1 or 0
        table.insert(zlines, z.name .. "|" .. unlocked .. "|" .. i .. "|" .. z.mult)
    end
    st.ZonesInfo.Value = table.concat(zlines, "\n")

    st.OwnAutoClick.Value = d.ownAutoClick
    st.OwnAutoSell.Value  = d.ownAutoSell
    st.Own2xMoney.Value   = d.own2xMoney
    st.Own2xClicks.Value  = d.own2xClicks
    st.OwnVIP.Value       = d.ownVIP
    st.OwnLucky.Value     = d.ownLucky
    st.OwnTurbo.Value     = d.ownTurbo
    st.AutoClickOn.Value  = d.autoClickOn
    st.AutoSellOn.Value   = d.autoSellOn
    st.Donated.Value      = math.floor(d.donated)

    -- таймеры наград
    local today = math.floor(os.time() / 86400)
    local claimedToday = (d.dailyDay == today)
    st.DailyReady.Value = not claimedToday
    if claimedToday then
        st.DailyDay.Value = math.clamp(d.dailyStreak, 1, #Config.DAILY)
    else
        local nextStreak = (d.dailyDay == today - 1) and (d.dailyStreak + 1) or 1
        st.DailyDay.Value = math.clamp(nextStreak, 1, #Config.DAILY)
    end
    st.ChestIn.Value    = math.max(0, math.floor(d.nextChest - os.time()))
    st.WheelIn.Value    = math.max(0, math.floor(d.nextWheel - os.time()))
    st.Available.Value  = AVAILABLE_KEYS
    st.ServerBoost.Value = serverBoostActive()
        and ("🔥 " .. serverBoost.by .. " включил x" .. serverBoost.mult .. " всему серверу! " .. timeStr(serverBoost.expires - now))
        or ""

    if ls then
        ls["Деньги"].Value  = math.floor(math.min(math.max(d.money, 0), 9e15))
        ls["Ребёрты"].Value = d.rebirths
    end
end

--========================================================================
--  ДОНАТ-СТАТИСТИКА
--========================================================================
local function addDonation(player, robux)
    local d = data[player]
    if not d then return end
    d.donated = d.donated + (robux or 0)
    if donateStore then
        pcall(function()
            donateStore:SetAsync("u_" .. player.UserId, math.clamp(math.floor(d.donated), 0, 2000000000))
        end)
    end
    updateStats(player)
end

--========================================================================
--  СОЗДАНИЕ ИГРОКА
--========================================================================
local function setOwnership(player, key, value)
    local d = data[player]
    if not d then return end
    if key == "AutoClick"   then d.ownAutoClick = value end
    if key == "AutoSell"    then d.ownAutoSell  = value end
    if key == "Money2x"     then d.own2xMoney   = value end
    if key == "Clicks2x"    then d.own2xClicks  = value end
    if key == "VIPTeleport" then d.ownVIP       = value end
    if key == "LuckyPass"   then d.ownLucky     = value end
    if key == "Turbo"       then d.ownTurbo     = value end
    updateStats(player)
end

local function checkPasses(player)
    if not data[player] then return end
    for key, id in pairs(Config.GAMEPASSES) do
        if id and id > 0 then
            local ok, owns = pcall(function()
                return MarketplaceService:UserOwnsGamePassAsync(player.UserId, id)
            end)
            if ok and owns then setOwnership(player, key, true) end
        end
    end
end

-- разовая награда за вступление в группу Roblox
local function checkGroupReward(player)
    local d = data[player]
    if not d then return end
    if (Config.GROUP_ID or 0) <= 0 then return end
    if d.groupRewarded then return end
    local ok, inGroup = pcall(function() return player:IsInGroup(Config.GROUP_ID) end)
    if not ok or not inGroup then return end
    d.groupRewarded = true
    local reward = Config.GROUP_REWARD or {}
    if reward.money then d.money = d.money + reward.money end
    updateStats(player)
    notify(player, "👥 Спасибо за вступление в группу! " .. (reward.text or ""))
end

local function setupPlayer(player)
    local d = defaultData()
    data[player] = d
    clickBucket[player] = {count = 0, t = os.clock()}

    if dataStore then
        local ok, saved = pcall(function() return dataStore:GetAsync("p_" .. player.UserId) end)
        if ok and type(saved) == "table" then
            for k, v in pairs(saved) do d[k] = v end
        end
    end

    d.code = 0
    d.zone = 1
    d.gearLevel     = math.clamp(d.gearLevel or 1, 1, #GEAR)
    d.backpackLevel = math.clamp(d.backpackLevel or 0, 0, Config.BACKPACK_MAX)
    d.sellLevel     = math.clamp(d.sellLevel or 0, 0, Config.SELL_MAX)
    d.unlockedZone  = math.clamp(d.unlockedZone or 1, 1, #ZONES)
    d.rebirths      = math.max(0, d.rebirths or 0)
    d.money         = math.max(0, d.money or 0)
    d.donated       = math.max(0, d.donated or 0)
    d.codes         = (type(d.codes) == "table") and d.codes or {}
    d.dailyDay      = d.dailyDay or 0
    d.dailyStreak   = d.dailyStreak or 0
    d.chestCount    = d.chestCount or 0

    -- бусты сохраняются в секундах остатка, чтобы не сгорали при выходе
    local restored = {}
    if type(d.boosts) == "table" then
        for _, b in ipairs(d.boosts) do
            local left = b.remain or ((b.expires or 0) - os.time())
            if left and left > 0 then
                table.insert(restored, {kind = b.kind, mult = b.mult, expires = os.time() + left})
            end
        end
    end
    d.boosts = restored
    d.nextChest = os.time() + Config.PLAYTIME_CHEST.every
    d.nextWheel = math.max(os.time(), d.nextWheel or 0)

    local ls = Instance.new("Folder")
    ls.Name = "leaderstats"
    local money = Instance.new("IntValue")
    money.Name = "Деньги"
    money.Value = math.floor(math.min(d.money, 9e15))
    money.Parent = ls
    local reb = Instance.new("IntValue")
    reb.Name = "Ребёрты"
    reb.Value = d.rebirths
    reb.Parent = ls
    ls.Parent = player

    local st = Instance.new("Folder")
    st.Name = "Stats"
    local function mk(cls, name, val)
        local v = Instance.new(cls)
        v.Name = name
        v.Value = val
        v.Parent = st
    end
    mk("IntValue", "Code", 0)
    mk("IntValue", "Capacity", Config.backpackCapacity(d.backpackLevel))
    mk("IntValue", "PerClick", 1)
    mk("IntValue", "BackpackCost", 0)
    mk("IntValue", "GearCost", 0)
    mk("IntValue", "SellCost", 0)
    mk("IntValue", "RebirthCost", 0)
    mk("IntValue", "Zone", 1)
    mk("IntValue", "UnlockedZone", 1)
    mk("IntValue", "Donated", math.floor(d.donated))
    mk("IntValue", "DailyDay", 1)
    mk("IntValue", "ChestIn", 0)
    mk("IntValue", "WheelIn", 0)
    mk("StringValue", "ZoneName", "")
    mk("StringValue", "BackpackInfo", "")
    mk("StringValue", "GearInfo", "")
    mk("StringValue", "SellInfo", "")
    mk("StringValue", "RebirthInfo", "")
    mk("StringValue", "Boosts", "нет")
    mk("StringValue", "ZonesInfo", "")
    mk("StringValue", "Available", "")
    mk("StringValue", "ServerBoost", "")
    mk("BoolValue", "OwnAutoClick", false)
    mk("BoolValue", "OwnAutoSell", false)
    mk("BoolValue", "Own2xMoney", false)
    mk("BoolValue", "Own2xClicks", false)
    mk("BoolValue", "OwnVIP", false)
    mk("BoolValue", "OwnLucky", false)
    mk("BoolValue", "OwnTurbo", false)
    mk("BoolValue", "AutoClickOn", d.autoClickOn)
    mk("BoolValue", "AutoSellOn", d.autoSellOn)
    mk("BoolValue", "DailyReady", false)
    st.Parent = player

    player.CharacterAdded:Connect(function(char)
        local dd = data[player]
        if not dd then return end
        task.wait(0.2)
        local hrp = char:FindFirstChild("HumanoidRootPart")
        if hrp then
            hrp.CFrame = CFrame.new(MapBuilder.zoneSpawn(math.min(dd.zone, dd.unlockedZone)))
        end
        updateStats(player)
    end)

    updateStats(player)
    task.spawn(checkPasses, player)
    task.spawn(function() checkGroupReward(player) end)
end

--========================================================================
--  БАЗОВЫЙ ГЕЙМПЛЕЙ
--========================================================================
local function writeCode(player)
    local d = data[player]
    if not d then return end
    local bucket = clickBucket[player]
    if not bucket then return end
    local now = os.clock()
    if now - bucket.t >= 1 then
        bucket.t = now
        bucket.count = 0
    end
    bucket.count = bucket.count + 1
    if bucket.count > Config.CLICK_LIMIT then return end

    local cap = Config.backpackCapacity(d.backpackLevel)
    if d.code >= cap then return end
    local add = math.max(1, math.floor(GEAR[d.gearLevel].perClick * clickMult(d)))
    d.code = math.min(cap, d.code + add)
    local st = player:FindFirstChild("Stats")
    if st then st.Code.Value = d.code end
end

local function sellAll(player, silent)
    local d = data[player]
    if not d then return end
    if d.code <= 0 then
        if not silent then notify(player, "Нечего продавать — напиши код!") end
        return
    end
    local zoneInfo = ZONES[d.zone] or ZONES[1]
    local perUnit = Config.sellValue(d.sellLevel) * zoneInfo.mult * moneyMult(d)
    local gain = math.floor(d.code * perUnit)
    d.money = d.money + gain
    d.code = 0
    updateStats(player)
    if not silent then notify(player, "💰 Продано! +$" .. fmt(gain)) end
end

local function killToSpawn(player)
    local char = player.Character
    local hum = char and char:FindFirstChildOfClass("Humanoid")
    if hum and hum.Health > 0 then hum.Health = 0 end
end

local function doRebirth(player, free)
    local d = data[player]
    if not d then return end
    if not free then
        local req = Config.rebirthRequirement(d.rebirths)
        if d.money < req then
            notify(player, "Нужно $" .. fmt(req) .. " для ребёрта")
            return false
        end
    end
    d.rebirths = d.rebirths + 1
    d.money = 0
    d.gearLevel = 1
    d.backpackLevel = 0
    d.sellLevel = 0
    d.code = 0
    d.zone = 1
    updateStats(player)
    notify(player, "🌟 РЕБЁРТ! Множитель денег x" .. string.format("%.2f", Config.rebirthMoneyMult(d.rebirths)))
    if d.rebirths % 5 == 0 then
        announce("🌟 " .. player.Name .. " сделал " .. d.rebirths .. "-й ребёрт!")
    end
    killToSpawn(player)
    return true
end

local function buy(player, kind)
    local d = data[player]
    if not d then return end
    local zoneInfo = ZONES[d.zone] or ZONES[1]

    if kind == "backpack" then
        if d.backpackLevel >= math.min(Config.BACKPACK_MAX, zoneInfo.maxBackpack) then
            notify(player, "Потолок зоны! Открой следующую локацию или сделай ребёрт")
            return
        end
        local cost = Config.backpackCost(d.backpackLevel)
        if d.money >= cost then
            d.money = d.money - cost
            d.backpackLevel = d.backpackLevel + 1
            updateStats(player)
            notify(player, "🎒 Рюкзак улучшен!")
        else
            notify(player, "Не хватает денег")
        end

    elseif kind == "gear" then
        local nextGear = GEAR[d.gearLevel + 1]
        if not nextGear then
            notify(player, "У тебя топовый ПК!")
            return
        end
        if d.gearLevel >= zoneInfo.maxGear then
            notify(player, "Потолок зоны! Открой следующую локацию или сделай ребёрт")
            return
        end
        if d.money >= nextGear.cost then
            d.money = d.money - nextGear.cost
            d.gearLevel = d.gearLevel + 1
            updateStats(player)
            notify(player, "💻 Куплено: " .. nextGear.name)
        else
            notify(player, "Не хватает денег")
        end

    elseif kind == "sell" then
        if d.sellLevel >= math.min(Config.SELL_MAX, zoneInfo.maxSell) then
            notify(player, "Потолок зоны! Открой следующую локацию или сделай ребёрт")
            return
        end
        local cost = Config.sellCost(d.sellLevel)
        if d.money >= cost then
            d.money = d.money - cost
            d.sellLevel = d.sellLevel + 1
            updateStats(player)
            notify(player, "📈 Цена продажи выросла!")
        else
            notify(player, "Не хватает денег")
        end

    elseif kind == "rebirth" then
        doRebirth(player, false)
    end
end

local function zoneUnlocked(d, target)
    if target <= d.unlockedZone then return true end
    local z = ZONES[target]
    if d.rebirths >= z.needRebirth and d.money >= z.needMoney then
        d.unlockedZone = math.max(d.unlockedZone, target)
        return true
    end
    return false
end

local function teleportToZone(player, target, viaVIP)
    local d = data[player]
    if not d then return end
    if type(target) ~= "number" then return end
    target = math.floor(target)
    if target < 1 or target > #ZONES then return end
    local z = ZONES[target]

    if not zoneUnlocked(d, target) then
        local msg = "🔒 " .. z.name .. ": нужно ребёртов " .. z.needRebirth
        if z.needMoney > 0 then msg = msg .. " или $" .. fmt(z.needMoney) end
        notify(player, msg)
        return
    end
    if viaVIP and not d.ownVIP then
        notify(player, "Нужен геймпасс VIP-Телепорт")
        BuyRobux:FireClient(player, "VIPTeleport")
        return
    end

    d.zone = target
    updateStats(player)
    local char = player.Character
    local hrp = char and char:FindFirstChild("HumanoidRootPart")
    if hrp then
        hrp.CFrame = CFrame.new(MapBuilder.zoneSpawn(target))
    end
    notify(player, "🚀 Зона: " .. z.name)
end

--========================================================================
--  НАГРАДЫ: ЕЖЕДНЕВКА, СУНДУК, КОЛЕСО, КОДЫ, ГРУППА
--========================================================================
local function giveReward(player, reward, source)
    local d = data[player]
    if not d then return end
    local mult = luckyMult(d)
    local text = {}
    if reward.money then
        local amount = math.floor(reward.money * mult)
        d.money = d.money + amount
        table.insert(text, "+$" .. fmt(amount))
    end
    if reward.boost then
        addBoost(player, reward.boost.kind, reward.boost.mult, reward.boost.time, true)
        table.insert(text, "x" .. reward.boost.mult .. " " .. ((reward.boost.kind == "money") and "деньги" or "код") .. " на " .. timeStr(reward.boost.time))
    end
    if reward.rebirth then
        d.rebirths = d.rebirths + reward.rebirth
        table.insert(text, "+" .. reward.rebirth .. " ребёрт")
    end
    if reward.code then
        local cap = Config.backpackCapacity(d.backpackLevel)
        d.code = math.min(cap, math.floor(cap * reward.code))
        table.insert(text, "рюкзак полон")
    end
    updateStats(player)
    notify(player, (source or "🎁") .. " " .. table.concat(text, ", "))
end

local function claimDaily(player)
    local d = data[player]
    if not d then return end
    local today = math.floor(os.time() / 86400)
    if d.dailyDay == today then
        notify(player, "Сегодня уже забрал. Заходи завтра!")
        return
    end
    if d.dailyDay == today - 1 then
        d.dailyStreak = math.min(d.dailyStreak + 1, #Config.DAILY)
    else
        d.dailyStreak = 1
    end
    d.dailyDay = today
    local reward = Config.DAILY[d.dailyStreak] or Config.DAILY[1]
    giveReward(player, reward, "🎁 День " .. d.dailyStreak .. ":")
    updateStats(player)
end

local function claimChest(player)
    local d = data[player]
    if not d then return end
    if os.time() < d.nextChest then
        notify(player, "Сундук будет через " .. timeStr(d.nextChest - os.time()))
        return
    end
    d.chestCount = d.chestCount + 1
    d.nextChest = os.time() + Config.PLAYTIME_CHEST.every
    local amount = math.floor(Config.PLAYTIME_CHEST.money * (Config.PLAYTIME_CHEST.growth ^ math.min(d.chestCount, 10)) * (1 + d.rebirths))
    giveReward(player, {money = amount}, "📦 Сундук за игру:")
end

local function pickWheelPrize()
    local total = 0
    for _, p in ipairs(Config.WHEEL) do total = total + p.weight end
    local roll = math.random() * total
    local acc = 0
    for i, p in ipairs(Config.WHEEL) do
        acc = acc + p.weight
        if roll <= acc then return i, p end
    end
    return 1, Config.WHEEL[1]
end

local function spinWheel(player, paid)
    local d = data[player]
    if not d then return end
    if not paid then
        if os.time() < d.nextWheel then
            notify(player, "Бесплатный прокрут через " .. timeStr(d.nextWheel - os.time()))
            if (Config.PRODUCTS.WheelSpin or 0) > 0 then
                notify(player, "Можно крутить сразу за Robux в меню 💎")
            end
            return
        end
        d.nextWheel = os.time() + Config.WHEEL_FREE_EVERY
    end

    local index, prize = pickWheelPrize()
    WheelResult:FireClient(player, index, prize.text)

    task.delay(2.6, function()
        if not data[player] then return end
        if prize.kind == "money" then
            giveReward(player, {money = prize.value}, "🎰 Колесо:")
        elseif prize.kind == "boost" then
            giveReward(player, {boost = prize.value}, "🎰 Колесо:")
        elseif prize.kind == "code" then
            giveReward(player, {code = prize.value}, "🎰 Колесо:")
        elseif prize.kind == "rebirth" then
            d.rebirths = d.rebirths + prize.value
            updateStats(player)
            notify(player, "🎰 Колесо: +" .. prize.value .. " РЕБЁРТ!")
            announce("🎰 " .. player.Name .. " выбил РЕБЁРТ на колесе удачи!")
        end
        updateStats(player)
    end)
end

local function redeemCode(player, text)
    local d = data[player]
    if not d then return end
    if type(text) ~= "string" then return end
    local key = string.upper((string.gsub(text, "^%s*(.-)%s*$", "%1")))
    if key == "" or #key > 32 then return end
    local reward = Config.CODES[key]
    if not reward then
        notify(player, "❌ Такого кода нет")
        return
    end
    if d.codes[key] then
        notify(player, "Этот код уже использован")
        return
    end
    d.codes[key] = true
    giveReward(player, reward, "🎟 Код " .. key .. ":")
end

--========================================================================
--  МОНЕТИЗАЦИЯ
--========================================================================
local productHandlers = {}
for key, id in pairs(Config.PRODUCTS) do
    if id and id > 0 then productHandlers[id] = key end
end

local function grantProduct(player, key)
    local d = data[player]
    if not d then return false end

    if key == "Rebirth" then
        doRebirth(player, true)
    elseif key == "SkipRebirth" then
        d.rebirths = d.rebirths + 3
        d.money = 0
        d.gearLevel = 1
        d.backpackLevel = 0
        d.sellLevel = 0
        d.code = 0
        notify(player, "🌟 +3 ребёрта!")
    elseif Config.CASH_AMOUNT[key] then
        d.money = d.money + Config.CASH_AMOUNT[key]
        notify(player, "💵 +$" .. fmt(Config.CASH_AMOUNT[key]))
    elseif Config.BOOSTS[key] then
        local b = Config.BOOSTS[key]
        addBoost(player, b.kind, b.mult, b.time)
    elseif key == "ServerBoost" then
        serverBoost.mult = Config.SERVER_BOOST.mult
        serverBoost.expires = os.time() + Config.SERVER_BOOST.time
        serverBoost.by = player.Name
        announce("🔥 " .. player.Name .. " включил x" .. serverBoost.mult .. " ВСЕМУ СЕРВЕРУ на " .. timeStr(Config.SERVER_BOOST.time) .. "! Спасибо!")
        for _, pl in ipairs(Players:GetPlayers()) do
            notify(pl, "🔥 x" .. serverBoost.mult .. " деньги всем — спасибо " .. player.Name .. "!")
        end
    elseif key == "WheelSpin" then
        spinWheel(player, true)
    elseif key == "StarterPack" then
        if d.boughtStarter then
            notify(player, "Стартовый набор уже куплен")
        else
            d.boughtStarter = true
            d.money = d.money + Config.STARTER_PACK.money
            if Config.STARTER_PACK.boostMoney > 0 then
                addBoost(player, "money", 2, Config.STARTER_PACK.boostMoney, true)
            end
            if Config.STARTER_PACK.autoClick then d.ownAutoClick = true end
            notify(player, "🎒 Стартовый набор получен!")
        end
    else
        return false
    end

    addDonation(player, Config.PRICES[key] or 0)
    updateStats(player)
    return true
end

BuyRobux.OnServerEvent:Connect(function(player, key)
    if not throttle(player, "robux", 0.5) then return end
    if type(key) ~= "string" then return end
    local gp = Config.GAMEPASSES[key]
    local pr = Config.PRODUCTS[key]
    if gp then
        if gp > 0 then
            MarketplaceService:PromptGamePassPurchase(player, gp)
        else
            notify(player, "Этот геймпасс ещё не создан на сайте Roblox (ID = 0)")
        end
    elseif pr then
        if pr > 0 then
            MarketplaceService:PromptProductPurchase(player, pr)
        else
            notify(player, "Этот товар ещё не создан на сайте Roblox (ID = 0)")
        end
    end
end)

MarketplaceService.PromptGamePassPurchaseFinished:Connect(function(player, gpId, purchased)
    if not purchased then return end
    for key, id in pairs(Config.GAMEPASSES) do
        if id == gpId then
            setOwnership(player, key, true)
            addDonation(player, Config.PRICES[key] or 0)
            notify(player, "✅ Спасибо за покупку!")
            announce("💎 " .. player.Name .. " купил: " .. (Config.NAMES[key] or key) .. "!")
        end
    end
end)

MarketplaceService.ProcessReceipt = function(receipt)
    local player = Players:GetPlayerByUserId(receipt.PlayerId)
    if not player then return Enum.ProductPurchaseDecision.NotProcessedYet end
    if not data[player] then return Enum.ProductPurchaseDecision.NotProcessedYet end

    local key = productHandlers[receipt.ProductId]
    if not key then return Enum.ProductPurchaseDecision.NotProcessedYet end

    local rkey = "r_" .. receipt.PlayerId .. "_" .. tostring(receipt.PurchaseId)
    if receiptStore then
        local okc, already = pcall(function() return receiptStore:GetAsync(rkey) end)
        if okc and already then return Enum.ProductPurchaseDecision.PurchaseGranted end
    end

    local ok = grantProduct(player, key)
    if not ok then return Enum.ProductPurchaseDecision.NotProcessedYet end

    if receiptStore then
        local oks = pcall(function() receiptStore:SetAsync(rkey, true) end)
        if not oks then return Enum.ProductPurchaseDecision.NotProcessedYet end
    end
    return Enum.ProductPurchaseDecision.PurchaseGranted
end

--========================================================================
--  СОХРАНЕНИЕ
--========================================================================
local function savePlayer(player)
    local d = data[player]
    if not d or not dataStore then return end

    local boosts = {}
    local now = os.time()
    for _, b in ipairs(d.boosts) do
        local left = (b.expires or 0) - now
        if left > 0 then
            table.insert(boosts, {kind = b.kind, mult = b.mult, remain = left})
        end
    end

    local payload = {
        money = math.floor(d.money), rebirths = d.rebirths, donated = math.floor(d.donated),
        gearLevel = d.gearLevel, backpackLevel = d.backpackLevel, sellLevel = d.sellLevel,
        unlockedZone = d.unlockedZone,
        ownAutoClick = d.ownAutoClick, ownAutoSell = d.ownAutoSell, own2xMoney = d.own2xMoney,
        own2xClicks = d.own2xClicks, ownVIP = d.ownVIP, ownLucky = d.ownLucky, ownTurbo = d.ownTurbo,
        autoClickOn = d.autoClickOn, autoSellOn = d.autoSellOn,
        boosts = boosts, dailyDay = d.dailyDay, dailyStreak = d.dailyStreak,
        chestCount = d.chestCount, nextWheel = d.nextWheel,
        codes = d.codes, boughtStarter = d.boughtStarter, groupRewarded = d.groupRewarded,
    }
    pcall(function() dataStore:SetAsync("p_" .. player.UserId, payload) end)
    if topStore then
        pcall(function()
            topStore:SetAsync("u_" .. player.UserId, math.clamp(math.floor(d.money), 0, 9000000000000000))
        end)
    end
end

--========================================================================
--  ОСВЕЩЕНИЕ (базовое; клиент дополняет его под зону)
--========================================================================
local function buildLighting()
    pcall(function() Lighting.Technology = Enum.Technology.Future end)
    Lighting.ClockTime = 14
    Lighting.Brightness = 2.6
    Lighting.Ambient = Color3.fromRGB(138, 142, 158)
    Lighting.OutdoorAmbient = Color3.fromRGB(140, 148, 168)
    Lighting.EnvironmentDiffuseScale = 0.6
    Lighting.EnvironmentSpecularScale = 0.4
    Lighting.GlobalShadows = true

    if not Lighting:FindFirstChildOfClass("Atmosphere") then
        local atm = Instance.new("Atmosphere")
        atm.Density = 0.24
        atm.Offset = 0.1
        atm.Color = Color3.fromRGB(196, 210, 238)
        atm.Decay = Color3.fromRGB(152, 172, 208)
        atm.Glare = 0.1
        atm.Haze = 1.2
        atm.Parent = Lighting
    end
    if not Lighting:FindFirstChildOfClass("Sky") then
        local sky = Instance.new("Sky")
        sky.StarCount = 0
        sky.Parent = Lighting
    end
    if not Lighting:FindFirstChildOfClass("BloomEffect") then
        local bloom = Instance.new("BloomEffect")
        bloom.Intensity = 0.55
        bloom.Size = 22
        bloom.Threshold = 1.2
        bloom.Parent = Lighting
    end
    if not Lighting:FindFirstChild("ZoneGrade") then
        local cc = Instance.new("ColorCorrectionEffect")
        cc.Name = "ZoneGrade"
        cc.Saturation = 0.16
        cc.Contrast = 0.06
        cc.Brightness = 0.02
        cc.TintColor = Color3.fromRGB(255, 252, 248)
        cc.Parent = Lighting
    end
    pcall(function()
        local terrain = Workspace:FindFirstChildOfClass("Terrain")
        if terrain and not terrain:FindFirstChildOfClass("Clouds") then
            local cl = Instance.new("Clouds")
            cl.Cover = 0.5
            cl.Density = 0.4
            cl.Color = Color3.fromRGB(255, 255, 255)
            cl.Parent = terrain
        end
    end)
end

--========================================================================
--  СТРОИМ МИР
--========================================================================
buildLighting()

world = MapBuilder.build({
    onClick = function(plr) writeCode(plr) end,

    onSell = function(plr, zoneIndex)
        local d = data[plr]
        if not d then return end
        d.zone = zoneIndex
        updateStats(plr)
        sellAll(plr)
    end,

    onShop    = function(plr) OpenUI:FireClient(plr, "shop") end,
    onDonate  = function(plr) OpenUI:FireClient(plr, "donate") end,
    onCodes   = function(plr) OpenUI:FireClient(plr, "codes") end,
    onRebirth = function(plr) OpenUI:FireClient(plr, "rebirth") end,
    onDaily   = function(plr) claimDaily(plr) end,
    onWheel   = function(plr) spinWheel(plr, false) end,

    onTravel = function(plr, target) teleportToZone(plr, target, false) end,

    onGateTouch = function(plr, target)
        local d = data[plr]
        if not d then return end
        if zoneUnlocked(d, target) then return end
        if not throttle(plr, "gate", 2) then return end
        local z = ZONES[target]
        local msg = "🔒 " .. z.name .. ": нужно ребёртов " .. z.needRebirth
        if z.needMoney > 0 then msg = msg .. " или $" .. fmt(z.needMoney) end
        notify(plr, msg)
    end,

    onVip = function(plr)
        local d = data[plr]
        if not d then return end
        if not d.ownVIP then
            notify(plr, "👑 VIP-лофт только для владельцев геймпасса VIP")
            BuyRobux:FireClient(plr, "VIPTeleport")
            return
        end
        local char = plr.Character
        local hrp = char and char:FindFirstChild("HumanoidRootPart")
        if hrp then
            hrp.CFrame = CFrame.new(MapBuilder.VIP_CENTER + Vector3.new(0, 12, 40))
            notify(plr, "👑 Добро пожаловать в VIP-лофт!")
        end
    end,

    onVipBoost = function(plr)
        local d = data[plr]
        if not d or not d.ownVIP then return end
        addBoost(plr, "money", 2, 60, true)
        updateStats(plr)
    end,

    onFall = function(plr)
        local d = data[plr]
        if not d then return end
        local char = plr.Character
        local hrp = char and char:FindFirstChild("HumanoidRootPart")
        if hrp then
            hrp.CFrame = CFrame.new(MapBuilder.zoneSpawn(math.min(d.zone, d.unlockedZone)))
        end
    end,
})

Players.CharacterAutoLoads = true
for _, plr in ipairs(Players:GetPlayers()) do
    task.spawn(function()
        setupPlayer(plr)
        if not plr.Character then plr:LoadCharacter() end
    end)
end
Players.PlayerAdded:Connect(setupPlayer)
Players.PlayerRemoving:Connect(function(plr)
    savePlayer(plr)
    data[plr] = nil
    clickBucket[plr] = nil
    lastFire[plr] = nil
end)
game:BindToClose(function()
    for _, plr in ipairs(Players:GetPlayers()) do savePlayer(plr) end
end)

--========================================================================
--  РЕМОУТЫ ОТ КЛИЕНТА
--========================================================================
ClickCode.OnServerEvent:Connect(function(plr) writeCode(plr) end)

SellCode.OnServerEvent:Connect(function(plr)
    if not throttle(plr, "sell", 0.4) then return end
    local d = data[plr]
    if not d then return end
    local char = plr.Character
    local hrp = char and char:FindFirstChild("HumanoidRootPart")
    if hrp then
        hrp.CFrame = CFrame.new(MapBuilder.zoneCenter(d.zone) + Vector3.new(0, 9, 72))
    end
    sellAll(plr)
end)

BuyUpgrade.OnServerEvent:Connect(function(plr, kind)
    if not throttle(plr, "buy", 0.1) then return end
    if type(kind) == "string" then buy(plr, kind) end
end)

Teleport.OnServerEvent:Connect(function(plr, idx)
    if not throttle(plr, "tp", 0.35) then return end
    teleportToZone(plr, idx, true)
end)

Toggle.OnServerEvent:Connect(function(plr, what, state)
    if not throttle(plr, "toggle", 0.18) then return end
    local d = data[plr]
    if not d then return end
    if what == "autoclick" then d.autoClickOn = state and true or false end
    if what == "autosell"  then d.autoSellOn  = state and true or false end
    updateStats(plr)
end)

RedeemCode.OnServerEvent:Connect(function(plr, text)
    if not throttle(plr, "code", 1) then return end
    redeemCode(plr, text)
end)

ClaimDaily.OnServerEvent:Connect(function(plr)
    if not throttle(plr, "daily", 1) then return end
    claimDaily(plr)
end)

ClaimChest.OnServerEvent:Connect(function(plr)
    if not throttle(plr, "chest", 1) then return end
    claimChest(plr)
end)

SpinWheel.OnServerEvent:Connect(function(plr)
    if not throttle(plr, "wheel", 1) then return end
    spinWheel(plr, false)
end)

--========================================================================
--  ФОНОВЫЕ ЦИКЛЫ
--========================================================================
-- авто-клик и авто-продажа
task.spawn(function()
    while true do
        task.wait(0.4)
        for _, plr in ipairs(Players:GetPlayers()) do
            local d = data[plr]
            if d then
                if d.ownAutoClick and d.autoClickOn then
                    local times = d.ownTurbo and 3 or 1
                    for _ = 1, times do writeCode(plr) end
                end
                if d.ownAutoSell and d.autoSellOn then
                    local cap = Config.backpackCapacity(d.backpackLevel)
                    if d.code >= cap and d.code > 0 then sellAll(plr, true) end
                end
            end
        end
    end
end)

-- определение зоны по позиции + мягкая защита закрытых зон
task.spawn(function()
    while true do
        task.wait(1)
        for _, plr in ipairs(Players:GetPlayers()) do
            local d = data[plr]
            local char = plr.Character
            local hrp = char and char:FindFirstChild("HumanoidRootPart")
            if d and hrp and hrp.Position.Y < 120 then
                local zi = MapBuilder.zoneFromPosition(hrp.Position)
                if zi ~= d.zone then
                    if zoneUnlocked(d, zi) then
                        d.zone = zi
                        updateStats(plr)
                    else
                        hrp.CFrame = CFrame.new(MapBuilder.zoneSpawn(math.min(d.unlockedZone, #ZONES)))
                        notify(plr, "🔒 " .. ZONES[zi].name .. ": нужно ребёртов " .. ZONES[zi].needRebirth)
                    end
                end
            end
        end
    end
end)

-- обновление таймеров в интерфейсе
task.spawn(function()
    while true do
        task.wait(1)
        for _, plr in ipairs(Players:GetPlayers()) do
            if data[plr] then updateStats(plr) end
        end
    end
end)

-- сундук за время в игре выдаётся сам, как только созрел
task.spawn(function()
    while true do
        task.wait(10)
        for _, plr in ipairs(Players:GetPlayers()) do
            local d = data[plr]
            if d and os.time() >= d.nextChest then
                claimChest(plr)
            end
        end
    end
end)

-- автосохранение
task.spawn(function()
    while true do
        task.wait(Config.AUTOSAVE_EVERY)
        for _, plr in ipairs(Players:GetPlayers()) do
            task.spawn(savePlayer, plr)
        end
    end
end)

-- лидерборды
local function refreshBoard(store, label, isMoney)
    if not store or not label then return end
    local ok, pages = pcall(function() return store:GetSortedAsync(false, 10) end)
    if ok and pages then
        local page = pages:GetCurrentPage()
        local lines = {}
        for rank, entry in ipairs(page) do
            local uid = tonumber((string.gsub(entry.key, "u_", "")))
            local name = "Игрок"
            if uid then
                pcall(function() name = Players:GetNameFromUserIdAsync(uid) end)
            end
            local val = isMoney and ("$" .. fmt(entry.value)) or (fmt(entry.value) .. " R$")
            table.insert(lines, rank .. ". " .. name .. " — " .. val)
        end
        if #lines == 0 then lines = {"Пока пусто.", "Будь первым!"} end
        label.Text = table.concat(lines, "\n")
    else
        label.Text = "Топ появится после\nпубликации игры\n(нужен доступ к DataStore)."
    end
end

task.spawn(function()
    while true do
        if world then
            refreshBoard(topStore, world.topList, true)
            refreshBoard(donateStore, world.donList, false)
        end
        task.wait(60)
    end
end)

--========================================================================
--  АДМИНКА
--========================================================================
local function isAdmin(plr)
    if Config.ADMINS[plr.UserId] then return true end
    if RunService:IsStudio() then return true end
    if game.CreatorType == Enum.CreatorType.User and plr.UserId == game.CreatorId then return true end
    return false
end

local function adminTargetOf(plr, targetName)
    if not targetName or targetName == "" or targetName == "СЕБЕ" or targetName == "self" then return plr end
    return Players:FindFirstChild(targetName) or plr
end

AdminAction.OnServerEvent:Connect(function(plr, action, targetName, amount)
    if not throttle(plr, "admin", 0.08) then return end
    if not isAdmin(plr) then return end
    if type(action) ~= "string" then return end
    amount = tonumber(amount) or 0

    if action == "giveAllMoney" then
        for _, pl in ipairs(Players:GetPlayers()) do
            local dd = data[pl]
            if dd then
                dd.money = dd.money + amount
                updateStats(pl)
            end
        end
        notify(plr, "Админ: всем +$" .. fmt(amount))
        return
    end
    if action == "serverBoost" then
        serverBoost.mult = Config.SERVER_BOOST.mult
        serverBoost.expires = os.time() + Config.SERVER_BOOST.time
        serverBoost.by = plr.Name
        announce("🔥 Админ включил x" .. serverBoost.mult .. " всему серверу!")
        return
    end

    local target = adminTargetOf(plr, targetName)
    local d = data[target]
    if not d then return end

    if action == "addMoney" then d.money = d.money + amount
    elseif action == "setMoney" then d.money = math.max(0, amount)
    elseif action == "addRebirth" then d.rebirths = d.rebirths + math.max(1, math.floor(amount))
    elseif action == "maxUpgrades" then
        d.gearLevel = #GEAR
        d.backpackLevel = Config.BACKPACK_MAX
        d.sellLevel = Config.SELL_MAX
    elseif action == "unlockZones" then d.unlockedZone = #ZONES
    elseif action == "fillCode" then d.code = Config.backpackCapacity(d.backpackLevel)
    elseif action == "give2xMoney" then d.own2xMoney = true
    elseif action == "give2xClicks" then d.own2xClicks = true
    elseif action == "giveAutoClick" then d.ownAutoClick = true
    elseif action == "giveAutoSell" then d.ownAutoSell = true
    elseif action == "giveVIP" then d.ownVIP = true
    elseif action == "giveLucky" then d.ownLucky = true
    elseif action == "giveTurbo" then d.ownTurbo = true
    elseif action == "resetDaily" then d.dailyDay = 0
    elseif action == "freeWheel" then d.nextWheel = 0
    elseif action == "wipe" then
        d.money = 0
        d.code = 0
        d.gearLevel = 1
        d.backpackLevel = 0
        d.sellLevel = 0
    end

    updateStats(target)
    notify(plr, "Админ: " .. action .. " -> " .. target.Name)
    if target ~= plr then notify(target, "Админ применил: " .. action) end
end)

AdminRequest.OnServerEvent:Connect(function(plr)
    if not throttle(plr, "adminreq", 0.5) then return end
    if isAdmin(plr) then AdminOpen:FireClient(plr, true) end
end)

local function hookAdminChat(plr)
    plr.Chatted:Connect(function(msg)
        if isAdmin(plr) and msg == Config.ADMIN_SECRET then
            AdminOpen:FireClient(plr, true)
        end
    end)
end
Players.PlayerAdded:Connect(hookAdminChat)
for _, pl in ipairs(Players:GetPlayers()) do hookAdminChat(pl) end

print("[DevSim] Сервер запущен, версия " .. Config.VERSION)
